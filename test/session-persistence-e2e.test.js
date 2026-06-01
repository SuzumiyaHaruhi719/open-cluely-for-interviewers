// End-to-end test of the interview-history persistence path the renderer now uses:
// the renderer keeps one ordered `liveConversation` and saves the WHOLE thing to
// the active session on every turn via session-set-messages (full replace). This
// exercises the REAL IPC handlers + session store, including a simulated app
// restart (new handler set, restore newest-with-content), to prove the
// conversation accumulates in ONE session and survives a restart.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { registerSessionsIpc } = require('../src/main-process/features/sessions/ipc');

// Minimal ipcMain mock: capture handlers so the test can invoke them like the
// renderer's preload would (channel → handler(payload)).
function makeApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-sess-'));
  // isPackaged:true so getStateBaseDir uses app.getPath (our temp dir) instead of
  // the dev project root — keeps the test isolated from the real cache/sessions.
  return { isPackaged: true, getPath: () => dir, _dir: dir };
}
function makeIpc() {
  const handlers = {};
  const ipcMain = { handle: (ch, fn) => { handlers[ch] = fn; } };
  const invoke = (ch, payload) => handlers[ch](null, payload);
  return { ipcMain, invoke };
}

test('conversation accumulates in one session via full-replace setMessages', async () => {
  const app = makeApp();
  const { ipcMain, invoke } = makeIpc();
  registerSessionsIpc({ ipcMain, app });

  // Renderer: ensureActiveSession → session-create on first activity.
  const created = await invoke('session-create', { title: 'Interview', mode: 'fast', interviewType: 'online' });
  assert.ok(created.success);
  const id = created.session.id;

  // Renderer records turns into liveConversation and full-replaces each time.
  const convo = [];
  const save = (turn) => { convo.push(turn); return invoke('session-set-messages', { id, messages: convo.slice() }); };

  await save({ role: 'candidate', source: 'system', kind: 'transcript', text: 'I led the migration.', ts: 1 });
  await save({ role: 'coach', kind: 'question', text: 'What call was yours alone?', ts: 2 });
  const r3 = await save({ role: 'candidate', source: 'system', kind: 'transcript', text: 'I chose Postgres.', ts: 3 });
  assert.ok(r3.success);

  // Reload (renderer handleSelectSession): all three present, in order, ONE session.
  const loaded = await invoke('session-load', { id });
  assert.strictEqual(loaded.session.messages.length, 3, 'all turns persisted to one session');
  assert.deepStrictEqual(loaded.session.messages.map((m) => m.kind), ['transcript', 'question', 'transcript']);
  const list = await invoke('session-list', {});
  assert.strictEqual(list.sessions.length, 1, 'no fragmentation — exactly one session');
  assert.strictEqual(list.sessions[0].messageCount, 3, 'index messageCount reflects content');

  fs.rmSync(app._dir, { recursive: true, force: true });
});

test('generated follow-up survives navigating away and back (the reported bug)', async () => {
  const app = makeApp();
  const { invoke, ipcMain } = makeIpc();
  registerSessionsIpc({ ipcMain, app });

  // Session A: a transcript + a Generate-Q follow-up (as renderExpertFollowUp /
  // renderInterviewerCoachMessage now record via recordConversationTurn).
  const a = (await invoke('session-create', { title: 'A', mode: 'expert' })).session.id;
  // Mirrors renderExpertFollowUp: a transcript, the PRIMARY follow-up, and the
  // ALTERNATIVE follow-up (+rationale) — all three must round-trip.
  const convoA = [
    { role: 'candidate', source: 'system', kind: 'transcript', text: 'we rewrote the ranking model', ts: 1 },
    { role: 'coach', kind: 'question', text: 'What call was yours alone, and what did it cost?', ts: 2 },
    { role: 'coach', kind: 'question', text: '**备选追问** Walk me through the tradeoff you rejected. *probes judgment*', ts: 3 }
  ];
  await invoke('session-set-messages', { id: a, messages: convoA });

  // Navigate away → new session B with its own turn.
  const b = (await invoke('session-create', { title: 'B', mode: 'expert' })).session.id;
  await invoke('session-set-messages', { id: b, messages: [{ role: 'coach', kind: 'question', text: 'B question', ts: 3 }] });

  // Navigate BACK to A: the follow-up question must still be there.
  const backToA = await invoke('session-load', { id: a });
  const questions = backToA.session.messages.filter((m) => m.kind === 'question').map((m) => m.text);
  assert.strictEqual(questions.length, 2, 'BOTH the follow-up and the candidate follow-up persist');
  assert.ok(questions.some((q) => q.includes('yours alone')), 'primary follow-up survived');
  assert.ok(questions.some((q) => q.includes('备选追问')), 'alternative follow-up survived');
  assert.strictEqual(backToA.session.messages.length, 3, 'A keeps all three turns; B did not bleed in');

  fs.rmSync(app._dir, { recursive: true, force: true });
});

test('history survives a simulated restart (restore newest-with-content + continue)', async () => {
  const app = makeApp();
  // --- run 1 ---
  let ipc = makeIpc();
  registerSessionsIpc({ ipcMain: ipc.ipcMain, app });
  const created = await ipc.invoke('session-create', { title: 'I1', mode: 'fast' });
  const id = created.session.id;
  const convo = [
    { role: 'candidate', source: 'system', kind: 'transcript', text: 'answer one', ts: 1 },
    { role: 'coach', kind: 'question', text: 'follow up one', ts: 2 }
  ];
  await ipc.invoke('session-set-messages', { id, messages: convo.slice() });

  // --- simulate app restart: brand-new handler set, no in-memory activeSessionId ---
  ipc = makeIpc();
  registerSessionsIpc({ ipcMain: ipc.ipcMain, app });
  // restoreLatestSession: pick newest entry with messageCount > 0.
  const list = await ipc.invoke('session-list', {});
  const target = list.sessions.find((s) => s.messageCount > 0) || list.sessions[0];
  assert.strictEqual(target.id, id, 'restore re-opens the interview that has content');
  const reloaded = await ipc.invoke('session-load', { id: target.id });
  // renderer re-hydrates liveConversation from the record, then continues it.
  const cont = reloaded.session.messages.map((m) => ({ role: m.role, source: m.source, kind: m.kind, text: m.text, ts: m.ts }));
  cont.push({ role: 'candidate', source: 'system', kind: 'transcript', text: 'answer two', ts: 3 });
  await ipc.invoke('session-set-messages', { id: target.id, messages: cont });

  const final = await ipc.invoke('session-load', { id });
  assert.strictEqual(final.session.messages.length, 3, 'post-restart turn appends to the SAME session');
  assert.strictEqual(final.session.messages[2].text, 'answer two');
  const finalList = await ipc.invoke('session-list', {});
  assert.strictEqual(finalList.sessions.length, 1, 'still one session after restart — no fragmentation');

  fs.rmSync(app._dir, { recursive: true, force: true });
});
