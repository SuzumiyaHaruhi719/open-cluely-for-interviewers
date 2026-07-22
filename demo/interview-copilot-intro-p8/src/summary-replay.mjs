import capturedSummary from '../fixtures/p8-full-summary.json' with { type: 'json' };

export const summaryFixture = Object.freeze(capturedSummary);
export const SUMMARY_REPLAY_DURATION_MS = 3_200;

const PHASES = Object.freeze([
  { id: 'evidence', startMs: 0, label: '校验完整证据' },
  { id: 'scoring', startMs: 700, label: '载入 P8 评分模板' },
  { id: 'streaming', startMs: 1_700, label: '回放 DeepSeek 评分结果' },
  { id: 'complete', startMs: SUMMARY_REPLAY_DURATION_MS, label: '完整总结已生成' }
]);

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const escapeHtml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

function renderInline(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, '<code class="summary-md__code">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

export function renderSummaryMarkdown(markdown) {
  const lines = String(markdown ?? '').replaceAll('\r\n', '\n').split('\n');
  const output = [];
  let listType = '';

  const closeList = () => {
    if (!listType) return;
    output.push(`</${listType}>`);
    listType = '';
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      closeList();
      continue;
    }
    const h3 = line.match(/^###\s+(.+)$/);
    const h2 = line.match(/^##\s+(.+)$/);
    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (h2 || h3) {
      closeList();
      const level = h2 ? 2 : 3;
      output.push(`<h${level} class="summary-md__h summary-md__h${level}">${renderInline((h2 ?? h3)[1])}</h${level}>`);
      continue;
    }
    if (bullet || ordered) {
      const nextListType = ordered ? 'ol' : 'ul';
      if (listType !== nextListType) {
        closeList();
        listType = nextListType;
        output.push(`<${listType} class="summary-md__list${listType === 'ol' ? ' summary-md__list--ordered' : ''}">`);
      }
      output.push(`<li class="summary-md__li">${renderInline((bullet ?? ordered)[1])}</li>`);
      continue;
    }
    closeList();
    if (line.startsWith('> ')) {
      output.push(`<blockquote class="summary-md__quote">${renderInline(line.slice(2))}</blockquote>`);
    } else {
      output.push(`<p class="summary-md__p">${renderInline(line)}</p>`);
    }
  }
  closeList();
  return output.join('');
}

export function deriveSummaryReplayState({
  elapsedMs,
  reportMarkdown = summaryFixture.reportMarkdown
}) {
  const elapsed = clamp(Number(elapsedMs) || 0, 0, SUMMARY_REPLAY_DURATION_MS);
  const progress = elapsed / SUMMARY_REPLAY_DURATION_MS;
  const phase = [...PHASES].reverse().find((item) => elapsed >= item.startMs) ?? PHASES[0];
  let visibleMarkdown = '';
  if (phase.id === 'complete') {
    visibleMarkdown = reportMarkdown;
  } else if (phase.id === 'streaming') {
    const streamProgress = clamp(
      (elapsed - phase.startMs) / (SUMMARY_REPLAY_DURATION_MS - phase.startMs),
      0,
      1
    );
    const target = Math.max(1, Math.floor(reportMarkdown.length * streamProgress));
    const candidate = reportMarkdown.slice(0, target);
    const lastBoundary = candidate.lastIndexOf('\n');
    visibleMarkdown = lastBoundary > 0 ? candidate.slice(0, lastBoundary) : candidate;
  }
  return Object.freeze({
    phase: phase.id,
    phaseLabel: phase.label,
    stageIndex: PHASES.findIndex((item) => item.id === phase.id),
    progress,
    visibleMarkdown
  });
}

