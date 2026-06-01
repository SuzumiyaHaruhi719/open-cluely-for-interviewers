const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Mirrors app-state.js storage conventions: one cache dir, dev writes to the
// project root (easy to inspect), packaged writes to userData (survives the
// portable-EXE temp-dir wipe). Each interview is one JSON file under
// cache/sessions/<id>.json plus a lightweight cache/sessions/index.json that
// lists every session for the history sidebar without reading each record.

const APP_STATE_DIR_NAME = 'cache';
const SESSIONS_DIR_NAME = 'sessions';
const SESSIONS_INDEX_FILE_NAME = 'index.json';

const VALID_MODES = ['fast', 'expert'];
// Online = dual-channel (computer-audio candidate + mic interviewer).
// Offline = in-person, single room microphone only. Defaults to online so any
// legacy session file without the field round-trips as the original behavior.
const VALID_INTERVIEW_TYPES = ['online', 'offline'];
const VALID_ROLES = ['candidate', 'interviewer', 'coach'];
const VALID_SOURCES = ['mic', 'system'];
const VALID_KINDS = ['transcript', 'question', 'note'];

function getDefaultSession({ id, title, startedAt, mode, interviewType } = {}) {
  return {
    id: id || crypto.randomUUID(),
    title: typeof title === 'string' && title.trim() ? title.trim() : 'Untitled interview',
    startedAt: Number.isFinite(startedAt) ? startedAt : Date.now(),
    mode: VALID_MODES.includes(mode) ? mode : 'fast',
    interviewType: VALID_INTERVIEW_TYPES.includes(interviewType) ? interviewType : 'online',
    resumeText: null,
    jobDescription: null,
    interviewerSessionState: null,
    messages: []
  };
}

function sanitizeMessage(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return null;
  }

  const text = typeof message.text === 'string' ? message.text : '';
  const role = VALID_ROLES.includes(message.role) ? message.role : 'candidate';

  const sanitized = {
    role,
    text,
    ts: Number.isFinite(message.ts) ? message.ts : Date.now()
  };

  if (VALID_SOURCES.includes(message.source)) {
    sanitized.source = message.source;
  }
  if (VALID_KINDS.includes(message.kind)) {
    sanitized.kind = message.kind;
  }
  if (typeof message.emotion === 'string' && message.emotion.trim()) {
    sanitized.emotion = message.emotion.trim();
  }

  return sanitized;
}

function sanitizeSession(session) {
  if (!session || typeof session !== 'object' || Array.isArray(session)) {
    return null;
  }

  const base = getDefaultSession({
    id: typeof session.id === 'string' ? session.id : undefined,
    title: typeof session.title === 'string' ? session.title : undefined,
    startedAt: Number.parseInt(String(session.startedAt ?? ''), 10),
    mode: String(session.mode ?? '').trim().toLowerCase(),
    interviewType: String(session.interviewType ?? '').trim().toLowerCase()
  });

  if (typeof session.resumeText === 'string') {
    const resumeText = session.resumeText.trim();
    base.resumeText = resumeText || null;
  }
  if (typeof session.jobDescription === 'string') {
    const jobDescription = session.jobDescription.trim();
    base.jobDescription = jobDescription || null;
  }
  if (
    session.interviewerSessionState &&
    typeof session.interviewerSessionState === 'object' &&
    !Array.isArray(session.interviewerSessionState)
  ) {
    base.interviewerSessionState = session.interviewerSessionState;
  }
  if (Array.isArray(session.messages)) {
    base.messages = session.messages.map(sanitizeMessage).filter(Boolean);
  }

  return base;
}

function sanitizeIndexEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return null;
  }
  if (typeof entry.id !== 'string' || !entry.id) {
    return null;
  }
  return {
    id: entry.id,
    title: typeof entry.title === 'string' && entry.title.trim() ? entry.title.trim() : 'Untitled interview',
    startedAt: Number.isFinite(entry.startedAt) ? entry.startedAt : Date.now(),
    mode: VALID_MODES.includes(entry.mode) ? entry.mode : 'fast',
    messageCount: Number.isFinite(entry.messageCount) ? entry.messageCount : 0,
    lastMessageAt: Number.isFinite(entry.lastMessageAt) ? entry.lastMessageAt : (Number.isFinite(entry.startedAt) ? entry.startedAt : Date.now())
  };
}

function indexEntryFromSession(session) {
  const lastMessage = Array.isArray(session.messages) && session.messages.length > 0
    ? session.messages[session.messages.length - 1]
    : null;
  return {
    id: session.id,
    title: session.title,
    startedAt: session.startedAt,
    mode: session.mode,
    messageCount: Array.isArray(session.messages) ? session.messages.length : 0,
    lastMessageAt: lastMessage && Number.isFinite(lastMessage.ts) ? lastMessage.ts : session.startedAt
  };
}

function getStateBaseDir(app) {
  // Dev: project root next to package.json (matches app-state.js so devs can
  // inspect both stores side by side).
  if (app && !app.isPackaged) {
    return path.join(__dirname, '..', '..', '..');
  }
  if (app) {
    return app.getPath('userData');
  }
  return path.join(__dirname, '..', '..', '..');
}

function getSessionsDir(app) {
  return path.join(getStateBaseDir(app), APP_STATE_DIR_NAME, SESSIONS_DIR_NAME);
}

function getSessionPath(app, id) {
  return path.join(getSessionsDir(app), `${id}.json`);
}

function getIndexPath(app) {
  return path.join(getSessionsDir(app), SESSIONS_INDEX_FILE_NAME);
}

function ensureSessionsDir(app) {
  fs.mkdirSync(getSessionsDir(app), { recursive: true });
}

function writeJsonFile(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readIndex(app) {
  const indexPath = getIndexPath(app);
  try {
    ensureSessionsDir(app);
    if (!fs.existsSync(indexPath)) {
      writeJsonFile(indexPath, []);
      return [];
    }
    const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map(sanitizeIndexEntry).filter(Boolean);
  } catch (error) {
    console.error('Failed to read sessions index:', error);
    return [];
  }
}

function writeIndex(app, entries) {
  ensureSessionsDir(app);
  writeJsonFile(getIndexPath(app), entries);
}

// Replace (or insert) one session's index entry and re-sort newest-first by
// last activity. Keeps the index authoritative on every mutation.
function upsertIndexEntry(app, session) {
  const entry = indexEntryFromSession(session);
  const index = readIndex(app);
  const next = index.filter((item) => item.id !== entry.id);
  next.push(entry);
  next.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  writeIndex(app, next);
  return entry;
}

function removeIndexEntry(app, id) {
  const index = readIndex(app);
  writeIndex(app, index.filter((item) => item.id !== id));
}

function listSessions(app) {
  return readIndex(app);
}

function loadSession(app, id) {
  if (typeof id !== 'string' || !id) {
    return null;
  }
  const sessionPath = getSessionPath(app, id);
  try {
    ensureSessionsDir(app);
    if (!fs.existsSync(sessionPath)) {
      return null;
    }
    const parsed = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
    return sanitizeSession(parsed);
  } catch (error) {
    console.error(`Failed to load session ${id}:`, error);
    return null;
  }
}

function persistSession(app, session) {
  ensureSessionsDir(app);
  writeJsonFile(getSessionPath(app, session.id), session);
  upsertIndexEntry(app, session);
  return session;
}

function createSession(app, { title, mode, interviewType } = {}) {
  const session = getDefaultSession({
    title,
    mode: String(mode ?? '').trim().toLowerCase(),
    interviewType: String(interviewType ?? '').trim().toLowerCase()
  });
  return persistSession(app, session);
}

function renameSession(app, id, title) {
  const session = loadSession(app, id);
  if (!session) {
    return null;
  }
  const nextTitle = typeof title === 'string' && title.trim() ? title.trim() : session.title;
  const nextSession = { ...session, title: nextTitle };
  return persistSession(app, nextSession);
}

function deleteSession(app, id) {
  if (typeof id !== 'string' || !id) {
    return false;
  }
  const sessionPath = getSessionPath(app, id);
  try {
    ensureSessionsDir(app);
    if (fs.existsSync(sessionPath)) {
      fs.unlinkSync(sessionPath);
    }
    removeIndexEntry(app, id);
    return true;
  } catch (error) {
    console.error(`Failed to delete session ${id}:`, error);
    return false;
  }
}

// Replace a session's entire message list in one write. The renderer persists
// the full visible chat on every change (the message store is the source of
// truth for what's shown), which is far more robust than incremental appends —
// no per-message races, ordering bugs, or fragmentation. Empty/garbage messages
// are dropped by sanitizeMessage.
function setMessages(app, id, messages) {
  const session = loadSession(app, id);
  if (!session) {
    return null;
  }
  const sanitized = (Array.isArray(messages) ? messages : []).map(sanitizeMessage).filter(Boolean);
  const nextSession = { ...session, messages: sanitized };
  return persistSession(app, nextSession);
}

function appendMessage(app, id, message) {
  const session = loadSession(app, id);
  if (!session) {
    return null;
  }
  const sanitized = sanitizeMessage(message);
  if (!sanitized) {
    return session;
  }
  const nextSession = {
    ...session,
    messages: [...session.messages, sanitized]
  };
  return persistSession(app, nextSession);
}

function updateSessionState(app, id, interviewerSessionState) {
  const session = loadSession(app, id);
  if (!session) {
    return null;
  }
  const nextState =
    interviewerSessionState &&
    typeof interviewerSessionState === 'object' &&
    !Array.isArray(interviewerSessionState)
      ? interviewerSessionState
      : null;
  const nextSession = { ...session, interviewerSessionState: nextState };
  return persistSession(app, nextSession);
}

// Patch the per-interview context snapshot (resume / job description) onto a
// session record. Each interview owns its own resumeText/jobDescription; the
// live app-state values are just a cache of the ACTIVE session (synced on
// switch). Only string fields present in `patch` are written, so a partial
// patch can set the resume without touching the JD and vice-versa.
function updateSessionContext(app, id, patch = {}) {
  const session = loadSession(app, id);
  if (!session) {
    return null;
  }
  const nextSession = { ...session };
  if (typeof patch.resumeText === 'string') {
    nextSession.resumeText = patch.resumeText;
  }
  if (typeof patch.jobDescription === 'string') {
    nextSession.jobDescription = patch.jobDescription;
  }
  return persistSession(app, nextSession);
}

module.exports = {
  getDefaultSession,
  listSessions,
  loadSession,
  createSession,
  renameSession,
  deleteSession,
  appendMessage,
  setMessages,
  updateSessionState,
  updateSessionContext
};
