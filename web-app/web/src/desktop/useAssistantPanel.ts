import { useCallback, useState } from 'react';
import {
  ApiError,
  assistantAsk,
  assistantInsights,
  assistantNotes
} from '../lib/api';

interface PanelState {
  open: boolean;
  title: string;
  text: string;
  loading: boolean;
  error: string | null;
}

const CLOSED: PanelState = { open: false, title: '', text: '', loading: false, error: null };

function errorMessage(error: unknown): string {
  if (error instanceof ApiError || error instanceof Error) {
    return error.message;
  }
  return 'Assistant request failed';
}

export interface UseAssistantPanel {
  panel: PanelState;
  busy: boolean;
  /** Ask a free-form question (with optional grounding context). */
  ask: (prompt: string, context?: string) => Promise<void>;
  /** Summarise the transcript into meeting notes. */
  notes: (transcript: string) => Promise<void>;
  /** Generate interviewer insights from the transcript. */
  insights: (transcript: string) => Promise<void>;
  close: () => void;
}

/**
 * Drives the legacy results panel for the topbar assistant actions (Ask AI /
 * Meeting notes / Insights). Each action opens the panel in a loading state,
 * calls the matching `/api/assistant/*` endpoint, and replaces the body with the
 * reply (or a friendly error). `busy` is true while any call is in flight so the
 * topbar can disable the actions.
 */
export function useAssistantPanel(): UseAssistantPanel {
  const [panel, setPanel] = useState<PanelState>(CLOSED);

  const run = useCallback(
    async (title: string, call: () => Promise<{ reply: string }>): Promise<void> => {
      setPanel({ open: true, title, text: '', loading: true, error: null });
      try {
        const res = await call();
        setPanel({ open: true, title, text: res.reply ?? '', loading: false, error: null });
      } catch (err: unknown) {
        setPanel({ open: true, title, text: '', loading: false, error: errorMessage(err) });
      }
    },
    []
  );

  const ask = useCallback(
    (prompt: string, context?: string) =>
      run('AI Response', () =>
        assistantAsk(context === undefined ? { prompt } : { prompt, context })
      ),
    [run]
  );

  const notes = useCallback(
    (transcript: string) => run('Meeting notes', () => assistantNotes({ transcript })),
    [run]
  );

  const insights = useCallback(
    (transcript: string) => run('Insights', () => assistantInsights({ transcript })),
    [run]
  );

  const close = useCallback(() => setPanel(CLOSED), []);

  return { panel, busy: panel.loading, ask, notes, insights, close };
}
