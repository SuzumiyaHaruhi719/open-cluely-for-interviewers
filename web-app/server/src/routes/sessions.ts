import { Router } from 'express';
import { z } from 'zod';
import * as store from '../store/sessions';
import { SESSION_ROLES } from '../store/sessions';

const createBodySchema = z.object({
  title: z.string().optional(),
  interviewType: z.string().optional()
});

const updateBodySchema = z.object({
  title: z.string().optional(),
  jobDescription: z.string().optional(),
  resumeText: z.string().optional()
});

const messageBodySchema = z.object({
  role: z.enum(SESSION_ROLES),
  text: z.string()
});

export function createSessionsRouter(): Router {
  const router = Router();

  // List summaries, newest first.
  router.get('/', (_req, res, next) => {
    try {
      res.json({ sessions: store.list() });
    } catch (err) {
      next(err);
    }
  });

  // Create a new session.
  router.post('/', (req, res, next) => {
    try {
      const parsed = createBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'invalid body' });
        return;
      }
      res.json({ session: store.create(parsed.data) });
    } catch (err) {
      next(err);
    }
  });

  // Full record (404 if missing).
  router.get('/:id', (req, res, next) => {
    try {
      const session = store.get(req.params.id);
      if (!session) {
        res.status(404).json({ error: 'not found' });
        return;
      }
      res.json({ session });
    } catch (err) {
      next(err);
    }
  });

  // Patch title / jobDescription / resumeText (404 if missing).
  router.patch('/:id', (req, res, next) => {
    try {
      const parsed = updateBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'invalid body' });
        return;
      }
      const session = store.update(req.params.id, parsed.data);
      if (!session) {
        res.status(404).json({ error: 'not found' });
        return;
      }
      res.json({ session });
    } catch (err) {
      next(err);
    }
  });

  // Delete (idempotent from the caller's view: always { ok: true }).
  router.delete('/:id', (req, res, next) => {
    try {
      store.remove(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // Append one message (404 if missing).
  router.post('/:id/messages', (req, res, next) => {
    try {
      const parsed = messageBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'invalid body' });
        return;
      }
      const messageCount = store.appendMessage(req.params.id, parsed.data.role, parsed.data.text);
      if (messageCount === null) {
        res.status(404).json({ error: 'not found' });
        return;
      }
      res.json({ ok: true, messageCount });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
