import { useCallback, useEffect, useState } from 'react';
import {
  ApiError,
  appendSessionMessage,
  createSession,
  deleteSession as apiDeleteSession,
  fetchSession,
  fetchSessions,
  updateSession,
  type CreateSessionBody,
  type SessionDetail,
  type SessionSummary,
  type UpdateSessionBody
} from '../lib/api';

const ACTIVE_ID_KEY = 'open-cluely.activeSessionId';

function errorMessage(error: unknown): string {
  if (error instanceof ApiError || error instanceof Error) {
    return error.message;
  }
  return 'Session request failed';
}

function readActiveId(): string | null {
  if (typeof localStorage === 'undefined') {
    return null;
  }
  return localStorage.getItem(ACTIVE_ID_KEY);
}

function persistActiveId(id: string | null): void {
  try {
    if (id) {
      localStorage.setItem(ACTIVE_ID_KEY, id);
    } else {
      localStorage.removeItem(ACTIVE_ID_KEY);
    }
  } catch {
    // Private-mode / quota — the in-memory id is what drives the UI.
  }
}

export interface UseSessions {
  /** Session summaries, newest-first as returned by the server. */
  sessions: SessionSummary[];
  /** The currently-selected session id, persisted to localStorage. */
  activeId: string | null;
  loading: boolean;
  error: string | null;
  /** Re-fetch the session list from the server. */
  refresh: () => Promise<SessionSummary[]>;
  /** Create a session, refresh the list, and select it. Returns the new id. */
  create: (body: CreateSessionBody) => Promise<string | null>;
  /** Fetch a single session's full detail (messages, JD, résumé). */
  load: (id: string) => Promise<SessionDetail | null>;
  /** Mark a session active (id only — caller hydrates the shell). */
  select: (id: string | null) => void;
  /** Rename a session and refresh the list. */
  rename: (id: string, title: string) => Promise<void>;
  /** Delete a session and refresh; clears active if it was the deleted one. */
  remove: (id: string) => Promise<void>;
  /** Persist a JD/résumé patch for a session (fire-and-forget friendly). */
  patch: (id: string, body: UpdateSessionBody) => Promise<void>;
  /** Append a transcript message to a session (candidate answer / AI question). */
  appendMessage: (id: string, role: string, text: string) => Promise<void>;
}

/**
 * Owns interview-history state for the sidebar: lists sessions, tracks the
 * active id (persisted to localStorage), and exposes create / load / rename /
 * delete / patch / append-message calls against the `/api/sessions` endpoints.
 *
 * Hydration of the shell (setting JD/résumé, replaying messages) is the
 * caller's job — `load()` returns the detail and `select()` only records which
 * id is active, keeping this hook free of shell/socket coupling.
 */
export function useSessions(): UseSessions {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(readActiveId);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<SessionSummary[]> => {
    setLoading(true);
    try {
      const res = await fetchSessions();
      setSessions(res.sessions);
      setError(null);
      return res.sessions;
    } catch (err: unknown) {
      setError(errorMessage(err));
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load on mount.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const select = useCallback((id: string | null): void => {
    setActiveId(id);
    persistActiveId(id);
  }, []);

  const create = useCallback(
    async (body: CreateSessionBody): Promise<string | null> => {
      try {
        const res = await createSession(body);
        await refresh();
        select(res.session.id);
        setError(null);
        return res.session.id;
      } catch (err: unknown) {
        setError(errorMessage(err));
        return null;
      }
    },
    [refresh, select]
  );

  const load = useCallback(async (id: string): Promise<SessionDetail | null> => {
    try {
      const res = await fetchSession(id);
      setError(null);
      return res.session;
    } catch (err: unknown) {
      setError(errorMessage(err));
      return null;
    }
  }, []);

  const rename = useCallback(
    async (id: string, title: string): Promise<void> => {
      try {
        await updateSession(id, { title });
        await refresh();
      } catch (err: unknown) {
        setError(errorMessage(err));
      }
    },
    [refresh]
  );

  const remove = useCallback(
    async (id: string): Promise<void> => {
      try {
        await apiDeleteSession(id);
      } catch (err: unknown) {
        setError(errorMessage(err));
      }
      if (id === activeId) {
        select(null);
      }
      await refresh();
    },
    [activeId, refresh, select]
  );

  const patch = useCallback(async (id: string, body: UpdateSessionBody): Promise<void> => {
    try {
      await updateSession(id, body);
    } catch (err: unknown) {
      setError(errorMessage(err));
    }
  }, []);

  const appendMessage = useCallback(
    async (id: string, role: string, text: string): Promise<void> => {
      try {
        await appendSessionMessage(id, { role, text });
      } catch (err: unknown) {
        setError(errorMessage(err));
      }
    },
    []
  );

  return {
    sessions,
    activeId,
    loading,
    error,
    refresh,
    create,
    load,
    select,
    rename,
    remove,
    patch,
    appendMessage
  };
}
