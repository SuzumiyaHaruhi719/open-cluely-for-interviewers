import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const demoRoot = path.resolve(here, '..');
const reportPath = process.argv[2];
const audioPath = process.argv[3];
const outputPath = process.argv[4] ?? path.join(demoRoot, 'fixtures', 'p8-full-seed-asr.json');

if (!reportPath || !audioPath) {
  throw new Error('usage: node extract-full-seed-fixture.mjs <qa-report.json> <audio.mp3> [output.json]');
}

const [reportText, audio] = await Promise.all([
  readFile(path.resolve(reportPath), 'utf8'),
  readFile(path.resolve(audioPath))
]);
const report = JSON.parse(reportText);
const finalPartition = report.partitions?.at(-1);
const assignments = (finalPartition?.speakerAssignments ?? []).map((assignment) => ({
  speakerId: assignment.speakerId,
  role: assignment.role,
  confidence: assignment.confidence
}));
const roleBySpeaker = new Map(assignments.map((assignment) => [assignment.speakerId, assignment.role]));
const finals = (report.transcripts ?? [])
  .filter((event) => event.isFinal === true)
  .map((event, seq) => ({
    seq,
    atMs: event.atMs,
    speakerId: event.speakerId,
    role: roleBySpeaker.get(event.speakerId) ?? 'unknown',
    text: event.text
  }));

if (Number(report.finalCount) !== finals.length || finals.length !== 48) {
  throw new Error(`expected 48 final transcript events, received ${finals.length}`);
}
if (Number(report.audioDurationMs) !== 493_517) {
  throw new Error(`unexpected audio duration: ${report.audioDurationMs}`);
}

const fixture = {
  schemaVersion: 1,
  source: 'Bilibili Immersive Interview P7 P8 (1).mp3',
  audioSha256: createHash('sha256').update(audio).digest('hex'),
  audioBytes: audio.length,
  audioDurationMs: report.audioDurationMs,
  provider: 'doubao-seed-asr-2.0',
  resourceId: 'volc.seedasr.sauc.duration',
  speakerAssignments: assignments,
  finals,
  autoQuestions: report.autoQuestions ?? []
};

await writeFile(outputPath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
console.log(outputPath);

