const sessionStore = require('../../../services/state/session-store');

// Persists/loads interview sessions for the chat-history sidebar. Mirrors the
// settings IPC style: every handler is wrapped in try/catch, logs server-side
// detail, and returns a { success, ... } envelope so the renderer never sees a
// raw rejection. The store itself never throws on reads (returns safe
// defaults), so failures here are limited to write/validation paths.

function registerSessionsIpc({ ipcMain, app, onSessionCreated = null }) {
  ipcMain.handle('session-list', () => {
    try {
      return { success: true, sessions: sessionStore.listSessions(app) };
    } catch (error) {
      console.error('Error listing sessions:', error);
      return { success: false, error: error.message, sessions: [] };
    }
  });

  ipcMain.handle('session-load', (_event, payload) => {
    try {
      const id = typeof payload === 'string' ? payload : payload?.id;
      const sessionId = String(id || '').trim();
      if (!sessionId) {
        return { success: false, error: 'empty-session-id', session: null };
      }
      const session = sessionStore.loadSession(app, sessionId);
      if (!session) {
        return { success: false, error: 'not-found', session: null };
      }
      return { success: true, session };
    } catch (error) {
      console.error('Error loading session:', error);
      return { success: false, error: error.message, session: null };
    }
  });

  ipcMain.handle('session-create', (_event, payload = {}) => {
    try {
      const title = typeof payload?.title === 'string' ? payload.title : '';
      const mode = String(payload?.mode || '').trim().toLowerCase();
      // online (dual-channel) vs offline (single room mic). The store
      // sanitizes to those two values and defaults to 'online'.
      const interviewType = String(payload?.interviewType || '').trim().toLowerCase();
      const session = sessionStore.createSession(app, { title, mode, interviewType });
      // Reset the global interviewer running-context so the new interview does
      // not inherit the previous one's consolidated topics/profile.
      if (typeof onSessionCreated === 'function') {
        try { onSessionCreated(session.id); } catch (err) { console.error('onSessionCreated failed:', err); }
      }
      return { success: true, session };
    } catch (error) {
      console.error('Error creating session:', error);
      return { success: false, error: error.message, session: null };
    }
  });

  ipcMain.handle('session-rename', (_event, payload = {}) => {
    try {
      const sessionId = String(payload?.id || '').trim();
      const title = String(payload?.title || '').trim();
      if (!sessionId) {
        return { success: false, error: 'empty-session-id' };
      }
      if (!title) {
        return { success: false, error: 'empty-title' };
      }
      const session = sessionStore.renameSession(app, sessionId, title);
      if (!session) {
        return { success: false, error: 'not-found' };
      }
      return { success: true, session };
    } catch (error) {
      console.error('Error renaming session:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('session-delete', (_event, payload) => {
    try {
      const id = typeof payload === 'string' ? payload : payload?.id;
      const sessionId = String(id || '').trim();
      if (!sessionId) {
        return { success: false, error: 'empty-session-id' };
      }
      const deleted = sessionStore.deleteSession(app, sessionId);
      return { success: deleted };
    } catch (error) {
      console.error('Error deleting session:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('session-append', (_event, payload = {}) => {
    try {
      const sessionId = String(payload?.id || '').trim();
      if (!sessionId) {
        return { success: false, error: 'empty-session-id', session: null };
      }
      const message = payload?.message;
      if (!message || typeof message !== 'object' || Array.isArray(message)) {
        return { success: false, error: 'invalid-message', session: null };
      }
      const session = sessionStore.appendMessage(app, sessionId, message);
      if (!session) {
        return { success: false, error: 'not-found', session: null };
      }
      return { success: true, session };
    } catch (error) {
      console.error('Error appending message to session:', error);
      return { success: false, error: error.message, session: null };
    }
  });

  // Patch the per-interview resume / JD snapshot onto a session record. Resume
  // is per-interview, not global: the renderer calls this after an upload/remove
  // so switching interviews shows THAT interview's resume.
  ipcMain.handle('session-update-context', (_event, payload = {}) => {
    try {
      const sessionId = String(payload?.id || '').trim();
      if (!sessionId) {
        return { success: false, error: 'empty-session-id', session: null };
      }
      const patch = {};
      if (typeof payload?.resumeText === 'string') patch.resumeText = payload.resumeText;
      if (typeof payload?.jobDescription === 'string') patch.jobDescription = payload.jobDescription;
      const session = sessionStore.updateSessionContext(app, sessionId, patch);
      if (!session) {
        return { success: false, error: 'not-found', session: null };
      }
      return { success: true, session };
    } catch (error) {
      console.error('Error updating session context:', error);
      return { success: false, error: error.message, session: null };
    }
  });
}

module.exports = {
  registerSessionsIpc
};
