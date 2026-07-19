import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_QWEN_TTS_MODEL,
  DEFAULT_QWEN_TTS_VOICE,
  DEFAULT_TTS_WS_URL,
  QWEN_TTS_MODELS,
  validateTtsConfig
} from '../src/config';

test('TTS config supports both Qwen Audio 3.0 models on the workspace endpoint', () => {
  assert.deepEqual(QWEN_TTS_MODELS, [
    'qwen-audio-3.0-tts-plus',
    'qwen-audio-3.0-tts-flash'
  ]);
  assert.equal(DEFAULT_QWEN_TTS_MODEL, 'qwen-audio-3.0-tts-plus');
  assert.equal(DEFAULT_QWEN_TTS_VOICE, 'longanlingxi');
  assert.equal(
    DEFAULT_TTS_WS_URL,
    'wss://llm-opv63ugogbbsgk6i.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference'
  );
});

test('TTS config rejects a missing key or voice without opening a provider connection', () => {
  assert.deepEqual(validateTtsConfig({ apiKey: '', voice: 'longanlingxi' }), {
    available: false,
    reason: 'DASHSCOPE_API_KEY 未配置'
  });
  assert.deepEqual(validateTtsConfig({ apiKey: 'sk-test', voice: '' }), {
    available: false,
    reason: 'QWEN_TTS_VOICE 未配置'
  });
  assert.deepEqual(validateTtsConfig({ apiKey: 'sk-test', voice: 'longanlingxi' }), {
    available: true
  });
});
