import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SUMMARY_SYSTEM,
  analyzeSummaryStream,
  buildSummaryInput
} from '../../../web-app/server/src/interview-analysis.ts';
import { USER_OPERATIONS_P8_PROFILE } from '../../../web-app/web/src/desktop/jobProfiles.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const demoRoot = path.resolve(here, '..');
const evidencePath = path.join(demoRoot, 'fixtures', 'p8-full-seed-asr.json');
const outputPath = process.argv[2] ?? path.join(demoRoot, 'fixtures', 'p8-full-summary.json');
const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

const evidence = JSON.parse(await readFile(evidencePath, 'utf8')) as {
  audioDurationMs: number;
  audioSha256: string;
  finals: Array<{ seq: number; speakerId: number; role: string; text: string }>;
};

const roleLabel = (role: string) => {
  if (role === 'candidate') return '候选人';
  if (role === 'interviewer') return '面试官';
  return '题目或非参与者旁白';
};
const transcript = evidence.finals
  .map((event) => `${roleLabel(event.role)}：${event.text.trim()}`)
  .join('\n');
const jobDescription = USER_OPERATIONS_P8_PROFILE.jobDescription;
const summaryInput = buildSummaryInput({ transcript, jobDescription });

if (!summaryInput.includes('# 面试完整记录')) {
  throw new Error('full transcript unexpectedly exceeded the production summary window');
}

let streamedText = '';
let usage = { input: 0, output: 0 };
const startedAt = performance.now();
const result = await analyzeSummaryStream(
  summaryInput,
  {
    onDelta: (delta) => {
      streamedText += delta;
      process.stderr.write('.');
    },
    onUsage: (nextUsage) => {
      usage = nextUsage;
    }
  },
  { model: 'deepseek-v4-pro' }
);
const elapsedMs = Math.round(performance.now() - startedAt);
process.stderr.write('\n');

const reportMarkdown = result.text.trim();
if (streamedText.trim() !== reportMarkdown) {
  throw new Error('streamed report does not match the production summary result');
}
const requiredHeadings = [
  '## 综合结论与录用建议',
  '## 能力维度评分',
  '## 亮点',
  '## 风险与顾虑',
  '## 进一步考察建议'
];
let headingCursor = -1;
for (const heading of requiredHeadings) {
  const next = reportMarkdown.indexOf(heading);
  if (next <= headingCursor) throw new Error(`production report is missing ordered heading: ${heading}`);
  headingCursor = next;
}
if (!/引用[：:]/.test(reportMarkdown)) {
  throw new Error('production report is missing the required evidence citations');
}
if (!usage.input || !usage.output) {
  throw new Error(`provider did not return complete token usage: ${JSON.stringify(usage)}`);
}

const fixture = {
  schemaVersion: 1,
  captureType: 'production-summary-replay',
  capturedAt: new Date().toISOString(),
  profileId: USER_OPERATIONS_P8_PROFILE.id,
  profileTitle: USER_OPERATIONS_P8_PROFILE.title,
  model: result.model,
  fellBack: result.fellBack,
  audioDurationMs: evidence.audioDurationMs,
  sourceAudioSha256: evidence.audioSha256,
  transcriptFinalCount: evidence.finals.length,
  transcriptCharacters: transcript.length,
  summaryInputCharacters: summaryInput.length,
  summaryInputHeading: '# 面试完整记录',
  elapsedMs,
  usage,
  promptSha256: sha256(SUMMARY_SYSTEM),
  transcriptSha256: sha256(transcript),
  jobDescriptionSha256: sha256(jobDescription),
  summaryInputSha256: sha256(summaryInput),
  requiredHeadings,
  reportMarkdown
};

await writeFile(outputPath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
console.log(outputPath);
