export function createChatUiManager({
    chatContainer,
    chatMessagesElement,
    chatComposer,
    chatManualInput,
    chatManualSend,
    messageStore,
    maxChatInputHeight,
    escapeHtml,
    updateUi,
    onMessagesChanged,
    showFeedback,
    addMonitorLog,
    isAutoScrollEnabled = () => true
}) {
    function formatResponse(text) {
        // SECURITY: escapeHtml FIRST, then apply markdown-style transforms.
        // Previously this returned raw markdown→HTML, which let model-
        // controlled content (or untrusted mobile-server inbound text)
        // inject `<img src=x onerror=...>` and similar. Escaping first
        // neutralises all HTML in the source string; Markdown patterns
        // (asterisks, backticks, newlines) survive escaping since they
        // are ASCII non-special characters. The transforms below then
        // re-introduce HTML tags only at the known-safe positions.
        return escapeHtml(String(text || ''))
            .replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/\n/g, '<br>');
    }

    function isChatNearBottom(threshold = 28) {
        if (!chatMessagesElement) {
            return true;
        }

        const distanceFromBottom =
            chatMessagesElement.scrollHeight - chatMessagesElement.clientHeight - chatMessagesElement.scrollTop;
        return distanceFromBottom <= threshold;
    }

    function addChatMessage(type, content, options = {}) {
        if (!chatMessagesElement) {
            return null;
        }

        const shouldAutoScroll = isChatNearBottom();

        const timestampDate = new Date();
        const record = messageStore.add(type, content, {
            id: options.id,
            timestamp: timestampDate,
            canToggleAi: options.canToggleAi,
            includeInAi: options.includeInAi,
            screenshotId: options.screenshotId
        });

        const messageDiv = document.createElement('div');
        messageDiv.className = `chat-message ${type}-message`;
        messageDiv.dataset.messageId = record.id;
        if (record.canToggleAi) {
            messageDiv.classList.add('ai-toggleable');
            messageDiv.classList.add(record.includeInAi ? 'ai-included' : 'ai-excluded');
        }

        const timestamp = timestampDate.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit'
        });

        let icon = '\u2139\uFE0F';
        let label = '';
        let contentClass = 'message-content';
        let safeContent = escapeHtml(content);

        switch (type) {
            case 'voice':
            case 'voice-mic':
                icon = '\u{1F3A4}';
                label = 'You';
                // Amber "interviewer / microphone" lane (see chat.css). The
                // class drives the left accent bar + mono lane marker; colour
                // comes from --interviewer, never hard-coded here.
                messageDiv.classList.add('lane-interviewer');
                break;

            case 'voice-system':
                icon = '\u{1F50A}';
                label = 'Candidate';
                // Teal "candidate / computer audio" lane.
                messageDiv.classList.add('lane-candidate');
                break;

            case 'screenshot':
                icon = '\u{1F4F8}';
                break;

            case 'ai-response':
                icon = '\u{1F916}';
                contentClass = 'message-content ai-response';
                safeContent = formatResponse(content);
                break;

            case 'interviewer-coach':
                icon = '\u{1F3AF}';
                label = 'AI follow-up';
                contentClass = 'message-content interviewer-coach';
                safeContent = formatResponse(content);
                // Indigo AI follow-up card styling (see chat.css). The class is
                // applied to the message wrapper so the existing escape-then-
                // markdown content (and live updateChatMessageContent streaming)
                // keep working unchanged; renderQuestionCard() below is the
                // richer entry point with an anchor quote + copy affordance.
                messageDiv.classList.add('is-question-card', 'lane-ai');
                break;

            case 'system':
                icon = '\u2139\uFE0F';
                contentClass = 'message-content system-message';
                break;
        }

        const labelHtml = label ? `<span class="message-label">${label}</span>` : '';
        const toggleHtml = record.canToggleAi
            ? `<button class="ai-include-toggle ${record.includeInAi ? 'included' : 'excluded'}" data-message-id="${record.id}" type="button" aria-label="Toggle AI context" aria-pressed="${record.includeInAi ? 'true' : 'false'}">${record.includeInAi ? '-' : '+'}</button>`
            : '';
        const copyHtml = `<button class="message-copy-btn" data-message-id="${record.id}" type="button" aria-label="Copy message"><svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg></button>`;
        const messageActionsHtml = `<span class="message-actions">${toggleHtml}${copyHtml}</span>`;
        const exclusionHtml = record.canToggleAi
            ? '<div class="ai-excluded-note">Excluded from AI context</div>'
            : '';

        const messageContent = `
        <div class="message-header">
            <span class="message-icon">${icon}</span>
            ${labelHtml}
            ${messageActionsHtml}
            <span class="message-time">${timestamp}</span>
        </div>
        <div class="${contentClass}">${exclusionHtml}${safeContent}</div>
    `;

        messageDiv.innerHTML = messageContent;
        chatMessagesElement.appendChild(messageDiv);

        if (shouldAutoScroll && isAutoScrollEnabled()) {
            chatMessagesElement.scrollTop = chatMessagesElement.scrollHeight;
        }

        onMessagesChanged?.(messageStore.getMessages());
        updateUi?.();

        return record;
    }

    function updateChatComposerHeight() {
        if (!chatContainer || !chatComposer) {
            return;
        }

        // Remove the variable first so the min-height constraint is cleared,
        // allowing getBoundingClientRect to return the natural content height
        // instead of being held at the previous (potentially stale) large value.
        chatContainer.style.removeProperty('--chat-composer-height');
        const composerHeight = Math.max(0, Math.round(chatComposer.getBoundingClientRect().height));
        if (composerHeight > 0) {
            chatContainer.style.setProperty('--chat-composer-height', `${composerHeight}px`);
        }
    }

    function autoResizeManualInput() {
        if (!chatManualInput) {
            return;
        }

        chatManualInput.style.height = 'auto';
        const nextHeight = Math.min(chatManualInput.scrollHeight, maxChatInputHeight);
        chatManualInput.style.height = `${Math.max(24, nextHeight)}px`;
        chatManualInput.style.overflowY = chatManualInput.scrollHeight > maxChatInputHeight ? 'auto' : 'hidden';
        updateChatComposerHeight();
    }

    function updateManualComposerState() {
        if (!chatManualInput || !chatManualSend) {
            return;
        }

        chatManualSend.disabled = String(chatManualInput.value || '').trim().length === 0;
    }

    function updateChatMessageContent(messageId, newContent) {
        const record = messageStore.findById(messageId);
        if (record) {
            record.content = newContent;
        }

        if (!chatMessagesElement) return;

        const messageEl = chatMessagesElement.querySelector(`[data-message-id="${messageId}"]`);
        if (!messageEl) return;

        const contentEl = messageEl.querySelector('.message-content');
        if (!contentEl) return;

        const shouldAutoScroll = isChatNearBottom();
        contentEl.innerHTML = formatResponse(newContent);

        if (shouldAutoScroll && isAutoScrollEnabled()) {
            chatMessagesElement.scrollTop = chatMessagesElement.scrollHeight;
        }
    }

    // Map a capture source ('system' | 'mic') to its transcript message type.
    // 'system' = candidate / computer audio (teal); 'mic'/'voice' = you /
    // microphone (amber). Anything else falls back to the mic lane.
    function messageTypeForSource(source) {
        return source === 'system' || source === 'voice-system'
            ? 'voice-system'
            : 'voice-mic';
    }

    // Render a single dual-lane transcript line. Thin wrapper over
    // addChatMessage so the orchestrator's streaming path can speak in terms
    // of { source, text, ts } without knowing the internal message types.
    // Returns the message-store record (so callers can stream updates into it
    // via updateChatMessageContent(record.id, ...)). `ts` is accepted for API
    // symmetry; the store stamps its own Date so ordering stays monotonic.
    function renderTranscriptLine({ source, text, ts } = {}) {
        const type = messageTypeForSource(source);
        return addChatMessage(type, String(text ?? ''), { timestamp: ts instanceof Date ? ts : undefined });
    }

    // Scroll to + briefly flash the transcript line a follow-up's anchor was
    // drilled from. Matches the most recent transcript bubble (NOT a question
    // card) whose text contains the anchor; the flash fades itself out via CSS.
    let activeJumpFlash = null;
    function jumpToSource(anchorText) {
        if (!chatMessagesElement) return;
        const needle = String(anchorText || '').trim();
        if (!needle) return;
        const bubbles = Array.from(chatMessagesElement.querySelectorAll('.chat-message:not(.chat-question-card)'));
        // Last match = the most recent occurrence (anchors quote the latest answer).
        let target = null;
        for (const el of bubbles) {
            const body = el.querySelector('.message-content') || el;
            if (body.textContent && body.textContent.includes(needle)) target = el;
        }
        if (!target) {
            showFeedback?.('找不到原文 / Source not found in transcript', 'info');
            return;
        }
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Restart the flash cleanly if one is already running on another bubble.
        if (activeJumpFlash) activeJumpFlash.classList.remove('source-flash');
        // Force reflow so re-adding the class re-triggers the animation.
        void target.offsetWidth;
        target.classList.add('source-flash');
        activeJumpFlash = target;
        target.addEventListener('animationend', function onEnd() {
            target.classList.remove('source-flash');
            target.removeEventListener('animationend', onEnd);
            if (activeJumpFlash === target) activeJumpFlash = null;
        });
    }

    async function copyTextToClipboard(text) {
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(text);
                return true;
            }
        } catch (_) {
            // Fall through to the legacy path below.
        }
        try {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.setAttribute('readonly', '');
            textarea.style.position = 'absolute';
            textarea.style.left = '-9999px';
            document.body.appendChild(textarea);
            textarea.select();
            const ok = document.execCommand('copy');
            document.body.removeChild(textarea);
            return ok;
        } catch (_) {
            return false;
        }
    }

    // Inline Lucide "copy" icon — static markup, safe to inject as innerHTML.
    const COPY_ICON_SVG =
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';

    // Render an indigo AI follow-up question card with a copy button and an
    // optional anchor quote (the candidate phrase the question drills into).
    //
    // SECURITY: question + anchor can be model- or LAN-sourced, so every
    // dynamic string is written via textContent. Only COPY_ICON_SVG (a
    // hardcoded constant) is assigned through innerHTML. `priority` is mapped
    // to a known class set — never interpolated into markup.
    function renderQuestionCard({ question, anchor, priority } = {}) {
        if (!chatMessagesElement) {
            return null;
        }

        const questionText = String(question ?? '').trim();
        if (!questionText) {
            return null;
        }

        const shouldAutoScroll = isChatNearBottom();
        const timestampDate = new Date();

        // Persist as an interviewer-coach record so it participates in the
        // message store (history persistence, AI-context defaults) exactly
        // like the addChatMessage('interviewer-coach', ...) path.
        const record = messageStore.add('interviewer-coach', questionText, { timestamp: timestampDate });

        const card = document.createElement('div');
        card.className = 'chat-message interviewer-coach-message is-question-card lane-ai chat-question-card';
        card.dataset.messageId = record.id;

        const normalizedPriority = ['high', 'medium', 'low'].includes(String(priority))
            ? String(priority)
            : null;
        if (normalizedPriority) {
            card.classList.add(`priority-${normalizedPriority}`);
            card.dataset.priority = normalizedPriority;
        }

        const timestamp = timestampDate.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit'
        });

        // Header: target icon + label + (optional) priority pill + copy + time.
        const header = document.createElement('div');
        header.className = 'message-header question-card__header';

        const iconSpan = document.createElement('span');
        iconSpan.className = 'message-icon';
        iconSpan.textContent = '\u{1F3AF}';

        const labelSpan = document.createElement('span');
        labelSpan.className = 'message-label';
        labelSpan.textContent = 'AI follow-up';

        header.append(iconSpan, labelSpan);

        if (normalizedPriority) {
            const pill = document.createElement('span');
            pill.className = 'question-card__priority';
            pill.dataset.priority = normalizedPriority;
            pill.textContent = normalizedPriority;
            header.appendChild(pill);
        }

        const actions = document.createElement('span');
        actions.className = 'message-actions';
        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'message-copy-btn question-card__copy';
        copyBtn.setAttribute('aria-label', 'Copy question');
        copyBtn.innerHTML = COPY_ICON_SVG; // static constant only.
        copyBtn.addEventListener('click', async (event) => {
            event.stopPropagation();
            const ok = await copyTextToClipboard(questionText);
            showFeedback?.(ok ? 'Question copied' : 'Copy failed', ok ? 'success' : 'error');
        });
        actions.appendChild(copyBtn);
        header.appendChild(actions);

        const timeSpan = document.createElement('span');
        timeSpan.className = 'message-time';
        timeSpan.textContent = timestamp;
        header.appendChild(timeSpan);

        card.appendChild(header);

        // Optional anchor quote — the candidate phrase being drilled into.
        // Clickable: jumps to + flashes the source transcript line it came from.
        const anchorText = String(anchor ?? '').trim();
        if (anchorText) {
            const anchorEl = document.createElement('blockquote');
            anchorEl.className = 'question-card__anchor question-card__anchor--jump';
            anchorEl.textContent = anchorText;
            anchorEl.setAttribute('role', 'button');
            anchorEl.setAttribute('tabindex', '0');
            anchorEl.title = '跳转到原文 / Jump to source';
            anchorEl.addEventListener('click', () => jumpToSource(anchorText));
            anchorEl.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); jumpToSource(anchorText); }
            });
            card.appendChild(anchorEl);
        }

        // The question body. textContent keeps it inert; .message-content lets
        // updateChatMessageContent stream into the card if needed.
        const body = document.createElement('div');
        body.className = 'message-content interviewer-coach question-card__body';
        body.textContent = questionText;
        card.appendChild(body);

        chatMessagesElement.appendChild(card);

        if (shouldAutoScroll && isAutoScrollEnabled()) {
            chatMessagesElement.scrollTop = chatMessagesElement.scrollHeight;
        }

        onMessagesChanged?.(messageStore.getMessages());
        updateUi?.();

        return record;
    }

    function submitManualContextMessage() {
        if (!chatManualInput) {
            return;
        }

        const text = String(chatManualInput.value || '').trim();
        if (!text) {
            showFeedback?.('Type a message first', 'error');
            return;
        }

        addChatMessage('voice-mic', text);
        addMonitorLog?.('info', 'manual-context-added', 'Manual context message added', 'mic', {
            chars: text.length
        });
        showFeedback?.('Manual context added', 'success');

        chatManualInput.value = '';
        autoResizeManualInput();
        updateManualComposerState();
        chatManualInput.focus();
    }

    return {
        addChatMessage,
        renderTranscriptLine,
        renderQuestionCard,
        updateChatMessageContent,
        formatResponse,
        autoResizeManualInput,
        submitManualContextMessage,
        updateManualComposerState,
        isChatNearBottom
    };
}
