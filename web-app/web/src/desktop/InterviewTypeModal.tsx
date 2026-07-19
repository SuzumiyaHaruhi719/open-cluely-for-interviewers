import { useEffect, useMemo, useState } from 'react';
import { CloseIcon } from './icons';
import { JOB_PROFILES, buildInterviewGuideLines } from './jobProfiles';

export type InterviewType = 'online' | 'offline';

export interface InterviewTypeChoice {
  interviewType: InterviewType;
  jobProfileId: string;
  jobDescription: string;
  interviewGuide: string[];
}

interface InterviewTypeModalProps {
  open: boolean;
  onClose: () => void;
  onPick: (choice: InterviewTypeChoice) => void;
}

const DEFAULT_JOB_PROFILE_ID = JOB_PROFILES[0]?.id ?? 'custom';

export function InterviewTypeModal({ open, onClose, onPick }: InterviewTypeModalProps) {
  const [interviewType, setInterviewType] = useState<InterviewType>('offline');
  const [jobProfileId, setJobProfileId] = useState(DEFAULT_JOB_PROFILE_ID);
  const [customJobDescription, setCustomJobDescription] = useState('');

  useEffect(() => {
    if (open) {
      setInterviewType('offline');
      setJobProfileId(DEFAULT_JOB_PROFILE_ID);
      setCustomJobDescription('');
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const selectedProfile = useMemo(
    () => JOB_PROFILES.find((profile) => profile.id === jobProfileId) ?? null,
    [jobProfileId]
  );
  const isCustom = jobProfileId === 'custom';
  const canStart = !isCustom || customJobDescription.trim().length > 0;

  const submit = (): void => {
    if (!canStart) {
      return;
    }
    onPick({
      interviewType,
      jobProfileId,
      jobDescription: selectedProfile?.jobDescription ?? customJobDescription.trim(),
      interviewGuide: selectedProfile ? buildInterviewGuideLines(selectedProfile) : []
    });
  };

  return (
    <div
      id="interview-type-modal"
      className={`interview-type-modal${open ? '' : ' hidden'}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="interview-type-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <form
        className="interview-type-card-wrap"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="interview-type-head">
          <div>
            <span className="interview-type-kicker">专家面试</span>
            <h2 id="interview-type-title" className="interview-type-title">
              开始新面试
            </h2>
            <p className="interview-type-subtitle">确认采集方式和职位背景后开始。</p>
          </div>
          <button
            id="interview-type-close"
            className="interview-type-close"
            type="button"
            aria-label="取消"
            onClick={onClose}
          >
            <CloseIcon size={16} />
          </button>
        </div>

        <div className="interview-type-content">
          <fieldset className="interview-type-section">
            <legend className="interview-type-section__label">面试形式</legend>
            <div className="interview-type-options">
              <label
                className="interview-type-option"
                data-accent="candidate"
                data-selected={interviewType === 'online' ? 'true' : 'false'}
              >
                <input
                  type="radio"
                  name="interview-type"
                  value="online"
                  data-interview-type="online"
                  aria-label="线上面试"
                  checked={interviewType === 'online'}
                  onChange={() => setInterviewType('online')}
                />
                <span className="interview-type-option__check" aria-hidden="true" />
                <span className="interview-type-option__body">
                  <span className="interview-type-option__title">线上面试</span>
                  <span className="interview-type-option__desc">电脑音频采集候选人，麦克风采集面试官</span>
                </span>
              </label>

              <label
                className="interview-type-option"
                data-accent="interviewer"
                data-selected={interviewType === 'offline' ? 'true' : 'false'}
              >
                <input
                  type="radio"
                  name="interview-type"
                  value="offline"
                  data-interview-type="offline"
                  aria-label="线下面试"
                  checked={interviewType === 'offline'}
                  onChange={() => setInterviewType('offline')}
                />
                <span className="interview-type-option__check" aria-hidden="true" />
                <span className="interview-type-option__body">
                  <span className="interview-type-option__title">线下面试</span>
                  <span className="interview-type-option__desc">房间麦克风采集双方，结束后自动校正角色</span>
                </span>
              </label>
            </div>
          </fieldset>

          <section className="interview-type-section">
            <label
              id="job-context-label"
              className="interview-type-section__label"
              htmlFor="job-profile-select"
            >
              职位背景
            </label>
            <select
              id="job-profile-select"
              className="interview-type-input"
              value={jobProfileId}
              onChange={(event) => setJobProfileId(event.target.value)}
            >
              {JOB_PROFILES.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.title} · {profile.department}
                </option>
              ))}
              <option value="custom">自定义职位</option>
            </select>

            {selectedProfile ? (
              <div className="job-context-review">
                <div className="job-context-review__summary">
                  <div>
                    <strong>{selectedProfile.title}</strong>
                    <span>
                      {selectedProfile.department} · 汇报给 {selectedProfile.reportsTo}
                    </span>
                  </div>
                  <span className="job-context-review__badge">已适配</span>
                </div>
                <p>{selectedProfile.summary}</p>

                <div className="job-context-review__block">
                  <span className="job-context-review__label">重点考察</span>
                  <div className="job-context-review__competencies">
                    {selectedProfile.interviewGuide.map((item) => (
                      <span key={item.id}>{item.competency}</span>
                    ))}
                  </div>
                </div>

                <details className="job-context-review__details">
                  <summary>面试官准备清单</summary>
                  <ul>
                    {selectedProfile.interviewerPreparation.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </details>
              </div>
            ) : (
              <div className="job-context-custom">
                <label htmlFor="custom-job-description">职位描述</label>
                <textarea
                  id="custom-job-description"
                  className="interview-type-input"
                  rows={7}
                  placeholder="粘贴职位职责和任职要求"
                  value={customJobDescription}
                  onChange={(event) => setCustomJobDescription(event.target.value)}
                />
                <p>职位描述仅作为专家模型的事实背景。</p>
              </div>
            )}
          </section>
        </div>

        <div className="interview-type-footer">
          <span>固定使用中文 · 10 秒专家模式</span>
          <button className="interview-type-start" type="submit" disabled={!canStart}>
            开始面试
          </button>
        </div>
      </form>
    </div>
  );
}
