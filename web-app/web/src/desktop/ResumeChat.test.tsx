import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ResumeChat } from './ResumeChat';

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as Response;
}

let bodies: unknown[];

beforeEach(() => {
  bodies = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(init?.body ? JSON.parse(String(init.body)) : undefined);
      return Promise.resolve(jsonResponse({ reply: 'They led a Saga refactor.' }));
    })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ResumeChat', () => {
  test('sends the conversation with the résumé text and renders the reply', async () => {
    render(<ResumeChat resumeText="Senior backend, 8 years." />);

    fireEvent.change(screen.getByLabelText('Ask about the résumé'), {
      target: { value: 'What is their strongest evidence?' }
    });
    fireEvent.submit(screen.getByLabelText('Ask about the résumé').closest('form')!);

    // The user turn renders immediately (indigo / right).
    expect(screen.getByText('What is their strongest evidence?')).toBeInTheDocument();

    // The reply lands after the fetch resolves.
    expect(await screen.findByText('They led a Saga refactor.')).toBeInTheDocument();

    // The request carried both the résumé grounding and the turn.
    await waitFor(() => expect(bodies.length).toBe(1));
    expect(bodies[0]).toMatchObject({
      resumeText: 'Senior backend, 8 years.',
      messages: [{ role: 'user', content: 'What is their strongest evidence?' }]
    });
  });

  test('Clear empties the conversation', async () => {
    render(<ResumeChat resumeText="R" />);

    fireEvent.change(screen.getByLabelText('Ask about the résumé'), {
      target: { value: 'Probe areas?' }
    });
    fireEvent.submit(screen.getByLabelText('Ask about the résumé').closest('form')!);
    await screen.findByText('They led a Saga refactor.');

    fireEvent.click(screen.getByRole('button', { name: 'Clear résumé chat' }));

    expect(screen.queryByText('Probe areas?')).not.toBeInTheDocument();
    expect(screen.queryByText('They led a Saga refactor.')).not.toBeInTheDocument();
  });
});
