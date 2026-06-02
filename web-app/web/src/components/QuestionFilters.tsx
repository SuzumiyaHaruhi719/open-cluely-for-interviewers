import type { CompanyCount } from '../lib/api';
import { DIFFICULTY_FILTERS } from '../lib/difficulty';
import { Spinner } from './Spinner';

interface QuestionFiltersProps {
  companies: CompanyCount[];
  companiesLoading: boolean;
  selectedCompany: string | null;
  onSelectCompany: (company: string | null) => void;
  selectedDifficulty: number | null;
  onSelectDifficulty: (difficulty: number | null) => void;
}

/** Left-rail company + difficulty filters for the question bank. */
export function QuestionFilters({
  companies,
  companiesLoading,
  selectedCompany,
  onSelectCompany,
  selectedDifficulty,
  onSelectDifficulty
}: QuestionFiltersProps) {
  return (
    <aside className="qbank-sidebar">
      <div className="filter-group">
        <div className="section-title">Difficulty</div>
        <div className="filter-list">
          {DIFFICULTY_FILTERS.map((filter) => {
            const isActive = selectedDifficulty === filter.value;
            return (
              <button
                key={filter.label}
                type="button"
                className={`filter-item${isActive ? ' is-active' : ''}`}
                aria-pressed={isActive}
                onClick={() => onSelectDifficulty(filter.value)}
              >
                <span className="filter-name">{filter.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="filter-group">
        <div className="section-title">Company</div>
        {companiesLoading ? (
          <Spinner label="Loading companies…" />
        ) : (
          <div className="filter-list">
            <button
              type="button"
              className={`filter-item${selectedCompany === null ? ' is-active' : ''}`}
              aria-pressed={selectedCompany === null}
              onClick={() => onSelectCompany(null)}
            >
              <span className="filter-name">All companies</span>
            </button>
            {companies.map((company) => {
              const isActive = selectedCompany === company.name;
              return (
                <button
                  key={company.name}
                  type="button"
                  className={`filter-item${isActive ? ' is-active' : ''}`}
                  aria-pressed={isActive}
                  onClick={() => onSelectCompany(company.name)}
                  title={company.name}
                >
                  <span className="filter-name">{company.name}</span>
                  <span className="filter-count">{company.count}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
