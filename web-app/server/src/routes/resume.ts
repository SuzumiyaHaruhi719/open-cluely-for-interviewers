// ============================================================================
// Résumé routes
// ----------------------------------------------------------------------------
//  POST /api/resume/extract  — decode an uploaded résumé to plain text.
//                              .pdf -> pdf-parse, .docx -> mammoth, .txt/.md ->
//                              utf8. Output capped to ~20k chars. Parse failure
//                              -> 400 { error }.
//  POST /api/resume/chat     — Anthropic-shape résumé-QA over the candidate's
//                              résumé. No key -> 503 { error: 'no key' }.
//
// The heavy parsers (pdf-parse / mammoth) are lazy-required inside the handler
// so they never load at server startup and a missing/broken parser degrades to
// a clean 400 rather than crashing the process.
// ============================================================================

import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { chat, type ChatMessage } from '../dashscope';

const MAX_RESUME_CHARS = 20000;

const extractBodySchema = z.object({
  filename: z.string().min(1, 'filename is required'),
  contentBase64: z.string().min(1, 'contentBase64 is required')
});

const chatBodySchema = z.object({
  resumeText: z.string(),
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string()
      })
    )
    .default([])
});

const RESUME_QA_SYSTEM =
  'You help an interviewer reason about this candidate\'s résumé. Be specific and cite the ' +
  'résumé (quote concrete lines, roles, dates, and skills). If something is not in the ' +
  'résumé, say so rather than inventing it. Answer in the same language the user writes in.';

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot).toLowerCase() : '';
}

function cap(text: string): string {
  return text.length > MAX_RESUME_CHARS ? text.slice(0, MAX_RESUME_CHARS) : text;
}

async function extractText(filename: string, buffer: Buffer): Promise<string> {
  const ext = getExtension(filename);
  if (ext === '.pdf') {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pdfParse = require('pdf-parse') as (data: Buffer) => Promise<{ text: string }>;
    const parsed = await pdfParse(buffer);
    return parsed.text ?? '';
  }
  if (ext === '.docx') {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mammoth = require('mammoth') as {
      extractRawText(input: { buffer: Buffer }): Promise<{ value: string }>;
    };
    const parsed = await mammoth.extractRawText({ buffer });
    return parsed.value ?? '';
  }
  if (ext === '.txt' || ext === '.md') {
    return buffer.toString('utf8');
  }
  throw new Error(`unsupported file type: ${ext || '(none)'}`);
}

export function createResumeRouter(): Router {
  const router = Router();

  router.post('/extract', async (req, res, next) => {
    try {
      const parsed = extractBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'invalid body' });
        return;
      }
      const { filename, contentBase64 } = parsed.data;
      let text: string;
      try {
        const buffer = Buffer.from(contentBase64, 'base64');
        text = await extractText(filename, buffer);
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'failed to extract text' });
        return;
      }
      res.json({ text: cap(text) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/chat', async (req, res, next) => {
    try {
      if (!config.dashscopeApiKey) {
        res.status(503).json({ error: 'no key' });
        return;
      }
      const parsed = chatBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'invalid body' });
        return;
      }
      const { resumeText, messages } = parsed.data;

      // Prepend the résumé as context on the first user turn so the model always
      // sees it; the rest of the conversation follows verbatim.
      const resumeContext = `Candidate résumé:\n\n${resumeText}`;
      const turns: ChatMessage[] = [
        { role: 'user', content: resumeContext },
        { role: 'assistant', content: 'Understood. I have read the résumé and will cite it.' },
        ...messages.map((m) => ({ role: m.role, content: m.content }))
      ];

      const reply = await chat({ system: RESUME_QA_SYSTEM, messages: turns });
      res.json({ reply });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
