import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionContextState } from '@open-cluely/contract';
import { ResumeDropzone } from './ResumeDropzone';
import { ResumeChat } from './ResumeChat';
import { SessionContextPanel } from './SessionContextPanel';

interface RightRailProps {
  jobDescription: string;
  resumeText: string;
  onJobDescriptionChange: (value: string) => void;
  onResumeTextChange: (value: string) => void;
  /** Latest live session-context from the server (null until the first analysis). */
  sessionContext: SessionContextState | null;
  /** Identity that resets the résumé chat when it changes (active session id). */
  resumeChatResetKey?: string | number | null;
}

const DEBOUNCE_MS = 500;

/**
 * A controlled text field that debounces commits to the parent. Owns local
 * draft state, but re-syncs to `external` whenever the parent replaces it (e.g.
 * loading a session or seeding a sample) WITHOUT echoing that value straight
 * back through `onCommit`. Edits the user types settle after `DEBOUNCE_MS`.
 *
 * Returns `[draft, setDraft, commitNow]`: `commitNow(value)` flushes immediately
 * (used by the résumé upload so the server grounds on it without the delay).
 */
function useDebouncedField(
  external: string,
  onCommit: (value: string) => void
): readonly [string, (value: string) => void, (value: string) => void] {
  const [draft, setDraft] = useState(external);
  // Tracks the last value that is "in sync" with the parent — either committed
  // by us or pushed down from the parent. Used to suppress echo + no-op commits.
  const syncedRef = useRef(external);

  // Parent replaced the value → adopt it as the new baseline, no commit.
  useEffect(() => {
    if (external !== syncedRef.current) {
      syncedRef.current = external;
      setDraft(external);
    }
  }, [external]);

  // Debounce user edits → commit once settled.
  useEffect(() => {
    if (draft === syncedRef.current) {
      return;
    }
    const handle = window.setTimeout(() => {
      syncedRef.current = draft;
      onCommit(draft);
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [draft, onCommit]);

  const commitNow = useCallback(
    (value: string): void => {
      syncedRef.current = value;
      setDraft(value);
      onCommit(value);
    },
    [onCommit]
  );

  return [draft, setDraft, commitNow] as const;
}

/**
 * Right rail, 1:1 with the desktop `.right-rail`:
 *   #resume-section  →  drop-zone (real upload) + résumé chat + manual textarea
 *   #jd-input        →  job-description textarea
 *   #session-context →  live session context, or an empty-state placeholder
 *
 * The drop-zone reads a file → base64 → /api/resume/extract → text, which flows
 * up via onResumeTextChange (pushed to the session config). A manual textarea
 * remains as a fallback editor and stays in sync with the extracted text. JD +
 * résumé edits are debounced before they push to the session config.
 */
export function RightRail({
  jobDescription,
  resumeText,
  onJobDescriptionChange,
  onResumeTextChange,
  sessionContext,
  resumeChatResetKey
}: RightRailProps) {
  const [jd, setJd] = useDebouncedField(jobDescription, onJobDescriptionChange);
  const [resume, setResume, commitResume] = useDebouncedField(resumeText, onResumeTextChange);

  // Upload extracts text → commit immediately (no debounce) so the chat + server
  // ground on it right away; the manual textarea mirrors it.
  const onExtracted = (text: string): void => commitResume(text);
  const onCleared = (): void => commitResume('');

  return (
    <aside id="right-rail" className="right-rail">
      <section className="rail-section" id="resume-section">
        <h2 className="rail-section__title">Resume</h2>
        <div className="rail-section__body">
          <ResumeDropzone resumeText={resume} onExtracted={onExtracted} onCleared={onCleared} />
          <textarea
            id="resume-text"
            className="jd-input"
            rows={4}
            placeholder="…or paste the candidate's résumé here."
            aria-label="Candidate résumé"
            value={resume}
            onChange={(e) => setResume(e.target.value)}
          />
          <ResumeChat resumeText={resume} resetKey={resumeChatResetKey} />
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
        <SessionContextPanel state={sessionContext} />
      </section>
    </aside>
  );
}
