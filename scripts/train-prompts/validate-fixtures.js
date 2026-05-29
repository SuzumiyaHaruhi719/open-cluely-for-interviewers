// Validate written fixtures against the V3 schema. Walks
// fixtures/expert-interview/*.json (excluding _manifests/), checks every
// required field, and reports per-fixture errors.
//
// Usage: node scripts/train-prompts/validate-fixtures.js

const fs = require('fs');
const path = require('path');

const FIXTURE_DIR = path.join(process.cwd(), 'fixtures', 'expert-interview');

const REQUIRED_FIELDS = [
  'id',
  'tags',
  'resume',
  'jd',
  'history',
  'candidate_last_answer',
  'session_state',
  'ground_truth'
];

const REQUIRED_TAGS = [
  'industry',
  'level',
  'language',
  'answer_quality',
  'history_length_bucket',
  'history_length',
  'resume_type',
  'edge_case'
];

const REQUIRED_GT_FIELDS = [
  'competency_target',
  'missing_evidence',
  'safety_flags',
  'top_question_traits'
];

function listFixtureFiles() {
  if (!fs.existsSync(FIXTURE_DIR)) return [];
  return fs.readdirSync(FIXTURE_DIR)
    .filter((name) => name.endsWith('.json') && name.startsWith('fx_'))
    .map((name) => path.join(FIXTURE_DIR, name));
}

function validateOne(filePath) {
  const errors = [];
  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    return { file: filePath, errors: [`JSON parse error: ${err.message}`] };
  }

  for (const f of REQUIRED_FIELDS) {
    if (data[f] === undefined || data[f] === null) errors.push(`missing field: ${f}`);
  }
  if (data.tags) {
    for (const t of REQUIRED_TAGS) {
      if (data.tags[t] === undefined) errors.push(`missing tags.${t}`);
    }
  }
  if (data.ground_truth) {
    for (const t of REQUIRED_GT_FIELDS) {
      if (data.ground_truth[t] === undefined) errors.push(`missing ground_truth.${t}`);
    }
  }
  if (Array.isArray(data.history) && data.tags?.history_length && data.history.length !== data.tags.history_length) {
    errors.push(`history.length (${data.history.length}) != tags.history_length (${data.tags.history_length})`);
  }
  if (typeof data.candidate_last_answer === 'string' && data.candidate_last_answer.trim().length < 5) {
    errors.push('candidate_last_answer too short (<5 chars)');
  }
  if (typeof data.resume === 'string') {
    const text = data.resume.trim();
    const rt = data.tags?.resume_type;
    const lang = data.tags?.language;
    // Chinese chars don't use whitespace word boundaries — count Han chars as words.
    const isCharCount = lang === 'zh' || (lang === 'mixed' && /[一-龥]{20,}/.test(text));
    const sizeUnit = isCharCount
      ? text.replace(/\s/g, '').length // char count, ignoring whitespace
      : text.split(/\s+/).length;       // word count
    if (rt === 'sparse-200words' && sizeUnit > 350) errors.push(`resume_type=sparse-200words but resume size ${sizeUnit} (${isCharCount ? 'chars' : 'words'})`);
    if (rt === 'verbose-1500words' && sizeUnit < 800) errors.push(`resume_type=verbose-1500words but resume size ${sizeUnit} (${isCharCount ? 'chars' : 'words'})`);
  }
  return { file: filePath, errors };
}

function main() {
  const files = listFixtureFiles();
  console.log(`Validating ${files.length} fixtures from ${FIXTURE_DIR}`);
  let passCount = 0;
  const failures = [];
  for (const f of files) {
    const result = validateOne(f);
    if (result.errors.length === 0) passCount += 1;
    else failures.push(result);
  }
  console.log(`PASS: ${passCount}/${files.length}`);
  if (failures.length) {
    console.log(`FAIL: ${failures.length}`);
    for (const f of failures.slice(0, 20)) {
      console.log(`  ${path.basename(f.file)}:`);
      for (const e of f.errors) console.log(`    - ${e}`);
    }
    if (failures.length > 20) console.log(`  ...and ${failures.length - 20} more`);
  }
  const reportPath = path.join(FIXTURE_DIR, '_manifests', 'validation-report.json');
  fs.writeFileSync(reportPath, JSON.stringify({
    total: files.length,
    pass: passCount,
    fail: failures.length,
    failures: failures.map((f) => ({ file: path.basename(f.file), errors: f.errors }))
  }, null, 2));
  console.log(`Report → ${reportPath}`);
  process.exit(failures.length === 0 ? 0 : 0); // never hard-fail; report is the artifact
}

if (require.main === module) main();

module.exports = { listFixtureFiles, validateOne };
