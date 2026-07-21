import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadServerEnvironment } from '../src/environment';
import { BALANCED_AUTO_GATE, resolveServerConfig } from '../src/config';

function fixture(): {
  directory: string;
  rootPath: string;
  legacyPath: string;
} {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'interviewer-env-'));
  return {
    directory,
    rootPath: path.join(directory, '.env'),
    legacyPath: path.join(directory, 'web-app.env')
  };
}

test('server environment precedence is OS then root then legacy', (context) => {
  const paths = fixture();
  context.after(() => fs.rmSync(paths.directory, { recursive: true, force: true }));
  fs.writeFileSync(
    paths.rootPath,
    [
      'INTERVIEWER_MODEL=root-model',
      'DASHSCOPE_API_KEY=root-key',
      'VOLC_APP_ID=root-app'
    ].join('\n')
  );
  fs.writeFileSync(
    paths.legacyPath,
    [
      'INTERVIEWER_MODEL=legacy-model',
      'DASHSCOPE_API_KEY=legacy-key',
      'VOLC_APP_ID=legacy-app',
      'VOLC_ACCESS_TOKEN=legacy-token'
    ].join('\n')
  );
  const target: NodeJS.ProcessEnv = { INTERVIEWER_MODEL: 'os-model' };

  const result = loadServerEnvironment({
    rootPath: paths.rootPath,
    legacyPath: paths.legacyPath,
    target
  });

  assert.equal(target.INTERVIEWER_MODEL, 'os-model');
  assert.equal(target.DASHSCOPE_API_KEY, 'root-key');
  assert.equal(target.VOLC_APP_ID, 'root-app');
  assert.equal(target.VOLC_ACCESS_TOKEN, 'legacy-token');
  assert.deepEqual(result, {
    rootLoaded: true,
    legacyLoaded: true,
    rootPath: paths.rootPath,
    legacyPath: paths.legacyPath
  });
});

test('missing environment files are safe and never erase existing values', (context) => {
  const paths = fixture();
  context.after(() => fs.rmSync(paths.directory, { recursive: true, force: true }));
  const target: NodeJS.ProcessEnv = { DASHSCOPE_API_KEY: 'os-key' };

  const result = loadServerEnvironment({
    rootPath: paths.rootPath,
    legacyPath: paths.legacyPath,
    target
  });

  assert.equal(target.DASHSCOPE_API_KEY, 'os-key');
  assert.equal(result.rootLoaded, false);
  assert.equal(result.legacyLoaded, false);
});

test('all active model bindings have explicit portable defaults and overrides', () => {
  const defaults = resolveServerConfig({});
  assert.equal(defaults.interviewerModel, 'deepseek-v4-flash');
  assert.equal(defaults.autoMonitorModel, 'deepseek-v4-flash');
  assert.equal(defaults.speakerPartitionModel, 'deepseek-v4-flash');
  assert.equal(defaults.expertQuestionModel, 'deepseek-v4-flash');
  assert.equal(defaults.interviewerContextModel, 'deepseek-v4-flash');
  assert.equal(defaults.interviewerSummaryModel, 'deepseek-v4-pro');
  assert.equal(defaults.dashscopeBaseUrl, 'https://dashscope.aliyuncs.com/apps/anthropic');

  const overridden = resolveServerConfig({
    INTERVIEWER_MODEL: 'qwen3.6-flash',
    AUTO_MONITOR_MODEL: 'monitor-model',
    SPEAKER_PARTITION_MODEL: 'partition-model',
    EXPERT_QUESTION_MODEL: 'expert-model',
    INTERVIEWER_CONTEXT_MODEL: 'context-model',
    INTERVIEWER_SUMMARY_MODEL: 'summary-model',
    DASHSCOPE_BASE_URL: 'https://example.invalid/anthropic'
  });
  assert.equal(overridden.interviewerModel, 'qwen3.6-flash');
  assert.equal(overridden.autoMonitorModel, 'monitor-model');
  assert.equal(overridden.speakerPartitionModel, 'partition-model');
  assert.equal(overridden.expertQuestionModel, 'expert-model');
  assert.equal(overridden.interviewerContextModel, 'context-model');
  assert.equal(overridden.interviewerSummaryModel, 'summary-model');
  assert.equal(overridden.dashscopeBaseUrl, 'https://example.invalid/anthropic');
});

test('Balanced is the single production Auto gate preset', () => {
  assert.deepEqual(BALANCED_AUTO_GATE, {
    profile: 'balanced',
    cooldownMs: 20_000,
    minNewChars: 120,
    debounceMs: 3_000,
    livenessWaits: 3,
    livenessChars: 280
  });
  const defaults = resolveServerConfig({});
  assert.equal(defaults.autoCooldownMs, BALANCED_AUTO_GATE.cooldownMs);
  assert.equal(defaults.autoMinNewChars, BALANCED_AUTO_GATE.minNewChars);
  assert.equal(defaults.autoDebounceMs, BALANCED_AUTO_GATE.debounceMs);
});

test('active model callsites source their bindings from centralized server config', () => {
  const sourceDirectory = path.resolve(__dirname, '..', 'src');
  const read = (name: string): string => fs.readFileSync(path.join(sourceDirectory, name), 'utf8');

  assert.match(read('speaker-partitioner.ts'), /config\.speakerPartitionModel/);
  assert.match(read('speaker-cohort.ts'), /config\.speakerPartitionModel/);
  assert.match(read('expert-question.ts'), /config\.expertQuestionModel/);
  assert.match(read('auto-monitor.ts'), /config\.autoMonitorModel/);
  assert.match(read('interview-analysis.ts'), /config\.interviewerContextModel/);
  assert.match(read('interview-analysis.ts'), /config\.interviewerSummaryModel/);
  assert.match(read('dashscope.ts'), /config\.dashscopeBaseUrl/);
});
