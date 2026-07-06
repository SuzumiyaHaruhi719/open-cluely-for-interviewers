import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Spotlight Tour — interactive newcomer guidance for the web app.
 *
 * Darkens the screen except a spotlight on the target element,
 * with an arrow + tooltip that dynamically positions relative to it.
 * "Next" advances; the spotlight animates to the next element.
 */

const TOUR_STORAGE_KEY = 'tour-completed-v2';

const TOUR_STEPS = [
  {
    selector: '#btn-new-interview',
    title: '新建面试',
    desc: '点这里开始一场新面试。选择「线上」采集电脑音频，或「线下」仅用房间麦克风。',
    icon: '✏️',
  },
  {
    selector: '#jd-input',
    title: '粘贴岗位描述',
    desc: '把 JD 粘贴到这里，AI 会据此生成针对性的追问方向。',
    icon: '📋',
  },
  {
    selector: '#resume-dropzone',
    title: '上传简历',
    desc: '拖入或点击上传候选人简历（txt / md / pdf / docx），AI 会结合简历提问。',
    icon: '📄',
  },
  {
    selector: '#channel-computer',
    title: '采集候选人音频',
    desc: '点击这里开启「电脑音频」通道，采集候选人的声音（线上面试用）。',
    icon: '🎙️',
  },
  {
    selector: '#channel-mic',
    title: '采集你的声音',
    desc: '点击这里开启「麦克风」通道，采集你的提问和对话。',
    icon: '🎤',
  },
  {
    selector: '#analyze-btn',
    title: '随时问 AI',
    desc: '对话进行中，点这里让 AI 分析上下文并推荐下一步追问。也可点「生成问题」快速出题。',
    icon: '🤖',
  },
];

interface TourStep {
  selector: string;
  title: string;
  desc: string;
  icon: string;
}

function getTargetRect(selector: string): DOMRect | null {
  const el = document.querySelector(selector);
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  return rect;
}

function computeMaskClipPath(rect: DOMRect, pad: number, r: number): string {
  const top = rect.top - pad;
  const left = rect.left - pad;
  const w = rect.width + pad * 2;
  const h = rect.height + pad * 2;
  const rt = top, rb = top + h, rl = left, rr = left + w;
  const sw = window.innerWidth;
  const sh = window.innerHeight;

  // Build rounded-rect cutout points
  const cx = 6;
  const pts: string[] = [];
  for (let i = 0; i <= cx; i++) {
    const t = i / cx;
    pts.push(`${rl + r * (1 - Math.cos(t * Math.PI / 2))}px ${rt}px`);
  }
  for (let i = 1; i <= cx; i++) {
    const t = i / cx;
    pts.push(`${rr - r * (1 - Math.cos(t * Math.PI / 2))}px ${rt}px`);
  }
  for (let i = 1; i <= cx; i++) {
    const t = i / cx;
    pts.push(`${rr}px ${rt + r * (1 - Math.sin(t * Math.PI / 2))}px`);
  }
  for (let i = 1; i <= cx; i++) {
    const t = i / cx;
    pts.push(`${rr}px ${rb - r * (1 - Math.sin(t * Math.PI / 2))}px`);
  }
  for (let i = 1; i <= cx; i++) {
    const t = i / cx;
    pts.push(`${rr - r * (1 - Math.cos(t * Math.PI / 2))}px ${rb}px`);
  }
  for (let i = 1; i <= cx; i++) {
    const t = i / cx;
    pts.push(`${rl + r * (1 - Math.cos(t * Math.PI / 2))}px ${rb}px`);
  }
  for (let i = 1; i <= cx; i++) {
    const t = i / cx;
    pts.push(`${rl}px ${rb - r * (1 - Math.sin(t * Math.PI / 2))}px`);
  }
  for (let i = 1; i <= cx; i++) {
    const t = i / cx;
    pts.push(`${rl}px ${rt + r * (1 - Math.sin(t * Math.PI / 2))}px`);
  }

  return `polygon(0% 0%, ${sw}px 0%, ${sw}px ${sh}px, 0% ${sh}px, 0% 0%, ${rl}px 0%, ${pts.join(', ')})`;
}

interface TooltipPosition {
  ttTop: number;
  ttLeft: number;
  arrowDir: 'up' | 'down' | 'left' | 'right';
  arrowTop: number;
  arrowLeft: number;
}

function computeTooltipPos(rect: DOMRect): TooltipPosition {
  const ttW = 300;
  const ttH = 170;
  const gap = 14;
  const sw = window.innerWidth;
  const sh = window.innerHeight;

  let ttTop = rect.bottom + gap;
  let ttLeft = rect.left + rect.width / 2 - ttW / 2;
  let arrowDir: 'up' | 'down' | 'left' | 'right' = 'up';

  if (ttTop + ttH > sh - 20) {
    ttTop = rect.top - ttH - gap;
    arrowDir = 'down';
  }
  if (ttTop < 20) {
    ttTop = rect.top + rect.height / 2 - ttH / 2;
    ttLeft = rect.right + gap;
    arrowDir = 'left';
    if (ttLeft + ttW > sw - 20) {
      ttLeft = rect.left - ttW - gap;
      arrowDir = 'right';
    }
  }

  ttLeft = Math.max(16, Math.min(ttLeft, sw - ttW - 16));
  ttTop = Math.max(16, Math.min(ttTop, sh - ttH - 16));

  const arrowSize = 8;
  let arrowTop: number, arrowLeft: number;
  if (arrowDir === 'up') {
    arrowTop = ttTop - arrowSize;
    arrowLeft = ttLeft + ttW / 2 - arrowSize;
  } else if (arrowDir === 'down') {
    arrowTop = ttTop + ttH;
    arrowLeft = ttLeft + ttW / 2 - arrowSize;
  } else if (arrowDir === 'left') {
    arrowTop = ttTop + ttH / 2 - arrowSize;
    arrowLeft = ttLeft - arrowSize;
  } else {
    arrowTop = ttTop + ttH / 2 - arrowSize;
    arrowLeft = ttLeft + ttW;
  }

  return { ttTop, ttLeft, arrowDir, arrowTop, arrowLeft };
}

const arrowStyles: Record<string, React.CSSProperties> = {
  up: { borderLeft: '8px solid transparent', borderRight: '8px solid transparent', borderBottom: '8px solid rgba(22,22,33,0.96)', borderTop: 'none' },
  down: { borderLeft: '8px solid transparent', borderRight: '8px solid transparent', borderTop: '8px solid rgba(22,22,33,0.96)', borderBottom: 'none' },
  left: { borderTop: '8px solid transparent', borderBottom: '8px solid transparent', borderRight: '8px solid rgba(22,22,33,0.96)', borderLeft: 'none' },
  right: { borderTop: '8px solid transparent', borderBottom: '8px solid transparent', borderLeft: '8px solid rgba(22,22,33,0.96)', borderRight: 'none' },
};

export function SpotlightTour() {
  const [visible, setVisible] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [ttPos, setTtPos] = useState<TooltipPosition | null>(null);
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const rafRef = useRef<number>(0);

  // Check if tour should start
  useEffect(() => {
    try {
      if (localStorage.getItem(TOUR_STORAGE_KEY) !== '1') {
        const t = setTimeout(() => setVisible(true), 800);
        return () => clearTimeout(t);
      }
    } catch { /* localStorage unavailable */ }
  }, []);

  // Position spotlight when step changes
  const reposition = useCallback((idx: number) => {
    const step = TOUR_STEPS[idx];
    const r = getTargetRect(step.selector);
    if (!r) {
      // Element not visible — skip to next
      if (idx + 1 < TOUR_STEPS.length) {
        setStepIdx(idx + 1);
      } else {
        setVisible(false);
      }
      return;
    }
    setRect(r);
    setTtPos(computeTooltipPos(r));
  }, []);

  useEffect(() => {
    if (!visible) return;
    setTooltipVisible(false);
    const t = setTimeout(() => {
      reposition(stepIdx);
      requestAnimationFrame(() => setTooltipVisible(true));
    }, 150);
    return () => clearTimeout(t);
  }, [stepIdx, visible, reposition]);

  // Reposition on resize/scroll
  useEffect(() => {
    if (!visible) return;
    const handler = () => reposition(stepIdx);
    window.addEventListener('resize', handler);
    window.addEventListener('scroll', handler, true);
    return () => {
      window.removeEventListener('resize', handler);
      window.removeEventListener('scroll', handler, true);
    };
  }, [visible, stepIdx, reposition]);

  // Keyboard
  useEffect(() => {
    if (!visible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [visible, stepIdx]);

  function next() {
    if (stepIdx + 1 >= TOUR_STEPS.length) {
      finish(true);
    } else {
      setStepIdx(stepIdx + 1);
    }
  }

  function prev() {
    if (stepIdx > 0) setStepIdx(stepIdx - 1);
  }

  function goToStep(idx: number) {
    setStepIdx(idx);
  }

  function finish(completed: boolean) {
    setVisible(false);
    if (completed) {
      try { localStorage.setItem(TOUR_STORAGE_KEY, '1'); } catch {}
    }
  }

  if (!visible || !rect || !ttPos) return null;

  const pad = 6;
  const r = 10;
  const step = TOUR_STEPS[stepIdx];
  const isLast = stepIdx === TOUR_STEPS.length - 1;
  const clipPath = computeMaskClipPath(rect, pad, r);
  const ringTop = rect.top - pad;
  const ringLeft = rect.left - pad;
  const ringW = rect.width + pad * 2;
  const ringH = rect.height + pad * 2;

  return (
    <>
      {/* Dark mask with cutout */}
      <div
        className="tour-mask"
        style={{ clipPath }}
        onClick={() => finish(false)}
      />

      {/* Spotlight ring */}
      <div
        className="tour-spotlight-ring"
        style={{
          top: ringTop + 'px',
          left: ringLeft + 'px',
          width: ringW + 'px',
          height: ringH + 'px',
          borderRadius: r + 'px',
        }}
      />

      {/* Arrow */}
      <div
        className="tour-arrow"
        style={{
          top: ttPos.arrowTop + 'px',
          left: ttPos.arrowLeft + 'px',
          ...arrowStyles[ttPos.arrowDir],
        }}
      />

      {/* Tooltip */}
      <div
        className="tour-tooltip"
        style={{
          top: ttPos.ttTop + 'px',
          left: ttPos.ttLeft + 'px',
          opacity: tooltipVisible ? 1 : 0,
          transform: tooltipVisible ? 'scale(1)' : 'scale(0.92)',
        }}
      >
        <div className="tour-step-badge">第 {stepIdx + 1} / {TOUR_STEPS.length} 步</div>
        <h3 className="tour-title">{step.icon} {step.title}</h3>
        <p className="tour-desc">{step.desc}</p>
        <div className="tour-actions">
          <div className="tour-dots">
            {TOUR_STEPS.map((_, i) => (
              <div
                key={i}
                className={`tour-dot ${i === stepIdx ? 'active' : ''}`}
                onClick={() => goToStep(i)}
              />
            ))}
          </div>
          <div className="tour-buttons">
            {stepIdx > 0 && (
              <button className="tour-btn tour-btn--ghost" onClick={prev}>上一步</button>
            )}
            {stepIdx === 0 && (
              <button className="tour-btn tour-btn--ghost" onClick={() => finish(false)}>跳过</button>
            )}
            {isLast ? (
              <button className="tour-btn tour-btn--primary" onClick={() => finish(true)}>完成 ✓</button>
            ) : (
              <button className="tour-btn tour-btn--primary" onClick={next}>下一步 →</button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
