// Session-context panel — the right-rail "Session context (auto)" surface.
//
// Renders the auto-organized Expert session state produced by the Block H
// consolidator (session-consolidator.js) as labelled, collapsible sections:
//   drilled_topics            string[] -> chip list
//   competencies_covered      string[] -> chip list
//   open_gaps                 string[] -> chip list
//   candidate_profile_summary string   -> paragraph
//   asked_questions           string[] -> ordered list (verbatim questions)
//
// This panel owns NO data fetching. The orchestrator feeds it from the
// `session-context-updated` IPC event:
//     const panel = createSessionContextPanel({ rootEl });
//     window.electronAPI.onSessionContext((state) => panel.update(state));
// Calling update(null) (or with an empty state) renders the empty state.
//
// Factory style mirrors createHistorySidebar / createChatUiManager (vanilla,
// no framework).
//
// SECURITY: every value here is model-generated (and may eventually be
// LAN/mobile-sourced), so ALL dynamic text is written via textContent. Only
// the hardcoded Lucide icon SVGs are assigned through innerHTML.

// Inline Lucide icons (no emoji as structural icons, per the design rules).
const ICON_LAYERS =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>';
const ICON_CHECK =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>';
const ICON_GAP =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';
const ICON_PROFILE =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>';
const ICON_QUESTION =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>';
// Clock-style icon for the empty state — reads as "context builds over time"
// rather than a generic document. Inline Lucide-style markup (hardcoded SVG —
// safe to inject as innerHTML; never model/user data).
const ICON_EMPTY =
  '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="opacity:0.3"><circle cx="12" cy="12" r="10"></circle><path d="M12 6v6l4 2"></path></svg>';

function setIcon(el, svg) {
  el.innerHTML = svg; // svg is a hardcoded constant — never model/user data.
}

// Coerce an unknown value into an array of non-empty trimmed strings. The
// consolidator already sanitizes, but the panel must never trust its input
// (it crosses the IPC boundary and may be partially-formed mid-stream).
function toStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set();
  const out = [];
  value.forEach((item) => {
    const text = String(item ?? '').trim();
    if (!text || seen.has(text)) {
      return;
    }
    seen.add(text);
    out.push(text);
  });
  return out;
}

// True when the state carries nothing worth showing — drives the empty state.
function isEmptyState(state) {
  if (!state || typeof state !== 'object') {
    return true;
  }
  const profile = String(state.candidate_profile_summary ?? '').trim();
  return (
    profile.length === 0 &&
    toStringList(state.drilled_topics).length === 0 &&
    toStringList(state.competencies_covered).length === 0 &&
    toStringList(state.open_gaps).length === 0 &&
    toStringList(state.asked_questions).length === 0
  );
}

function buildChipList(items, accentVar) {
  const list = document.createElement('ul');
  list.className = 'session-chip-list';
  list.setAttribute('role', 'list');
  items.forEach((text) => {
    const chip = document.createElement('li');
    chip.className = 'session-chip';
    if (accentVar) {
      chip.style.setProperty('--chip-accent', accentVar);
    }
    chip.textContent = text; // XSS-safe.
    list.appendChild(chip);
  });
  return list;
}

function buildQuestionList(items) {
  const list = document.createElement('ol');
  list.className = 'session-question-list';
  items.forEach((text) => {
    const item = document.createElement('li');
    item.className = 'session-question';
    item.textContent = text; // verbatim question, XSS-safe.
    list.appendChild(item);
  });
  return list;
}

function buildParagraph(text) {
  const paragraph = document.createElement('p');
  paragraph.className = 'session-profile';
  paragraph.textContent = text; // XSS-safe.
  return paragraph;
}

// One collapsible <details> section. `count` (when finite) renders a small
// mono badge in the summary; `accentVar` tints the section icon/badge.
function buildSection({ title, iconSvg, accentVar, count, bodyEl, open }) {
  const section = document.createElement('details');
  section.className = 'session-section';
  if (accentVar) {
    section.style.setProperty('--section-accent', accentVar);
  }
  section.open = !!open;

  const summary = document.createElement('summary');
  summary.className = 'session-section__summary';

  const icon = document.createElement('span');
  icon.className = 'session-section__icon';
  setIcon(icon, iconSvg);

  const label = document.createElement('span');
  label.className = 'session-section__label';
  label.textContent = title;

  summary.append(icon, label);

  if (Number.isFinite(count)) {
    const badge = document.createElement('span');
    badge.className = 'session-section__count';
    badge.textContent = String(count);
    summary.appendChild(badge);
  }

  const body = document.createElement('div');
  body.className = 'session-section__body';
  body.appendChild(bodyEl);

  section.append(summary, body);
  return section;
}

export function createSessionContextPanel({ rootEl }) {
  if (rootEl) {
    rootEl.classList.add('session-context');
  }

  function renderEmptyState() {
    const empty = document.createElement('div');
    empty.className = 'session-empty';

    const icon = document.createElement('div');
    icon.className = 'session-empty__icon';
    setIcon(icon, ICON_EMPTY);

    const text = document.createElement('p');
    text.className = 'session-empty__text';
    text.textContent = '暂无会话上下文';

    const hint = document.createElement('p');
    hint.className = 'session-empty__hint';
    hint.textContent = 'Expert 模式下每次追问后会自动构建上下文。';

    empty.append(icon, text, hint);
    return empty;
  }

  function render(state) {
    const fragment = document.createDocumentFragment();

    const profile = String(state.candidate_profile_summary ?? '').trim();
    const drilled = toStringList(state.drilled_topics);
    const competencies = toStringList(state.competencies_covered);
    const gaps = toStringList(state.open_gaps);
    const asked = toStringList(state.asked_questions);

    // Profile first — the at-a-glance summary. Open by default.
    if (profile) {
      fragment.appendChild(
        buildSection({
          title: '候选人画像',
          iconSvg: ICON_PROFILE,
          accentVar: 'var(--candidate, #2dd4bf)',
          count: undefined,
          bodyEl: buildParagraph(profile),
          open: true
        })
      );
    }

    if (drilled.length > 0) {
      fragment.appendChild(
        buildSection({
          title: '已追问话题',
          iconSvg: ICON_LAYERS,
          accentVar: 'var(--candidate, #2dd4bf)',
          count: drilled.length,
          bodyEl: buildChipList(drilled, 'var(--candidate, #2dd4bf)'),
          open: true
        })
      );
    }

    if (competencies.length > 0) {
      fragment.appendChild(
        buildSection({
          title: '已覆盖能力',
          iconSvg: ICON_CHECK,
          accentVar: 'var(--success, #3fb950)',
          count: competencies.length,
          bodyEl: buildChipList(competencies, 'var(--success, #3fb950)'),
          open: true
        })
      );
    }

    if (gaps.length > 0) {
      fragment.appendChild(
        buildSection({
          title: '待考察项',
          iconSvg: ICON_GAP,
          accentVar: 'var(--interviewer, #f5a524)',
          count: gaps.length,
          bodyEl: buildChipList(gaps, 'var(--interviewer, #f5a524)'),
          open: true
        })
      );
    }

    if (asked.length > 0) {
      fragment.appendChild(
        buildSection({
          title: '已提问数',
          iconSvg: ICON_QUESTION,
          accentVar: 'var(--ai, #7c8cf8)',
          count: asked.length,
          bodyEl: buildQuestionList(asked),
          open: false
        })
      );
    }

    return fragment;
  }

  // Replace the panel contents with the rendered state, or the empty state
  // when there is nothing to show. Safe to call repeatedly (idempotent).
  function update(state) {
    if (!rootEl) {
      return;
    }
    if (isEmptyState(state)) {
      rootEl.replaceChildren(renderEmptyState());
      return;
    }
    rootEl.replaceChildren(render(state));
  }

  // Start in the empty state until the first IPC push arrives.
  update(null);

  return { update };
}
