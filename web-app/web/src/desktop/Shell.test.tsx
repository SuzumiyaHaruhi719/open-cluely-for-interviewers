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
  // Interviews are ephemeral — the shell makes NO session HTTP calls. Route the
  // remaining endpoints (assistant / résumé / pipelines) to in-memory fakes.
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    fetchCalls.push({ url, method, body });

    if (url.includes('/api/assistant/')) {
      return Promise.resolve(jsonResponse({ reply: 'Assistant reply.' }));
    }
    if (url.includes('/api/resume/')) {
      return Promise.resolve(jsonResponse({ text: '', reply: '' }));
    }
    if (url.endsWith('/api/pipelines/generate') && method === 'POST') {
      return Promise.resolve(
        jsonResponse({
          pipeline: { id: 'gen-be', name: 'AI Backend', builtin: false, nodes: [], edges: [] }
        })
      );
    }
    if (url.endsWith('/api/pipelines') && method === 'POST') {
      return Promise.resolve(jsonResponse({ id: 'gen-be' }));
    }
    if (url.endsWith('/api/pipelines')) {
      return Promise.resolve(
        jsonResponse({
          pipelines: [
            { id: 'builtin-role-backend', name: '资深后端', builtin: true },
            { id: 'builtin-role-pm', name: '产品经理', builtin: true }
          ]
        })
      );
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

/**
 * The shell auto-opens the interview-type picker on mount (ephemeral: a fresh
 * in-memory interview every open). Dismiss it so tests run against the default
 * online interview, mirroring the pre-ephemeral "no active session" baseline.
 */
async function flushMount(): Promise<void> {
  await waitFor(() => {
    const modal = document.getElementById('interview-type-modal');
    expect(modal?.classList.contains('hidden')).toBe(false);
  });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => {
    expect(
      document.getElementById('interview-type-modal')?.classList.contains('hidden')
    ).toBe(true);
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

  test('Auto toggle is ON by default and full config re-push carries autoGenerate', async () => {
    render(<Shell />);
    await flushMount();
    const ws = openSocket();

    // The pill defaults ON.
    const pill = document.getElementById('auto-indicator');
    expect(pill).toHaveAttribute('data-auto', 'on');

    // The full-config re-push (fired on the new sessionId) includes autoGenerate.
    expect(lastConfig(ws)).toMatchObject({ autoGenerate: true });
  });

  test('toggling Auto off persists the setting and sends configure({ autoGenerate:false })', async () => {
    render(<Shell />);
    await flushMount();
    const ws = openSocket();

    const pill = document.getElementById('auto-indicator')!;
    fireEvent.click(pill);

    // Pill flips OFF, the delta configure is sent, and the choice persists.
    expect(document.getElementById('auto-indicator')).toHaveAttribute('data-auto', 'off');
    expect(lastConfig(ws)).toMatchObject({ autoGenerate: false });
    expect(localStorage.getItem('open-cluely.autoGenerate')).toBe('false');

    // Toggling back ON sends true again.
    fireEvent.click(document.getElementById('auto-indicator')!);
    expect(document.getElementById('auto-indicator')).toHaveAttribute('data-auto', 'on');
    expect(lastConfig(ws)).toMatchObject({ autoGenerate: true });
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

  test('an auto result renders the ranked list + 自动 badge; picking a candidate fills the analyze buffer', async () => {
    render(<Shell />);
    await flushMount();
    const ws = openSocket();

    // Server pushes an autonomous result carrying a ranked pool (no manual analyze).
    act(() => {
      ws.emit({
        type: 'result',
        requestId: 'auto-1',
        mode: 'expert',
        trigger: 'auto',
        output: {
          primary_question: 'How did you size the cache?',
          alternative_question: '',
          rationale_for_interviewer: '',
          anchor_quotes: [],
          expected_evidence_yield: '',
          iteration_version: '3'
        },
        ranked: [
          { question: 'How did you size the cache?', score: 28, maxScore: 30, rubricReason: 'Top.', rank: 1 },
          { question: 'What was the eviction policy?', score: 22, maxScore: 30, rubricReason: 'Probe.', rank: 2 }
        ],
        shouldShowFollowUps: true,
        tokensUsed: { input: 10, output: 5, total: 15 },
        elapsedMs: 1200,
        iterationVersion: '3'
      });
    });

    // 自动 badge + the top-pick score badge on the primary.
    expect(screen.getByText('自动')).toBeInTheDocument();
    expect(document.querySelector('.question-card__primary .question-card__score')?.textContent).toBe(
      '28/30'
    );

    // Generate Q is disabled until there is buffered text to analyze.
    expect(screen.getByRole('button', { name: 'Generate Q' })).toBeDisabled();

    // Pick the second candidate → it fills the (internal) analyze buffer + flashes a hint.
    fireEvent.click(screen.getByText('What was the eviction policy?'));
    expect(document.querySelector('.question-card__picked-hint')?.textContent).toContain(
      'What was the eviction policy?'
    );

    // The picked text is now the analyze buffer: Generate Q is enabled and analyzes it.
    const generate = screen.getByRole('button', { name: 'Generate Q' });
    expect(generate).toBeEnabled();
    fireEvent.click(generate);
    const analyzeMsg = ws.sent.map((s) => JSON.parse(s)).find((m) => m.type === 'analyze');
    expect(analyzeMsg?.candidateAnswer).toBe('What was the eviction policy?');
  });

  test('New interview opens the type picker and a card starts a fresh in-memory interview (no session POST)', async () => {
    render(<Shell />);
    await flushMount();

    fireEvent.click(screen.getByRole('button', { name: /New interview/ }));

    // The interview-type picker is shown (not .hidden).
    const modal = document.getElementById('interview-type-modal');
    expect(modal).toBeInTheDocument();
    expect(modal?.classList.contains('hidden')).toBe(false);

    // Picking the online card closes the picker and starts a fresh interview.
    fireEvent.click(screen.getByText('线上面试 / Online').closest('button')!);
    await waitFor(() => {
      expect(modal?.classList.contains('hidden')).toBe(true);
    });

    // Ephemeral: NO session is persisted. Opening the socket re-pushes the full
    // config for the online interview (diarize off — dual-lane routing).
    const ws = openSocket();
    await waitFor(() => {
      expect(lastConfig(ws)).toMatchObject({ diarize: false });
    });
    expect(fetchCalls.some((c) => c.url.includes('/api/sessions'))).toBe(false);
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

  test('selecting the Doubao ASR provider configures the recognizer (creds in their own section)', async () => {
    render(<Shell />);
    await flushMount();
    const ws = openSocket();

    // Default ASR provider pill reads Paraformer.
    expect(document.getElementById('asr-indicator')).toHaveAttribute('data-asr', 'paraformer');

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

    // Doubao creds now live in their own always-visible "Doubao API" section,
    // so the APP ID input is present regardless of the selected provider.
    expect(document.getElementById('setting-volc-app-id')).toBeInTheDocument();

    fireEvent.change(document.getElementById('setting-asr-provider')!, {
      target: { value: 'volc' }
    });

    // The topbar pill flips to Doubao and a configure carries the provider.
    expect(document.getElementById('asr-indicator')).toHaveAttribute('data-asr', 'volc');
    expect(lastConfig(ws)).toMatchObject({ asrProvider: 'volc' });

    // Editing a cred persists to localStorage and re-sends it with the provider.
    fireEvent.change(document.getElementById('setting-volc-app-id')!, {
      target: { value: 'app-123' }
    });
    expect(localStorage.getItem('open-cluely.volcAppId')).toBe('app-123');
    expect(lastConfig(ws)).toMatchObject({ asrProvider: 'volc', volcAppId: 'app-123' });
  });

  test('an offline interview turns on diarize: full config carries the text asrProvider + diarize:true + funasrUrl', async () => {
    // The FunASR URL lives in app settings (localStorage); seed a non-default one
    // so the assertion proves the configured value flows through, not a constant.
    const funasrUrl = 'ws://funasr.example:10096';
    localStorage.setItem('open-cluely.funasrUrl', funasrUrl);

    render(<Shell />);
    await flushMount();

    // Create an OFFLINE interview via the type picker (offline card). Ephemeral:
    // no session is persisted — the choice only flips the in-memory routing.
    fireEvent.click(screen.getByRole('button', { name: /New interview/ }));
    fireEvent.click(
      document.querySelector<HTMLButtonElement>('[data-interview-type="offline"]')!
    );
    await waitFor(() => {
      expect(
        document.getElementById('interview-type-modal')?.classList.contains('hidden')
      ).toBe(true);
    });
    expect(fetchCalls.some((c) => c.url.includes('/api/sessions'))).toBe(false);

    // Now open the socket: the new sessionId triggers the FULL-config re-push,
    // which for an offline interview keeps the text engine (paraformer here) and
    // turns on diarize, carrying the sidecar URL.
    const ws = openSocket();
    await waitFor(() => {
      expect(lastConfig(ws)).toMatchObject({ asrProvider: 'paraformer', diarize: true, funasrUrl });
    });

    // Offline composer shows only the room mic — no computer-audio/display card.
    expect(document.getElementById('channel-mic')).toBeInTheDocument();
    expect(document.getElementById('channel-computer')).not.toBeInTheDocument();
  });

  test('Customize: picking a template card configures the pipeline + flips to customize mode', async () => {
    render(<Shell />);
    await flushMount();
    const ws = openSocket();

    // Switch to Customize so the template row renders + fetches the gallery.
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(screen.getByRole('radio', { name: /Customize/ }));

    // The builtin role templates load from /api/pipelines; click the backend card.
    await waitFor(() => {
      expect(
        document.querySelector('.customize-card[data-id="builtin-role-backend"]')
      ).toBeInTheDocument();
    });
    const card = document.querySelector<HTMLButtonElement>(
      '.customize-card[data-id="builtin-role-backend"]'
    )!;
    fireEvent.click(card);

    expect(lastConfig(ws)).toMatchObject({
      mode: 'customize',
      activePipelineId: 'builtin-role-backend'
    });
    // The picked card is marked active.
    await waitFor(() => {
      expect(card.className).toContain('customize-card--active');
    });
  });

  test('Customize: AI-generate authors → saves → activates the pipeline and shows a hint', async () => {
    render(<Shell />);
    await flushMount();
    const ws = openSocket();

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(screen.getByRole('radio', { name: /Customize/ }));
    await waitFor(() => {
      expect(document.getElementById('customize-ai-input')).toBeInTheDocument();
    });

    fireEvent.change(document.getElementById('customize-ai-input')!, {
      target: { value: '招一个资深后端' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'AI 生成' }));

    // generate → save → activate (configure with the saved id).
    await waitFor(() => {
      expect(lastConfig(ws)).toMatchObject({ mode: 'customize', activePipelineId: 'gen-be' });
    });
    expect(
      fetchCalls.some((c) => c.url.endsWith('/api/pipelines/generate') && c.method === 'POST')
    ).toBe(true);
    expect(
      fetchCalls.some((c) => c.url.endsWith('/api/pipelines') && c.method === 'POST')
    ).toBe(true);
    expect(document.getElementById('customize-ai-hint')?.textContent).toContain('AI Backend');
  });
});
