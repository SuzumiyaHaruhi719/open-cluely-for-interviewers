import { describe, expect, test } from 'vitest';
import { formatCharCount, readFileAsBase64 } from './resumeFile';

describe('readFileAsBase64', () => {
  test('returns a bare base64 payload (no data: URL prefix)', async () => {
    const file = new File(['ABC'], 'cv.txt', { type: 'text/plain' });

    const base64 = await readFileAsBase64(file);

    // "ABC" → base64 "QUJD"; the data:...;base64, prefix must be stripped.
    expect(base64).toBe('QUJD');
    expect(base64).not.toContain(',');
    expect(base64).not.toContain('data:');
  });

  test('handles an empty file', async () => {
    const file = new File([''], 'empty.txt', { type: 'text/plain' });

    const base64 = await readFileAsBase64(file);

    expect(base64).toBe('');
  });
});

describe('formatCharCount', () => {
  test('formats with thousands separators + the "characters" suffix', () => {
    expect(formatCharCount(1024)).toBe('1,024 characters');
    expect(formatCharCount(0)).toBe('0 characters');
  });

  test('coerces non-finite input to 0', () => {
    expect(formatCharCount(Number.NaN)).toBe('0 characters');
  });
});
