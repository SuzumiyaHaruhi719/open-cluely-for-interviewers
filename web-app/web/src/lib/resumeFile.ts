/**
 * Read a résumé file in the browser and return its bytes as a bare base64
 * string (no `data:` URL prefix), ready for `POST /api/resume/extract`.
 *
 * Ported from the desktop drop-zone's `readFileAsBase64`: a `FileReader` reads
 * the file as a data URL, then we strip everything up to and including the
 * comma so the server receives a clean base64 payload.
 */
export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('无法读取文件'));
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const commaIndex = result.indexOf(',');
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

/** Accepted résumé file extensions, shared by the dropzone target + hint. */
export const RESUME_ACCEPT_ATTR = '.txt,.md,.pdf,.docx';
export const RESUME_ACCEPT_HINT = '.txt, .md, .pdf, .docx';

/** Format a character count for the parsed-file chip (e.g. "1,024 字"). */
export function formatCharCount(chars: number): string {
  const value = Number.isFinite(chars) ? chars : 0;
  return `${value.toLocaleString('zh-CN')} 字`;
}
