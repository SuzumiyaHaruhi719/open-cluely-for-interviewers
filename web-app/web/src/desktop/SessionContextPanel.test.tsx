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

  test('renders notes in ascending interview time even before AI context exists', () => {
    const { container } = render(
      <SessionContextPanel
        state={null}
        startedAtMs={1_000}
        notes={[
          { text: '后写的备注', createdAtMs: 241_000 },
          { text: '先写的备注', createdAtMs: 121_000 }
        ]}
      />
    );

    expect(screen.getByRole('heading', { name: '面试备注' })).toBeInTheDocument();
    const notes = Array.from(container.querySelectorAll('.ctx-note')).map(
      (node) => node.textContent ?? ''
    );
    expect(notes).toEqual([
      expect.stringContaining('00:02:00先写的备注'),
      expect.stringContaining('00:04:00后写的备注')
    ]);
    expect(screen.queryByText('还没有上下文')).not.toBeInTheDocument();
  });
});
