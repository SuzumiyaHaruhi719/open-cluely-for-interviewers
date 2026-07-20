import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor, within } from '@testing-library/react';
import { installMockWebSocket, MockWebSocket } from '../test/mockWebSocket';
import { Shell } from './Shell';

vi.mock('../lib/audioCapture', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/audioCapture')>();
  return {
    ...actual,
    startCapture: vi.fn(async () => ({ stop: vi.fn() }))
  };
});

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
  // remaining résumé endpoints to in-memory fakes.
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    fetchCalls.push({ url, method, body });

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
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.classList.remove('rail-collapsed');
  localStorage.clear();
  sessionStorage.clear();
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
/**
 * Helper: the app no longer auto-opens the type picker on mount.
 * If a modal is visible, dismiss it; otherwise skip.
 */
async function flushMount(): Promise<void> {
  const modal = document.getElementById('interview-type-modal');
  if (!modal || modal.classList.contains('hidden')) return;
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
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

  test('settings exposes only essential controls and the session stays fixed to Expert', async () => {
    render(<Shell />);
    await flushMount();
    const ws = openSocket();

    // Default mode is expert.
    const indicator = document.getElementById('mode-indicator');
    expect(indicator).toHaveAttribute('data-mode', 'expert');

    expect(lastConfig(ws)).toMatchObject({
      mode: 'expert',
      interviewerModel: 'deepseek-v4-flash',
      outputLanguage: 'zh',
      asrProvider: 'volc',
      autoGenerate: true
    });

    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    expect(lastConfig(ws)).toMatchObject({ autoMode: 'agent' });
    expect(screen.queryByLabelText('语音识别')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: '自动追问' })).not.toBeInTheDocument();
    expect(document.getElementById('auto-indicator')).toBeNull();
    expect(screen.getByLabelText('评估报告模型')).toBeInTheDocument();
    expect(screen.queryByText('面试模式')).not.toBeInTheDocument();
    expect(screen.queryByText(/Customize|Pipeline/i)).not.toBeInTheDocument();
    expect(screen.queryByText('API 密钥')).not.toBeInTheDocument();
  });

  test('realtime Expert model is truthfully fixed to DeepSeek v4 Flash for the SLO', async () => {
    render(<Shell />);
    await flushMount();
    const ws = openSocket();

    expect(lastConfig(ws)).toMatchObject({ interviewerModel: 'deepseek-v4-flash', outputLanguage: 'zh' });

    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    expect(screen.getByText('专家 · 中文')).toBeInTheDocument();
    expect(screen.queryByLabelText('实时专家模型')).not.toBeInTheDocument();
  });

  test('every retained setting persists while fixed policies reach the live server session', async () => {
    render(<Shell />);
    await flushMount();
    const ws = openSocket();

    fireEvent.click(screen.getByRole('button', { name: '设置' }));

    fireEvent.change(screen.getByLabelText('评估报告模型'), {
      target: { value: 'deepseek-v4-flash' }
    });
    expect(lastConfig(ws)).toMatchObject({ summaryModel: 'deepseek-v4-flash' });
    expect(localStorage.getItem('open-cluely.summaryModel')).toBe('deepseek-v4-flash');

    const policyConfig = ws.sent
      .map((frame) => JSON.parse(frame))
      .find((message) => message.type === 'configure' && message.config?.asrProvider === 'volc');
    expect(policyConfig?.config).toMatchObject({ asrProvider: 'volc', autoGenerate: true });
    expect(localStorage.getItem('open-cluely.asrProvider')).toBeNull();
    expect(localStorage.getItem('open-cluely.autoGenerate')).toBeNull();
    expect(localStorage.getItem('open-cluely.autoMode')).toBeNull();
    expect(localStorage.getItem('open-cluely.autoIntervalSec')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '关闭设置' }));
    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    expect(screen.queryByLabelText('语音识别')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: '自动追问' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('评估报告模型')).toHaveValue('deepseek-v4-flash');
    expect(screen.queryByLabelText('触发方式')).not.toBeInTheDocument();
  });

  test('ignores a legacy language preference and always configures Chinese', async () => {
    localStorage.setItem('open-cluely.outputLanguage', 'en');
    render(<Shell />);
    await flushMount();
    const ws = openSocket();

    expect(lastConfig(ws)).toMatchObject({ outputLanguage: 'zh' });
    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    expect(screen.queryByText('输出语言')).not.toBeInTheDocument();
    expect(localStorage.getItem('open-cluely.outputLanguage')).toBeNull();
  });

  test('the question-mark shortcut replays the Tour without discarding the interview', async () => {
    sessionStorage.setItem('tour-shown-this-session', '1');
    render(<Shell />);
    await flushMount();

    fireEvent.change(screen.getByLabelText('手动上下文输入'), {
      target: { value: '保留中的面试上下文' }
    });
    fireEvent.click(screen.getByRole('button', { name: '添加' }));
    expect(screen.getByText('保留中的面试上下文')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: '?' });

    expect(await screen.findByText('欢迎使用面试官 Copilot')).toBeInTheDocument();
    expect(screen.getByText('保留中的面试上下文')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '设置' })).not.toBeInTheDocument();
    });
  });

  test('rail toggle flips body.rail-collapsed and persists to localStorage', async () => {
    render(<Shell />);
    await flushMount();
    expect(document.body.classList.contains('rail-collapsed')).toBe(false);
    const toggle = screen.getByRole('button', { name: '收起右侧栏' });
    expect(toggle).toHaveAttribute('aria-controls', 'right-rail');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(toggle);

    expect(document.body.classList.contains('rail-collapsed')).toBe(true);
    expect(localStorage.getItem('open-cluely.railCollapsed')).toBe('true');
    expect(screen.getByRole('button', { name: '展开右侧栏' })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
  });

  test('renders main shell chrome in Chinese', async () => {
    render(<Shell />);
    await flushMount();

    expect(screen.getByRole('button', { name: /新建面试/ })).toBeInTheDocument();
    expect(screen.getByText('实时助手')).toBeInTheDocument();
    expect(screen.getByText('题库')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '设置' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '提问 AI' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '总结面试' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '生成追问' })).toBeInTheDocument();
    expect(screen.getByLabelText('手动上下文输入')).toBeInTheDocument();
    expect(screen.getByText('简历')).toBeInTheDocument();
    expect(screen.getByText('职位描述')).toBeInTheDocument();
    expect(screen.getByText('会话上下文')).toBeInTheDocument();
  });

  test('a manual note enables analyze and Generate Q sends an analyze request', async () => {
    render(<Shell />);
    await flushMount();
    const ws = openSocket();

    // Add a note → fills the candidate-answer buffer.
    fireEvent.change(screen.getByLabelText('手动上下文输入'), {
      target: { value: 'We sharded by user id' }
    });
    fireEvent.click(screen.getByRole('button', { name: '添加' }));

    fireEvent.click(screen.getByRole('button', { name: '生成追问' }));

    const analyzeMsg = ws.sent.map((s) => JSON.parse(s)).find((m) => m.type === 'analyze');
    expect(analyzeMsg).toBeTruthy();
    expect(analyzeMsg.candidateAnswer).toContain('We sharded by user id');
  });

  test('Auto is fixed ON without a user-facing toggle', async () => {
    localStorage.setItem('open-cluely.autoGenerate', 'false');
    render(<Shell />);
    await flushMount();
    const ws = openSocket();

    expect(document.getElementById('auto-indicator')).toBeNull();
    expect(lastConfig(ws)).toMatchObject({ autoGenerate: true });
    expect(localStorage.getItem('open-cluely.autoGenerate')).toBeNull();
  });

  test('renders the AI question card when a result arrives', async () => {
    render(<Shell />);
    await flushMount();
    const ws = openSocket();

    fireEvent.change(screen.getByLabelText('手动上下文输入'), {
      target: { value: 'I used consistent hashing' }
    });
    fireEvent.click(screen.getByRole('button', { name: '添加' }));
    fireEvent.click(screen.getByRole('button', { name: '生成追问' }));

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

  test('a manual result renders the 手动 badge and never shows the 自动 badge', async () => {
    render(<Shell />);
    await flushMount();
    const ws = openSocket();

    fireEvent.change(screen.getByLabelText('手动上下文输入'), {
      target: { value: 'I rolled out an idempotency key migration' }
    });
    fireEvent.click(screen.getByRole('button', { name: '添加' }));
    fireEvent.click(screen.getByRole('button', { name: '生成追问' }));

    const analyzeMsg = ws.sent.map((s) => JSON.parse(s)).find((m) => m.type === 'analyze');
    act(() => {
      ws.emit({
        type: 'result',
        requestId: analyzeMsg.requestId,
        mode: 'expert',
        trigger: 'manual',
        output: {
          primary_question: 'What did you do when idempotency failed?',
          alternative_question: '',
          rationale_for_interviewer: '',
          anchor_quotes: [],
          expected_evidence_yield: '',
          iteration_version: '3'
        },
        shouldShowFollowUps: true,
        tokensUsed: { input: 10, output: 5, total: 15 },
        elapsedMs: 1200,
        iterationVersion: '3'
      });
    });

    const questionCard = document.querySelector('.is-question-card')!;
    expect(within(questionCard as HTMLElement).getByText('手动')).toBeInTheDocument();
    expect(within(questionCard as HTMLElement).queryByText('自动')).toBeNull();
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
    const questionCard = document.querySelector('.is-question-card')!;
    expect(within(questionCard as HTMLElement).getByText('自动')).toBeInTheDocument();
    expect(document.querySelector('.question-card__primary .question-card__score')?.textContent).toBe(
      '28/30'
    );

    // Generate Q is disabled until there is buffered text to analyze.
    expect(screen.getByRole('button', { name: '生成追问' })).toBeDisabled();

    // Pick the second candidate → it fills the (internal) analyze buffer + flashes a hint.
    fireEvent.click(screen.getByText('What was the eviction policy?'));
    expect(document.querySelector('.question-card__picked-hint')?.textContent).toContain(
      'What was the eviction policy?'
    );

    // The picked text is now the analyze buffer: Generate Q is enabled and analyzes it.
    const generate = screen.getByRole('button', { name: '生成追问' });
    expect(generate).toBeEnabled();
    fireEvent.click(generate);
    const analyzeMsg = ws.sent.map((s) => JSON.parse(s)).find((m) => m.type === 'analyze');
    expect(analyzeMsg?.candidateAnswer).toBe('What was the eviction policy?');
  });

  test('New interview reviews JD context and starts only after explicit confirmation', async () => {
    render(<Shell />);
    await flushMount();

    fireEvent.click(screen.getByRole('button', { name: /新建面试/ }));

    // The interview-type picker is shown (not .hidden).
    const modal = document.getElementById('interview-type-modal');
    expect(modal).toBeInTheDocument();
    expect(modal?.classList.contains('hidden')).toBe(false);

    // Picking the online radio only changes capture mode; the reviewed context is
    // committed by the explicit start action.
    fireEvent.click(screen.getByRole('radio', { name: '线上面试' }));
    expect(modal?.classList.contains('hidden')).toBe(false);
    expect(screen.getByLabelText('职位背景')).toHaveValue('property-manager');
    fireEvent.click(screen.getByRole('button', { name: '开始面试' }));
    await waitFor(() => {
      expect(modal?.classList.contains('hidden')).toBe(true);
    });

    // Ephemeral: NO session is persisted. Opening the socket re-pushes the full
    // config for the online interview. Semantic diarization stays on because a
    // shared meeting/tab stream can contain both interviewer and candidate.
    const ws = openSocket();
    await waitFor(() => {
      expect(lastConfig(ws)).toMatchObject({
        diarize: true,
        jobDescription: expect.stringContaining('现场的安全及消防'),
        interviewGuide: expect.arrayContaining([
          expect.stringContaining('突发事件应对与复盘')
        ])
      });
    });
    expect(fetchCalls.some((c) => c.url.includes('/api/sessions'))).toBe(false);
  });

  test('New interview notifies the server to reset generation state for the abandoned chat', async () => {
    render(<Shell />);
    await flushMount();
    const ws = openSocket();

    fireEvent.click(screen.getByRole('button', { name: /新建面试/ }));

    const resetConfig = ws.sent
      .map((s) => JSON.parse(s))
      .find((m) => m.type === 'configure' && m.config?.resetGeneration === true);
    expect(resetConfig).toBeTruthy();
  });

  test('New interview stops capture and resets the runtime badge and elapsed clock', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T00:00:00Z'));
    render(<Shell />);
    const ws = openSocket();

    const micCard = document.getElementById('channel-mic')!;
    await act(async () => {
      fireEvent.click(within(micCard).getByRole('button', { name: '开始' }));
    });
    act(() => {
      ws.emit({ type: 'asr-status', source: 'mic', provider: 'volc', state: 'live' });
      vi.advanceTimersByTime(65_000);
    });
    expect(document.querySelector('.timer')).toHaveTextContent('01:05');

    fireEvent.click(screen.getByRole('button', { name: /新建面试/ }));

    expect(document.querySelector('.timer')).toHaveTextContent('00:00');
    expect(within(micCard).getByRole('button', { name: '开始' })).toBeEnabled();
    expect(within(micCard).getByText('关闭')).toBeInTheDocument();
    expect(
      ws.sent.map((frame) => JSON.parse(frame)).filter(
        (message) => message.type === 'audio-control' && message.action === 'stop'
      )
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'mic' }),
        expect.objectContaining({ source: 'display' })
      ])
    );
  });

  test('Doubao ASR 2.0 is fixed while credentials stay server-side', async () => {
    render(<Shell />);
    await flushMount();
    const ws = openSocket();

    expect(document.getElementById('asr-indicator')).toHaveAttribute('data-asr', 'volc');

    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    expect(screen.queryByLabelText('语音识别')).not.toBeInTheDocument();

    expect(document.getElementById('setting-volc-app-id')).not.toBeInTheDocument();
    expect(document.getElementById('setting-volc-access-token')).not.toBeInTheDocument();

    expect(document.getElementById('asr-indicator')).toHaveAttribute('data-asr', 'volc');
    const policyConfig = ws.sent
      .map((frame) => JSON.parse(frame))
      .find((message) => message.type === 'configure' && message.config?.asrProvider === 'volc');
    expect(policyConfig?.config).toMatchObject({ asrProvider: 'volc', autoGenerate: true });
    expect(policyConfig?.config).not.toHaveProperty('volcAppId');
    expect(policyConfig?.config).not.toHaveProperty('volcAccessToken');
    expect(localStorage.getItem('open-cluely.volcAppId')).toBeNull();
    expect(localStorage.getItem('open-cluely.volcAccessToken')).toBeNull();
  });

  test('a failed ASR session clears the optimistic global live state while capture can still be stopped', async () => {
    render(<Shell />);
    await flushMount();
    const ws = openSocket();

    const micCard = document.getElementById('channel-mic')!;
    await act(async () => {
      fireEvent.click(within(micCard).getByRole('button', { name: '开始' }));
    });
    act(() => {
      ws.emit({ type: 'asr-status', source: 'mic', provider: 'volc', state: 'live' });
    });
    expect(document.getElementById('rec-indicator')).toHaveAttribute('data-state', 'live');

    act(() => {
      ws.emit({
        type: 'asr-status',
        source: 'mic',
        provider: 'volc',
        state: 'failed',
        message: '模拟识别失败'
      });
    });

    expect(document.getElementById('rec-indicator')).toHaveAttribute('data-state', 'idle');
    expect(document.getElementById('topbar')).not.toHaveClass('is-live');
    expect(within(micCard).getByText('错误')).toBeInTheDocument();
    expect(within(micCard).getByRole('button', { name: '停止' })).toBeEnabled();
  });

  test('an offline interview enables single-mic role partitioning without a CAM++ sidecar', async () => {
    render(<Shell />);
    await flushMount();

    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    expect(document.getElementById('settings-funasr')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭设置' }));

    // Create an OFFLINE interview via the type picker (offline card). Ephemeral:
    // no session is persisted — the choice only flips the in-memory routing.
    fireEvent.click(screen.getByRole('button', { name: /新建面试/ }));
    fireEvent.click(screen.getByRole('radio', { name: '线下面试' }));
    fireEvent.click(screen.getByRole('button', { name: '开始面试' }));
    await waitFor(() => {
      expect(
        document.getElementById('interview-type-modal')?.classList.contains('hidden')
      ).toBe(true);
    });
    expect(fetchCalls.some((c) => c.url.includes('/api/sessions'))).toBe(false);

    // Now open the socket: the new sessionId triggers the FULL-config re-push,
    // which for an offline interview keeps Doubao and
    // turns on the single-mic speaker-partition lifecycle. No local sidecar
    // address is part of the protocol anymore.
    const ws = openSocket();
    await waitFor(() => {
      expect(lastConfig(ws)).toMatchObject({ asrProvider: 'volc', diarize: true });
    });
    expect(lastConfig(ws)).not.toHaveProperty('funasrUrl');

    // Offline composer shows only the room mic — no computer-audio/display card.
    expect(document.getElementById('channel-mic')).toBeInTheDocument();
    expect(document.getElementById('channel-computer')).not.toBeInTheDocument();
  });

  test('online native ASR: a candidate-labeled speaker segment feeds the analyze buffer (Generate Q uses it)', async () => {
    // Stay in the default ONLINE interview. Doubao carries
    // its own speaker id on finals, so segments appear even online.
    render(<Shell />);
    await flushMount();
    const ws = openSocket();

    // A native-cluster final becomes a diarized segment (still unknown until labeled).
    act(() => {
      ws.emit({
        type: 'transcript',
        source: 'mic',
        text: '我用一致性哈希做了分片',
        isFinal: true,
        speakerId: 2,
        speaker: 'unknown'
      });
    });

    // The labelable bubble now renders (online + segments exist). Tap its 候选人
    // toggle. Scope to the transcript bubble's toggle (the dismissed type-picker
    // modal also contains the word 候选人 in its option copy).
    const toggle = await waitFor(() => {
      const btns = Array.from(
        document.querySelectorAll<HTMLButtonElement>('.chat-message .speaker-role-toggle')
      ).filter((b) => b.textContent?.includes('候选人'));
      expect(btns).toHaveLength(1);
      return btns[0];
    });
    fireEvent.click(toggle);

    // Labeling that speaker as candidate also tells the server (set-speaker-role).
    const roleMsg = ws.sent
      .map((s) => JSON.parse(s))
      .find((m) => m.type === 'set-speaker-role');
    expect(roleMsg).toMatchObject({ speakerId: 2, role: 'candidate' });

    // The candidate-labeled segment text is fed into the analyze buffer, so
    // Generate Q is enabled and analyzes THAT text — not the empty display lane.
    const generate = await screen.findByRole('button', { name: '生成追问' });
    await waitFor(() => expect(generate).toBeEnabled());
    fireEvent.click(generate);

    const analyzeMsg = ws.sent.map((s) => JSON.parse(s)).find((m) => m.type === 'analyze');
    expect(analyzeMsg).toBeTruthy();
    expect(analyzeMsg.candidateAnswer).toContain('我用一致性哈希做了分片');
  });

  describe('preserve interview history when audio capture stops', () => {
    test('stopping the microphone keeps transcript history and generation context', async () => {
      render(<Shell />);
      await flushMount();
      const ws = openSocket();

      // Seed both socket transcript history and a local note so stopping capture
      // cannot silently behave like "New interview" for either history source.
      act(() => {
        ws.emit({
          type: 'transcript',
          source: 'mic',
          text: '我负责了消息队列迁移',
          isFinal: true,
          speakerId: 1,
          speaker: 'candidate'
        });
      });
      fireEvent.change(screen.getByLabelText('手动上下文输入'), {
        target: { value: '保留这条面试记录' }
      });
      fireEvent.click(screen.getByRole('button', { name: '添加' }));
      await waitFor(() => {
        expect(document.querySelector('.chat-message .speaker-role-toggle')).toBeInTheDocument();
      });
      expect(screen.getByText('保留这条面试记录')).toBeInTheDocument();

      const micCard = document.getElementById('channel-mic')!;
      await act(async () => {
        fireEvent.click(within(micCard).getByRole('button', { name: '开始' }));
      });
      act(() => {
        ws.emit({ type: 'asr-status', source: 'mic', provider: 'volc', state: 'live' });
      });

      const beforeStop = ws.sent.length;
      await act(async () => {
        fireEvent.click(within(micCard).getByRole('button', { name: '停止' }));
      });

      const resets = ws.sent
        .slice(beforeStop)
        .map((s) => JSON.parse(s))
        .filter((m) => m.type === 'configure' && m.config?.resetGeneration === true);
      expect(resets).toHaveLength(0);
      expect(document.querySelector('.chat-message .speaker-role-toggle')).toBeInTheDocument();
      expect(screen.getByText('保留这条面试记录')).toBeInTheDocument();
    });
  });

  test('the retired Customize and Pipeline Studio surfaces are absent', async () => {
    render(<Shell />);
    await flushMount();
    openSocket();

    fireEvent.click(screen.getByRole('button', { name: '设置' }));

    expect(screen.queryByText(/Customize|Pipeline Studio/i)).not.toBeInTheDocument();
    expect(document.querySelector('.customize-card')).not.toBeInTheDocument();
    expect(document.getElementById('pipeline-studio')).not.toBeInTheDocument();
    expect(fetchCalls.some((call) => call.url.includes('/api/pipelines'))).toBe(false);
  });
});
