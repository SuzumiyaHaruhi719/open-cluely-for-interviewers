// Auto-repair pass for subagent-written fixtures.
//
// Bug class fixed: subagents sometimes embed ASCII " inside Chinese string
// content for quoted product/feature names (e.g. "喜茶星球银卡"). These break
// JSON parsing. We detect the pattern (ASCII " surrounded by Han chars on
// at least one side) and replace with Chinese book-end brackets 『 』.
//
// We only modify files that currently FAIL JSON.parse — successful files are
// left alone so we never risk altering valid content.

const fs = require('fs');
const path = require('path');

const FIXTURE_DIR = path.join(process.cwd(), 'fixtures', 'expert-interview');

function tryParse(text) {
  try { JSON.parse(text); return true; } catch (_) { return false; }
}

// Replace " that appears between Han chars (on at least one side) with brackets.
// Iterate pairs: turn the FIRST such " into 『 and the next into 』.
function repairInnerQuotes(text) {
  // Walk character by character. Track Han adjacency.
  const isHan = (ch) => /[一-鿿㐀-䶿]/.test(ch);
  const chars = Array.from(text);
  let open = true;
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] !== '"') continue;
    const prev = i > 0 ? chars[i - 1] : '';
    const next = i + 1 < chars.length ? chars[i + 1] : '';
    // Skip if this looks like a JSON key/value boundary: preceded by whitespace/,/:/{/[ or followed by :/}/,/]
    const looksLikeJsonBoundary = /[\s,:{[]/.test(prev) || /[:},\]]/.test(next);
    const hanAdjacent = isHan(prev) || isHan(next);
    if (hanAdjacent && !looksLikeJsonBoundary) {
      chars[i] = open ? '『' : '』';
      open = !open;
    }
  }
  return chars.join('');
}

function main() {
  const files = fs.readdirSync(FIXTURE_DIR).filter((n) => n.startsWith('fx_') && n.endsWith('.json'));
  let repaired = 0;
  let stillBroken = 0;
  for (const name of files) {
    const filePath = path.join(FIXTURE_DIR, name);
    const original = fs.readFileSync(filePath, 'utf8');
    if (tryParse(original)) continue;
    const repaired1 = repairInnerQuotes(original);
    if (tryParse(repaired1)) {
      fs.writeFileSync(filePath, repaired1, 'utf8');
      console.log(`REPAIRED: ${name}`);
      repaired += 1;
    } else {
      stillBroken += 1;
      console.log(`STILL BROKEN: ${name}`);
    }
  }
  console.log(`\n${repaired} repaired, ${stillBroken} still broken`);
}

if (require.main === module) main();
