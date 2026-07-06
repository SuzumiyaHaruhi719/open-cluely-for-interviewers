// Shared output-language guard for interviewer prompts.
// Empty / unknown language keeps the current auto behavior. 'zh' and 'en' add a
// hard instruction for fields shown to the interviewer, while preserving schema
// keys, enum ids, technical terms, and real candidate quotes.

function normalizeOutputLanguage(outputLanguage) {
  const lang = String(outputLanguage || '').trim().toLowerCase();
  return lang === 'zh' || lang === 'en' ? lang : '';
}

function languageName(outputLanguage) {
  const lang = normalizeOutputLanguage(outputLanguage);
  if (lang === 'zh') return 'Simplified Chinese (简体中文)';
  if (lang === 'en') return 'English';
  return '';
}

function buildOutputLanguageDirective(outputLanguage, { fields = [], extra = '' } = {}) {
  const target = languageName(outputLanguage);
  if (!target) return '';

  const fieldList = fields.length
    ? fields.map((f) => `- ${f}`).join('\n')
    : '- every interviewer-visible prose field';

  const extraLine = extra ? `\n${extra.trim()}` : '';

  return `\n=== OUTPUT LANGUAGE — MANDATORY ===
Write the interviewer-visible prose fields below in ${target}:
${fieldList}
This includes question text and any rationale/reasoning/expected-yield text that will be displayed to the interviewer. Do NOT translate JSON keys, enum values, ids, scores, schema labels, technical terms, tool/framework/product names, acronyms, metric units, or candidate/resume quotes inside single quotes; keep those verbatim. If source material or an upstream candidate question is in another language, translate only the framing around preserved quotes into natural ${target}.${extraLine}
=== END OUTPUT LANGUAGE ===\n`;
}

module.exports = {
  normalizeOutputLanguage,
  languageName,
  buildOutputLanguageDirective
};
