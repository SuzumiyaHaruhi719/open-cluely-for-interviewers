import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { installMockWebSocket, MockWebSocket } from '../test/mockWebSocket';
import { Shell } from './Shell';

let restore: () => void;

beforeEach(() => {
  restore = installMockWebSocket();
});

afterEach(() => {
  cleanup();
  restore();
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

describe('Shell', () => {
  test('renders the desktop shell structure (titlebar, layout panes, composer)', () => {
    render(<Shell />);
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

  test('selecting a mode in settings updates #mode-indicator and sends configure', () => {
    render(<Shell />);
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

  test('rail toggle flips body.rail-collapsed and persists to localStorage', () => {
    render(<Shell />);
    expect(document.body.classList.contains('rail-collapsed')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Toggle right panel' }));

    expect(document.body.classList.contains('rail-collapsed')).toBe(true);
    expect(localStorage.getItem('open-cluely.railCollapsed')).toBe('true');
  });

  test('a manual note enables analyze and Generate Q sends an analyze request', () => {
    render(<Shell />);
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

  test('renders the AI question card when a result arrives', () => {
    render(<Shell />);
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
});
