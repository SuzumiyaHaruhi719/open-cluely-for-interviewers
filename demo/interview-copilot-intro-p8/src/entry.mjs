import { createDeck } from './deck.mjs';
import { createReplayPlayer } from './player.mjs';
import { DEMO_DURATION_MS, cues, questionEvent, roleConfirmedMs } from './timeline.mjs';

const root = document;
const replayRoot = root.querySelector('#product-replay');
const audio = root.querySelector('#demo-audio');
const hint = root.querySelector('#key-hint');
let replayOwnsKeys = false;
let deck;

const player = createReplayPlayer({
  root: replayRoot,
  audio,
  timeline: { DEMO_DURATION_MS, cues, questionEvent, roleConfirmedMs },
  onStarted: () => { replayOwnsKeys = true; },
  onEnded: () => {
    replayOwnsKeys = false;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }
});

deck = createDeck({
  root,
  onSlideChange: ({ id, previousId }) => {
    if (previousId === 'p8-demo' && id !== 'p8-demo') player.pause();
    if (id !== 'p8-demo') replayOwnsKeys = false;
  }
});

const markDeckUsed = () => hint.classList.add('is-used');
root.querySelectorAll('#deck-prev, #deck-next').forEach((button) => button.addEventListener('click', markDeckUsed));

root.addEventListener('keydown', (event) => {
  const activeSlide = root.querySelector('.slide.active')?.dataset.slideId;
  const targetIsTextEntry = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName ?? '');
  const targetIsButtonActivation = event.target?.tagName === 'BUTTON' && (event.key === ' ' || event.key === 'Enter');
  if ((targetIsTextEntry || targetIsButtonActivation) && event.key !== 'Escape') return;

  if (event.key.toLowerCase() === 'f') {
    event.preventDefault();
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.();
    markDeckUsed();
    return;
  }

  if (activeSlide === 'p8-demo' && replayOwnsKeys) {
    if (event.key === ' ') { event.preventDefault(); player.toggle(); return; }
    if (event.key === 'ArrowLeft') { event.preventDefault(); player.seek(-5000); return; }
    if (event.key === 'ArrowRight') { event.preventDefault(); player.seek(5000); return; }
    if (event.key.toLowerCase() === 'm') { event.preventDefault(); player.toggleMute(); return; }
    if (event.key === 'Escape') {
      event.preventDefault();
      player.pause();
      replayOwnsKeys = false;
      root.querySelector('#deck-next').focus();
      return;
    }
  }

  if (event.key === 'ArrowLeft' || event.key === 'PageUp') { event.preventDefault(); deck.previous(); markDeckUsed(); }
  if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') { event.preventDefault(); deck.next(); markDeckUsed(); }
  if (event.key === 'Home') { event.preventDefault(); deck.show(0); markDeckUsed(); }
  if (event.key === 'End') { event.preventDefault(); deck.show(8); markDeckUsed(); }
});

replayRoot.addEventListener('pointerdown', () => {
  if (player.isStarted()) replayOwnsKeys = true;
});

root.querySelector('#theme-toggle').addEventListener('click', () => {
  const dark = replayRoot.dataset.productTheme === 'dark';
  replayRoot.dataset.productTheme = dark ? 'light' : 'dark';
  root.querySelector('#theme-toggle').setAttribute('aria-label', dark ? '切换深色主题' : '切换浅色主题');
});

root.querySelector('#close-replay').addEventListener('click', () => {
  deck.show(3);
  replayOwnsKeys = true;
  player.reset({ autoplay: true });
});
root.querySelector('#close-home').addEventListener('click', () => deck.show(0));

root.querySelectorAll('[data-real-product-url]').forEach((button) => {
  button.addEventListener('click', () => window.open(button.dataset.realProductUrl, '_blank', 'noopener'));
});
