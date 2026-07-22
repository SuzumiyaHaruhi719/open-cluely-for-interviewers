export function createDeck({ root = document, onSlideChange = () => {} } = {}) {
  const slides = [...root.querySelectorAll('[data-slide-id]')];
  const counter = root.querySelector('#deck-counter');
  const progress = root.querySelector('#deck-progress');
  const title = root.querySelector('#deck-title');
  let index = -1;

  function show(next) {
    const bounded = Math.max(0, Math.min(slides.length - 1, next));
    if (bounded === index && slides[index]?.classList.contains('is-active')) return;
    const previous = index >= 0 ? slides[index] : null;
    index = bounded;
    slides.forEach((slide, slideIndex) => slide.classList.toggle('is-active', slideIndex === index));
    counter.textContent = `${String(index + 1).padStart(2, '0')} / ${String(slides.length).padStart(2, '0')}`;
    progress.style.transform = `scaleX(${(index + 1) / slides.length})`;
    title.textContent = slides[index].dataset.slideTitle;
    if (root.body) root.body.dataset.activeSlide = slides[index].dataset.slideId;
    history.replaceState(null, '', `#${index + 1}`);
    onSlideChange({ index, id: slides[index].dataset.slideId, previousId: previous?.dataset.slideId });
  }

  const fromHash = Number.parseInt(location.hash.slice(1), 10);
  const initialIndex = Number.isFinite(fromHash) ? Math.max(0, Math.min(slides.length - 1, fromHash - 1)) : 0;
  root.querySelector('#deck-prev').addEventListener('click', () => show(index - 1));
  root.querySelector('#deck-next').addEventListener('click', () => show(index + 1));
  show(initialIndex);

  return { show, next: () => show(index + 1), previous: () => show(index - 1), getIndex: () => index };
}
