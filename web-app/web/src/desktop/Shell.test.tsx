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

async function enterLiveWorkspace(customJd?: string) {
  render(<Shell />);
  const ws = openSocket();
  if (customJd) {
    const picker = screen.getByRole('combobox', { name: '选择职位 JD' });
    fireEvent.change(picker, { target: { value: '自定义' } });
    fireEvent.click(screen.getByRole('option', { name: '自定义职位' }));
    fireEvent.change(screen.getByLabelText('自定义职位描述'), { target: { value: customJd } });
  }
  fireEvent.click(screen.getByRole('button', { name: '开始面试' }));
  await screen.findByRole('button', { name: '结束面试' });
  return ws;
}

describe('Shell one-shot interview workflow', () => {
  test('opens on resume + JD preparation and removes confusing product surfaces', () => {
    render(<Shell />);

    expect(screen.getByRole('heading', { name: '准备本次面试' })).toBeInTheDocument();
    expect(screen.getByLabelText(/上传简历/)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '选择职位 JD' })).toBeInTheDocument();
    expect(screen.getByText('物业经理')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /线上面试/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /线下面试/ })).not.toBeChecked();
    expect(screen.queryByLabelText('自定义职位描述')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开始面试' })).toBeInTheDocument();

    expect(document.querySelector('.sidebar')).not.toBeInTheDocument();
    expect(document.querySelector('.right-rail')).not.toBeInTheDocument();
    expect(screen.queryByText('题库')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '设置' })).not.toBeInTheDocument();
    expect(screen.queryByText(/移动端|面试历史|Pipeline Studio/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /生成追问|提问 AI/ })).not.toBeInTheDocument();
  });

  test('starts with supplied JD as fixed Expert context and no user-facing policy settings', async () => {
    const ws = await enterLiveWorkspace();

    await waitFor(() => {
      expect(lastConfig(ws)).toMatchObject({
        mode: 'expert',
        interviewerModel: 'deepseek-v4-flash',
        outputLanguage: 'zh',
        asrProvider: 'volc',
        diarize: true,
        autoGenerate: true,
        autoMode: 'agent',
        jobDescription: expect.stringContaining('现场的安全及消防'),
        interviewGuide: expect.arrayContaining([expect.stringContaining('突发事件应对与复盘')])
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
    expect(screen.getByRole('button', { name: '面试总结' })).toBeInTheDocument();
    expect(document.getElementById('channel-computer')).toBeInTheDocument();
    expect(document.getElementById('channel-mic')).toBeInTheDocument();
    expect(screen.getByLabelText('面试备注')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '手动追问' })).toBeDisabled();
  });

  test('uses a single room microphone lane when offline mode is selected', async () => {
    render(<Shell />);
    openSocket();
    fireEvent.click(screen.getByRole('radio', { name: /线下面试/ }));
    fireEvent.click(screen.getByRole('button', { name: '开始面试' }));
    await screen.findByRole('button', { name: '结束面试' });

    expect(document.getElementById('channel-computer')).not.toBeInTheDocument();
    expect(document.getElementById('channel-mic')).toBeInTheDocument();
    expect(screen.getByText('现场面试 · 麦克风')).toBeInTheDocument();
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
    expect(screen.getByText('150 词元')).toBeInTheDocument();
    expect(screen.getAllByText('2.4 s').length).toBeGreaterThan(0);
  });

  test('adds notes to transcript while preserving the manual Expert control', async () => {
    const ws = await enterLiveWorkspace();
    fireEvent.change(screen.getByLabelText('面试备注'), {
      target: { value: '追问消防演练频率' }
    });
    fireEvent.click(screen.getByRole('button', { name: '添加备注' }));

    expect(
      within(screen.getByRole('log', { name: '实时转写' })).getByText('追问消防演练频率')
    ).toBeInTheDocument();
    expect(sentMessages(ws)).toContainEqual(
      expect.objectContaining({ type: 'context-note', note: '追问消防演练频率' })
    );
    expect(screen.getByRole('button', { name: '手动追问' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '打开会话上下文' }));
    const context = screen.getByRole('complementary', { name: '会话上下文' });
    expect(within(context).getByRole('heading', { name: '面试备注' })).toBeInTheDocument();
    expect(within(context).getByText('追问消防演练频率')).toBeInTheDocument();
  });

  test('manual Expert question sends confirmed candidate evidence through the existing analyze path', async () => {
    const ws = await enterLiveWorkspace();
    act(() => {
      ws.emit({
        type: 'transcript',
        source: 'mic',
        text: '我负责三个园区，并把消防隐患整改时长从七天降到两天。',
        isFinal: true,
        speakerId: 1,
        speaker: 'candidate'
      });
    });

    const manual = await screen.findByRole('button', { name: '手动追问' });
    expect(manual).toBeEnabled();
    fireEvent.click(manual);

    expect(sentMessages(ws)).toContainEqual(
      expect.objectContaining({
        type: 'analyze',
        candidateAnswer: expect.stringContaining('消防隐患整改时长')
      })
    );
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

  test('summarizes the visible role-labelled transcript instead of the notes-only buffer', async () => {
    const ws = await enterLiveWorkspace();
    act(() => {
      ws.emit({
        type: 'transcript',
        source: 'mic',
        text: '请介绍一次您独立负责园区运营的经历。',
        isFinal: true,
        speakerId: 0,
        speaker: 'interviewer'
      });
      ws.emit({
        type: 'transcript',
        source: 'mic',
        text: '我独立负责过三个园区，并把消防整改周期从七天降到两天。',
        isFinal: true,
        speakerId: 1,
        speaker: 'candidate'
      });
    });

    fireEvent.click(screen.getByRole('button', { name: '面试总结' }));

    const summaryFrame = [...sentMessages(ws)].reverse().find((frame) => frame.type === 'summarize');
    expect(summaryFrame).toMatchObject({
      type: 'summarize',
      transcript: expect.stringContaining('面试官: 请介绍一次您独立负责园区运营的经历。')
    });
    expect(summaryFrame?.transcript).toEqual(
      expect.stringContaining('候选人: 我独立负责过三个园区，并把消防整改周期从七天降到两天。')
    );
  });

  test('requires confirmation before ending and returns to preparation only after confirm', async () => {
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

    const stopFrameCountBefore = sentMessages(ws).filter(
      (frame) => frame.type === 'audio-control' && frame.action === 'stop'
    ).length;
    const resetFrameCountBefore = sentMessages(ws).filter(
      (frame) => frame.type === 'configure' &&
        (frame.config as Record<string, unknown> | undefined)?.resetGeneration === true
    ).length;

    fireEvent.click(screen.getByRole('button', { name: '结束面试' }));

    expect(screen.getByRole('dialog', { name: '结束本次面试？' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '结束本次面试？' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '取消' })).toHaveFocus();
    expect(sentMessages(ws).filter(
      (frame) => frame.type === 'audio-control' && frame.action === 'stop'
    )).toHaveLength(stopFrameCountBefore);
    expect(screen.getByRole('button', { name: '结束面试' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('dialog', { name: '结束本次面试？' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '结束面试' })).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: '结束面试' }));
    fireEvent.click(screen.getByRole('button', { name: '确认结束' }));

    expect(screen.getByRole('heading', { name: '准备本次面试' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '面试总结' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '结束面试' })).not.toBeInTheDocument();
    expect(sentMessages(ws)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'audio-control', source: 'display', action: 'stop' }),
        expect.objectContaining({ type: 'audio-control', source: 'mic', action: 'stop' }),
        expect.objectContaining({
          type: 'configure',
          config: expect.objectContaining({ resetGeneration: true })
        })
      ])
    );
    expect(sentMessages(ws)).not.toContainEqual(expect.objectContaining({ type: 'summarize' }));
    expect(sentMessages(ws).filter(
      (frame) => frame.type === 'configure' &&
        (frame.config as Record<string, unknown> | undefined)?.resetGeneration === true
    )).toHaveLength(resetFrameCountBefore + 1);
  });
});
