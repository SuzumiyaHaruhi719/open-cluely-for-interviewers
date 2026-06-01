// Preset library — SP2 persistence. Built-in read-only presets (Expert) plus
// user-saved pipelines stored as JSON files in a directory (default
// cache/pipelines/ for the CLI; the Electron app passes userData/pipelines).
// CRUD + import/export, with validation on save/import so a broken pipeline can
// never be persisted.

const fs = require('fs');
const path = require('path');
const { EXPERT_PRESET } = require('./presets');
const { validatePipeline } = require('./pipeline-schema');
const { BLOCK_TYPES } = require('./block-types');

const BUILTINS = { [EXPERT_PRESET.id]: EXPERT_PRESET };
const ALIASES = { expert: EXPERT_PRESET.id, Expert: EXPERT_PRESET.id };

function defaultDir() { return path.join(process.cwd(), 'cache', 'pipelines'); }
function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function resolveId(id) { return ALIASES[id] || id; }

function userFiles(dir) {
  try { return fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch (_) { return []; }
}
function readUser(dir) {
  const out = [];
  for (const f of userFiles(dir)) {
    try { out.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))); } catch (_) { /* skip corrupt */ }
  }
  return out;
}

function listPipelines(dir = defaultDir()) {
  const fmt = (p, builtin) => ({ id: p.id, name: p.name, builtin, nodes: (p.nodes || []).length });
  return [
    ...Object.values(BUILTINS).map((p) => fmt(p, true)),
    ...readUser(dir).map((p) => fmt(p, false))
  ];
}

function getPipeline(id, dir = defaultDir()) {
  const rid = resolveId(id);
  if (BUILTINS[rid]) return BUILTINS[rid];
  return readUser(dir).find((p) => p.id === rid) || null;
}

function savePipeline(pipeline, dir = defaultDir()) {
  if (!pipeline || !pipeline.id) throw new Error('pipeline needs an id');
  if (BUILTINS[pipeline.id]) throw new Error(`cannot overwrite built-in preset "${pipeline.id}"`);
  const v = validatePipeline(pipeline, BLOCK_TYPES);
  if (!v.ok) throw new Error(`invalid pipeline: ${v.errors.join('; ')}`);
  ensureDir(dir);
  const safe = String(pipeline.id).replace(/[^a-z0-9_-]/gi, '_');
  fs.writeFileSync(path.join(dir, `${safe}.json`), JSON.stringify({ ...pipeline, builtin: false }, null, 2), 'utf8');
  return pipeline.id;
}

function deletePipeline(id, dir = defaultDir()) {
  if (BUILTINS[resolveId(id)]) throw new Error('cannot delete a built-in preset');
  for (const f of userFiles(dir)) {
    try {
      const p = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (p.id === id) { fs.unlinkSync(path.join(dir, f)); return true; }
    } catch (_) { /* skip */ }
  }
  return false;
}

function exportPipeline(id, dir = defaultDir()) {
  const p = getPipeline(id, dir);
  return p ? JSON.stringify(p, null, 2) : null;
}
function importPipeline(json, dir = defaultDir()) {
  const p = typeof json === 'string' ? JSON.parse(json) : json;
  return savePipeline(p, dir);
}

module.exports = {
  BUILTINS, defaultDir, listPipelines, getPipeline, savePipeline, deletePipeline, exportPipeline, importPipeline, resolveId
};
