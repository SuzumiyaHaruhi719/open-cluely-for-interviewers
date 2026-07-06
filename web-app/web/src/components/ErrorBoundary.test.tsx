import { describe, expect, test, afterEach, vi, beforeEach, afterAll } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

afterEach(cleanup);

// Component that renders normally
function GoodChild() {
  return <p>All good</p>;
}

// Component that always throws during render
function BadChild({ message }: { message: string }): never {
  throw new Error(message);
}

describe('ErrorBoundary', () => {
  // Suppress the two console.error calls React emits for caught render errors
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterAll(() => {
    consoleErrorSpy.mockRestore();
  });

  test('renders children normally when no error occurs', () => {
    render(
      <ErrorBoundary>
        <GoodChild />
      </ErrorBoundary>
    );

    expect(screen.getByText('All good')).toBeInTheDocument();
    // Fallback must NOT appear
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('renders fallback alert panel when a child throws, without crashing', () => {
    const errorMessage = 'Something exploded in the child';

    render(
      <ErrorBoundary>
        <BadChild message={errorMessage} />
      </ErrorBoundary>
    );

    // The boundary must show a role="alert" panel
    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();

    // The error message text must be visible
    expect(alert).toHaveTextContent(errorMessage);

    // Normal children must NOT appear
    expect(screen.queryByText('All good')).not.toBeInTheDocument();
  });
});
