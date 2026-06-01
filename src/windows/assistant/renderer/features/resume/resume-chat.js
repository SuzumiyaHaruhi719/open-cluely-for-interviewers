// Isolated résumé chat — a standalone Q&A about the ACTIVE interview's résumé.
//
// The conversation is owned HERE (renderer-side) and is reset per interview. It
// is deliberately NOT connected to the main interview transcript, the
// interviewer AI context, or the session store. The grounding (the résumé text)
// lives main-side (app-state.resumeText, which is per-interview), so we only
// send the conversation turns; main grounds + replies via the isolated
// 'resume-chat' IPC. This keeps the résumé conversation fully independent.
//
// Factory style mirrors the other renderer managers (vanilla, no framework).
// SECURITY: all dynamic text (the interviewer's input and the AI reply) is set
// via textContent — never innerHTML — so nothing in a résumé or reply can
// inject markup.

export function createResumeChat({ rootEl }) {
  if (!rootEl) {
    return { reset: () => {} };
  }

  // role: 'interviewer' | 'assistant'. Owned here; never persisted to the
  // session store or merged into the interview transcript.
  const messages = [];
  let pending = false;

  rootEl.classList.add('resume-chat');
  rootEl.innerHTML = `
    <div class="resume-chat__header">
      <span class="resume-chat__title">Ask about this résumé</span>
      <button type="button" class="resume-chat__clear" aria-label="Clear résumé chat">Clear</button>
    </div>
    <div class="resume-chat__messages" role="log" aria-live="polite"></div>
    <form class="resume-chat__composer">
      <textarea class="resume-chat__input" rows="1" placeholder="Ask anything about the résumé…" aria-label="Ask about the résumé"></textarea>
      <button type="submit" class="resume-chat__send">Send</button>
    </form>
  `;

  const messagesEl = rootEl.querySelector('.resume-chat__messages');
  const formEl = rootEl.querySelector('.resume-chat__composer');
  const inputEl = rootEl.querySelector('.resume-chat__input');
  const sendEl = rootEl.querySelector('.resume-chat__send');
  const clearEl = rootEl.querySelector('.resume-chat__clear');

  function renderMessages() {
    messagesEl.replaceChildren();
    messages.forEach((message) => {
      const row = document.createElement('div');
      const role = message.role === 'assistant' ? 'assistant' : 'user';
      row.className = `resume-chat__msg resume-chat__msg--${role}`;
      if (message.isError) {
        row.classList.add('resume-chat__msg--error');
      }
      row.textContent = message.content; // XSS-safe.
      messagesEl.appendChild(row);
    });
    if (pending) {
      const row = document.createElement('div');
      row.className = 'resume-chat__msg resume-chat__msg--assistant resume-chat__msg--pending';
      row.textContent = 'Thinking…';
      messagesEl.appendChild(row);
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function setPending(value) {
    pending = Boolean(value);
    if (sendEl) sendEl.disabled = pending;
    if (inputEl) inputEl.disabled = pending;
    renderMessages();
  }

  async function send(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed || pending) {
      return;
    }
    messages.push({ role: 'interviewer', content: trimmed });
    renderMessages();
    setPending(true);
    try {
      const result = await window.electronAPI?.resumeChat?.({ messages });
      if (result && result.success) {
        messages.push({ role: 'assistant', content: String(result.reply || '') });
      } else {
        messages.push({
          role: 'assistant',
          content: (result && result.error) || 'Could not get a reply.',
          isError: true
        });
      }
    } catch (error) {
      messages.push({
        role: 'assistant',
        content: error?.message || 'Résumé chat failed.',
        isError: true
      });
    } finally {
      setPending(false);
      inputEl?.focus();
    }
  }

  formEl?.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = inputEl ? inputEl.value : '';
    if (inputEl) inputEl.value = '';
    send(text);
  });

  // Enter sends; Shift+Enter inserts a newline.
  inputEl?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      const text = inputEl.value;
      inputEl.value = '';
      send(text);
    }
  });

  clearEl?.addEventListener('click', () => reset());

  // Reset wipes the conversation — called when the active interview changes
  // (switch / new) or its résumé changes (upload / remove), so the chat always
  // reflects the CURRENT interview's résumé and never bleeds across interviews.
  function reset() {
    messages.length = 0;
    pending = false;
    if (inputEl) {
      inputEl.value = '';
      inputEl.disabled = false;
    }
    if (sendEl) sendEl.disabled = false;
    renderMessages();
  }

  renderMessages();
  return { reset };
}
