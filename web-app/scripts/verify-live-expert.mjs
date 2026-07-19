#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { WebSocket } from 'ws';

const argv = process.argv.slice(2);
const valueOf = (name, fallback = '') => {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] !== undefined ? argv[index + 1] : fallback;
};

const url = valueOf('--url', 'ws://127.0.0.1:8788/ws');
const outPath = valueOf('--out');
const timeoutMs = Number(valueOf('--timeout-ms', '12000'));

const PROPERTY_MANAGER_JD = `物业经理，区域运营服务，汇报城市负责人。负责园区现场运营、人员管理、安全消防、秩序、环境、设施设备、租户服务、费用收缴、政府检查、预算计划和流程闭环。要求三年以上综合体或园区物业独立管理经验，具备沟通、应急、抗压、办公系统和工程相关能力。`;

const CASES = [
  {
    id: 'team-management',
    answer: '我接手过一个八万平方米的产业园，重新排了保安和保洁班次，三个月后投诉下降了百分之三十。'
  },
  {
    id: 'emergency-response',
    answer: '有一次配电房夜间报警，我组织工程和安保处理，当晚恢复供电，第二天也完成了复盘。'
  },
  {
    id: 'tenant-collections',
    answer: '我负责租户水电费和租金催缴，通过分级跟进把逾期率从百分之十二降到了百分之四。'
  }
];

function waitFor(socket, predicate, timeout, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', onMessage);
      reject(new Error(`Timed out waiting for ${label}`));
    }, timeout);
    function onMessage(raw) {
      let message;
      try {
        message = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (!predicate(message)) return;
      clearTimeout(timer);
      socket.off('message', onMessage);
      resolve(message);
    }
    socket.on('message', onMessage);
  });
}

const socket = new WebSocket(url);
await new Promise((resolve, reject) => {
  socket.once('open', resolve);
  socket.once('error', reject);
});
await waitFor(socket, (message) => message.type === 'ready', 5_000, 'ready');

socket.send(JSON.stringify({
  type: 'configure',
  config: {
    mode: 'expert',
    interviewerModel: 'deepseek-v4-flash',
    outputLanguage: 'zh',
    jobDescription: PROPERTY_MANAGER_JD,
    autoGenerate: true,
    resetGeneration: true
  }
}));

const runs = [];
for (const entry of CASES) {
  const requestId = `live-expert-${entry.id}-${Date.now()}`;
  const wallStartedAt = Date.now();
  socket.send(JSON.stringify({
    type: 'analyze',
    requestId,
    candidateAnswer: entry.answer,
    questionHistory: runs.map((run) => run.question)
  }));
  const message = await waitFor(
    socket,
    (candidate) =>
      (candidate.type === 'result' || candidate.type === 'error') && candidate.requestId === requestId,
    timeoutMs,
    requestId
  );
  const wallMs = Date.now() - wallStartedAt;
  if (message.type === 'error') throw new Error(`${requestId}: ${message.message}`);
  const question = String(message.output?.primary_question ?? '');
  runs.push({
    id: entry.id,
    answer: entry.answer,
    question,
    rationale: String(message.output?.rationale_for_interviewer ?? ''),
    anchors: message.output?.anchor_quotes ?? [],
    expectedEvidence: String(message.output?.expected_evidence_yield ?? ''),
    model: message.model,
    elapsedMs: message.elapsedMs,
    wallMs,
    fellBack: message.fellBack,
    underTenSeconds: message.elapsedMs < 10_000 && wallMs < 10_000,
    pureChineseQuestion: /[\u3400-\u9fff]/.test(question) && !/[A-Za-z]{2,}/.test(question),
    oneQuestion: (question.match(/[？?]/g) ?? []).length === 1
  });
}

socket.close();
const report = {
  url,
  model: 'deepseek-v4-flash',
  language: 'zh',
  jobDescriptionAsContext: true,
  passed: runs.every((run) => run.underTenSeconds && run.pureChineseQuestion && run.oneQuestion),
  runs
};
const json = `${JSON.stringify(report, null, 2)}\n`;
if (outPath) fs.writeFileSync(path.resolve(outPath), json, 'utf8');
process.stdout.write(json);
if (!report.passed) process.exitCode = 1;
