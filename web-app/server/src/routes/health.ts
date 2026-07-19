import { Router } from 'express';
import { hasKey } from '../config';
import { isQuestionBankReady } from '../question-bank';
import { getAsrCapabilities } from '../asr-capabilities';

// Read our own version once at module load.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require('../../package.json') as { version?: string };

export function createHealthRouter(): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({
      ok: true,
      version: pkg.version ?? '0.0.0',
      questionBankReady: isQuestionBankReady(),
      hasKey: hasKey(),
      asrProviders: getAsrCapabilities()
    });
  });

  return router;
}
