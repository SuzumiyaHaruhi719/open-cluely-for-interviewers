import { useState } from 'react';
import { ResumeDropzone } from './ResumeDropzone';

export interface InterviewSetupSubmit {
  jobDescription: string;
  resumeText: string;
}

interface InterviewSetupProps {
  ready: boolean;
  resumeText: string;
  onResumeTextChange: (text: string) => void;
  onStart: (payload: InterviewSetupSubmit) => void;
}

/**
 * The app's single preparation step. It deliberately owns only factual Expert
 * context (résumé + JD); capture, models, prompts, providers, and interview
 * formats are fixed product policy and therefore do not appear here.
 */
export function InterviewSetup({
  ready,
  resumeText,
  onResumeTextChange,
  onStart
}: InterviewSetupProps) {
  const [jobDescription, setJobDescription] = useState('');
  const trimmedJobDescription = jobDescription.trim();
  const canStart = ready && trimmedJobDescription.length > 0;

  const submit = (): void => {
    if (!canStart) return;
    onStart({
      jobDescription: trimmedJobDescription,
      resumeText: resumeText.trim()
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

          <section className="interview-setup__field">
            <div className="interview-setup__field-heading">
              <label htmlFor="interview-setup-jd">职位描述</label>
              <span>{jobDescription.length.toLocaleString('zh-CN')} 字</span>
            </div>
            <textarea
              id="interview-setup-jd"
              className="interview-setup__jd"
              rows={9}
              placeholder="粘贴职位职责、任职要求和重点考察内容"
              value={jobDescription}
              onChange={(event) => setJobDescription(event.target.value)}
            />
            <p className="interview-setup__hint">职位描述仅作为专家模型的事实背景。</p>
          </section>
        </div>

        <footer className="interview-setup__footer">
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
        </footer>
      </section>
    </main>
  );
}
