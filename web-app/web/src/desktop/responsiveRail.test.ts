import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';

const shellCss = readFileSync(resolve(process.cwd(), 'src/desktop-ui/styles.css'), 'utf8');

test('the right-rail toggle opens a real drawer below the desktop breakpoint', () => {
  const narrowLayout = shellCss.match(/@media \(max-width: 1000px\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';

  expect(narrowLayout).toMatch(/\.right-rail\s*\{[^}]*display:\s*flex/s);
  expect(narrowLayout).toMatch(/\.right-rail\s*\{[^}]*position:\s*absolute/s);
  expect(narrowLayout).toMatch(/body\.rail-collapsed \.right-rail\s*\{[^}]*translateX\(100%\)/s);
  expect(narrowLayout).not.toMatch(/\.right-rail\s*\{[^}]*display:\s*none/s);
});
