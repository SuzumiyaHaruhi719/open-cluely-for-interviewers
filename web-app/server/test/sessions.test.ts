import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

import { createApp } from '../src/app';

// Point the file-based store at a throwaway dir. The store resolves DATA_DIR
// lazily on every call, so setting it before the first request (below) is
// enough — no import-order coupling.
const TMP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-sessions-'));
process.env.DATA_DIR = TMP_DATA_DIR;

interface SessionSummary {
  id: string;
  title: string;
  interviewType: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

interface Session extends SessionSummary {
  jobDescription: string;
  resumeText: string;
  messages: { role: string; text: string; ts: number }[];
}

async function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
  const server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

test('sessions: full CRUD + append, list ordering, 404s, message count', async () => {
  await withServer(async (base) => {
    // --- create two sessions ---------------------------------------------
    const createA = await fetch(`${base}/api/sessions`, json({ title: 'Alpha', interviewType: 'offline' }));
    assert.equal(createA.status, 200);
    const { session: a } = (await createA.json()) as { session: Session };
    assert.ok(a.id);
    assert.equal(a.title, 'Alpha');
    assert.equal(a.interviewType, 'offline');

    const createB = await fetch(`${base}/api/sessions`, json({}));
    const { session: b } = (await createB.json()) as { session: Session };
    assert.equal(b.title, 'New interview', 'default title applied');

    // --- list: newest-updated first (b was created after a) --------------
    const listRes = await fetch(`${base}/api/sessions`);
    assert.equal(listRes.status, 200);
    const { sessions } = (await listRes.json()) as { sessions: SessionSummary[] };
    assert.equal(sessions.length, 2);
    assert.equal(sessions[0].id, b.id, 'most recently updated session is first');
    assert.equal(sessions[1].id, a.id);
    for (const s of sessions) {
      assert.equal(typeof s.messageCount, 'number');
      assert.equal(s.messageCount, 0);
    }

    // --- get full record --------------------------------------------------
    const getRes = await fetch(`${base}/api/sessions/${a.id}`);
    assert.equal(getRes.status, 200);
    const { session: full } = (await getRes.json()) as { session: Session };
    assert.equal(full.id, a.id);
    assert.deepEqual(full.messages, []);
    assert.equal(full.jobDescription, '');
    assert.equal(full.resumeText, '');

    // --- 404 on missing get ----------------------------------------------
    const missing = await fetch(`${base}/api/sessions/does-not-exist`);
    assert.equal(missing.status, 404);

    // --- patch context ----------------------------------------------------
    const patchRes = await fetch(`${base}/api/sessions/${a.id}`, {
      ...json({ jobDescription: 'JD here', resumeText: 'résumé here', title: 'Alpha v2' }),
      method: 'PATCH'
    });
    assert.equal(patchRes.status, 200);
    const { session: patched } = (await patchRes.json()) as { session: Session };
    assert.equal(patched.jobDescription, 'JD here');
    assert.equal(patched.resumeText, 'résumé here');
    assert.equal(patched.title, 'Alpha v2');

    // --- 404 on patch missing --------------------------------------------
    const patchMissing = await fetch(`${base}/api/sessions/nope`, { ...json({ title: 'x' }), method: 'PATCH' });
    assert.equal(patchMissing.status, 404);

    // --- append messages, assert running count ---------------------------
    const m1 = await fetch(`${base}/api/sessions/${a.id}/messages`, json({ role: 'candidate', text: 'hello' }));
    assert.equal(m1.status, 200);
    const m1Body = (await m1.json()) as { ok: boolean; messageCount: number };
    assert.equal(m1Body.ok, true);
    assert.equal(m1Body.messageCount, 1);

    const m2 = await fetch(`${base}/api/sessions/${a.id}/messages`, json({ role: 'ai', text: 'hi back' }));
    const m2Body = (await m2.json()) as { messageCount: number };
    assert.equal(m2Body.messageCount, 2);

    // invalid role -> 400
    const badRole = await fetch(`${base}/api/sessions/${a.id}/messages`, json({ role: 'robot', text: 'x' }));
    assert.equal(badRole.status, 400);

    // append to missing session -> 404
    const appendMissing = await fetch(`${base}/api/sessions/nope/messages`, json({ role: 'note', text: 'x' }));
    assert.equal(appendMissing.status, 404);

    // messages persist + bump messageCount in the full record + list
    const after = await fetch(`${base}/api/sessions/${a.id}`);
    const { session: afterSession } = (await after.json()) as { session: Session };
    assert.equal(afterSession.messages.length, 2);
    assert.equal(afterSession.messages[0].text, 'hello');
    assert.equal(afterSession.messages[1].role, 'ai');

    // a now has activity so it sorts ahead of b
    const list2 = await fetch(`${base}/api/sessions`);
    const { sessions: sessions2 } = (await list2.json()) as { sessions: SessionSummary[] };
    assert.equal(sessions2[0].id, a.id, 'session with newest activity sorts first');
    assert.equal(sessions2.find((s) => s.id === a.id)?.messageCount, 2);

    // --- delete -----------------------------------------------------------
    const del = await fetch(`${base}/api/sessions/${b.id}`, { method: 'DELETE' });
    assert.equal(del.status, 200);
    assert.deepEqual(await del.json(), { ok: true });

    const list3 = await fetch(`${base}/api/sessions`);
    const { sessions: sessions3 } = (await list3.json()) as { sessions: SessionSummary[] };
    assert.equal(sessions3.length, 1);
    assert.equal(sessions3[0].id, a.id);

    // delete is forgiving: deleting an already-gone id still returns ok
    const delAgain = await fetch(`${base}/api/sessions/${b.id}`, { method: 'DELETE' });
    assert.equal(delAgain.status, 200);
  });
});

test.after(() => {
  fs.rmSync(TMP_DATA_DIR, { recursive: true, force: true });
});
