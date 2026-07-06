import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Optional custom fallback renderer. Receives the caught error and a reset callback. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
  /** React component stack for the caught error — surfaced on-screen in dev. */
  componentStack: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Log so the real trigger is visible in the console instead of a silent white screen.
    console.error('[ErrorBoundary] Uncaught render error:', error, info.componentStack);
    // Also keep the component stack so the dev fallback can show WHICH component
    // threw — diagnosing "Cannot read properties of undefined" without DevTools.
    this.setState({ componentStack: info.componentStack ?? null });
  }

  reset = (): void => {
    this.setState({ error: null, componentStack: null });
  };

  render(): ReactNode {
    const { error, componentStack } = this.state;
    const { children, fallback } = this.props;

    if (!error) return children;

    if (fallback) return fallback(error, this.reset);

    return <DefaultFallback error={error} componentStack={componentStack} onReset={this.reset} />;
  }
}

// ---------------------------------------------------------------------------
// Default fallback panel — themed via CSS variables, no external deps
// ---------------------------------------------------------------------------

function DefaultFallback({
  error,
  componentStack,
  onReset,
}: {
  error: Error;
  componentStack: string | null;
  onReset: () => void;
}) {
  const panelStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    padding: '2rem',
    fontFamily: 'system-ui, sans-serif',
    background: 'var(--surface-page, #f9fafb)',
    color: 'var(--text-primary, #42464a)',
  };

  const cardStyle: React.CSSProperties = {
    maxWidth: 560,
    width: '100%',
    padding: '2rem',
    borderRadius: 12,
    background: 'var(--surface-elevated, #ffffff)',
    border: '1px solid var(--error-bg, rgba(200,58,58,.2))',
    boxShadow: '0 4px 24px rgba(0,0,0,.08)',
    textAlign: 'center',
  };

  const headingStyle: React.CSSProperties = {
    margin: '0 0 .75rem',
    fontSize: 'var(--text-xl, 20px)',
    fontWeight: 700,
    color: 'var(--error, #c83a3a)',
  };

  const messageStyle: React.CSSProperties = {
    margin: '0 0 1.5rem',
    fontSize: 'var(--text-sm, 13px)',
    color: 'var(--text-secondary, #555b61)',
    wordBreak: 'break-word',
    whiteSpace: 'pre-wrap',
  };

  const buttonRowStyle: React.CSSProperties = {
    display: 'flex',
    gap: '0.75rem',
    justifyContent: 'center',
    flexWrap: 'wrap',
  };

  const primaryBtnStyle: React.CSSProperties = {
    padding: '0.6rem 1.25rem',
    borderRadius: 8,
    border: 'none',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: 'var(--text-sm, 13px)',
    background: 'var(--text-brand, #00aa4f)',
    color: 'var(--text-inverse, #ffffff)',
  };

  const secondaryBtnStyle: React.CSSProperties = {
    padding: '0.6rem 1.25rem',
    borderRadius: 8,
    border: '1px solid var(--surface-active, #e5e7eb)',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: 'var(--text-sm, 13px)',
    background: 'var(--surface-subtle, #f0f1f3)',
    color: 'var(--text-primary, #42464a)',
  };

  const diagStyle: React.CSSProperties = {
    marginBottom: '1.25rem',
    textAlign: 'left',
  };

  const preStyle: React.CSSProperties = {
    marginTop: '.5rem',
    maxHeight: 280,
    overflow: 'auto',
    fontSize: 11,
    lineHeight: 1.45,
    background: 'var(--surface-subtle, #f0f1f3)',
    padding: '.75rem',
    borderRadius: 8,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  };

  // Vite exposes import.meta.env.DEV; show diagnostics only in dev builds.
  const showDiagnostics = Boolean(
    (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV
  );

  return (
    <div style={panelStyle}>
      <div role="alert" style={cardStyle}>
        <h1 style={headingStyle}>出错了</h1>
        <p style={messageStyle}>{error.message}</p>
        {showDiagnostics ? (
          <details style={diagStyle} open>
            <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--text-secondary, #555b61)' }}>
              诊断信息 — 出错位置
            </summary>
            <pre style={preStyle}>
              {error.stack || error.message}
              {componentStack ? `\n\n— component stack —\n${componentStack}` : ''}
            </pre>
          </details>
        ) : null}
        <div style={buttonRowStyle}>
          <button style={primaryBtnStyle} onClick={() => window.location.reload()}>
            重新加载
          </button>
          <button style={secondaryBtnStyle} onClick={onReset}>
            重试
          </button>
        </div>
      </div>
    </div>
  );
}
