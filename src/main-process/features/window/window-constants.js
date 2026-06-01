const WINDOW_DEFAULT_WIDTH = 1100;
const WINDOW_DEFAULT_HEIGHT = 720;
// Min width lowered so the window can be made compact (stealth overlay use). The
// layout is responsive below this: the sidebar collapses to icons (≤900px) and
// the topbar sheds informational pills so the action buttons never truncate
// (≤860/740/620px — see styles.css). 600 still fits the action trio + mode dot.
const WINDOW_MIN_WIDTH = 600;
const WINDOW_MIN_HEIGHT = 520;
const WINDOW_OPACITY_LEVEL_MIN = 1;
const WINDOW_OPACITY_LEVEL_MAX = 10;
const DEFAULT_WINDOW_OPACITY_LEVEL = 10;
const STEALTH_WINDOW_OPACITY = 0.02;

module.exports = {
  WINDOW_DEFAULT_WIDTH,
  WINDOW_DEFAULT_HEIGHT,
  WINDOW_MIN_WIDTH,
  WINDOW_MIN_HEIGHT,
  WINDOW_OPACITY_LEVEL_MIN,
  WINDOW_OPACITY_LEVEL_MAX,
  DEFAULT_WINDOW_OPACITY_LEVEL,
  STEALTH_WINDOW_OPACITY
};
