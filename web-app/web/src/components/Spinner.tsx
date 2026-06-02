interface SpinnerProps {
  label?: string;
}

/** A small inline loading indicator. */
export function Spinner({ label }: SpinnerProps) {
  return (
    <span className="loading-row" role="status">
      <span className="spinner" aria-hidden="true" />
      {label ? <span>{label}</span> : null}
    </span>
  );
}
