// Resume drop-zone — a drag-and-drop / click-to-browse target that reads a
// resume file in the renderer, base64-encodes the bytes, and hands them to the
// main process via window.electronAPI.uploadResume({ name, mime, dataBase64 }).
// Main extracts the text, stores it in appState.resumeText, and returns a
// preview which we render inline.
//
// Factory style mirrors createChatUiManager (vanilla, no framework):
//   const dropzone = createResumeDropzone({ rootEl, onResumeParsed });
//   dropzone.setText('...');  // programmatically reflect an existing resume
//
// States: idle → hover (drag-over) → parsing → parsed | error.
// Accessibility: the drop-zone is a focusable button (Enter/Space → browse),
// has an aria-label, and announces parse results via an aria-live region.
// Dynamic text (filename, preview, error) is set via textContent — never
// innerHTML — so a crafted filename can't inject markup.

const ACCEPT_ATTR = '.txt,.md,.pdf,.docx';
const ACCEPT_HINT = '.txt, .md, .pdf, .docx';
const PREVIEW_LINES = 2;

// Inline Lucide "upload" icon (no emoji as structural icon). Static markup —
// safe to inject as innerHTML.
const UPLOAD_ICON_SVG = `
  <svg class="resume-dropzone__icon" width="22" height="22" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
    <polyline points="17 8 12 3 7 8"></polyline>
    <line x1="12" y1="3" x2="12" y2="15"></line>
  </svg>`;

// Inline "x" icon for the remove button. Static markup — safe to inject.
const REMOVE_ICON_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('Could not read file'));
    reader.onload = () => {
      const result = String(reader.result || '');
      // result is a data: URL (data:<mime>;base64,XXXX); strip the prefix so we
      // send a bare base64 payload (main also tolerates the prefix).
      const commaIndex = result.indexOf(',');
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

function formatCharCount(chars) {
  const value = Number.isFinite(chars) ? chars : 0;
  return `${value.toLocaleString('en-US')} characters`;
}

// Electron/Chromium navigates the WHOLE window to a file dropped anywhere in it
// unless the default is prevented at the document level — and without a
// document-level `dragover` preventDefault the window isn't treated as a valid
// drop target, so an in-page drop-zone's `drop` event may never fire. THIS is
// why only click-to-browse worked. Installed once; the zone's own handlers call
// stopPropagation, so these guards only see (and harmlessly swallow) drops
// OUTSIDE the zone — preventing the app from being replaced by the file.
let globalDropGuardInstalled = false;
function installGlobalDropGuard() {
  if (globalDropGuardInstalled || typeof window === 'undefined') {
    return;
  }
  globalDropGuardInstalled = true;
  window.addEventListener('dragover', (event) => { event.preventDefault(); });
  window.addEventListener('drop', (event) => { event.preventDefault(); });
}

export function createResumeDropzone({ rootEl, onResumeParsed }) {
  if (!rootEl) {
    // Match the defensive posture of other managers: no root → inert no-op.
    return { setText: () => {} };
  }

  rootEl.classList.add('resume-dropzone');
  rootEl.dataset.state = 'idle';

  // Build static structure once. Dynamic regions are populated via textContent.
  rootEl.innerHTML = `
    <button type="button" class="resume-dropzone__target" aria-label="Upload resume. ${ACCEPT_HINT}. Drop a file here or press Enter to browse.">
      ${UPLOAD_ICON_SVG}
      <span class="resume-dropzone__primary">Drop resume or click to browse</span>
      <span class="resume-dropzone__hint">${ACCEPT_HINT}</span>
    </button>
    <div class="resume-dropzone__result" hidden>
      <div class="resume-dropzone__meta">
        <span class="resume-dropzone__filename"></span>
        <span class="resume-dropzone__count"></span>
        <button type="button" class="resume-dropzone__remove" aria-label="Remove resume" title="Remove resume">${REMOVE_ICON_SVG}</button>
      </div>
      <p class="resume-dropzone__preview"></p>
    </div>
    <p class="resume-dropzone__error" hidden></p>
    <input type="file" class="resume-dropzone__input" accept="${ACCEPT_ATTR}" hidden aria-hidden="true" tabindex="-1" />
    <span class="resume-dropzone__live" aria-live="polite" role="status"></span>
  `;

  const targetEl = rootEl.querySelector('.resume-dropzone__target');
  const resultEl = rootEl.querySelector('.resume-dropzone__result');
  const filenameEl = rootEl.querySelector('.resume-dropzone__filename');
  const countEl = rootEl.querySelector('.resume-dropzone__count');
  const previewEl = rootEl.querySelector('.resume-dropzone__preview');
  const errorEl = rootEl.querySelector('.resume-dropzone__error');
  const inputEl = rootEl.querySelector('.resume-dropzone__input');
  const liveEl = rootEl.querySelector('.resume-dropzone__live');
  const removeEl = rootEl.querySelector('.resume-dropzone__remove');

  let dragDepth = 0;

  function setState(state) {
    rootEl.dataset.state = state;
  }

  function announce(message) {
    if (liveEl) {
      liveEl.textContent = message;
    }
  }

  function showError(message) {
    setState('error');
    if (resultEl) resultEl.hidden = true;
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.hidden = false;
    }
    announce(`Resume upload failed. ${message}`);
  }

  function showParsed({ name, chars, preview }) {
    setState('parsed');
    if (errorEl) errorEl.hidden = true;
    if (filenameEl) filenameEl.textContent = name || 'Resume';
    if (countEl) countEl.textContent = formatCharCount(chars);
    if (previewEl) previewEl.textContent = String(preview || '');
    if (resultEl) resultEl.hidden = false;
    announce(`Resume loaded: ${name || 'file'}, ${formatCharCount(chars)}.`);
  }

  async function handleFile(file) {
    if (!file) {
      return;
    }

    if (!window.electronAPI || typeof window.electronAPI.uploadResume !== 'function') {
      showError('Resume upload is unavailable in this build');
      return;
    }

    setState('parsing');
    if (errorEl) errorEl.hidden = true;
    if (resultEl) resultEl.hidden = true;
    announce(`Reading ${file.name || 'file'}…`);

    try {
      const dataBase64 = await readFileAsBase64(file);
      const response = await window.electronAPI.uploadResume({
        name: file.name,
        mime: file.type || '',
        dataBase64
      });

      if (!response || response.success !== true) {
        showError((response && response.error) || 'Could not read resume');
        return;
      }

      showParsed({ name: file.name, chars: response.chars, preview: response.preview });
      onResumeParsed?.({ chars: response.chars, preview: response.preview, text: response.text });
    } catch (error) {
      showError(error?.message || 'Could not read resume');
    }
  }

  function openFilePicker() {
    if (inputEl) {
      inputEl.click();
    }
  }

  // Remove/clear the stored resume: tells main to null out app-state.resumeText
  // (via the upload IPC's `clear` path), then resets the zone to idle. The
  // onResumeParsed callback fires with cleared:true so dependent UI (e.g. the
  // resume chat's grounding) can react.
  async function handleRemove() {
    if (window.electronAPI && typeof window.electronAPI.uploadResume === 'function') {
      try {
        await window.electronAPI.uploadResume({ clear: true });
      } catch (error) {
        console.warn('Failed to clear resume:', error);
      }
    }
    setState('idle');
    if (resultEl) resultEl.hidden = true;
    if (errorEl) errorEl.hidden = true;
    announce('Resume removed.');
    onResumeParsed?.({ chars: 0, preview: '', cleared: true });
  }

  // --- Click / keyboard to browse -----------------------------------------
  targetEl?.addEventListener('click', openFilePicker);

  // Remove button lives inside the parsed result; stop the click from doing
  // anything else and clear the resume.
  removeEl?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    handleRemove();
  });

  inputEl?.addEventListener('change', () => {
    const file = inputEl.files && inputEl.files[0];
    handleFile(file);
    // Reset so re-selecting the same file fires 'change' again.
    inputEl.value = '';
  });

  // --- Drag & drop ----------------------------------------------------------
  // The window-level guard makes the window a valid drop target (without it the
  // drop event is suppressed) and stops file-navigation outside the zone.
  installGlobalDropGuard();

  // dragDepth (enter/leave fire for child elements too) keeps the hover
  // highlight stable while the pointer moves inside the zone. We ALWAYS
  // preventDefault on dragenter/over/drop — preventing the default on dragover
  // is what actually permits the drop to fire — and only gate the visual
  // .is-dragover highlight on "is this a file drag".
  function isDraggingFiles(event) {
    const types = event.dataTransfer && event.dataTransfer.types;
    return !!types && Array.prototype.indexOf.call(types, 'Files') !== -1;
  }

  rootEl.addEventListener('dragenter', (event) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepth += 1;
    if (isDraggingFiles(event)) {
      rootEl.classList.add('is-dragover');
    }
  });

  rootEl.addEventListener('dragover', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
    if (isDraggingFiles(event)) {
      rootEl.classList.add('is-dragover');
    }
  });

  rootEl.addEventListener('dragleave', (event) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) {
      rootEl.classList.remove('is-dragover');
    }
  });

  rootEl.addEventListener('drop', (event) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepth = 0;
    rootEl.classList.remove('is-dragover');
    const dataTransfer = event.dataTransfer;
    const file = dataTransfer && dataTransfer.files && dataTransfer.files.length > 0
      ? dataTransfer.files[0]
      : null;
    if (file) {
      handleFile(file);
    } else {
      showError('Could not read the dropped file — try clicking to browse');
    }
  });

  // --- Public API -----------------------------------------------------------
  // setText reflects an already-stored resume (e.g. loaded from app-state on
  // boot) into the parsed UI without re-uploading.
  function setText(text) {
    const value = String(text || '').trim();
    if (!value) {
      setState('idle');
      if (resultEl) resultEl.hidden = true;
      if (errorEl) errorEl.hidden = true;
      return;
    }
    const lines = value.split('\n').slice(0, PREVIEW_LINES).join('\n');
    showParsed({ name: 'Saved resume', chars: value.length, preview: lines });
  }

  return { setText };
}
