import fs from 'node:fs';
import path from 'node:path';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { WS_PATH } from '@open-cluely/contract';
import { createHealthRouter } from './routes/health';
import { createQuestionBankRouter } from './routes/question-bank';
import { createResumeRouter } from './routes/resume';

// Resolve ../web/dist (the separately-built browser client) relative to source.
// At runtime from dist/, __dirname is server/dist, so ../../web/dist; from tsx
// it is server/src, so ../../web/dist as well. Both land on server/../web/dist.
const WEB_DIST = path.resolve(__dirname, '..', '..', 'web', 'dist');

/** Permissive dev CORS. Allows any origin and the methods/headers the client uses. */
function corsMiddleware(req: Request, res: Response, next: NextFunction): void {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
}

export function createApp(): Express {
  const app = express();

  app.use(corsMiddleware);
  // 25mb accommodates base64-encoded résumé uploads (POST /api/resume/extract).
  app.use(express.json({ limit: '25mb' }));

  app.use('/api', createHealthRouter());
  app.use('/api/question-bank', createQuestionBankRouter());
  app.use('/api/resume', createResumeRouter());

  // Serve the built web client if it exists; otherwise skip (built separately).
  const hasWebDist = fs.existsSync(path.join(WEB_DIST, 'index.html'));
  if (hasWebDist) {
    app.use(express.static(WEB_DIST));
    // SPA fallback: any non-API, non-WS GET returns index.html.
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path === WS_PATH) {
        next();
        return;
      }
      res.sendFile(path.join(WEB_DIST, 'index.html'));
    });
  } else {
    // eslint-disable-next-line no-console
    console.warn(`[server] web client not found at ${WEB_DIST} — skipping static serving (build the web app separately)`);
  }

  // Final error handler: 500 + { error: message }, never leak the stack.
  // The 4-arg signature is required for Express to treat this as an error handler.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    if (!res.headersSent) {
      res.status(500).json({ error: message });
    }
  });

  return app;
}
