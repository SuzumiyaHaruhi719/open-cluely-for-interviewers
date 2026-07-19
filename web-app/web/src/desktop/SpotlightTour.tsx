import { useState, useEffect, useCallback, useRef } from 'react';
/**
 * Spotlight Tour — interactive newcomer guidance for the web app.
 *
 * Darkens the screen except a spotlight on the target element,
 * with an arrow + tooltip that dynamically positions relative to it.
 * "Next" advances; the spotlight animates to the next element.
 */

const TOUR_STORAGE_KEY = 'tour-shown-this-session';

// Track across both sessionStorage (per-tab) so the tour shows on every fresh
// page load but doesn't re-trigger during HMR or in-tab navigation.
function hasSeenTour(): boolean {
  try {
    return sessionStorage.getItem(TOUR_STORAGE_KEY) === '1';
  } catch { return false; }
}
function markTourSeen() {
  try { sessionStorage.setItem(TOUR_STORAGE_KEY, '1'); } catch {}
}

const TOUR_STEPS: TourStep[] = [
  {
    selector: null,
    title: '欢迎使用面试官 Copilot',
    desc: '这是一个 AI 辅助面试工具。30 秒带你了解核心功能：新建面试、粘贴 JD、上传简历、开始录音、获取 AI 追问。',
    icon: '👋',
    isWelcome: true,
  },
  {
    selector: '#btn-new-interview',
    title: '① 新建面试',
    desc: '点这里开始一场新面试。选择「线上」采集电脑音频，或「线下」仅用房间麦克风。',
    icon: '✏️',
  },
  {
    selector: '#jd-input',
    title: '② 粘贴岗位描述',
    desc: '把 JD 粘贴到这里，AI 会据此生成针对性的追问方向。',
    icon: '📋',
    requiresRightRail: true,
  },
  {
    selector: '#resume-dropzone',
    title: '③ 上传简历',
    desc: '拖入或点击上传候选人简历（txt / md / pdf / docx），AI 会结合简历提问。',
    icon: '📄',
    requiresRightRail: true,
  },
  {
    selector: '#channel-computer',
    title: '④ 采集候选人音频',
    desc: '点击这里开启「电脑音频」通道，采集候选人的声音（线上面试用）。',
    icon: '🎙️',
  },
  {
    selector: '#channel-mic',
    title: '⑤ 采集你的声音',
    desc: '点击这里开启「麦克风」通道，采集你的提问和对话。',
    icon: '🎤',
  },
  {
    selector: '#analyze-btn',
    title: '⑥ 随时问 AI',
    desc: '对话进行中，点这里让 AI 分析上下文并推荐下一步追问。也可点「生成问题」快速出题。',
    icon: '🤖',
  },
  {
    selector: null,
    title: '一切就绪！',
    desc: '你现在可以开始第一场 AI 辅助面试了。遇到问题随时在设置里重播引导。',
    icon: '🎉',
    isFinal: true,
  },
];

interface TourStep {
  selector: string | null;
  title: string;
  desc: string;
  icon: string;
  isWelcome?: boolean;
  isFinal?: boolean;
  requiresRightRail?: boolean;
}

function getTargetRect(selector: string): DOMRect | null {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) return null;

  for (let current: HTMLElement | null = el; current; current = current.parentElement) {
    const style = window.getComputedStyle(current);
    const opacity = Number.parseFloat(style.opacity);
    if (
      style.display === 'none'
      || style.visibility === 'hidden'
      || (Number.isFinite(opacity) && opacity === 0)
    ) {
      return null;
    }
  }

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
  up: { borderLeft: '8px solid transparent', borderRight: '8px solid transparent', borderBottom: '8px solid var(--tour-arrow)', borderTop: 'none' },
  down: { borderLeft: '8px solid transparent', borderRight: '8px solid transparent', borderTop: '8px solid var(--tour-arrow)', borderBottom: 'none' },
  left: { borderTop: '8px solid transparent', borderBottom: '8px solid transparent', borderRight: '8px solid var(--tour-arrow)', borderLeft: 'none' },
  right: { borderTop: '8px solid transparent', borderBottom: '8px solid transparent', borderLeft: '8px solid var(--tour-arrow)', borderRight: 'none' },
};

export function SpotlightTour() {
  const [visible, setVisible] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [ttPos, setTtPos] = useState<TooltipPosition | null>(null);
  const [tooltipVisible, setTooltipVisible] = useState(false);
  // The rendered layout deliberately lags behind stepIdx while a new target is
  // being revealed/scrolled into view. Keeping the previous geometry mounted is
  // what gives CSS a real start and end point to interpolate between.
  const [layoutMode, setLayoutMode] = useState<'centered' | 'target'>('centered');
  const positionRunRef = useRef(0);
  const isScrollingRef = useRef(false);

  // Check if tour should start — shows on every fresh page load
  useEffect(() => {
    if (!hasSeenTour()) {
      const t = setTimeout(() => setVisible(true), 800);
      return () => clearTimeout(t);
    }
  }, []);

  // Position spotlight when step changes
  const reposition = useCallback((idx: number) => {
    const run = ++positionRunRef.current;
    const step = TOUR_STEPS[idx];
    isScrollingRef.current = false;

    // Welcome/final step: no spotlight, centered
    if (step.isWelcome || step.isFinal || !step.selector) {
      setLayoutMode('centered');
      setTooltipVisible(true);
      return;
    }

    let revealDelay = 0;
    if (step.requiresRightRail && document.body.classList.contains('rail-collapsed')) {
      document.querySelector<HTMLButtonElement>('#toggle-rail-btn')?.click();
      revealDelay = 350;
    }

    setTimeout(() => {
      if (run !== positionRunRef.current) return;

      const el = document.querySelector<HTMLElement>(step.selector!);
      if (el) {
        // Suppress scroll-triggered reposition during programmatic scroll.
        isScrollingRef.current = true;
        el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      }

      setTimeout(() => {
        if (run !== positionRunRef.current) return;
        isScrollingRef.current = false;

        const r = getTargetRect(step.selector!);
        if (!r) {
          // Keep the requested step visible without leaving the spotlight on an
          // unrelated control. The same mounted nodes animate back to center.
          setLayoutMode('centered');
          setTooltipVisible(true);
          return;
        }

        setRect(r);
        setTtPos(computeTooltipPos(r));
        setLayoutMode('target');
        setTooltipVisible(true);
      }, 400);
    }, revealDelay);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => {
      reposition(stepIdx);
    }, 0);
    return () => clearTimeout(t);
  }, [stepIdx, visible, reposition]);

  // Reposition on resize/scroll
  useEffect(() => {
    if (!visible) return;
    const handler = () => {
      if (isScrollingRef.current) return; // ignore scroll from scrollIntoView
      reposition(stepIdx);
    };
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
    ++positionRunRef.current;
    setVisible(false);
    if (completed) {
      markTourSeen();
    } else {
      markTourSeen(); // also mark on skip so it doesn't re-show mid-session
    }
  }

  if (!visible) return null;

  const step = TOUR_STEPS[stepIdx];
  const isWelcome = step.isWelcome;
  const isFinal = step.isFinal;
  const hasTargetLayout = layoutMode === 'target' && rect !== null && ttPos !== null;
  const isLast = stepIdx === TOUR_STEPS.length - 1;

  const pad = 6;
  const r = 10;

  const clipPath = hasTargetLayout
    ? computeMaskClipPath(rect, pad, r)
    : 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)';
  const ringTop = rect ? rect.top - pad : 0;
  const ringLeft = rect ? rect.left - pad : 0;
  const ringW = rect ? rect.width + pad * 2 : 0;
  const ringH = rect ? rect.height + pad * 2 : 0;
  const tooltipStyle: React.CSSProperties = hasTargetLayout
    ? {
        top: `${ttPos.ttTop}px`,
        left: `${ttPos.ttLeft}px`,
        width: '300px',
        opacity: tooltipVisible ? 1 : 0,
        transform: tooltipVisible ? 'scale(1)' : 'scale(0.92)'
      }
    : {
        top: '50%',
        left: '50%',
        width: '340px',
        opacity: tooltipVisible ? 1 : 0,
        transform: tooltipVisible
          ? 'translate(-50%, -50%) scale(1)'
          : 'translate(-50%, -50%) scale(0.92)'
      };

  return (
    <>
      <div
        className="tour-mask"
        style={{ clipPath }}
        onClick={() => finish(false)}
      />

      {/* Spotlight ring */}
      <div
        className={`tour-spotlight-ring ${hasTargetLayout ? '' : 'is-hidden'}`}
        aria-hidden={!hasTargetLayout}
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
        className={`tour-arrow ${hasTargetLayout ? '' : 'is-hidden'}`}
        aria-hidden={!hasTargetLayout}
        style={{
          top: `${ttPos?.arrowTop ?? 0}px`,
          left: `${ttPos?.arrowLeft ?? 0}px`,
          ...(ttPos ? arrowStyles[ttPos.arrowDir] : {}),
        }}
      />

      <div
        className={`tour-tooltip ${tooltipVisible ? 'visible' : ''}`}
        style={tooltipStyle}
      >
        <div className="tour-progress-bar" style={{ width: `${(stepIdx / (TOUR_STEPS.length - 1)) * 100}%` }} />
        {isWelcome || isFinal || !step.selector ? (
          <div className="tour-final-icon" style={{ fontSize: '28px' }}>{step.icon}</div>
        ) : (
          <div className="tour-step-badge">第 {stepIdx} / {TOUR_STEPS.length - 2} 步</div>
        )}
        <h3 className="tour-title">{isWelcome || isFinal ? '' : `${step.icon} `}{step.title}</h3>
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
            {isFinal ? (
              <button className="tour-btn tour-btn--primary" onClick={() => finish(true)}>开始使用 ✓</button>
            ) : isWelcome ? (
              <>
                <button className="tour-btn tour-btn--ghost" onClick={() => finish(false)}>跳过</button>
                <button className="tour-btn tour-btn--primary" onClick={next}>开始导览 →</button>
              </>
            ) : (
              <>
              {stepIdx > 0 && (
              <button className="tour-btn tour-btn--ghost" onClick={prev}>上一步</button>
              )}
              {isLast ? (
                <button className="tour-btn tour-btn--primary" onClick={() => finish(true)}>完成 ✓</button>
              ) : (
                <button className="tour-btn tour-btn--primary" onClick={next}>下一步 →</button>
              )}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
