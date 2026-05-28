// Unit smoke for the transcript-buffer merge logic. Covers the Chinese
// drop-bug, English boundary overlap, near-dup, and substring cases.

const path = require('path');

// The module is ESM; load it dynamically.
(async () => {
  const url = require('url').pathToFileURL(
    path.resolve(__dirname, '..', 'src', 'windows', 'assistant', 'renderer', 'features', 'assembly-ai', 'transcript-buffer.js')
  ).href;

  // Stub the source-state import. The module only uses `normalizeSource`
  // which we don't exercise here.
  const sourceStateUrl = require('url').pathToFileURL(
    path.resolve(__dirname, '..', 'src', 'windows', 'assistant', 'renderer', 'features', 'assembly-ai', 'source-state.js')
  ).href;

  const transcriptBuffer = await import(url);
  const { createTranscriptBufferManager } = transcriptBuffer;

  // Create a manager just to get a handle on the merge helper.
  const mgr = createTranscriptBufferManager({ onFlush: () => {}, mergeWindowMs: 99999 });
  const merge = mgr._mergeTranscriptText;
  const normalize = mgr._normalizeTranscriptForMerge;

  let failed = 0;
  function check(name, expected, actual) {
    const ok = expected === actual;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}: ${name}`);
    if (!ok) {
      console.log(`    expected: ${JSON.stringify(expected)}`);
      console.log(`    actual:   ${JSON.stringify(actual)}`);
      failed += 1;
    }
  }

  console.log('--- normalizer ---');
  check('Chinese kept', '你好世界', normalize('你好，世界！'));
  check('punctuation stripped', 'hello world', normalize('Hello, World!'));
  // Stripping the Chinese comma between scripts produces no space because the
  // raw text had none — same canonical form as "你好World!". For the equality
  // check that's what we want; users don't see this normalized form.
  check('mixed', '你好world', normalize('你好，World!'));
  check('fullwidth space', 'a b', normalize('a　b'));

  console.log('--- Chinese merge (regression for the dropped-second-sentence bug) ---');
  check('two distinct CN sentences', '但是古代的那个封号呢?他是因为你为国家做了一些贡献。',
    merge('但是古代的那个封号呢?', '他是因为你为国家做了一些贡献。'));
  check('CN duplicate kept once', '你好世界',
    merge('你好世界', '你好世界'));
  check('CN substring contained',
    '我们使用了缓存和数据库索引优化来提升性能',
    merge('我们使用了缓存', '我们使用了缓存和数据库索引优化来提升性能'));

  console.log('--- English merge (existing behaviour preserved) ---');
  check('EN boundary overlap',
    'the candidate said they led a team of five engineers',
    merge('the candidate said they led', 'they led a team of five engineers'));
  check('EN no overlap',
    'first sentence. second sentence',
    merge('first sentence.', 'second sentence'));

  console.log('--- Mixed ---');
  check('CN + EN appended with space',
    '候选人说 The deployment failed',
    merge('候选人说', 'The deployment failed'));

  console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
