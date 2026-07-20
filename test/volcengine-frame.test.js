const test = require('node:test');
const assert = require('node:assert');
const zlib = require('zlib');
const {
  VOLC_DEFAULT_RESOURCE_ID,
  VOLC_WS_URL_NOSTREAM,
  buildFrame,
  endpointForResource,
  isDoubaoAsr2Resource,
  parseFrame
} = require('../src/services/volcengine-asr/service');

test('desktop Doubao policy defaults to Seed ASR 2.0 duration on the nostream endpoint', () => {
  assert.strictEqual(VOLC_DEFAULT_RESOURCE_ID, 'volc.seedasr.sauc.duration');
  assert.strictEqual(isDoubaoAsr2Resource(VOLC_DEFAULT_RESOURCE_ID), true);
  assert.strictEqual(isDoubaoAsr2Resource('volc.bigasr.sauc.duration'), false);
  assert.strictEqual(endpointForResource(VOLC_DEFAULT_RESOURCE_ID), VOLC_WS_URL_NOSTREAM);
});

// Volcengine binary framing: a JSON config frame round-trips through build→parse.
test('config frame round-trips (gzip JSON, full-server-shaped parse)', () => {
  const json = JSON.stringify({ user: { uid: 'x' }, audio: { rate: 16000 } });
  const frame = buildFrame({
    messageType: 0x1, flags: 0x1, serialization: 0x1, compression: 0x1,
    sequence: 1, payload: zlib.gzipSync(Buffer.from(json))
  });
  // Header byte 0 = version<<4 | headerSize.
  assert.strictEqual(frame[0], (0x1 << 4) | 0x1);
  // messageType<<4 | flags.
  assert.strictEqual((frame[1] >> 4) & 0xF, 0x1);
  assert.strictEqual(frame[1] & 0xF, 0x1);

  const parsed = parseFrame(frame);
  assert.strictEqual(parsed.messageType, 0x1);
  assert.deepStrictEqual(JSON.parse(parsed.payload.toString('utf8')), JSON.parse(json));
});

test('audio frame with sequence parses and un-gzips payload', () => {
  const pcm = Buffer.from([1, 2, 3, 4, 5, 6]);
  const frame = buildFrame({ messageType: 0x2, flags: 0x1, serialization: 0x0, compression: 0x1, sequence: 7, payload: zlib.gzipSync(pcm) });
  const parsed = parseFrame(frame);
  assert.strictEqual(parsed.messageType, 0x2);
  assert.deepStrictEqual(parsed.payload, pcm);
});
