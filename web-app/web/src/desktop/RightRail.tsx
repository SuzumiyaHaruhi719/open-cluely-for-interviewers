import { useEffect, useRef, useState } from 'react';
import { ContextEmptyIcon, UploadIcon } from './icons';

interface RightRailProps {
  jobDescription: string;
  resumeText: string;
  onJobDescriptionChange: (value: string) => void;
  onResumeTextChange: (value: string) => void;
  /** Whether any live session-context has arrived from the server yet. */
  hasSessionContext: boolean;
}

const DEBOUNCE_MS = 500;

/**
 * Debounce a value and invoke `onCommit` after it settles, skipping the initial
 * mount so we don't echo the empty default back to the server.
 */
function useCommitDebounced(value: string, onCommit: (value: string) => void): void {
  const committedRef = useRef(value);
  useEffect(() => {
    if (value === committedRef.current) {
      return;
    }
    const handle = window.setTimeout(() => {
      committedRef.current = value;
      onCommit(value);
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [value, onCommit]);
}

/**
 * Right rail, 1:1 with the desktop `.right-rail`:
 *   #resume-section  →  drop-zone (visible markup) + a working resume textarea
 *   #jd-input        →  job-description textarea
 *   #session-context →  live session context, or an empty-state placeholder
 *
 * JD + resume edits are debounced before they push to the session config. The
 * drop-zone markup stays visible per the spec; the textarea below it is the
 * working input until drag-drop upload lands in a later wave.
 */
export function RightRail({
  jobDescription,
  resumeText,
  onJobDescriptionChange,
  onResumeTextChange,
  hasSessionContext
}: RightRailProps) {
  const [jd, setJd] = useState(jobDescription);
  const [resume, setResume] = useState(resumeText);

  useCommitDebounced(jd, onJobDescriptionChange);
  useCommitDebounced(resume, onResumeTextChange);

  return (
    <aside id="right-rail" className="right-rail">
      <section className="rail-section" id="resume-section">
        <h2 className="rail-section__title">Resume</h2>
        <div className="rail-section__body">
          <div id="resume-dropzone" className="resume-dropzone" data-state="idle">
            <div className="resume-dropzone__target" role="presentation">
              <span className="resume-dropzone__icon" aria-hidden="true">
                <UploadIcon size={22} />
              </span>
              <span className="resume-dropzone__primary">Paste the résumé below</span>
              <span className="resume-dropzone__hint">Drag-and-drop upload coming soon</span>
            </div>
          </div>
          <textarea
            id="resume-text"
            className="jd-input"
            rows={5}
            placeholder="Paste the candidate's résumé so the copilot can ground its follow-ups…"
            aria-label="Candidate résumé"
            value={resume}
            onChange={(e) => setResume(e.target.value)}
          />
        </div>
      </section>

      <section className="rail-section">
        <h2 className="rail-section__title">
          <label htmlFor="jd-input">Job description</label>
        </h2>
        <textarea
          id="jd-input"
          className="jd-input"
          rows={5}
          placeholder="Paste the JD so the copilot prioritises relevant hooks…"
          aria-label="Job description"
          value={jd}
          onChange={(e) => setJd(e.target.value)}
        />
      </section>

      <section className="rail-section rail-section--grow">
        <h2 className="rail-section__title">
          Session context <span className="rail-section__tag">auto</span>
        </h2>
        <div id="session-context" className="session-context">
          {hasSessionContext ? null : (
            <div className="session-empty">
              <span className="session-empty__icon" aria-hidden="true">
                <ContextEmptyIcon size={28} />
              </span>
              <p className="session-empty__text">No context yet</p>
              <p className="session-empty__hint">
                Drilled topics, covered competencies and open gaps will appear here as the
                interview progresses.
              </p>
            </div>
          )}
        </div>
      </section>
    </aside>
  );
}
