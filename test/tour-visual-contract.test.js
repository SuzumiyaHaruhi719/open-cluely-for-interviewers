const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const CSS_FILES = [
  'src/windows/assistant/tour.css',
  'web-app/web/src/web-extras.css'
];

function cssRule(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 's'));
  assert.ok(match, `missing ${selector} rule`);
  return match[1];
}

test('tour masks keep the real interface fully visible without dimming or blur', () => {
  for (const file of CSS_FILES) {
    const css = fs.readFileSync(file, 'utf8');
    const mask = cssRule(css, '.tour-mask');
    assert.doesNotMatch(mask, /backdrop-filter/, `${file} still blurs the interface`);
    assert.match(css, /--tour-mask:\s*transparent\s*;/, `${file} does not define a transparent mask`);
    assert.doesNotMatch(css, /--tour-mask:\s*rgba\(/, `${file} still dims the interface`);
  }
});

test('Electron tour navigation preserves geometry during step handoff', () => {
  const source = fs.readFileSync('src/windows/assistant/tour.js', 'utf8');
  const start = source.indexOf('function goToStep');
  const end = source.indexOf('/** Finish the tour */', start);
  assert.ok(start >= 0 && end > start, 'missing goToStep implementation');
  const goToStep = source.slice(start, end);

  assert.doesNotMatch(goToStep, /resetPosition\(\)/, 'navigation resets the old geometry before the next target is ready');
  assert.doesNotMatch(goToStep, /style\.display\s*=\s*['"]none['"]/, 'navigation removes moving elements before CSS can animate them');
});
