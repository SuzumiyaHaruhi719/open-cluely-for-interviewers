// ============================================================================
// Pipelines routes (Customize-mode presets)
// ----------------------------------------------------------------------------
// Thin HTTP layer over the desktop `presetLibrary` (re-exported by
// @open-cluely/copilot-core), the single source of truth shared with the
// Electron app. Built-ins (EXPERT_PRESET / EXPERT_FAST_PRESET + role templates)
// are read-only; user pipelines persist as JSON under `${DATA_DIR}/pipelines`.
//
// `presetLibrary.savePipeline` validates the pipeline and rejects built-in
// overwrites; `deletePipeline` throws on a built-in id — we surface both as 400.
// ============================================================================

import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { presetLibrary } from '@open-cluely/copilot-core';

interface PipelineSummary {
  id: string;
  name: string;
  builtin: boolean;
}

const createBodySchema = z.object({
  pipeline: z.object({}).passthrough()
});

/** Resolve the pipelines dir lazily so a test can set DATA_DIR before any call. */
function pipelinesDir(): string {
  const base = process.env.DATA_DIR || path.join(__dirname, '..', '..', '.data');
  return path.join(base, 'pipelines');
}

export function createPipelinesRouter(): Router {
  const router = Router();

  // List built-ins + saved customs as { id, name, builtin }.
  router.get('/', (_req, res, next) => {
    try {
      const pipelines: PipelineSummary[] = presetLibrary
        .listPipelines(pipelinesDir())
        .map((p: { id: string; name: string; builtin: boolean }) => ({
          id: p.id,
          name: p.name,
          builtin: Boolean(p.builtin)
        }));
      res.json({ pipelines });
    } catch (err) {
      next(err);
    }
  });

  // Full pipeline by id (404 if missing).
  router.get('/:id', (req, res, next) => {
    try {
      const pipeline = presetLibrary.getPipeline(req.params.id, pipelinesDir());
      if (!pipeline) {
        res.status(404).json({ error: 'not found' });
        return;
      }
      res.json({ pipeline });
    } catch (err) {
      next(err);
    }
  });

  // Save a user pipeline. presetLibrary validates + rejects built-in ids; both
  // become a 400 with the library's message.
  router.post('/', (req, res, next) => {
    try {
      const parsed = createBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'invalid body' });
        return;
      }
      try {
        const id = presetLibrary.savePipeline(parsed.data.pipeline, pipelinesDir());
        res.json({ id });
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'invalid pipeline' });
      }
    } catch (err) {
      next(err);
    }
  });

  // Delete a user pipeline. Built-ins are not deletable -> 400.
  router.delete('/:id', (req, res, next) => {
    try {
      try {
        presetLibrary.deletePipeline(req.params.id, pipelinesDir());
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'cannot delete pipeline' });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
