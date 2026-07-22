import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as timeline from '../src/timeline.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const demoRoot = path.resolve(here, '..');
const repoRoot = path.resolve(demoRoot, '..', '..');
const require = createRequire(import.meta.url);
const esbuild = require(path.join(repoRoot, 'web-app/node_modules/esbuild'));
const copyToDownloads = process.argv.includes('--copy');

const [template, styles, audio] = await Promise.all([
  readFile(path.join(demoRoot, 'src/index.template.html'), 'utf8'),
  readFile(path.join(demoRoot, 'src/styles.css'), 'utf8'),
  readFile(path.join(demoRoot, 'assets/p8-card-channel-100s.mp3'))
]);
const bundle = await esbuild.build({
  entryPoints: [path.join(demoRoot, 'src/entry.mjs')],
  bundle: true,
  format: 'iife',
  target: ['chrome120'],
  minify: false,
  write: false
});
const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
const data = JSON.stringify({ ...timeline, cues: timeline.cues, questionEvent: timeline.questionEvent }).replaceAll('<', '\\u003c');
const html = template
  .replace('/*__DEMO_STYLES__*/', styles)
  .replace('/*__DEMO_SCRIPT__*/', bundle.outputFiles[0].text)
  .replace('__DEMO_DATA__', data)
  .replace('__DEMO_AUDIO_BASE64__', audio.toString('base64'))
  .replace('__BUILD_COMMIT__', commit);
const distDir = path.join(demoRoot, 'dist');
const artifact = path.join(distDir, 'Interview Copilot P8 Complete Introduction.html');
await mkdir(distDir, { recursive: true });
await writeFile(artifact, html);
if (copyToDownloads) await copyFile(artifact, '/Users/thomasli/Downloads/Interview Copilot P8 Complete Introduction.html');
console.log(artifact);
