import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const demoRoot = path.resolve(here, '..');
const repoRoot = path.resolve(demoRoot, '..', '..');
const webRoot = path.join(repoRoot, 'web-app', 'web', 'src');
const webNodeModules = path.join(repoRoot, 'web-app', 'node_modules');
const require = createRequire(import.meta.url);
const esbuild = require(path.join(webNodeModules, 'esbuild'));
const copyToDownloads = process.argv.includes('--copy');

const productionCssPaths = [
  'desktop-ui/theme.css',
  'desktop-ui/styles.css',
  'desktop-ui/history-sidebar.css',
  'desktop-ui/channel-control.css',
  'desktop-ui/resume-dropzone.css',
  'desktop-ui/chat.css',
  'desktop-ui/session-context.css',
  'desktop-ui/interview-type.css',
  'desktop-ui/settings.css',
  'web-extras.css',
  'desktop-ui/one-shot-interview.css'
].map((relativePath) => path.join(webRoot, relativePath));

const [
  template,
  styles,
  productFrameTemplate,
  productFrameAdditions,
  audio,
  productShot,
  ...productionCssParts
] = await Promise.all([
  readFile(path.join(demoRoot, 'src/index.template.html'), 'utf8'),
  readFile(path.join(demoRoot, 'src/styles.css'), 'utf8'),
  readFile(path.join(demoRoot, 'src/product-frame.template.html'), 'utf8'),
  readFile(path.join(demoRoot, 'src/product-frame.css'), 'utf8'),
  readFile(path.join(demoRoot, 'assets/p8-full-interview-493s.mp3')),
  readFile(path.join(demoRoot, 'assets/p8-product-replay-cover.png')),
  ...productionCssPaths.map((cssPath) => readFile(cssPath, 'utf8'))
]);

const buildBundle = async (entryPoint) => {
  const result = await esbuild.build({
    entryPoints: [entryPoint],
    bundle: true,
    format: 'iife',
    target: ['chrome120'],
    minify: false,
    write: false
  });
  return result.outputFiles[0].text.replaceAll('</script', '<\\/script');
};

const [outerBundle, productBundle] = await Promise.all([
  buildBundle(path.join(demoRoot, 'src/entry.mjs')),
  buildBundle(path.join(demoRoot, 'src/product-frame.mjs'))
]);

const ReactModule = await import(pathToFileURL(path.join(webNodeModules, 'react', 'index.js')));
const React = ReactModule.default ?? ReactModule;
const { renderToStaticMarkup } = await import(pathToFileURL(path.join(webNodeModules, 'react-dom', 'server.js')));
const Phosphor = await import(pathToFileURL(path.join(webNodeModules, '@phosphor-icons', 'react', 'dist', 'index.es.js')));

const iconDefinitions = {
  '__ICON_CHECK_CIRCLE_18_FILL__': ['CheckCircle', { size: 18, weight: 'fill' }],
  '__ICON_SPARKLE_17_FILL__': ['Sparkle', { size: 17, weight: 'fill' }],
  '__ICON_TRASH_17__': ['Trash', { size: 17 }],
  '__ICON_BRAIN_18__': ['Brain', { size: 18 }],
  '__ICON_BRAIN_20__': ['Brain', { size: 20 }],
  '__ICON_FILE_TEXT_18__': ['FileText', { size: 18 }],
  '__ICON_SUN_18__': ['Sun', { size: 18 }],
  '__ICON_MOON_18__': ['Moon', { size: 18 }],
  '__ICON_STOP_CIRCLE_18__': ['StopCircle', { size: 18 }],
  '__ICON_X_18__': ['X', { size: 18 }],
  '__ICON_X_14_BOLD__': ['X', { size: 14, weight: 'bold' }],
  '__ICON_MONITOR_18__': ['Monitor', { size: 18 }],
  '__ICON_MICROPHONE_18__': ['Microphone', { size: 18 }],
  '__ICON_LOCK_OPEN_12__': ['LockOpen', { size: 12 }],
  '__ICON_RECORD_14_FILL__': ['Record', { size: 14, weight: 'fill' }],
  '__ICON_PAPER_PLANE_18_FILL__': ['PaperPlane', { size: 18, weight: 'fill' }],
  '__ICON_USER_15_FILL__': ['User', { size: 15, weight: 'fill', 'data-icon-library': 'phosphor' }],
  '__ICON_USERS_THREE_15_FILL__': ['UsersThree', { size: 15, weight: 'fill', 'data-icon-library': 'phosphor' }],
  '__ICON_QUESTION_15_FILL__': ['Question', { size: 15, weight: 'fill', 'data-icon-library': 'phosphor' }],
  '__ICON_NOTE_PENCIL_15_FILL__': ['NotePencil', { size: 15, weight: 'fill', 'data-icon-library': 'phosphor' }],
  '__ICON_SPARKLE_15_FILL__': ['Sparkle', { size: 15, weight: 'fill', 'data-icon-library': 'phosphor' }]
};

const renderIcon = (componentName, props) => {
  const Component = Phosphor[componentName];
  if (!Component) throw new Error(`Missing Phosphor icon: ${componentName}`);
  return renderToStaticMarkup(React.createElement(Component, { ...props, 'aria-hidden': true }));
};

const productionStyles = productionCssParts
  .join('\n')
  .replace(/@import\s+url\(['"]?https?:\/\/[^;]+;?/gi, '');
let productHtml = productFrameTemplate
  .replace('/*__PRODUCT_STYLES__*/', `${productionStyles}\n${productFrameAdditions}`)
  .replace('/*__PRODUCT_SCRIPT__*/', productBundle)
  .replace('__DEMO_AUDIO_BASE64__', audio.toString('base64'));

for (const [token, [componentName, props]] of Object.entries(iconDefinitions)) {
  productHtml = productHtml.replaceAll(token, renderIcon(componentName, props));
}

if (/__ICON_[A-Z0-9_]+__/.test(productHtml)) {
  throw new Error('Unresolved product icon placeholder');
}

const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
const productFrameBase64 = Buffer.from(productHtml, 'utf8').toString('base64');
const html = template
  .replace('/*__DEMO_STYLES__*/', styles)
  .replace('/*__DEMO_SCRIPT__*/', outerBundle)
  .replace('__PRODUCT_FRAME_BASE64__', productFrameBase64)
  .replace('__PRODUCT_SHOT_BASE64__', productShot.toString('base64'))
  .replace('__BUILD_COMMIT__', commit);

const distDir = path.join(demoRoot, 'dist');
const artifact = path.join(distDir, 'Interview Copilot P8 Complete Introduction.html');
await mkdir(distDir, { recursive: true });
await writeFile(artifact, html);
if (copyToDownloads) {
  await copyFile(artifact, '/Users/thomasli/Downloads/Interview Copilot P8 Complete Introduction.html');
}
console.log(artifact);
