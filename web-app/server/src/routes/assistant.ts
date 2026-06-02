// ============================================================================
// Legacy assistant routes
// ----------------------------------------------------------------------------
// General-purpose Anthropic-shape chat helpers used by the legacy assistant UI:
//   POST /api/assistant/ask       — answer a prompt (optional context).
//   POST /api/assistant/notes     — concise meeting notes from a transcript.
//   POST /api/assistant/insights  — candidate insights (strengths / gaps).
// All reuse the shared `chat()` helper (config.dashscopeApiKey). No key -> 503.
// ============================================================================

import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { chat } from '../dashscope';

const askBodySchema = z.object({
  prompt: z.string().min(1, 'prompt is required'),
  context: z.string().optional()
});

const transcriptBodySchema = z.object({
  transcript: z.string().min(1, 'transcript is required')
});

const NOTES_SYSTEM =
  'You produce concise, well-structured meeting notes from an interview transcript. ' +
  'Summarize key topics, decisions, and action items as short bullet points. Be faithful ' +
  'to the transcript and do not invent details. Answer in the transcript\'s language.';

const INSIGHTS_SYSTEM =
  'You analyze an interview transcript and surface candidate insights for the interviewer: ' +
  'concrete strengths, gaps/risks, and signals worth probing further. Cite evidence from the ' +
  'transcript. Be specific and balanced. Answer in the transcript\'s language.';

export function createAssistantRouter(): Router {
  const router = Router();

  function requireKey(res: import('express').Response): boolean {
    if (!config.dashscopeApiKey) {
      res.status(503).json({ error: 'no key' });
      return false;
    }
    return true;
  }

  router.post('/ask', async (req, res, next) => {
    try {
      if (!requireKey(res)) return;
      const parsed = askBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'invalid body' });
        return;
      }
      const { prompt, context } = parsed.data;
      const content = context ? `Context:\n${context}\n\n---\n\n${prompt}` : prompt;
      const reply = await chat({ messages: [{ role: 'user', content }] });
      res.json({ reply });
    } catch (err) {
      next(err);
    }
  });

  router.post('/notes', async (req, res, next) => {
    try {
      if (!requireKey(res)) return;
      const parsed = transcriptBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'invalid body' });
        return;
      }
      const reply = await chat({
        system: NOTES_SYSTEM,
        messages: [{ role: 'user', content: parsed.data.transcript }]
      });
      res.json({ reply });
    } catch (err) {
      next(err);
    }
  });

  router.post('/insights', async (req, res, next) => {
    try {
      if (!requireKey(res)) return;
      const parsed = transcriptBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'invalid body' });
        return;
      }
      const reply = await chat({
        system: INSIGHTS_SYSTEM,
        messages: [{ role: 'user', content: parsed.data.transcript }]
      });
      res.json({ reply });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
