import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';

const tourCss = readFileSync(resolve(process.cwd(), 'src/web-extras.css'), 'utf8');

test('tour chrome uses semantic variables that follow the app theme', () => {
  expect(tourCss).toContain('--tour-surface: var(--surface-elevated)');
  expect(tourCss).toContain('html[data-theme="dark"]');
  expect(tourCss).toMatch(/\.tour-tooltip\s*\{[^}]*var\(--tour-surface\)/s);
  expect(tourCss).toMatch(/\.tour-title\s*\{[^}]*var\(--tour-title\)/s);
});
