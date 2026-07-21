import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
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

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as Response;
}

beforeEach(() => {
  restore = installMockWebSocket();
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/resume/')) {
        return Promise.resolve(jsonResponse({ text: '', reply: '' }));
      }
      return Promise.reject(new Error(`unexpected url ${url}`));
    })
  );
});

afterEach(() => {
  cleanup();
  restore();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

function openSocket(): MockWebSocket {
  const ws = MockWebSocket.last();
  act(() => {
    ws.open();
    ws.emit({ type: 'ready', sessionId: 'sess-1' });
  });
  return ws;
}

function sentMessages(ws: MockWebSocket): Array<Record<string, unknown>> {
  return ws.sent.map((frame) => JSON.parse(frame) as Record<string, unknown>);
}

function lastConfig(ws: MockWebSocket): Record<string, unknown> | null {
  const frames = sentMessages(ws);
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    if (frames[index].type === 'configure') {
      return frames[index].config as Record<string, unknown>;
    }
  }
  return null;
}

async function enterLiveWorkspace(jd = '物业经理\n负责园区运营落地。') {
  render(<Shell />);
  const ws = openSocket();
  fireEvent.change(screen.getByLabelText('职位描述'), { target: { value: jd } });
  fireEvent.click(screen.getByRole('button', { name: '开始面试' }));
  await screen.findByRole('button', { name: '结束面试' });
  return ws;
}

describe('Shell one-shot interview workflow', () => {
  test('opens on resume + JD preparation and removes confusing product surfaces', () => {
    render(<Shell />);

    expect(screen.getByRole('heading', { name: '准备本次面试' })).toBeInTheDocument();
    expect(screen.getByLabelText(/上传简历/)).toBeInTheDocument();
    expect(screen.getByLabelText('职位描述')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开始面试' })).toBeInTheDocument();

    expect(document.querySelector('.sidebar')).not.toBeInTheDocument();
    expect(document.querySelector('.right-rail')).not.toBeInTheDocument();
    expect(screen.queryByText('题库')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '设置' })).not.toBeInTheDocument();
    expect(screen.queryByText(/移动端|面试历史|Pipeline Studio/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /生成追问|提问 AI/ })).not.toBeInTheDocument();
  });

  test('starts with supplied JD as fixed Expert context and no user-facing policy settings', async () => {
    const ws = await enterLiveWorkspace('物业经理\n负责消防、设备和租户服务。');

    await waitFor(() => {
      expect(lastConfig(ws)).toMatchObject({
        mode: 'expert',
        interviewerModel: 'deepseek-v4-flash',
        outputLanguage: 'zh',
        asrProvider: 'volc',
        diarize: true,
        autoGenerate: true,
        autoMode: 'agent',
        jobDescription: '物业经理\n负责消防、设备和租户服务。'
      });
    });
    expect(lastConfig(ws)).not.toHaveProperty('volcAppId');
    expect(lastConfig(ws)).not.toHaveProperty('volcAccessToken');
    expect(localStorage.getItem('open-cluely.outputLanguage')).toBeNull();
  });

  test('renders only the focused live interview header, transcript, context toggle, and dock', async () => {
    await enterLiveWorkspace();

    expect(document.querySelector('.one-shot-app')).toBeInTheDocument();
    expect(screen.getByText('资料已载入')).toBeInTheDocument();
    expect(screen.getByRole('log', { name: '实时转写' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '清空转写' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开会话上下文' })).toBeInTheDocument();
    expect(document.getElementById('channel-computer')).toBeInTheDocument();
    expect(document.getElementById('channel-mic')).toBeInTheDocument();
    expect(screen.getByLabelText('面试备注')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /生成追问|提问 AI/ })).not.toBeInTheDocument();
  });

  test('keeps automatic session context in the dedicated collapsible drawer', async () => {
    const ws = await enterLiveWorkspace();
    act(() => {
      ws.emit({
        type: 'session-context',
        state: {
          competencies: [{ name: '消防安全', status: 'partial', evidence: '提到月度巡检' }],
          topics: ['租户纠纷'],
          gaps: ['预算结果']
        }
      });
    });

    const closed = screen.getByRole('complementary', { hidden: true });
    expect(closed).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('消防安全')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '打开会话上下文' }));
    expect(screen.getByRole('complementary', { name: '会话上下文' })).toHaveAttribute(
      'aria-hidden',
      'false'
    );
    expect(screen.getByText('租户纠纷')).toBeInTheDocument();
    expect(screen.getByText('预算结果')).toBeInTheDocument();
  });

  test('renders speaker-labelled transcript turns with timestamps and manual correction', async () => {
    const ws = await enterLiveWorkspace();
    act(() => {
      ws.emit({
        type: 'transcript',
        source: 'mic',
        text: '我负责过三个园区的消防改造。',
        isFinal: true,
        speakerId: 2,
        speaker: 'unknown'
      });
    });

    expect(await screen.findByText('我负责过三个园区的消防改造。')).toBeInTheDocument();
    expect(screen.getByText('待确认 · 说话人 2')).toBeInTheDocument();
    expect(document.querySelector('.transcript-time')).toBeInTheDocument();

    const bubble = screen.getByText('我负责过三个园区的消防改造。').closest('.chat-message')!;
    fireEvent.click(within(bubble as HTMLElement).getByRole('button', { name: '候选人' }));
    expect(sentMessages(ws)).toContainEqual(
      expect.objectContaining({ type: 'set-speaker-role', speakerId: 2, role: 'candidate' })
    );
  });

  test('inserts automatic expert questions beneath their evidence with token metadata', async () => {
    const ws = await enterLiveWorkspace();
    act(() => {
      ws.emit({
        type: 'transcript',
        source: 'mic',
        text: '我通过培训提升了团队执行力。',
        isFinal: true,
        speakerId: 1,
        speaker: 'candidate'
      });
      ws.emit({
        type: 'result',
        requestId: 'auto-1',
        mode: 'expert',
        trigger: 'auto',
        anchorSeq: 0,
        output: {
          primary_question: '培训前后的执行指标分别是多少？',
          alternative_question: '',
          rationale_for_interviewer: '回答缺少可验证结果。',
          anchor_quotes: ['提升了团队执行力'],
          expected_evidence_yield: '培训前后指标。',
          iteration_version: '4'
        },
        shouldShowFollowUps: true,
        tokensUsed: { input: 120, output: 30, total: 150 },
        elapsedMs: 2_400,
        iterationVersion: '4'
      });
    });

    const timeline = Array.from(document.querySelectorAll('.chat-message')).map(
      (node) => node.textContent ?? ''
    );
    expect(timeline[0]).toContain('我通过培训提升了团队执行力。');
    expect(timeline[1]).toContain('培训前后的执行指标分别是多少？');
    expect(screen.getByText('150 令牌')).toBeInTheDocument();
    expect(screen.getAllByText('2.4 s').length).toBeGreaterThan(0);
  });

  test('adds notes to transcript and autonomous context without manual generation controls', async () => {
    const ws = await enterLiveWorkspace();
    fireEvent.change(screen.getByLabelText('面试备注'), {
      target: { value: '追问消防演练频率' }
    });
    fireEvent.click(screen.getByRole('button', { name: '添加备注' }));

    expect(screen.getByText('追问消防演练频率')).toBeInTheDocument();
    expect(sentMessages(ws)).toContainEqual(
      expect.objectContaining({ type: 'context-note', note: '追问消防演练频率' })
    );
    expect(screen.queryByRole('button', { name: /生成追问|提问 AI/ })).not.toBeInTheDocument();
  });

  test('clear is visible and resets transcript plus server generation state', async () => {
    const ws = await enterLiveWorkspace();
    act(() => {
      ws.emit({
        type: 'transcript',
        source: 'mic',
        text: '需要清除的转写',
        isFinal: true,
        speakerId: 1,
        speaker: 'candidate'
      });
    });
    expect(screen.getByText('需要清除的转写')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '清空转写' }));

    expect(screen.queryByText('需要清除的转写')).not.toBeInTheDocument();
    expect(sentMessages(ws)).toContainEqual(
      expect.objectContaining({ type: 'configure', config: expect.objectContaining({ resetGeneration: true }) })
    );
  });

  test('stopping capture preserves interview evidence', async () => {
    const ws = await enterLiveWorkspace();
    act(() => {
      ws.emit({
        type: 'transcript',
        source: 'mic',
        text: '保留的候选人证据',
        isFinal: true,
        speakerId: 1,
        speaker: 'candidate'
      });
    });
    const micCard = document.getElementById('channel-mic')!;
    await act(async () => {
      fireEvent.click(within(micCard).getByRole('button', { name: '开始' }));
    });
    act(() => {
      ws.emit({ type: 'asr-status', source: 'mic', provider: 'volc', state: 'live' });
    });
    await act(async () => {
      fireEvent.click(within(micCard).getByRole('button', { name: '停止' }));
    });

    expect(screen.getByText('保留的候选人证据')).toBeInTheDocument();
  });

  test('ending stops both audio lanes and opens the existing summary flow', async () => {
    const ws = await enterLiveWorkspace();
    act(() => {
      ws.emit({
        type: 'transcript',
        source: 'mic',
        text: '用于总结的候选人回答',
        isFinal: true,
        speakerId: 1,
        speaker: 'candidate'
      });
    });

    fireEvent.click(screen.getByRole('button', { name: '结束面试' }));

    expect(screen.getByRole('dialog', { name: '面试总结' })).toBeInTheDocument();
    expect(sentMessages(ws)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'audio-control', source: 'display', action: 'stop' }),
        expect.objectContaining({ type: 'audio-control', source: 'mic', action: 'stop' }),
        expect.objectContaining({ type: 'summarize' })
      ])
    );
  });
});
