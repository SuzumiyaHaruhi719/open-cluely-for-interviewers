const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function loadExporter() {
  return import('../scripts/export-portable-env.mjs');
}

function fixture(context) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'portable-model-env-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return {
    directory,
    rootEnvPath: path.join(directory, '.env'),
    legacyEnvPath: path.join(directory, 'web-app.env'),
    outputPath: path.join(directory, '.env.portable')
  };
}

test('exporter writes only active allowlisted keys with OS-root-legacy precedence', async (context) => {
  const paths = fixture(context);
  fs.writeFileSync(
    paths.rootEnvPath,
    [
      'DASHSCOPE_API_KEY=root-key',
      'VOLC_APP_ID=root-app',
      'INTERVIEWER_MODEL=qwen3.6-flash',
      'XFYUN_API_SECRET=must-not-copy'
    ].join('\n')
  );
  fs.writeFileSync(
    paths.legacyEnvPath,
    [
      'DASHSCOPE_API_KEY=legacy-key',
      'VOLC_ACCESS_TOKEN=legacy-token',
      'VOLC_APP_ID=legacy-app',
      'CAMPP_URL=http://must-not-copy'
    ].join('\n')
  );
  const messages = [];
  const { exportPortableEnvironment, PORTABLE_ENV_KEYS } = await loadExporter();

  const result = exportPortableEnvironment({
    ...paths,
    processEnv: { VOLC_APP_ID: 'os-app' },
    logger: (message) => messages.push(message)
  });
  const output = fs.readFileSync(paths.outputPath, 'utf8');

  assert.match(output, /^DASHSCOPE_API_KEY=root-key$/m);
  assert.match(output, /^VOLC_APP_ID=os-app$/m);
  assert.match(output, /^VOLC_ACCESS_TOKEN=legacy-token$/m);
  assert.match(output, /^INTERVIEWER_MODEL=qwen3\.6-flash$/m);
  assert.doesNotMatch(output, /XFYUN|CAMPP|TTS|GEMINI|must-not-copy/);
  assert.deepEqual(result.keys, PORTABLE_ENV_KEYS);
  assert.deepEqual(result.missing, []);
  assert.equal(fs.statSync(paths.outputPath).mode & 0o777, 0o600);
  assert.equal(
    messages.some((message) => /root-key|legacy-token|os-app/.test(message)),
    false,
    'logs may contain key names but never values'
  );
});

test('exporter fails closed when a required credential is missing', async (context) => {
  const paths = fixture(context);
  fs.writeFileSync(paths.rootEnvPath, 'DASHSCOPE_API_KEY=only-one-key\n');
  const { exportPortableEnvironment } = await loadExporter();

  assert.throws(
    () =>
      exportPortableEnvironment({
        ...paths,
        processEnv: {},
        logger: () => {}
      }),
    /Missing required keys: VOLC_APP_ID, VOLC_ACCESS_TOKEN/
  );
  assert.equal(fs.existsSync(paths.outputPath), false);
});

test('exporter quotes unsafe dotenv characters without changing their values', async (context) => {
  const paths = fixture(context);
  fs.writeFileSync(
    paths.rootEnvPath,
    [
      'DASHSCOPE_API_KEY="key with spaces#hash"',
      'VOLC_APP_ID=app-id',
      'VOLC_ACCESS_TOKEN="token with spaces"'
    ].join('\n')
  );
  const { exportPortableEnvironment } = await loadExporter();

  exportPortableEnvironment({ ...paths, processEnv: {}, logger: () => {} });
  const output = fs.readFileSync(paths.outputPath, 'utf8');

  assert.match(output, /^DASHSCOPE_API_KEY="key with spaces#hash"$/m);
  assert.match(output, /^VOLC_ACCESS_TOKEN="token with spaces"$/m);
});

test('repository exposes the exporter, ignores its output, and templates every key once', async () => {
  const repositoryRoot = path.resolve(__dirname, '..');
  const packageJson = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'));
  const gitignore = fs.readFileSync(path.join(repositoryRoot, '.gitignore'), 'utf8');
  const template = fs.readFileSync(path.join(repositoryRoot, '.env.example'), 'utf8');
  const legacyTemplate = fs.readFileSync(
    path.join(repositoryRoot, 'web-app', '.env.example'),
    'utf8'
  );
  const { PORTABLE_ENV_KEYS } = await loadExporter();

  assert.equal(packageJson.scripts['env:export'], 'node scripts/export-portable-env.mjs');
  assert.match(gitignore, /^\.env\.portable$/m);
  for (const key of PORTABLE_ENV_KEYS) {
    assert.equal(
      (template.match(new RegExp(`^${key}=`, 'gm')) ?? []).length,
      1,
      `${key} must appear exactly once in the root template`
    );
  }
  assert.doesNotMatch(template, /^(?:XFYUN|CAMPP|[A-Z0-9_]*TTS|GEMINI)[A-Z0-9_]*=/m);
  assert.match(legacyTemplate, /root \.env/i);
  assert.doesNotMatch(legacyTemplate, /DASHSCOPE_API_KEY=|VOLC_ACCESS_TOKEN=/);
});
