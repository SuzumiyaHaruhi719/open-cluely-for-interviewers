import { useEffect, useRef, useState } from 'react';
import { resumeChat, ApiError, type ResumeChatTurn } from '../lib/api';

interface ResumeMessage extends ResumeChatTurn {
  isError?: boolean;
}

interface ResumeChatProps {
  /** Grounding text; chat is disabled when empty. */
  resumeText: string;
  /** A key that, when it changes, resets the conversation (e.g. session id). */
  resetKey?: string | number | null;
}

/**
 * Isolated résumé chat, reproducing the desktop `#resume-chat` markup
 * (resume-dropzone.css `.resume-chat*`). A standalone Q&A grounded only on the
 * active résumé: user turns are indigo/right, assistant turns neutral/left, each
 * entering with the `resume-chat-msg-in` animation. Sends the conversation to
 * /api/resume/chat with the current résumé text and appends the reply.
 *
 * The conversation lives here (renderer-side) and resets when `resetKey`
 * changes, so it never bleeds across interviews — matching the desktop's
 * per-interview reset contract.
 */
export function ResumeChat({ resumeText, resetKey }: ResumeChatProps) {
  const [messages, setMessages] = useState<ResumeMessage[]>([]);
  const [pending, setPending] = useState(false);
  const [input, setInput] = useState('');
  const messagesRef = useRef<HTMLDivElement | null>(null);

  // Reset the conversation when the active interview / résumé identity changes.
  useEffect(() => {
    setMessages([]);
    setPending(false);
    setInput('');
  }, [resetKey]);

  // Keep the newest message in view.
  useEffect(() => {
    const el = messagesRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, pending]);

  const send = async (text: string): Promise<void> => {
    const trimmed = text.trim();
    if (trimmed.length === 0 || pending) {
      return;
    }
    const next: ResumeMessage[] = [...messages, { role: 'user', content: trimmed }];
    setMessages(next);
    setPending(true);
    try {
      // Send only role/content turns (drop the local isError flag).
      const turns: ResumeChatTurn[] = next.map(({ role, content }) => ({ role, content }));
      const res = await resumeChat({ resumeText, messages: turns });
      setMessages((prev) => [...prev, { role: 'assistant', content: res.reply ?? '' }]);
    } catch (err: unknown) {
      const message =
        err instanceof ApiError || err instanceof Error ? err.message : 'Résumé chat failed.';
      setMessages((prev) => [...prev, { role: 'assistant', content: message, isError: true }]);
    } finally {
      setPending(false);
    }
  };

  const onSubmit = (event: React.FormEvent): void => {
    event.preventDefault();
    const text = input;
    setInput('');
    void send(text);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      const text = input;
      setInput('');
      void send(text);
    }
  };

  const clear = (): void => {
    setMessages([]);
    setPending(false);
    setInput('');
  };

  return (
    <div id="resume-chat" className="resume-chat">
      <div className="resume-chat__header">
        <span className="resume-chat__title">Ask about this résumé</span>
        <button
          type="button"
          className="resume-chat__clear"
          aria-label="Clear résumé chat"
          onClick={clear}
        >
          Clear
        </button>
      </div>

      <div className="resume-chat__messages" role="log" aria-live="polite" ref={messagesRef}>
        {messages.map((message, index) => {
          const role = message.role === 'assistant' ? 'assistant' : 'user';
          const className = `resume-chat__msg resume-chat__msg--${role}${
            message.isError ? ' resume-chat__msg--error' : ''
          }`;
          return (
            <div className={className} key={index}>
              {message.content}
            </div>
          );
        })}
        {pending ? (
          <div className="resume-chat__msg resume-chat__msg--assistant resume-chat__msg--pending">
            Thinking…
          </div>
        ) : null}
      </div>

      <form className="resume-chat__composer" onSubmit={onSubmit}>
        <textarea
          className="resume-chat__input"
          rows={1}
          placeholder="Ask anything about the résumé…"
          aria-label="Ask about the résumé"
          value={input}
          disabled={pending}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button type="submit" className="resume-chat__send" disabled={pending}>
          Send
        </button>
      </form>
    </div>
  );
}
