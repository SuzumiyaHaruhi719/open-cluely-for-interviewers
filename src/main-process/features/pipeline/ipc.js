// IPC for the customizable-pipeline feature (SP2/SP3). Wraps the preset library
// (built-in + user pipelines) and exposes block-type metadata for the editor.
// User pipelines live in <userData>/pipelines. Every handler returns a
// { success, ... } envelope so the renderer never sees a raw rejection.

const path = require('path');
const lib = require('../../../services/ai/pipeline/preset-library');
const { validatePipeline, PORT_TYPES } = require('../../../services/ai/pipeline/pipeline-schema');
const { BLOCK_TYPES, blockTypeMeta } = require('../../../services/ai/pipeline/block-types');

// app is passed so handlers resolve the per-install pipelines dir. getAppState /
// saveAppState let "set active pipeline" flip Customize mode + persist the choice.
function registerPipelineIpc({ ipcMain, app, getAppState, saveAppState, setAppState }) {
  const dir = path.join(app.getPath('userData'), 'pipelines');

  ipcMain.handle('pipeline-list', () => {
    try { return { success: true, pipelines: lib.listPipelines(dir) }; }
    catch (error) { return { success: false, error: error.message, pipelines: [] }; }
  });

  ipcMain.handle('pipeline-get', (_e, payload) => {
    try {
      const id = typeof payload === 'string' ? payload : payload?.id;
      const p = lib.getPipeline(String(id || ''), dir);
      return p ? { success: true, pipeline: p } : { success: false, error: 'not-found', pipeline: null };
    } catch (error) { return { success: false, error: error.message, pipeline: null }; }
  });

  ipcMain.handle('pipeline-block-types', () => {
    try { return { success: true, blockTypes: blockTypeMeta(), portTypes: PORT_TYPES }; }
    catch (error) { return { success: false, error: error.message, blockTypes: [], portTypes: [] }; }
  });

  ipcMain.handle('pipeline-validate', (_e, payload) => {
    try {
      const p = payload && payload.pipeline ? payload.pipeline : payload;
      return { success: true, ...validatePipeline(p, BLOCK_TYPES) };
    } catch (error) { return { success: false, ok: false, errors: [error.message] }; }
  });

  ipcMain.handle('pipeline-save', (_e, payload) => {
    try {
      const p = payload && payload.pipeline ? payload.pipeline : payload;
      const id = lib.savePipeline(p, dir);
      return { success: true, id };
    } catch (error) { return { success: false, error: error.message }; }
  });

  ipcMain.handle('pipeline-delete', (_e, payload) => {
    try {
      const id = typeof payload === 'string' ? payload : payload?.id;
      return { success: true, deleted: lib.deletePipeline(String(id || ''), dir) };
    } catch (error) { return { success: false, error: error.message }; }
  });

  ipcMain.handle('pipeline-export', (_e, payload) => {
    try {
      const id = typeof payload === 'string' ? payload : payload?.id;
      const json = lib.exportPipeline(String(id || ''), dir);
      return json ? { success: true, json } : { success: false, error: 'not-found' };
    } catch (error) { return { success: false, error: error.message }; }
  });

  ipcMain.handle('pipeline-import', (_e, payload) => {
    try {
      const json = typeof payload === 'string' ? payload : payload?.json;
      return { success: true, id: lib.importPipeline(json, dir) };
    } catch (error) { return { success: false, error: error.message }; }
  });

  // Select the active Customize pipeline AND switch interviewer mode to 'customize'
  // in one step. Pass id=null to leave Customize without a specific pipeline
  // (falls back to Expert at run time).
  ipcMain.handle('pipeline-set-active', (_e, payload = {}) => {
    try {
      const id = payload && payload.id != null ? String(payload.id) : null;
      const next = saveAppState(app, { interviewerMode: 'customize', activePipelineId: id });
      if (typeof setAppState === 'function') setAppState(next);
      return { success: true, activePipelineId: next.activePipelineId, interviewerMode: next.interviewerMode };
    } catch (error) { return { success: false, error: error.message }; }
  });

  // Switch interviewer mode (fast | expert | customize) without changing the
  // active pipeline.
  ipcMain.handle('interviewer-set-mode', (_e, payload = {}) => {
    try {
      const mode = String(payload && payload.mode || '').toLowerCase();
      if (!['fast', 'expert', 'customize'].includes(mode)) return { success: false, error: 'invalid-mode' };
      const next = saveAppState(app, { interviewerMode: mode });
      if (typeof setAppState === 'function') setAppState(next);
      return { success: true, interviewerMode: next.interviewerMode, activePipelineId: next.activePipelineId };
    } catch (error) { return { success: false, error: error.message }; }
  });
}

module.exports = { registerPipelineIpc };
