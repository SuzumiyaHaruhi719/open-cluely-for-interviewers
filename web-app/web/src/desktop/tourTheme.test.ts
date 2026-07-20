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

test('tour leaves the workspace fully visible without dimming or blur', () => {
  expect(tourCss).toContain('--tour-mask: transparent');
  expect(tourCss).not.toMatch(/--tour-mask:\s*rgba\(/);
  expect(tourCss).toMatch(/\.tour-mask\s*\{[^}]*background:\s*var\(--tour-mask\)/s);
  expect(tourCss).not.toMatch(/\.tour-mask\s*\{[^}]*backdrop-filter:/s);
});
