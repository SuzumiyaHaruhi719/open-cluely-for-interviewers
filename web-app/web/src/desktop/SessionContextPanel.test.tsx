import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { SessionContextPanel } from './SessionContextPanel';

afterEach(cleanup);

describe('SessionContextPanel', () => {
  test('renders the empty state when runtime context arrays are missing', () => {
    const { container } = render(<SessionContextPanel state={{} as never} />);

    expect(screen.getByText('还没有上下文')).toBeInTheDocument();
    expect(container.querySelector('[data-icon-library="phosphor"]')).not.toBeNull();
  });
});
