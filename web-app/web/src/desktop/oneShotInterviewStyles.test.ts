import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/desktop-ui/one-shot-interview.css'), 'utf8');

describe('one-shot interview layout contracts', () => {
  test('gives automatic context its own keyboard-scrollable viewport', () => {
    const bodyRule = css.match(/\.context-drawer__body\s*\{(?<body>[\s\S]*?)\}/)?.groups?.body ?? '';
    expect(bodyRule).toMatch(/min-height:\s*0/);
    expect(bodyRule).toMatch(/overflow-y:\s*auto/);
    expect(bodyRule).toMatch(/overscroll-behavior:\s*contain/);
    expect(bodyRule).toMatch(/scrollbar-gutter:\s*stable/);
  });

  test('uses the same source field geometry for both audio lanes', () => {
    expect(css).toMatch(/\.interview-dock\s+\[data-source-field='true'\]/);
  });
});
