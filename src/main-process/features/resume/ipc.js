// Resume upload IPC — extracts plain text from an uploaded resume file and
// persists it into appState.resumeText (the field interviewer prompts already
// read). Mirrors the dependency-injection + handler style of
// src/main-process/features/settings/ipc.js.
//
// Channel: 'resume-upload'. Accepts EITHER
//   { name, mime, dataBase64 }  — raw file bytes, extracted by type, OR
//   { name, text }              — already-plain text (e.g. paste fallback).
// Extraction by extension/mime: .txt/.md → utf8 decode; .pdf → pdf-parse;
// .docx → mammoth (extractRawText). Result is trimmed + capped to a sane
// length. This handler NEVER throws — every failure path returns
// { success:false, error } so the renderer can show a message inline.

// Cap extracted text so a pathological file can't bloat app-state / prompt
// context. ~20k chars comfortably covers a multi-page resume.
const MAX_RESUME_CHARS = 20000;
const PREVIEW_CHARS = 280;

// Lazy-require the heavy parsers so the cost is only paid when a binary
// document is actually uploaded (and a missing optional dep degrades to a
// structured error instead of crashing module load).
function loadPdfParse() {
  // eslint-disable-next-line global-require
  return require('pdf-parse');
}

function loadMammoth() {
  // eslint-disable-next-line global-require
  return require('mammoth');
}

function getExtension(name) {
  const match = /\.([a-z0-9]+)$/i.exec(String(name || '').trim());
  return match ? match[1].toLowerCase() : '';
}

function normalizeText(rawText) {
  // Normalize line endings, collapse runs of blank lines, trim, then cap.
  const collapsed = String(rawText || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return collapsed.slice(0, MAX_RESUME_CHARS);
}

// ── Résumé chat (isolated) ───────────────────────────────────────────────────
// A standalone Q&A about ONE candidate's résumé. Deliberately NOT connected to
// the interview transcript, the interviewer AI context, or the session store —
// it grounds ONLY on the active interview's resumeText and the conversation the
// renderer passes (which the renderer owns and resets per interview).
const RESUME_CHAT_MAX_TURNS = 16;

function buildResumeChatPrompt(resumeText, messages) {
  const turns = Array.isArray(messages) ? messages.slice(-RESUME_CHAT_MAX_TURNS) : [];
  const convo = turns
    .map((m) => {
      const role = m && m.role === 'assistant' ? 'Assistant' : 'Interviewer';
      const content = String((m && m.content) || '').trim();
      return content ? `${role}: ${content}` : '';
    })
    .filter(Boolean)
    .join('\n');
  return [
    'You are helping an interviewer reason about ONE candidate using ONLY the résumé below.',
    "Answer strictly from what the résumé supports. If something is not in the résumé, say so",
    'plainly — never invent employers, dates, titles, or numbers. Be concise and concrete, and',
    'suggest sharp probing questions when asked.',
    '',
    '=== CANDIDATE RÉSUMÉ ===',
    resumeText,
    '=== END RÉSUMÉ ===',
    '',
    convo ? `Conversation so far:\n${convo}` : 'The interviewer has not asked anything yet.',
    '',
    'Reply as the assistant with just your answer (no role prefix).'
  ].join('\n');
}

function decodeBase64(dataBase64) {
  // Tolerate a data: URL prefix (data:application/pdf;base64,XXXX) as well as
  // a bare base64 payload.
  const payload = String(dataBase64 || '').replace(/^data:[^;]*;base64,/, '');
  return Buffer.from(payload, 'base64');
}

// Decide which extractor to use. mime is a hint only — extension wins because
// browsers report inconsistent mimes for .md/.docx and an empty mime is common
// for drag-and-drop. Returns 'text' | 'pdf' | 'docx' | null (unsupported).
function resolveKind(extension, mime) {
  const normalizedMime = String(mime || '').toLowerCase();

  if (extension === 'txt' || extension === 'md' || extension === 'markdown') {
    return 'text';
  }
  if (extension === 'pdf') {
    return 'pdf';
  }
  if (extension === 'docx') {
    return 'docx';
  }

  // Fall back to mime when the filename has no useful extension.
  if (normalizedMime === 'application/pdf') {
    return 'pdf';
  }
  if (normalizedMime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return 'docx';
  }
  if (normalizedMime.startsWith('text/')) {
    return 'text';
  }

  return null;
}

async function extractFromBuffer(kind, buffer) {
  if (kind === 'text') {
    return buffer.toString('utf8');
  }
  if (kind === 'pdf') {
    const pdfParse = loadPdfParse();
    const result = await pdfParse(buffer);
    return result && typeof result.text === 'string' ? result.text : '';
  }
  if (kind === 'docx') {
    const mammoth = loadMammoth();
    const result = await mammoth.extractRawText({ buffer });
    return result && typeof result.value === 'string' ? result.value : '';
  }
  return '';
}

function registerResumeIpc({ ipcMain, app, getAppState, setAppState, saveAppState, getGeminiService }) {
  ipcMain.handle('resume-upload', async (_event, payload = {}) => {
    try {
      // Clear path: explicit removal of the stored resume (the remove button).
      // saveAppState's sanitizer turns '' into null, so resumeText is cleared.
      if (payload && payload.clear === true) {
        const clearedState = saveAppState(app, { resumeText: '' });
        if (typeof setAppState === 'function') {
          setAppState(clearedState);
        }
        return { success: true, chars: 0, preview: '', text: '', cleared: true };
      }

      const name = String(payload?.name || '').trim();

      // Path 1: caller already has plain text (paste fallback). No parsing.
      let extractedText;
      if (typeof payload?.text === 'string') {
        extractedText = payload.text;
      } else {
        // Path 2: raw bytes — choose an extractor by extension/mime.
        const extension = getExtension(name);
        const kind = resolveKind(extension, payload?.mime);
        if (!kind) {
          return { success: false, error: 'Unsupported file type — paste text instead' };
        }

        const buffer = decodeBase64(payload?.dataBase64);
        if (!buffer || buffer.length === 0) {
          return { success: false, error: 'Empty or unreadable file' };
        }

        extractedText = await extractFromBuffer(kind, buffer);
      }

      const resumeText = normalizeText(extractedText);
      if (!resumeText) {
        return { success: false, error: 'No readable text found in file' };
      }

      // Persist. saveAppState merges + sanitizes + writes + returns the full
      // next state; keep the in-memory app-state in sync via setAppState so
      // other features (interviewer prompts) read the new resume immediately.
      const updatedAppState = saveAppState(app, { resumeText });
      if (typeof setAppState === 'function') {
        setAppState(updatedAppState);
      }

      // Read back from the persisted state so chars/preview reflect any
      // sanitizer-applied trimming rather than our pre-save string.
      const persisted = typeof getAppState === 'function' ? getAppState() : updatedAppState;
      const storedText = typeof persisted?.resumeText === 'string' ? persisted.resumeText : resumeText;

      return {
        success: true,
        chars: storedText.length,
        preview: storedText.slice(0, PREVIEW_CHARS),
        text: storedText
      };
    } catch (error) {
      console.error('Resume upload failed:', error);
      return { success: false, error: error?.message || '读取简历失败' };
    }
  });

  // Isolated résumé chat — grounds ONLY on the active interview's resumeText
  // (per-interview, from app-state) + the renderer-owned conversation. Reuses
  // the DashScope client's stateless generateText so it never touches the
  // interview transcript or the shared AI history.
  ipcMain.handle('resume-chat', async (_event, payload = {}) => {
    try {
      const state = (typeof getAppState === 'function' ? getAppState() : {}) || {};
      const resumeText = String(state.resumeText || '').trim();
      if (!resumeText) {
        return { success: false, error: 'No résumé loaded for this interview — upload one first.' };
      }
      const service = typeof getGeminiService === 'function' ? getGeminiService() : null;
      if (!service || typeof service.generateText !== 'function') {
        return { success: false, error: 'AI service unavailable.' };
      }
      const prompt = buildResumeChatPrompt(resumeText, payload?.messages);
      // Model precedence: the per-chat picker (payload.model) → the persisted
      // resumeChatModel → the global Fast-mode model. When a specific model is
      // chosen and a key is present, call dashscopeChat directly so this chat can
      // use a different model than the rest of the app; otherwise fall back to the
      // shared service (global model).
      const chosenModel = String(payload?.model || state.resumeChatModel || state.dashscopeAiModel || '').trim();
      const apiKey = String(state.dashscopeApiKey || '').trim();
      let text = '';
      if (chosenModel && apiKey) {
        const { dashscopeChat } = require('../interviewer/expert-orchestrator');
        const { text: out } = await dashscopeChat({ apiKey, model: chosenModel, prompt, temperature: 0.4, maxTokens: 1200, timeoutMs: 60000 });
        text = String(out || '').trim();
      } else {
        text = String(await service.generateText(prompt) || '').trim();
      }
      if (!text) {
        return { success: false, error: 'Empty reply from AI.' };
      }
      return { success: true, reply: text };
    } catch (error) {
      console.error('Resume chat failed:', error);
      return { success: false, error: error?.message || 'Resume chat failed' };
    }
  });
}

module.exports = {
  registerResumeIpc
};
