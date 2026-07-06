/**
 * Spotlight Tour Engine — interactive newcomer guidance.
 *
 * Darkens the screen except a spotlight on the target element,
 * with an arrow + tooltip that dynamically positions relative to it.
 * "Next" advances; the spotlight animates to the next element.
 *
 * Used by: desktop renderer.js (vanilla JS) and web-app OnboardingOverlay.tsx (via wrapper).
 */

const TOUR_STORAGE_KEY = 'tour-completed-v2';

/**
 * Tour steps. Step 0 is a welcome (no target element, centered modal).
 * Steps 1+ target DOM elements by selector.
 */
const TOUR_STEPS = [
  {
    selector: null, // welcome step — centered, no spotlight
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
  },
  {
    selector: '#resume-dropzone',
    title: '③ 上传简历',
    desc: '拖入或点击上传候选人简历（txt / md / pdf / docx），AI 会结合简历提问。',
    icon: '📄',
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
];

/**
 * Start the spotlight tour. Creates overlay elements, positions them,
 * and wires up Next/Prev/Skip/keyboard.
 * @param {object} opts — { onComplete: fn }
 */
export function startTour(opts = {}) {
  const { onComplete } = opts;
  let currentStep = 0;
  let dismissed = false;

  // Remove any existing tour elements
  document.querySelectorAll('.tour-mask, .tour-spotlight-ring, .tour-tooltip, .tour-arrow').forEach(el => el.remove());

  // Create mask (dark backdrop with cutout)
  const mask = document.createElement('div');
  mask.className = 'tour-mask';
  mask.style.clipPath = 'polygon(0% 0%, 0% 100%, 100% 100%, 100% 0%)';
  document.body.appendChild(mask);

  // Create spotlight ring
  const ring = document.createElement('div');
  ring.className = 'tour-spotlight-ring';
  ring.style.display = 'none';
  document.body.appendChild(ring);

  // Create arrow
  const arrow = document.createElement('div');
  arrow.className = 'tour-arrow';
  document.body.appendChild(arrow);

  // Create tooltip
  const tooltip = document.createElement('div');
  tooltip.className = 'tour-tooltip';
  document.body.appendChild(tooltip);

  /** Get element rect, return null if not found/visible */
  function getTargetRect(selector) {
    const el = document.querySelector(selector);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return rect;
  }

  /** Position spotlight ring + mask cutout + tooltip + arrow */
  function positionSpotlight(rect) {
    const pad = 6;
    const top = rect.top - pad;
    const left = rect.left - pad;
    const w = rect.width + pad * 2;
    const h = rect.height + pad * 2;
    const r = 10; // rounded corner radius

    // Position ring
    ring.style.display = 'block';
    ring.style.top = top + 'px';
    ring.style.left = left + 'px';
    ring.style.width = w + 'px';
    ring.style.height = h + 'px';
    ring.style.borderRadius = r + 'px';

    // Cut hole in mask using clip-path (everything dark EXCEPT the spotlight rect)
    const rt = top, rb = top + h, rl = left, rr = left + w;
    // Use rounded rect approximation with polygon (many points for smooth corners)
    const points = [];
    const cx = 4; // corner segments
    // Top edge (left to right)
    for (let i = 0; i <= cx; i++) {
      const t = i / cx;
      const x = rl + r * (1 - Math.cos(t * Math.PI / 2));
      points.push(`${x}px ${rt}px`);
    }
    for (let i = 1; i <= cx; i++) {
      const t = i / cx;
      const x = rr - r * (1 - Math.cos(t * Math.PI / 2));
      points.push(`${x}px ${rt}px`);
    }
    // Right edge
    for (let i = 1; i <= cx; i++) {
      const t = i / cx;
      const y = rt + r * (1 - Math.sin(t * Math.PI / 2));
      points.push(`${rr}px ${y}px`);
    }
    for (let i = 1; i <= cx; i++) {
      const t = i / cx;
      const y = rb - r * (1 - Math.sin(t * Math.PI / 2));
      points.push(`${rr}px ${y}px`);
    }
    // Bottom edge (right to left)
    for (let i = 1; i <= cx; i++) {
      const t = i / cx;
      const x = rr - r * (1 - Math.cos(t * Math.PI / 2));
      points.push(`${x}px ${rb}px`);
    }
    for (let i = 1; i <= cx; i++) {
      const t = i / cx;
      const x = rl + r * (1 - Math.cos(t * Math.PI / 2));
      points.push(`${x}px ${rb}px`);
    }
    // Left edge
    for (let i = 1; i <= cx; i++) {
      const t = i / cx;
      const y = rb - r * (1 - Math.sin(t * Math.PI / 2));
      points.push(`${rl}px ${y}px`);
    }
    for (let i = 1; i <= cx; i++) {
      const t = i / cx;
      const y = rt + r * (1 - Math.sin(t * Math.PI / 2));
      points.push(`${rl}px ${y}px`);
    }

    // Outer rectangle (full screen) → cut out the spotlight shape
    const sw = window.innerWidth;
    const sh = window.innerHeight;
    const polygon = `polygon(0% 0%, ${sw}px 0%, ${sw}px ${sh}%, 0% ${sh}%, 0% 0%, ${rl}px 0%, ${points.join(', ')})`;
    mask.style.clipPath = polygon;
  }

  /** Position tooltip + arrow relative to spotlight */
  function positionTooltip(rect, step) {
    const ttW = 300;
    const ttH = 160; // approximate
    const gap = 14;
    const sw = window.innerWidth;
    const sh = window.innerHeight;

    let ttTop, ttLeft, arrowDir, arrowTop, arrowLeft;

    // Default: tooltip below the element
    ttTop = rect.bottom + gap;
    ttLeft = rect.left + rect.width / 2 - ttW / 2;
    arrowDir = 'up'; // arrow points up to element

    // If not enough space below, try above
    if (ttTop + ttH > sh - 20) {
      ttTop = rect.top - ttH - gap;
      arrowDir = 'down';
    }
    // If not enough space above either, try right side
    if (ttTop < 20) {
      ttTop = rect.top + rect.height / 2 - ttH / 2;
      ttLeft = rect.right + gap;
      arrowDir = 'left';
      // If no space right, try left
      if (ttLeft + ttW > sw - 20) {
        ttLeft = rect.left - ttW - gap;
        arrowDir = 'right';
      }
    }

    // Clamp horizontally
    ttLeft = Math.max(16, Math.min(ttLeft, sw - ttW - 16));
    ttTop = Math.max(16, Math.min(ttTop, sh - ttH - 16));

    tooltip.style.top = ttTop + 'px';
    tooltip.style.left = ttLeft + 'px';

    // Position arrow
    const arrowSize = 8;
    if (arrowDir === 'up') {
      arrowTop = ttTop - arrowSize;
      arrowLeft = ttLeft + ttW / 2 - arrowSize;
      arrow.style.borderLeft = arrowSize + 'px solid transparent';
      arrow.style.borderRight = arrowSize + 'px solid transparent';
      arrow.style.borderBottom = arrowSize + 'px solid rgba(22, 22, 33, 0.96)';
      arrow.style.borderTop = 'none';
    } else if (arrowDir === 'down') {
      arrowTop = ttTop + ttH;
      arrowLeft = ttLeft + ttW / 2 - arrowSize;
      arrow.style.borderLeft = arrowSize + 'px solid transparent';
      arrow.style.borderRight = arrowSize + 'px solid transparent';
      arrow.style.borderTop = arrowSize + 'px solid rgba(22, 22, 33, 0.96)';
      arrow.style.borderBottom = 'none';
    } else if (arrowDir === 'left') {
      arrowTop = ttTop + ttH / 2 - arrowSize;
      arrowLeft = ttLeft - arrowSize;
      arrow.style.borderTop = arrowSize + 'px solid transparent';
      arrow.style.borderBottom = arrowSize + 'px solid transparent';
      arrow.style.borderRight = arrowSize + 'px solid rgba(22, 22, 33, 0.96)';
      arrow.style.borderLeft = 'none';
    } else { // right
      arrowTop = ttTop + ttH / 2 - arrowSize;
      arrowLeft = ttLeft + ttW;
      arrow.style.borderTop = arrowSize + 'px solid transparent';
      arrow.style.borderBottom = arrowSize + 'px solid transparent';
      arrow.style.borderLeft = arrowSize + 'px solid rgba(22, 22, 33, 0.96)';
      arrow.style.borderRight = 'none';
    }
    arrow.style.top = arrowTop + 'px';
    arrow.style.left = arrowLeft + 'px';

    return arrowDir;
  }

  /** Render tooltip content */
  function renderTooltip(stepIdx, isLast) {
    const step = TOUR_STEPS[stepIdx];
    const dots = TOUR_STEPS.map((_, i) =>
      `<div class="tour-dot ${i === stepIdx ? 'active' : ''}" data-step="${i}"></div>`
    ).join('');

    tooltip.innerHTML = `
      <div class="tour-step-badge">第 ${stepIdx + 1} / ${TOUR_STEPS.length} 步</div>
      <h3 class="tour-title">${step.icon || ''} ${step.title}</h3>
      <p class="tour-desc">${step.desc}</p>
      <div class="tour-actions">
        <div class="tour-dots">${dots}</div>
        <div class="tour-buttons">
          ${stepIdx > 0 ? '<button class="tour-btn tour-btn--ghost" data-action="prev">上一步</button>' : ''}
          ${stepIdx === 0 ? '<button class="tour-btn tour-btn--ghost" data-action="skip">跳过</button>' : ''}
          ${isLast
            ? '<button class="tour-btn tour-btn--primary" data-action="finish">完成 ✓</button>'
            : '<button class="tour-btn tour-btn--primary" data-action="next">下一步 →</button>'
          }
        </div>
      </div>
    `;

    // Wire buttons
    tooltip.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        if (action === 'next') goToStep(currentStep + 1);
        else if (action === 'prev') goToStep(currentStep - 1);
        else if (action === 'skip') finish(false);
        else if (action === 'finish') finish(true);
      });
    });

    // Wire dots
    tooltip.querySelectorAll('.tour-dot').forEach(dot => {
      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        goToStep(parseInt(dot.dataset.step));
      });
    });
  }

  /** Go to a specific step */
  function goToStep(idx) {
    if (idx < 0) idx = 0;
    if (idx >= TOUR_STEPS.length) {
      finish(true);
      return;
    }
    currentStep = idx;
    const step = TOUR_STEPS[idx];

    // Welcome step: no spotlight, centered tooltip
    if (step.isWelcome || !step.selector) {
      const isLast = idx === TOUR_STEPS.length - 1;
      tooltip.classList.remove('visible');
      ring.style.display = 'none';
      arrow.style.display = 'none';
      // Full dark mask (no cutout)
      mask.style.clipPath = 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)';
      setTimeout(() => {
        // Center tooltip
        const ttW = 340;
        const ttH = 200;
        tooltip.style.top = (window.innerHeight / 2 - ttH / 2) + 'px';
        tooltip.style.left = (window.innerWidth / 2 - ttW / 2) + 'px';
        tooltip.style.width = ttW + 'px';
        renderTooltip(idx, isLast);
        requestAnimationFrame(() => {
          tooltip.classList.add('visible');
        });
      }, 150);
      return;
    }

    // Normal step: scroll element into view if needed, then spotlight
    const el = document.querySelector(step.selector);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    }

    // Wait a tick for scroll to settle
    setTimeout(() => {
      const rect = getTargetRect(step.selector);
      if (!rect) {
        goToStep(idx + 1);
        return;
      }

      const isLast = idx === TOUR_STEPS.length - 1;
      arrow.style.display = 'block';
      tooltip.style.width = '300px';

      // Fade out tooltip, reposition, fade in
      tooltip.classList.remove('visible');
      setTimeout(() => {
        positionSpotlight(rect);
        positionTooltip(rect, step);
        renderTooltip(idx, isLast);
        requestAnimationFrame(() => {
          tooltip.classList.add('visible');
        });
      }, 150);
    }, 300);
  }

  /** Finish the tour */
  function finish(completed) {
    if (dismissed) return;
    dismissed = true;
    tooltip.classList.remove('visible');
    ring.style.display = 'none';
    mask.style.clipPath = 'polygon(0% 0%, 0% 100%, 100% 100%, 100% 0%)';
    setTimeout(() => {
      tooltip.remove();
      ring.remove();
      arrow.remove();
      mask.remove();
    }, 300);
    if (completed) {
      try { localStorage.setItem(TOUR_STORAGE_KEY, '1'); } catch {}
    }
    document.removeEventListener('keydown', handleKey);
    window.removeEventListener('resize', handleResize);
    if (onComplete) onComplete();
  }

  /** Keyboard navigation */
  function handleKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); goToStep(currentStep + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); goToStep(currentStep - 1); }
  }

  /** Reposition on resize/scroll */
  function handleResize() {
    const step = TOUR_STEPS[currentStep];
    const rect = getTargetRect(step.selector);
    if (rect) {
      positionSpotlight(rect);
      positionTooltip(rect, step);
    }
  }

  // Click on mask = skip
  mask.addEventListener('click', () => finish(false));

  document.addEventListener('keydown', handleKey);
  window.addEventListener('resize', handleResize);
  window.addEventListener('scroll', handleResize, true);

  // Start at step 0
  goToStep(0);
}

/**
 * Check if the tour has been completed/dismissed.
 */
export function isTourCompleted() {
  try { return localStorage.getItem(TOUR_STORAGE_KEY) === '1'; }
  catch { return false; }
}

/**
 * Reset tour state (for re-triggering).
 */
export function resetTour() {
  try { localStorage.removeItem(TOUR_STORAGE_KEY); } catch {}
}

/**
 * Start tour if not yet completed.
 */
export function startTourIfNeeded() {
  if (!isTourCompleted()) {
    startTour();
  }
}
