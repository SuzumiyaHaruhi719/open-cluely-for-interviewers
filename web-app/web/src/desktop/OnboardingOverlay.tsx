import { useState, useEffect } from 'react';

/**
 * 新手指引 / Newcomer guidance overlay.
 * Shows on first launch (dismissal saved in localStorage).
 * Highlights the 4 key steps: new interview, paste JD, upload resume, start recording.
 */
export function OnboardingOverlay() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem('onboarding-dismissed') !== '1') {
        const t = setTimeout(() => setVisible(true), 600);
        return () => clearTimeout(t);
      }
    } catch {
      /* localStorage may be unavailable */
    }
  }, []);

  const dismiss = (dontShow: boolean) => {
    if (dontShow) {
      try { localStorage.setItem('onboarding-dismissed', '1'); } catch {}
    }
    setVisible(false);
  };

  if (!visible) return null;

  const steps = [
    {
      num: 1,
      title: '新建面试',
      desc: '点击左上角「新建面试」按钮，选择线上/线下面试形式。',
    },
    {
      num: 2,
      title: '粘贴岗位描述（JD）',
      desc: '在右侧「岗位描述」区域粘贴 JD，AI 会据此生成针对性追问。',
    },
    {
      num: 3,
      title: '上传简历',
      desc: '在右侧「简历」区域拖入或点击上传候选人简历（txt/md/pdf/docx）。',
    },
    {
      num: 4,
      title: '开始录音',
      desc: '在底部音频通道区，点击「电脑音频」采集候选人声音，点击「麦克风」采集你的声音。对话开始后随时点「问 AI」获取追问建议。',
    },
  ];

  return (
    <div
      className="onboarding-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
    >
      <div className="onboarding-card">
        <button
          className="onboarding-close"
          type="button"
          aria-label="关闭指引"
          onClick={() => dismiss(true)}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
          </svg>
        </button>
        <h2 id="onboarding-title" className="onboarding-title">👋 欢迎使用面试官 Copilot</h2>
        <p className="onboarding-subtitle">30 秒上手，4 步开始你的第一场 AI 辅助面试</p>
        <div className="onboarding-steps">
          {steps.map((s) => (
            <div key={s.num} className="onboarding-step">
              <span className="onboarding-step__num">{s.num}</span>
              <div className="onboarding-step__body">
                <div className="onboarding-step__title">{s.title}</div>
                <div className="onboarding-step__desc">{s.desc}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="onboarding-footer">
          <label className="onboarding-dont-show">
            <input type="checkbox" onChange={(e) => { if (e.target.checked) dismiss(true); }} />
            不再显示
          </label>
          <button className="onboarding-start-btn" type="button" onClick={() => dismiss(false)}>
            开始使用
          </button>
        </div>
      </div>
    </div>
  );
}
