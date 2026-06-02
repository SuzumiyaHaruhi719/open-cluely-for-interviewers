import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import type { QuestionBankHit } from '@open-cluely/contract';
import { QuestionBank } from './QuestionBank';

function hit(question: string, overrides: Partial<QuestionBankHit> = {}): QuestionBankHit {
  return {
    question,
    companies: ['Acme'],
    subcategories: ['Systems'],
    difficulty: 2,
    vote: 12,
    url: 'https://example.com/q',
    score: 0.81,
    ...overrides
  };
}

const companies = { companies: [{ name: 'Acme', count: 3 }, { name: 'Globex', count: 1 }] };

interface FetchCall {
  url: string;
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body)
  } as Response;
}

describe('QuestionBank', () => {
  const calls: FetchCall[] = [];

  beforeEach(() => {
    calls.length = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push({ url });

      if (url.includes('/companies')) {
        return Promise.resolve(jsonResponse(companies));
      }
      if (url.includes('/questions')) {
        return Promise.resolve(
          jsonResponse({
            total: 2,
            page: 0,
            pageSize: 20,
            items: [hit('What is a B+ tree?'), hit('Explain MVCC.')]
          })
        );
      }
      if (url.includes('/search')) {
        return Promise.resolve(jsonResponse({ results: [hit('Semantic match', { score: 0.9 })] }));
      }
      return Promise.reject(new Error(`unexpected url ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  test('renders companies and the default question page', async () => {
    render(<QuestionBank />);

    // Company filter buttons appear in the sidebar (scoped to buttons so the
    // identically-named company chips in result rows don't collide).
    expect(await screen.findByRole('button', { name: /Acme/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Globex/ })).toBeInTheDocument();

    // Questions render in the list.
    expect(await screen.findByText('What is a B+ tree?')).toBeInTheDocument();
    expect(screen.getByText('Explain MVCC.')).toBeInTheDocument();
  });

  test('changing the difficulty filter updates the questions query', async () => {
    render(<QuestionBank />);
    await screen.findByText('What is a B+ tree?');

    // Choosing "Hard" should issue a /questions request with difficulty=3.
    fireEvent.click(screen.getByRole('button', { name: 'Hard' }));

    await waitFor(() => {
      const hasDifficulty = calls.some(
        (c) => c.url.includes('/questions') && c.url.includes('difficulty=3')
      );
      expect(hasDifficulty).toBe(true);
    });
  });

  test('semantic mode calls the search endpoint and shows scores', async () => {
    render(<QuestionBank />);
    await screen.findByText('What is a B+ tree?');

    fireEvent.click(screen.getByRole('tab', { name: 'Semantic' }));
    fireEvent.change(screen.getByRole('searchbox', { name: /search questions/i }), {
      target: { value: 'database indexes' }
    });

    expect(await screen.findByText('Semantic match')).toBeInTheDocument();
    await waitFor(() => {
      const searched = calls.some(
        (c) => c.url.includes('/search') && c.url.includes('q=database')
      );
      expect(searched).toBe(true);
    });
    // Score badge is shown in semantic mode.
    expect(screen.getByText('0.90')).toBeInTheDocument();
  });
});
