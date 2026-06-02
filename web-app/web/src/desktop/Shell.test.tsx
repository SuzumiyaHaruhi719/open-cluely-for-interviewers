import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react';
import { installMockWebSocket, MockWebSocket } from '../test/mockWebSocket';
import { Shell } from './Shell';

let restore: () => void;

/** Minimal JSON Response double for the HTTP API the shell hits on mount. */
function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as Response;
}

interface FetchCall {
  url: string;
  method: string;
  body: unknown;
}

let fetchCalls: FetchCall[];

beforeEach(() => {
  restore = installMockWebSocket();
  fetchCalls = [];
  // The shell loads the session list on mount and may POST sessions/messages;
  // route those to in-memory fakes so tests don't hit the network.
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    fetchCalls.push({ url, method, body });

    if (url.endsWith('/api/sessions') && method === 'POST') {
      return Promise.resolve(
        jsonResponse({ session: { id: 'new-1', title: body?.title ?? 'New interview' } })
      );
    }
    if (url.endsWith('/api/sessions')) {
      return Promise.resolve(jsonResponse({ sessions: [] }));
    }
    if (url.includes('/api/sessions/')) {
      return Promise.resolve(jsonResponse({ ok: true, messageCount: 1 }));
    }
    if (url.includes('/api/assistant/')) {
      return Promise.resolve(jsonResponse({ reply: 'Assistant reply.' }));
    }
    if (url.includes('/api/resume/')) {
      return Promise.resolve(jsonResponse({ text: '', reply: '' }));
    }
    return Promise.reject(new Error(`unexpected url ${url}`));
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  restore();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.classList.remove('rail-collapsed');
  localStorage.clear();
});

/** Open the socket so the shell reports a ready session. */
function openSocket(): MockWebSocket {
  const ws = MockWebSocket.last();
  act(() => {
    ws.open();
    ws.emit({ type: 'ready', sessionId: 'sess-1' });
  });
  return ws;
}

function lastConfig(ws: MockWebSocket): Record<string, unknown> | null {
  for (let i = ws.sent.length - 1; i >= 0; i -= 1) {
    const msg = JSON.parse(ws.sent[i]);
    if (msg.type === 'configure') {
      return msg.config;
    }
  }
  return null;
}

/** Let the on-mount `useSessions` fetch resolve so state settles inside act(). */
async function flushMount(): Promise<void> {
  await waitFor(() => {
    expect(fetchCalls.some((c) => c.url.endsWith('/api/sessions'))).toBe(true);
  });
}

describe('Shell', () => {
  test('renders the desktop shell structure (titlebar, layout panes, composer)', async () => {
    render(<Shell />);
    await flushMount();
    expect(document.querySelector('.app-shell')).toBeInTheDocument();
    expect(document.querySelector('.titlebar')).toBeInTheDocument();
    expect(document.querySelector('.layout > .sidebar')).toBeInTheDocument();
    expect(document.querySelector('.layout > .main')).toBeInTheDocument();
    expect(document.querySelector('.layout > .right-rail')).toBeInTheDocument();
    expect(document.querySelector('.composer .composer__channels')).toBeInTheDocument();
    // Both dual channels with the desktop ids.
    expect(document.getElementById('channel-computer')).toBeInTheDocument();
    expect(document.getElementById('channel-mic')).toBeInTheDocument();
  });

  test('selecting a mode in settings updates #mode-indicator and sends configure', async () => {
    render(<Shell />);
    await flushMount();
    const ws = openSocket();

    // Default mode is expert.
    const indicator = document.getElementById('mode-indicator');
    expect(indicator).toHaveAttribute('data-mode', 'expert');

    // Open settings, pick Fast.
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(screen.getByRole('radio', { name: /Fast/ }));

    expect(document.getElementById('mode-indicator')).toHaveAttribute('data-mode', 'fast');
    expect(lastConfig(ws)).toMatchObject({ mode: 'fast' });
  });

  test('rail toggle flips body.rail-collapsed and persists to localStorage', async () => {
    render(<Shell />);
    await flushMount();
    expect(document.body.classList.contains('rail-collapsed')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Toggle right panel' }));

    expect(document.body.classList.contains('rail-collapsed')).toBe(true);
    expect(localStorage.getItem('open-cluely.railCollapsed')).toBe('true');
  });

  test('a manual note enables analyze and Generate Q sends an analyze request', async () => {
    render(<Shell />);
    await flushMount();
    const ws = openSocket();

    // Add a note → fills the candidate-answer buffer.
    fireEvent.change(screen.getByLabelText('Manual context input'), {
      target: { value: 'We sharded by user id' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    fireEvent.click(screen.getByRole('button', { name: 'Generate Q' }));

    const analyzeMsg = ws.sent.map((s) => JSON.parse(s)).find((m) => m.type === 'analyze');
    expect(analyzeMsg).toBeTruthy();
    expect(analyzeMsg.candidateAnswer).toContain('We sharded by user id');
  });

  test('renders the AI question card when a result arrives', async () => {
    render(<Shell />);
    await flushMount();
    const ws = openSocket();

    fireEvent.change(screen.getByLabelText('Manual context input'), {
      target: { value: 'I used consistent hashing' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generate Q' }));

    const analyzeMsg = ws.sent.map((s) => JSON.parse(s)).find((m) => m.type === 'analyze');
    act(() => {
      ws.emit({
        type: 'result',
        requestId: analyzeMsg.requestId,
        mode: 'expert',
        output: {
          primary_question: 'How did you pick the hash ring size?',
          alternative_question: '',
          rationale_for_interviewer: '',
          anchor_quotes: ['consistent hashing'],
          expected_evidence_yield: '',
          iteration_version: '3'
        },
        shouldShowFollowUps: true,
        tokensUsed: { input: 10, output: 5, total: 15 },
        elapsedMs: 1200,
        iterationVersion: '3'
      });
    });

    expect(document.querySelector('.is-question-card')).toBeInTheDocument();
    expect(screen.getByText('How did you pick the hash ring size?')).toBeInTheDocument();
  });

  test('New interview opens the type picker and a card creates a session', async () => {
    render(<Shell />);
    await flushMount();

    fireEvent.click(screen.getByRole('button', { name: /New interview/ }));

    // The interview-type picker is shown (not .hidden).
    const modal = document.getElementById('interview-type-modal');
    expect(modal).toBeInTheDocument();
    expect(modal?.classList.contains('hidden')).toBe(false);

    // Picking the online card POSTs a new session.
    fireEvent.click(screen.getByText('线上面试 / Online').closest('button')!);

    await waitFor(() => {
      expect(
        fetchCalls.some((c) => c.url.endsWith('/api/sessions') && c.method === 'POST')
      ).toBe(true);
    });
    const post = fetchCalls.find((c) => c.url.endsWith('/api/sessions') && c.method === 'POST');
    expect(post?.body).toMatchObject({ interviewType: 'online' });
  });

  test('Ask AI calls the assistant endpoint and shows the reply in the results panel', async () => {
    render(<Shell />);
    await flushMount();
    openSocket();

    // Seed the answer buffer so Ask AI has a prompt.
    fireEvent.change(screen.getByLabelText('Manual context input'), {
      target: { value: 'They optimised the cache layer.' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    fireEvent.click(screen.getByRole('button', { name: /Ask AI/ }));

    // The results panel opens and renders the assistant reply.
    expect(await screen.findByText('Assistant reply.')).toBeInTheDocument();
    const panel = document.getElementById('results-panel');
    expect(panel?.classList.contains('hidden')).toBe(false);

    const ask = fetchCalls.find((c) => c.url.includes('/api/assistant/ask'));
    expect(ask?.body).toMatchObject({ prompt: 'They optimised the cache layer.' });

    // Closing the panel hides it.
    fireEvent.click(screen.getByRole('button', { name: 'Close response' }));
    await waitFor(() => {
      expect(document.getElementById('results-panel')?.classList.contains('hidden')).toBe(true);
    });
  });
});
