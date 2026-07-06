import type { OutputLanguage } from '@open-cluely/contract';

interface FollowUpCopy {
  ariaFollowUp: string;
  cardLabel: string;
  suggestedLabel: string;
  alternative: string;
  alternativeShort: string;
  why: string;
  anchoredTo: string;
  expected: string;
  pickedPrefix: string;
  pickCandidateTitle: string;
  triggerAuto: string;
  triggerManual: string;
  triggerAutoTitle: string;
  triggerManualTitle: string;
  rankedSummary: (count: number) => string;
}

const ZH_COPY: FollowUpCopy = {
  ariaFollowUp: '建议追问',
  cardLabel: 'AI 追问',
  suggestedLabel: '建议追问',
  alternative: '备选问题',
  alternativeShort: '备选',
  why: '为什么这样问',
  anchoredTo: '依据片段',
  expected: '预期证据',
  pickedPrefix: '已选用：',
  pickCandidateTitle: '选用这个候选问题',
  triggerAuto: '自动',
  triggerManual: '手动',
  triggerAutoTitle: '根据实时对话自动生成',
  triggerManualTitle: '通过 Generate Q 手动生成',
  rankedSummary: (count) => `更多排序候选 (${count})`
};

export function followUpCopyFor(outputLanguage?: OutputLanguage): FollowUpCopy {
  // The language selector controls generated answer text, not app chrome. Keep
  // interface labels Chinese across all output-language modes.
  if (outputLanguage === 'zh') return ZH_COPY;
  if (outputLanguage === 'en') return ZH_COPY;
  return ZH_COPY;
}
