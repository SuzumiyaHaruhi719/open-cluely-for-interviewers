import type { Ref } from 'react';
import { Brain } from '@phosphor-icons/react/Brain';
import { CheckCircle } from '@phosphor-icons/react/CheckCircle';
import { StopCircle } from '@phosphor-icons/react/StopCircle';
import { Trash } from '@phosphor-icons/react/Trash';

interface InterviewHeaderProps {
  title: string;
  connected: boolean;
  capturing: boolean;
  timer: string;
  contextLoaded: boolean;
  contextOpen: boolean;
  contextButtonRef?: Ref<HTMLButtonElement>;
  onClear: () => void;
  onToggleContext: () => void;
  onEnd: () => void;
}

/** Fixed live-interview chrome: identity, truthful runtime state, and 3 actions. */
export function InterviewHeader({
  title,
  connected,
  capturing,
  timer,
  contextLoaded,
  contextOpen,
  contextButtonRef,
  onClear,
  onToggleContext,
  onEnd
}: InterviewHeaderProps) {
  const runtimeLabel = !connected ? '连接中' : capturing ? '直播中' : '待录音';

  return (
    <header className="interview-header">
      <div className="interview-header__identity">
        <span className="interview-header__wordmark" aria-label="GLP">
          GLP
        </span>
        <span className="interview-header__divider" aria-hidden="true" />
        <strong className="interview-header__title">{title}</strong>
      </div>

      <div className="interview-header__status" aria-label="面试状态">
        <span
          className="interview-header__live"
          data-state={!connected ? 'connecting' : capturing ? 'live' : 'idle'}
        >
          <span className="interview-header__live-dot" aria-hidden="true" />
          {runtimeLabel}
        </span>
        <time className="interview-header__timer" dateTime={`PT${timer}`}>{timer}</time>
        <span className="interview-header__loaded" data-loaded={contextLoaded ? 'true' : 'false'}>
          <CheckCircle size={18} weight="fill" aria-hidden="true" />
          {contextLoaded ? '资料已载入' : '资料待分析'}
        </span>
      </div>

      <div className="interview-header__actions">
        <button className="interview-header__action" type="button" onClick={onClear}>
          <Trash size={17} aria-hidden="true" />
          <span>清空转写</span>
        </button>
        <button
          ref={contextButtonRef}
          className="interview-header__action"
          type="button"
          aria-controls="session-context-drawer"
          aria-expanded={contextOpen}
          aria-label={contextOpen ? '关闭会话上下文' : '打开会话上下文'}
          onClick={onToggleContext}
        >
          <Brain size={18} aria-hidden="true" />
          <span>会话上下文</span>
        </button>
        <button className="interview-header__end" type="button" onClick={onEnd}>
          <StopCircle size={18} aria-hidden="true" />
          <span>结束面试</span>
        </button>
      </div>
    </header>
  );
}
