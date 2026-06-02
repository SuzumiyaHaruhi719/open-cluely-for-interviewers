interface ErrorAlertProps {
  message: string;
  title?: string;
}

/** Inline error banner. */
export function ErrorAlert({ message, title = 'Error' }: ErrorAlertProps) {
  return (
    <div className="alert alert-error" role="alert">
      <span>
        <strong>{title}:</strong> {message}
      </span>
    </div>
  );
}
