// Chat-history sidebar: lists every persisted interview grouped by day
// (Today / Yesterday / Earlier), highlights the active session, and exposes
// new / rename / delete. Factory style matches chat-ui-manager.js (a plain
// function returning a small method object; no framework).
//
// SECURITY: session titles can originate from user input and, eventually,
// LAN/mobile-sourced text. This module builds every row with createElement +
// textContent (never innerHTML for dynamic strings) so titles cannot inject
// markup. Only the static Lucide icon SVGs are assigned via innerHTML, and
// those are hardcoded constants.

const DAY_MS = 24 * 60 * 60 * 1000;

// Inline Lucide icons (no emoji as structural icons, per the design rules).
const ICON_PLUS =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
const ICON_MORE =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="19" r="1"></circle></svg>';
const ICON_PENCIL =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>';
const ICON_TRASH =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';
const ICON_HISTORY =
  '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v5h5"></path><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"></path><path d="M12 7v5l4 2"></path></svg>';

// ── Premium in-app dialogs ───────────────────────────────────────────────────
// Replace the native window.confirm()/window.prompt() — unstyleable OS dialogs
// that broke the premium dark aesthetic — with on-brand modals. Promise-based:
// confirm resolves boolean; prompt resolves string|null (null = cancelled).
// SECURITY: every dynamic string is set via textContent / input.value, never
// innerHTML, so session titles can't inject markup.

function buildModalScrim() {
  const scrim = document.createElement('div');
  scrim.className = 'app-modal';
  const card = document.createElement('div');
  card.className = 'app-modal__card';
  scrim.appendChild(card);
  return { scrim, card };
}

function openConfirmDialog({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    const { scrim, card } = buildModalScrim();

    const heading = document.createElement('h2');
    heading.className = 'app-modal__title';
    heading.textContent = title;

    const text = document.createElement('p');
    text.className = 'app-modal__text';
    text.textContent = message;

    const actions = document.createElement('div');
    actions.className = 'app-modal__actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'app-modal__btn app-modal__btn--secondary';
    cancelBtn.textContent = 'Cancel';

    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = 'app-modal__btn ' + (danger ? 'app-modal__btn--danger' : 'app-modal__btn--primary');
    okBtn.textContent = confirmLabel;

    actions.append(cancelBtn, okBtn);
    card.append(heading, text, actions);

    const settle = (result) => {
      document.removeEventListener('keydown', onKey, true);
      scrim.remove();
      resolve(result);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); settle(false); }
      else if (event.key === 'Enter') { event.preventDefault(); settle(true); }
    };
    cancelBtn.addEventListener('click', () => settle(false));
    okBtn.addEventListener('click', () => settle(true));
    scrim.addEventListener('mousedown', (event) => { if (event.target === scrim) settle(false); });
    document.addEventListener('keydown', onKey, true);

    document.body.appendChild(scrim);
    okBtn.focus();
  });
}

function openPromptDialog({ title, label, value = '', confirmLabel = 'Save' }) {
  return new Promise((resolve) => {
    const { scrim, card } = buildModalScrim();

    const heading = document.createElement('h2');
    heading.className = 'app-modal__title';
    heading.textContent = title;

    const field = document.createElement('label');
    field.className = 'app-modal__field';
    if (label) {
      const caption = document.createElement('span');
      caption.className = 'app-modal__label';
      caption.textContent = label;
      field.appendChild(caption);
    }
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'app-modal__input';
    input.value = value;
    field.appendChild(input);

    const actions = document.createElement('div');
    actions.className = 'app-modal__actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'app-modal__btn app-modal__btn--secondary';
    cancelBtn.textContent = 'Cancel';

    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = 'app-modal__btn app-modal__btn--primary';
    okBtn.textContent = confirmLabel;

    actions.append(cancelBtn, okBtn);
    card.append(heading, field, actions);

    const settle = (result) => {
      document.removeEventListener('keydown', onKey, true);
      scrim.remove();
      resolve(result);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); settle(null); }
      else if (event.key === 'Enter') { event.preventDefault(); settle(input.value); }
    };
    cancelBtn.addEventListener('click', () => settle(null));
    okBtn.addEventListener('click', () => settle(input.value));
    scrim.addEventListener('mousedown', (event) => { if (event.target === scrim) settle(null); });
    document.addEventListener('keydown', onKey, true);

    document.body.appendChild(scrim);
    input.focus();
    input.select();
  });
}

function startOfDay(ts) {
  const date = new Date(ts);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

// Bucket a timestamp into a stable group key. Earlier rows keep their absolute
// date so the list stays scannable beyond two days.
function groupKeyFor(ts, nowStartOfDay) {
  const dayStart = startOfDay(ts);
  if (dayStart >= nowStartOfDay) {
    return 'Today';
  }
  if (dayStart >= nowStartOfDay - DAY_MS) {
    return 'Yesterday';
  }
  return 'Earlier';
}

function formatRelativeTime(ts, now) {
  const diff = Math.max(0, now - ts);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days}d ago`;
  }
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function createHistorySidebar({ listEl, newBtnEl, onSelectSession, onNewSession }) {
  let activeId = null;
  let lastSessions = [];

  function setIcon(el, svg) {
    el.innerHTML = svg; // svg is a hardcoded constant — never user data.
  }

  if (newBtnEl) {
    newBtnEl.classList.add('history-new-btn');
    newBtnEl.setAttribute('type', 'button');
    const iconSpan = document.createElement('span');
    iconSpan.className = 'history-new-btn__icon';
    setIcon(iconSpan, ICON_PLUS);
    const labelSpan = document.createElement('span');
    labelSpan.className = 'history-new-btn__label';
    labelSpan.textContent = 'New interview';
    newBtnEl.replaceChildren(iconSpan, labelSpan);
    newBtnEl.addEventListener('click', () => {
      onNewSession?.();
    });
  }

  function selectSession(id) {
    if (!id) {
      return;
    }
    setActive(id);
    onSelectSession?.(id);
  }

  function buildRow(session, now) {
    const row = document.createElement('div');
    row.className = 'history-row';
    row.dataset.sessionId = session.id;
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    if (session.id === activeId) {
      row.classList.add('is-active');
    }

    const main = document.createElement('div');
    main.className = 'history-row__main';

    const title = document.createElement('span');
    title.className = 'history-row__title';
    title.textContent = session.title || 'Untitled interview'; // XSS-safe.
    title.title = session.title || 'Untitled interview';

    const meta = document.createElement('span');
    meta.className = 'history-row__time';
    const stamp = Number.isFinite(session.lastMessageAt) ? session.lastMessageAt : session.startedAt;
    meta.textContent = formatRelativeTime(stamp, now);

    main.append(title, meta);

    const actions = buildRowActions(session);

    row.append(main, actions);

    row.addEventListener('click', (event) => {
      if (event.target.closest('.history-row__actions')) {
        return;
      }
      selectSession(session.id);
    });
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectSession(session.id);
      }
    });

    return row;
  }

  // Inline action buttons (rename + delete), pinned inside the row and revealed
  // on hover/focus. NOT an absolute popup — the old dropdown was clipped by the
  // scroll container's overflow, which made Delete unclickable.
  function buildRowActions(session) {
    const actions = document.createElement('div');
    actions.className = 'history-row__actions';

    const renameBtn = document.createElement('button');
    renameBtn.type = 'button';
    renameBtn.className = 'history-row__action';
    renameBtn.title = 'Rename';
    renameBtn.setAttribute('aria-label', 'Rename interview');
    setIcon(renameBtn, ICON_PENCIL);
    renameBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      handleRename(session);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'history-row__action history-row__action--danger';
    deleteBtn.title = 'Delete';
    deleteBtn.setAttribute('aria-label', 'Delete interview');
    setIcon(deleteBtn, ICON_TRASH);
    deleteBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      handleDelete(session);
    });

    actions.append(renameBtn, deleteBtn);
    return actions;
  }

  function closeAllMenus() {
    if (!listEl) {
      return;
    }
    listEl.querySelectorAll('.history-row.menu-open').forEach((row) => {
      row.classList.remove('menu-open');
    });
  }

  async function handleRename(session) {
    const current = session.title || '';
    const next = await openPromptDialog({
      title: 'Rename interview',
      label: 'Interview name',
      value: current,
      confirmLabel: 'Save',
    });
    if (next === null) {
      return;
    }
    const trimmed = String(next).trim();
    if (!trimmed || trimmed === current) {
      return;
    }
    try {
      const result = await window.electronAPI.renameSession(session.id, trimmed);
      if (result && result.success === false) {
        console.error('Rename session failed:', result.error);
      }
    } catch (error) {
      console.error('Rename session threw:', error);
    }
    await refresh();
  }

  async function handleDelete(session) {
    const label = session.title || 'this interview';
    const confirmed = await openConfirmDialog({
      title: 'Delete interview',
      message: `Delete "${label}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!confirmed) {
      return;
    }
    try {
      const result = await window.electronAPI.deleteSession(session.id);
      if (result && result.success === false) {
        console.error('Delete session failed:', result.error);
      }
    } catch (error) {
      console.error('Delete session threw:', error);
    }
    if (session.id === activeId) {
      activeId = null;
    }
    await refresh();
  }

  function renderEmptyState() {
    const empty = document.createElement('div');
    empty.className = 'history-empty';
    const icon = document.createElement('div');
    icon.className = 'history-empty__icon';
    setIcon(icon, ICON_HISTORY);
    const text = document.createElement('p');
    text.className = 'history-empty__text';
    text.textContent = 'No interviews yet';
    const hint = document.createElement('p');
    hint.className = 'history-empty__hint';
    hint.textContent = 'Start a new interview to see it here.';
    empty.append(icon, text, hint);
    listEl.replaceChildren(empty);
  }

  function render(sessions) {
    if (!listEl) {
      return;
    }

    if (!Array.isArray(sessions) || sessions.length === 0) {
      renderEmptyState();
      return;
    }

    const now = Date.now();
    const nowStartOfDay = startOfDay(now);

    // Index is already sorted newest-first by the store; preserve that order
    // within each group while emitting groups in chronological precedence.
    const order = ['Today', 'Yesterday', 'Earlier'];
    const groups = new Map(order.map((key) => [key, []]));
    sessions.forEach((session) => {
      const stamp = Number.isFinite(session.lastMessageAt) ? session.lastMessageAt : session.startedAt;
      const key = groupKeyFor(stamp, nowStartOfDay);
      groups.get(key).push(session);
    });

    const fragment = document.createDocumentFragment();
    order.forEach((key) => {
      const items = groups.get(key);
      if (!items || items.length === 0) {
        return;
      }
      const group = document.createElement('div');
      group.className = 'history-group';
      const heading = document.createElement('div');
      heading.className = 'history-group__label';
      heading.textContent = key;
      group.appendChild(heading);
      items.forEach((session) => {
        group.appendChild(buildRow(session, now));
      });
      fragment.appendChild(group);
    });

    listEl.replaceChildren(fragment);
  }

  async function refresh() {
    if (!listEl) {
      return [];
    }
    try {
      const result = await window.electronAPI.listSessions();
      const sessions = Array.isArray(result?.sessions)
        ? result.sessions
        : Array.isArray(result)
          ? result
          : [];
      lastSessions = sessions;
      render(sessions);
      return sessions;
    } catch (error) {
      console.error('Failed to refresh history sidebar:', error);
      render(lastSessions);
      return lastSessions;
    }
  }

  function setActive(id) {
    activeId = id || null;
    if (!listEl) {
      return;
    }
    listEl.querySelectorAll('.history-row').forEach((row) => {
      row.classList.toggle('is-active', row.dataset.sessionId === activeId);
    });
  }

  // Close any open row menu when clicking elsewhere in the document.
  if (typeof document !== 'undefined') {
    document.addEventListener('click', (event) => {
      if (!listEl) {
        return;
      }
      if (!event.target.closest('.history-row')) {
        closeAllMenus();
      }
    });
  }

  return { refresh, setActive };
}
