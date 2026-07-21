import type { CompetencyStatus, SessionContextState } from '@open-cluely/contract';
import { FileText } from '@phosphor-icons/react/FileText';
import { formatTranscriptTime } from './TranscriptStream';

export interface SessionContextNote {
  text: string;
  createdAtMs?: number;
}

interface SessionContextPanelProps {
  /** Latest live session-context from the server, or null before the first analysis. */
  state: SessionContextState | null;
  /** Interviewer notes, shown even before the first model-generated context arrives. */
  notes?: readonly SessionContextNote[];
  /** First capture start, used to render note times on the interview clock. */
  startedAtMs?: number | null;
}

/** Bilingual status label for a competency chip. */
const STATUS_LABEL: Record<CompetencyStatus, string> = {
  covered: '已覆盖',
  partial: '部分覆盖',
  gap: '缺口'
};

/**
 * Live "Session context" right-rail panel. Renders the light analyzer's output:
 *   - competency chips coloured by status (covered → success, partial → warning,
 *     gap → info) via GLP tokens, with a mono-uppercase status badge;
 *   - a drilled-topics list ("已追问主题 / Topics");
 *   - an open-gaps list ("待探究 / Open gaps").
 * Until the first analysis arrives (state === null) it shows a bilingual empty
 * state. Empty individual sections are omitted so the panel only shows signal.
 */
export function SessionContextPanel({
  state,
  notes = [],
  startedAtMs = null
}: SessionContextPanelProps) {
  const competencies = Array.isArray(state?.competencies) ? state.competencies : [];
  const topics = Array.isArray(state?.topics) ? state.topics : [];
  const gaps = Array.isArray(state?.gaps) ? state.gaps : [];
  const orderedNotes = notes
    .map((note, sourceIndex) => ({ note, sourceIndex }))
    .sort((left, right) => {
      const leftTime = left.note.createdAtMs;
      const rightTime = right.note.createdAtMs;
      const leftTimed = Number.isFinite(leftTime);
      const rightTimed = Number.isFinite(rightTime);
      if (leftTimed && rightTimed && leftTime !== rightTime) {
        return (leftTime as number) - (rightTime as number);
      }
      if (leftTimed !== rightTimed) return leftTimed ? -1 : 1;
      return left.sourceIndex - right.sourceIndex;
    })
    .map(({ note }) => note);
  const hasContent =
    competencies.length > 0 || topics.length > 0 || gaps.length > 0 || orderedNotes.length > 0;

  if (!hasContent) {
    return (
      <div id="session-context" className="session-context">
        <div className="session-empty">
          <span className="session-empty__icon" aria-hidden="true">
            <FileText size={28} data-icon-library="phosphor" />
          </span>
          <p className="session-empty__text">还没有上下文</p>
          <p className="session-empty__hint">
            随着面试推进，这里会显示已覆盖能力、已追问主题和待探究缺口。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div id="session-context" className="session-context">
      {orderedNotes.length > 0 && (
        <section className="ctx-block ctx-block--notes">
          <h3 className="ctx-block__title">面试备注</h3>
          <ol className="ctx-notes">
            {orderedNotes.map((note, index) => (
              <li className="ctx-note" key={`${note.createdAtMs ?? 'untimed'}-${index}`}>
                <time className="ctx-note__time">
                  {formatTranscriptTime(note.createdAtMs, startedAtMs)}
                </time>
                <span className="ctx-note__text">{note.text}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {competencies.length > 0 && (
        <section className="ctx-block">
          <h3 className="ctx-block__title">能力维度</h3>
          <ul className="ctx-chips">
            {competencies.map((c, i) => (
              <li
                key={`${c.name}-${i}`}
                className="ctx-chip"
                data-status={c.status}
                title={c.evidence || undefined}
              >
                <span className="ctx-chip__name">{c.name}</span>
                <span className="ctx-chip__badge">{STATUS_LABEL[c.status]}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {topics.length > 0 && (
        <section className="ctx-block">
          <h3 className="ctx-block__title">已追问主题</h3>
          <ul className="ctx-list">
            {topics.map((t, i) => (
              <li key={`${t}-${i}`} className="ctx-list__item">
                {t}
              </li>
            ))}
          </ul>
        </section>
      )}

      {gaps.length > 0 && (
        <section className="ctx-block">
          <h3 className="ctx-block__title">待探究缺口</h3>
          <ul className="ctx-list ctx-list--gaps">
            {gaps.map((g, i) => (
              <li key={`${g}-${i}`} className="ctx-list__item">
                {g}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
