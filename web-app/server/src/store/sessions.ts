// ============================================================================
// File-based interview session store (web edition)
// ----------------------------------------------------------------------------
// Each session is one JSON file under `${DATA_DIR}/sessions/<id>.json`. There is
// no separate index file — `list()` reads the directory and projects a summary
// from each record (the corpus is small: one file per interview). All writes go
// through `persist()`, which bumps `updatedAt`.
//
// DATA_DIR is resolved lazily on every call from `process.env.DATA_DIR` (so
// tests can point it at a temp dir), falling back to `<server>/.data`.
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const SESSION_ROLES = ['candidate', 'interviewer', 'ai', 'note'] as const;
export type SessionRole = (typeof SESSION_ROLES)[number];

export interface SessionMessage {
  readonly role: SessionRole;
  readonly text: string;
  readonly ts: number;
}

export interface Session {
  readonly id: string;
  readonly title: string;
  readonly interviewType: string;
  readonly jobDescription: string;
  readonly resumeText: string;
  readonly messages: SessionMessage[];
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** The lightweight projection returned by `list()` for the history sidebar. */
export interface SessionSummary {
  readonly id: string;
  readonly title: string;
  readonly interviewType: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly messageCount: number;
}

const DEFAULT_TITLE = 'New interview';
const DEFAULT_INTERVIEW_TYPE = 'online';

/** Resolve the data dir lazily so a test can set DATA_DIR before any call. */
function dataDir(): string {
  return process.env.DATA_DIR || path.join(__dirname, '..', '..', '.data');
}

function sessionsDir(): string {
  return path.join(dataDir(), 'sessions');
}

function sessionPath(id: string): string {
  return path.join(sessionsDir(), `${id}.json`);
}

function ensureDir(): void {
  fs.mkdirSync(sessionsDir(), { recursive: true });
}

function isRole(value: unknown): value is SessionRole {
  return typeof value === 'string' && (SESSION_ROLES as readonly string[]).includes(value);
}

function sanitizeMessage(raw: unknown): SessionMessage | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const m = raw as Record<string, unknown>;
  const role = isRole(m.role) ? m.role : 'candidate';
  const text = typeof m.text === 'string' ? m.text : '';
  const ts = Number.isFinite(m.ts) ? (m.ts as number) : Date.now();
  return { role, text, ts };
}

function sanitizeSession(raw: unknown): Session | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const s = raw as Record<string, unknown>;
  if (typeof s.id !== 'string' || !s.id) return null;
  const createdAt = Number.isFinite(s.createdAt) ? (s.createdAt as number) : Date.now();
  return {
    id: s.id,
    title: typeof s.title === 'string' && s.title.trim() ? s.title : DEFAULT_TITLE,
    interviewType:
      typeof s.interviewType === 'string' && s.interviewType.trim()
        ? s.interviewType
        : DEFAULT_INTERVIEW_TYPE,
    jobDescription: typeof s.jobDescription === 'string' ? s.jobDescription : '',
    resumeText: typeof s.resumeText === 'string' ? s.resumeText : '',
    messages: Array.isArray(s.messages)
      ? s.messages.map(sanitizeMessage).filter((m): m is SessionMessage => m !== null)
      : [],
    createdAt,
    updatedAt: Number.isFinite(s.updatedAt) ? (s.updatedAt as number) : createdAt
  };
}

function readFile(id: string): Session | null {
  const file = sessionPath(id);
  try {
    if (!fs.existsSync(file)) return null;
    return sanitizeSession(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    return null;
  }
}

/** Write a session record verbatim (caller owns updatedAt). */
function persist(session: Session): Session {
  ensureDir();
  fs.writeFileSync(sessionPath(session.id), `${JSON.stringify(session, null, 2)}\n`, 'utf8');
  return session;
}

function toSummary(s: Session): SessionSummary {
  return {
    id: s.id,
    title: s.title,
    interviewType: s.interviewType,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    messageCount: s.messages.length
  };
}

/** Every session summary, newest-updated first. */
export function list(): SessionSummary[] {
  let files: string[] = [];
  try {
    ensureDir();
    files = fs.readdirSync(sessionsDir()).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const summaries: SessionSummary[] = [];
  for (const file of files) {
    const session = readFile(path.basename(file, '.json'));
    if (session) summaries.push(toSummary(session));
  }
  return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
}

export interface CreateInput {
  readonly title?: string;
  readonly interviewType?: string;
}

export function create(input: CreateInput = {}): Session {
  const now = Date.now();
  const session: Session = {
    id: crypto.randomUUID(),
    title: typeof input.title === 'string' && input.title.trim() ? input.title.trim() : DEFAULT_TITLE,
    interviewType:
      typeof input.interviewType === 'string' && input.interviewType.trim()
        ? input.interviewType.trim()
        : DEFAULT_INTERVIEW_TYPE,
    jobDescription: '',
    resumeText: '',
    messages: [],
    createdAt: now,
    updatedAt: now
  };
  return persist(session);
}

/** Full session record, or null if missing. */
export function get(id: string): Session | null {
  if (typeof id !== 'string' || !id) return null;
  return readFile(id);
}

export interface UpdateInput {
  readonly title?: string;
  readonly jobDescription?: string;
  readonly resumeText?: string;
}

/** Patch title / jobDescription / resumeText. Returns null if missing. */
export function update(id: string, patch: UpdateInput): Session | null {
  const session = readFile(id);
  if (!session) return null;
  const next: Session = {
    ...session,
    ...(typeof patch.title === 'string' && patch.title.trim() ? { title: patch.title.trim() } : {}),
    ...(typeof patch.jobDescription === 'string' ? { jobDescription: patch.jobDescription } : {}),
    ...(typeof patch.resumeText === 'string' ? { resumeText: patch.resumeText } : {}),
    updatedAt: Date.now()
  };
  return persist(next);
}

/** Delete a session file. Returns true if it existed (idempotent-ish). */
export function remove(id: string): boolean {
  if (typeof id !== 'string' || !id) return false;
  const file = sessionPath(id);
  try {
    if (!fs.existsSync(file)) return false;
    fs.unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}

/** Append one message; returns the new message count, or null if missing. */
export function appendMessage(id: string, role: SessionRole, text: string): number | null {
  const session = readFile(id);
  if (!session) return null;
  const message: SessionMessage = { role, text, ts: Date.now() };
  const next: Session = {
    ...session,
    messages: [...session.messages, message],
    updatedAt: Date.now()
  };
  persist(next);
  return next.messages.length;
}
