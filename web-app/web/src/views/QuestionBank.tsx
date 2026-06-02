import { useMemo, useState } from 'react';
import { useDebounce } from '../lib/useDebounce';
import {
  PAGE_SIZE,
  useCompanies,
  useQuestionResults,
  type QuestionBankParams,
  type SearchMode
} from '../lib/useQuestionBank';
import { QuestionFilters } from '../components/QuestionFilters';
import { QuestionRow } from '../components/QuestionRow';
import { ErrorAlert } from '../components/ErrorAlert';
import { Spinner } from '../components/Spinner';

const SEARCH_DEBOUNCE_MS = 300;

export function QuestionBank() {
  const [mode, setMode] = useState<SearchMode>('browse');
  const [company, setCompany] = useState<string | null>(null);
  const [difficulty, setDifficulty] = useState<number | null>(null);
  const [rawQuery, setRawQuery] = useState('');
  const [page, setPage] = useState(0);

  const query = useDebounce(rawQuery, SEARCH_DEBOUNCE_MS);

  const { companies, loading: companiesLoading, error: companiesError } = useCompanies();

  const params = useMemo<QuestionBankParams>(() => {
    if (mode === 'semantic') {
      return { mode: 'semantic', query };
    }
    return { mode: 'browse', company, difficulty, query, page };
  }, [mode, company, difficulty, query, page]);

  const { items, total, loading, error } = useQuestionResults(params);

  const resetToFirstPage = (): void => setPage(0);

  const onSelectCompany = (next: string | null): void => {
    setCompany(next);
    resetToFirstPage();
  };

  const onSelectDifficulty = (next: number | null): void => {
    setDifficulty(next);
    resetToFirstPage();
  };

  const onChangeQuery = (next: string): void => {
    setRawQuery(next);
    resetToFirstPage();
  };

  const onChangeMode = (next: SearchMode): void => {
    setMode(next);
    resetToFirstPage();
  };

  const totalPages = mode === 'browse' ? Math.max(1, Math.ceil(total / PAGE_SIZE)) : 1;
  const isSemantic = mode === 'semantic';
  const showPager = mode === 'browse' && total > PAGE_SIZE;
  const hasResults = items.length > 0;
  const semanticAwaitingQuery = isSemantic && query.trim().length === 0;

  return (
    <div className="qbank">
      <QuestionFilters
        companies={companies}
        companiesLoading={companiesLoading}
        selectedCompany={company}
        onSelectCompany={onSelectCompany}
        selectedDifficulty={difficulty}
        onSelectDifficulty={onSelectDifficulty}
      />

      <div className="qbank-main">
        <div className="qbank-toolbar">
          <div className="mode-toggle" role="tablist" aria-label="Search mode">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'browse'}
              className={mode === 'browse' ? 'is-active' : ''}
              onClick={() => onChangeMode('browse')}
            >
              Browse
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'semantic'}
              className={mode === 'semantic' ? 'is-active' : ''}
              onClick={() => onChangeMode('semantic')}
            >
              Semantic
            </button>
          </div>
          <div className="qbank-search">
            <input
              type="search"
              aria-label="Search questions"
              placeholder={
                isSemantic
                  ? 'Describe a topic to find related questions…'
                  : 'Filter questions by keyword…'
              }
              value={rawQuery}
              onChange={(e) => onChangeQuery(e.target.value)}
            />
          </div>
        </div>

        <div className="qbank-results">
          {companiesError ? <ErrorAlert message={companiesError} title="Companies" /> : null}
          {error ? <ErrorAlert message={error} /> : null}

          {!error && !semanticAwaitingQuery ? (
            <div className="qbank-meta">
              <span>
                {loading
                  ? 'Searching…'
                  : isSemantic
                    ? `${items.length} related`
                    : `${total.toLocaleString()} question${total === 1 ? '' : 's'}`}
              </span>
              {isSemantic && hasResults ? <span>by relevance</span> : null}
            </div>
          ) : null}

          {loading && !hasResults ? <Spinner label="Loading questions…" /> : null}

          {semanticAwaitingQuery ? (
            <div className="empty">
              <div className="empty-icon" aria-hidden="true" />
              <div className="empty-title">Semantic search</div>
              <p>Type a topic or concept to find the closest questions by meaning.</p>
            </div>
          ) : null}

          {!loading && !semanticAwaitingQuery && !hasResults && !error ? (
            <div className="empty">
              <div className="empty-icon" aria-hidden="true" />
              <div className="empty-title">No matches</div>
              <p>Try a different keyword{mode === 'browse' ? ' or clear the filters' : ''}.</p>
            </div>
          ) : null}

          {hasResults ? (
            <ul className="q-list">
              {items.map((item, index) => (
                <QuestionRow
                  key={`${index}-${item.question}`}
                  item={item}
                  showScore={isSemantic}
                />
              ))}
            </ul>
          ) : null}

          {showPager ? (
            <div className="pager">
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page <= 0 || loading}
              >
                ← Prev
              </button>
              <span className="pager-info">
                Page {page + 1} of {totalPages}
              </span>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1 || loading}
              >
                Next →
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
