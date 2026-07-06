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
          <div className="mode-toggle" role="tablist" aria-label="搜索模式">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'browse'}
              className={mode === 'browse' ? 'is-active' : ''}
              onClick={() => onChangeMode('browse')}
            >
              浏览
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'semantic'}
              className={mode === 'semantic' ? 'is-active' : ''}
              onClick={() => onChangeMode('semantic')}
            >
              语义
            </button>
          </div>
          <div className="qbank-search">
            <input
              type="search"
              aria-label="搜索题目"
              placeholder={
                isSemantic
                  ? '描述一个主题，查找相关题目…'
                  : '输入关键词筛选题目…'
              }
              value={rawQuery}
              onChange={(e) => onChangeQuery(e.target.value)}
            />
          </div>
        </div>

        <div className="qbank-results">
          {companiesError ? <ErrorAlert message={companiesError} title="公司列表" /> : null}
          {error ? <ErrorAlert message={error} /> : null}

          {!error && !semanticAwaitingQuery ? (
            <div className="qbank-meta">
              <span>
                {loading
                  ? '搜索中…'
                  : isSemantic
                    ? `${items.length} 个相关结果`
                    : `${total.toLocaleString()} 道题`}
              </span>
              {isSemantic && hasResults ? <span>按相关性排序</span> : null}
            </div>
          ) : null}

          {loading && !hasResults ? <Spinner label="加载题目中…" /> : null}

          {semanticAwaitingQuery ? (
            <div className="empty">
              <div className="empty-icon" aria-hidden="true" />
              <div className="empty-title">语义搜索</div>
              <p>输入主题或概念，按语义查找最接近的题目。</p>
            </div>
          ) : null}

          {!loading && !semanticAwaitingQuery && !hasResults && !error ? (
            <div className="empty">
              <div className="empty-icon" aria-hidden="true" />
              <div className="empty-title">没有匹配结果</div>
              <p>{mode === 'browse' ? '换个关键词，或清空筛选条件。' : '换个主题或概念试试。'}</p>
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
                ← 上一页
              </button>
              <span className="pager-info">
                第 {page + 1} / {totalPages} 页
              </span>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1 || loading}
              >
                下一页 →
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
