interface CompanyChipsProps {
  companies: string[];
  /** Show at most this many chips, collapsing the rest into a "+N" chip. */
  max?: number;
}

const DEFAULT_MAX = 4;

/** Renders a list of company names as compact chips. */
export function CompanyChips({ companies, max = DEFAULT_MAX }: CompanyChipsProps) {
  if (companies.length === 0) {
    return null;
  }

  const shown = companies.slice(0, max);
  const remaining = companies.length - shown.length;

  return (
    <span className="chips">
      {shown.map((company) => (
        <span key={company} className="chip" title={company}>
          {company}
        </span>
      ))}
      {remaining > 0 ? <span className="chip chip-more">+{remaining}</span> : null}
    </span>
  );
}
