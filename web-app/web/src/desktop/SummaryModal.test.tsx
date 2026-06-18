import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { SummaryModal } from './SummaryModal';
import type { SummaryState } from '../lib/useCopilotSocket';

// The SummaryModal renders the interview-evaluation report with a tiny, SAFE
// Markdown renderer (React text nodes only — never dangerouslySetInnerHTML). The
// tests pin: the loading spinner, the error banner, the empty-notice state (#8),
// and the markdown fidelity (#7 — inline `code`, numbered lists, plus the
// existing bold/heading/bullet support).

const noop = () => {};

function state(patch: Partial<SummaryState>): SummaryState {
  return { status: 'idle', text: '', error: null, empty: false, ...patch };
}

function renderModal(summary: SummaryState) {
  return render(
    <SummaryModal open summary={summary} onRegenerate={noop} onClose={noop} />
  );
}

afterEach(() => {
  cleanup();
});

describe('SummaryModal states', () => {
  test('loading state shows the generating spinner copy', () => {
    renderModal(state({ status: 'loading' }));
    expect(screen.getByText(/Generating evaluation report/i)).toBeInTheDocument();
  });

  test('error state shows the failure banner with the message', () => {
    renderModal(state({ status: 'error', error: 'no key' }));
    expect(screen.getByText(/Failed to generate summary/i)).toBeInTheDocument();
    expect(screen.getByText(/no key/)).toBeInTheDocument();
  });

  // #8 — the empty-transcript notice must be a distinct NOTICE, not a fake report.
  test('#8 empty-notice state renders a notice, not a report body', () => {
    const { container } = renderModal(
      state({ status: 'done', empty: true, text: '还没有可总结的面试内容。' })
    );
    // A dedicated notice element (not the .summary-md report container).
    expect(container.querySelector('.summary-modal__notice')).not.toBeNull();
    expect(container.querySelector('.summary-md')).toBeNull();
    expect(screen.getByText(/还没有可总结的面试内容/)).toBeInTheDocument();
  });

  test('a real report (done, not empty) renders the markdown report body', () => {
    const { container } = renderModal(
      state({ status: 'done', text: '## 候选人概况\n整体不错。' })
    );
    expect(container.querySelector('.summary-md')).not.toBeNull();
    expect(container.querySelector('.summary-modal__notice')).toBeNull();
  });
});

describe('#7 SummaryReport markdown fidelity', () => {
  test('renders inline `code` as a <code> element', () => {
    const { container } = renderModal(
      state({ status: 'done', text: '使用 `useCallback` 包裹回调。' })
    );
    const code = container.querySelector('code');
    expect(code).not.toBeNull();
    expect(code?.textContent).toBe('useCallback');
    // The surrounding text is preserved (no backticks left literal).
    expect(container.textContent).toContain('包裹回调');
    expect(container.textContent).not.toContain('`');
  });

  test('renders a numbered list (1. / 2.) as an ordered list', () => {
    const { container } = renderModal(
      state({ status: 'done', text: '步骤：\n1. 第一步\n2. 第二步\n3. 第三步' })
    );
    const ol = container.querySelector('ol');
    expect(ol).not.toBeNull();
    const items = ol ? within(ol as HTMLElement).getAllByRole('listitem') : [];
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toContain('第一步');
    expect(items[2].textContent).toContain('第三步');
    // The literal "1." marker is not rendered as text (the <ol> supplies it).
    expect(items[0].textContent).not.toContain('1.');
  });

  test('numbered list items still support inline bold + code', () => {
    const { container } = renderModal(
      state({ status: 'done', text: '1. **系统设计**：使用 `Redis` 缓存' })
    );
    const ol = container.querySelector('ol');
    expect(ol).not.toBeNull();
    expect(ol?.querySelector('strong')?.textContent).toBe('系统设计');
    expect(ol?.querySelector('code')?.textContent).toBe('Redis');
  });

  test('existing behavior still works: ## heading, **bold**, and - bullets', () => {
    const { container } = renderModal(
      state({
        status: 'done',
        text: '## 亮点\n- 表现 **突出**\n- 沟通清晰\n\n> 一句引用'
      })
    );
    // Heading rendered (## → an <h3> in this renderer).
    expect(screen.getByText('亮点')).toBeInTheDocument();
    // Unordered list with two items.
    const ul = container.querySelector('ul');
    expect(ul).not.toBeNull();
    expect(within(ul as HTMLElement).getAllByRole('listitem')).toHaveLength(2);
    // Bold inside a bullet.
    expect(container.querySelector('strong')?.textContent).toBe('突出');
    // Blockquote.
    expect(container.querySelector('blockquote')?.textContent).toContain('一句引用');
  });

  test('does NOT use dangerouslySetInnerHTML — angle brackets render as literal text', () => {
    const { container } = renderModal(
      state({ status: 'done', text: '注意 <script>alert(1)</script> 不应执行' })
    );
    // No script element was injected — the markup is inert text.
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('<script>alert(1)</script>');
  });

  test('ordered and unordered lists do not bleed into each other', () => {
    const { container } = renderModal(
      state({ status: 'done', text: '- 无序项\n1. 有序项' })
    );
    const ul = container.querySelector('ul');
    const ol = container.querySelector('ol');
    expect(ul).not.toBeNull();
    expect(ol).not.toBeNull();
    expect(within(ul as HTMLElement).getAllByRole('listitem')).toHaveLength(1);
    expect(within(ol as HTMLElement).getAllByRole('listitem')).toHaveLength(1);
  });
});
