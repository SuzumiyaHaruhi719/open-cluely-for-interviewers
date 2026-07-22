import { createDeck } from './deck.mjs';

const root = document;
const hint = root.querySelector('#key-hint');
const productFrame = root.querySelector('.live-demo-frame');
const productFramePayload = root.querySelector('#product-frame-payload');

function decodeBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

if (productFrame && productFramePayload) {
  productFrame.srcdoc = new TextDecoder().decode(
    decodeBase64(productFramePayload.textContent.trim())
  );
}

const sendToProduct = (message) => {
  productFrame?.contentWindow?.postMessage(message, '*');
};

const deck = createDeck({
  root,
  onSlideChange: ({ id, previousId }) => {
    if (previousId === 'p8-demo' && id !== 'p8-demo') sendToProduct('pause-product-frame');
  }
});

const markDeckUsed = () => hint.classList.add('is-used');
root.querySelectorAll('#deck-prev, #deck-next').forEach((button) => button.addEventListener('click', markDeckUsed));

root.addEventListener('keydown', (event) => {
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

  if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
    event.preventDefault();
    deck.previous();
    markDeckUsed();
  }
  if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') {
    event.preventDefault();
    deck.next();
    markDeckUsed();
  }
  if (event.key === 'Home') {
    event.preventDefault();
    deck.show(0);
    markDeckUsed();
  }
  if (event.key === 'End') {
    event.preventDefault();
    deck.show(8);
    markDeckUsed();
  }
});

root.querySelector('#close-replay').addEventListener('click', () => {
  deck.show(3);
  sendToProduct('reset-product-frame');
});
root.querySelector('#close-home').addEventListener('click', () => deck.show(0));

root.querySelectorAll('[data-real-product-url]').forEach((button) => {
  button.addEventListener('click', () => window.open(button.dataset.realProductUrl, '_blank', 'noopener'));
});
