import { useEffect, useMemo, useRef, useState } from 'react';
import { CaretDown } from '@phosphor-icons/react/CaretDown';
import { Check } from '@phosphor-icons/react/Check';
import { Desktop } from '@phosphor-icons/react/Desktop';
import { MagnifyingGlass } from '@phosphor-icons/react/MagnifyingGlass';
import { Microphone } from '@phosphor-icons/react/Microphone';
import { ResumeDropzone } from './ResumeDropzone';
import { ThemeToggle } from './ThemeToggle';
import {
  PROPERTY_MANAGER_PROFILE,
  buildInterviewGuideLines,
  searchJobProfiles,
  type JobProfile
} from './jobProfiles';

export interface InterviewSetupSubmit {
  jobProfileId: string;
  jobDescription: string;
  interviewGuide: string[];
  resumeText: string;
  interviewType: InterviewType;
}

export type InterviewType = 'online' | 'offline';

interface InterviewSetupProps {
  ready: boolean;
  resumeText: string;
  onResumeTextChange: (text: string) => void;
  onStart: (payload: InterviewSetupSubmit) => void;
}

/**
 * The app's single preparation step. It deliberately owns only factual Expert
 * context (résumé + JD) plus the one capture-topology choice that affects the
 * interviewer's physical workflow. Models, prompts, and providers stay fixed.
 */
export function InterviewSetup({
  ready,
  resumeText,
  onResumeTextChange,
  onStart
}: InterviewSetupProps) {
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<JobProfile | 'custom' | null>(
    PROPERTY_MANAGER_PROFILE
  );
  const [query, setQuery] = useState(
    `${PROPERTY_MANAGER_PROFILE.title} · ${PROPERTY_MANAGER_PROFILE.department}`
  );
  const [customJobDescription, setCustomJobDescription] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [activeOption, setActiveOption] = useState(0);
  const [interviewType, setInterviewType] = useState<InterviewType>('online');

  const profiles = useMemo(() => searchJobProfiles(query), [query]);
  const options: Array<JobProfile | 'custom'> = [...profiles, 'custom'];
  const isCustom = selectedProfile === 'custom';
  const trimmedCustomDescription = customJobDescription.trim();
  const canStart =
    ready &&
    (selectedProfile !== null) &&
    (!isCustom || trimmedCustomDescription.length > 0);

  useEffect(() => {
    const closeOnOutsidePointer = (event: MouseEvent): void => {
      if (!pickerRef.current?.contains(event.target as Node)) setPickerOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsidePointer);
    return () => document.removeEventListener('mousedown', closeOnOutsidePointer);
  }, []);

  const chooseProfile = (option: JobProfile | 'custom'): void => {
    setSelectedProfile(option);
    setQuery(option === 'custom' ? '自定义职位' : `${option.title} · ${option.department}`);
    setPickerOpen(false);
  };

  const submit = (): void => {
    if (!canStart || selectedProfile === null) return;
    const isBuiltIn = selectedProfile !== 'custom';
    onStart({
      jobProfileId: isBuiltIn ? selectedProfile.id : 'custom',
      jobDescription: isBuiltIn ? selectedProfile.jobDescription : trimmedCustomDescription,
      interviewGuide: isBuiltIn ? buildInterviewGuideLines(selectedProfile) : [],
      resumeText: resumeText.trim(),
      interviewType
    });
  };

  return (
    <main className="interview-setup" aria-labelledby="interview-setup-title">
      <section className="interview-setup__panel">
        <header className="interview-setup__brand">
          <span className="interview-setup__wordmark" aria-label="GLP">
            GLP
          </span>
          <span className="interview-setup__product">面试官 Copilot</span>
          <ThemeToggle className="interview-setup__theme" />
        </header>

        <div className="interview-setup__intro">
          <p className="interview-setup__eyebrow">开始前准备</p>
          <h1 id="interview-setup-title">准备本次面试</h1>
          <p>添加职位描述和候选人简历，专家会在面试中自动寻找证据缺口并给出追问。</p>
        </div>

        <div className="interview-setup__fields">
          <section className="interview-setup__field" aria-labelledby="resume-field-title">
            <div className="interview-setup__field-heading">
              <h2 id="resume-field-title">候选人简历</h2>
              <span>可选</span>
            </div>
            <ResumeDropzone
              resumeText={resumeText}
              onExtracted={onResumeTextChange}
              onCleared={() => onResumeTextChange('')}
            />
          </section>

          <section className="interview-setup__field interview-setup__job-field">
            <div className="interview-setup__field-heading">
              <label htmlFor="interview-setup-job-picker">职位 JD</label>
              <span>{isCustom ? '自定义' : '内置专家模板'}</span>
            </div>

            <div ref={pickerRef} className="interview-setup__picker">
              <MagnifyingGlass
                className="interview-setup__picker-search"
                size={17}
                data-icon-library="phosphor"
                aria-hidden="true"
              />
              <input
                id="interview-setup-job-picker"
                className="interview-setup__picker-input"
                role="combobox"
                aria-label="选择职位 JD"
                aria-autocomplete="list"
                aria-controls="interview-job-options"
                aria-expanded={pickerOpen}
                aria-activedescendant={pickerOpen ? `interview-job-option-${activeOption}` : undefined}
                autoComplete="off"
                placeholder="搜索职位、部门或职责"
                value={query}
                onFocus={() => {
                  setPickerOpen(true);
                  setActiveOption(0);
                }}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSelectedProfile(null);
                  setPickerOpen(true);
                  setActiveOption(0);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    setPickerOpen(false);
                    return;
                  }
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    setPickerOpen(true);
                    setActiveOption((index) => Math.min(index + 1, options.length - 1));
                  }
                  if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    setActiveOption((index) => Math.max(index - 1, 0));
                  }
                  if (event.key === 'Enter' && pickerOpen) {
                    event.preventDefault();
                    chooseProfile(options[activeOption] ?? 'custom');
                  }
                }}
              />
              <CaretDown
                className="interview-setup__picker-caret"
                size={16}
                data-icon-library="phosphor"
                aria-hidden="true"
              />

              {pickerOpen ? (
                <div id="interview-job-options" className="interview-setup__picker-list" role="listbox">
                  {profiles.map((profile, index) => (
                    <button
                      id={`interview-job-option-${index}`}
                      key={profile.id}
                      className="interview-setup__picker-option"
                      type="button"
                      role="option"
                      aria-selected={selectedProfile !== 'custom' && selectedProfile?.id === profile.id}
                      aria-label={`${profile.title} · ${profile.department}`}
                      data-active={activeOption === index ? 'true' : 'false'}
                      onMouseEnter={() => setActiveOption(index)}
                      onClick={() => chooseProfile(profile)}
                    >
                      <span>
                        <strong>{profile.title}</strong>
                        <small>{profile.department} · 汇报 {profile.reportsTo}</small>
                      </span>
                      {selectedProfile !== 'custom' && selectedProfile?.id === profile.id ? (
                        <Check size={16} data-icon-library="phosphor" aria-hidden="true" />
                      ) : null}
                    </button>
                  ))}
                  <button
                    id={`interview-job-option-${profiles.length}`}
                    className="interview-setup__picker-option interview-setup__picker-option--custom"
                    type="button"
                    role="option"
                    aria-selected={isCustom}
                    aria-label="自定义职位"
                    data-active={activeOption === profiles.length ? 'true' : 'false'}
                    onMouseEnter={() => setActiveOption(profiles.length)}
                    onClick={() => chooseProfile('custom')}
                  >
                    <span>
                      <strong>自定义职位</strong>
                      <small>没有匹配职位时手动输入 JD</small>
                    </span>
                    {isCustom ? <Check size={16} data-icon-library="phosphor" aria-hidden="true" /> : null}
                  </button>
                </div>
              ) : null}
            </div>

            {selectedProfile && selectedProfile !== 'custom' ? (
              <article className="interview-setup__profile" aria-label="已选择职位">
                <div className="interview-setup__profile-heading">
                  <div>
                    <h3>{selectedProfile.title}</h3>
                    <p>{selectedProfile.department} · 汇报 {selectedProfile.reportsTo}</p>
                  </div>
                  <span>已匹配</span>
                </div>
                <p>{selectedProfile.summary}</p>
                <div className="interview-setup__profile-tags" aria-label="重点考察能力">
                  {selectedProfile.interviewGuide.slice(0, 3).map((item) => (
                    <span key={item.id}>{item.competency}</span>
                  ))}
                </div>
              </article>
            ) : null}

            {isCustom ? (
              <div className="interview-setup__custom">
                <div className="interview-setup__field-heading">
                  <label htmlFor="interview-setup-custom-jd">自定义职位描述</label>
                  <span>{customJobDescription.length.toLocaleString('zh-CN')} 字</span>
                </div>
                <textarea
                  id="interview-setup-custom-jd"
                  className="interview-setup__jd"
                  rows={5}
                  placeholder="粘贴职位职责、任职要求和重点考察内容"
                  value={customJobDescription}
                  onChange={(event) => setCustomJobDescription(event.target.value)}
                />
              </div>
            ) : null}
            <p className="interview-setup__hint">JD 仅作为专家模型的事实背景，不会创建额外提示词。</p>
          </section>

        </div>

        <footer className="interview-setup__footer">
          <fieldset className="interview-setup__mode">
            <legend>面试方式</legend>
            <div className="interview-setup__mode-options">
              <label data-selected={interviewType === 'online' ? 'true' : 'false'}>
                <input
                  type="radio"
                  name="interview-type"
                  value="online"
                  checked={interviewType === 'online'}
                  onChange={() => setInterviewType('online')}
                />
                <span className="interview-setup__mode-icon" aria-hidden="true">
                  <Desktop size={18} data-icon-library="phosphor" />
                </span>
                <span className="interview-setup__mode-copy">
                  <strong>线上面试</strong>
                  <small>麦克风 + 电脑音频</small>
                </span>
                <span className="interview-setup__mode-check" aria-hidden="true">
                  <Check size={13} data-icon-library="phosphor" />
                </span>
              </label>
              <label data-selected={interviewType === 'offline' ? 'true' : 'false'}>
                <input
                  type="radio"
                  name="interview-type"
                  value="offline"
                  checked={interviewType === 'offline'}
                  onChange={() => setInterviewType('offline')}
                />
                <span className="interview-setup__mode-icon" aria-hidden="true">
                  <Microphone size={18} data-icon-library="phosphor" />
                </span>
                <span className="interview-setup__mode-copy">
                  <strong>线下面试</strong>
                  <small>单麦克风采集双方</small>
                </span>
                <span className="interview-setup__mode-check" aria-hidden="true">
                  <Check size={13} data-icon-library="phosphor" />
                </span>
              </label>
            </div>
          </fieldset>
          <div className="interview-setup__footer-actions">
            <p className="interview-setup__connection" role="status">
              {ready ? '面试服务已就绪' : '正在连接面试服务…'}
            </p>
            <button
              className="interview-setup__start"
              type="button"
              disabled={!canStart}
              onClick={submit}
            >
              开始面试
            </button>
          </div>
        </footer>
      </section>
    </main>
  );
}
