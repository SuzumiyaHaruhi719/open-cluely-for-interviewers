#!/usr/bin/env bash
#
# capture-readme-media.sh — reproducibly capture the README media for Interviewer Copilot.
#
# Captures live frames from the running app with the gstack `browse` headless browser,
# then encodes smooth, optimized GIFs with ffmpeg (lanczos scale + a generated palette).
#
# Requirements:
#   - The app running in production on http://localhost:8787 (cd web-app && npm run dev/start)
#   - ffmpeg on PATH (this repo was authored against ffmpeg 8.x).
#   - The gstack browse binary at: ~/.claude/skills/gstack/browse/dist/browse
#
# Output: PNG frame sequences under .tmp-readme-frames/, encoded GIFs/PNGs into .github/assets/.
#
# NOTE ON FRAME RATE: the headless screenshot ceiling is ~5 fps, and a few elements (the
# determinate progress bar) advance in discrete per-phase steps. The progress card also
# renders a LIVE TIMER (updates every 100ms), so sampling the generation across its full
# ~35s duration yields ~30 unique frames whose timer/label/tokens change frame-to-frame —
# encoded at 15 fps that reads as smooth motion. The résumé rail is hidden during the hero
# capture (a DOM-only, capture-time tweak — no app code is modified) so the progress card's
# timer + token meta is on-screen.
#
set -euo pipefail

BROWSE="${BROWSE:-$HOME/.claude/skills/gstack/browse/dist/browse}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_URL="${APP_URL:-http://localhost:8787}"
FRAMES="$ROOT/.tmp-readme-frames"
ASSETS="$ROOT/.github/assets"
SAMPLE="rich-backend-zh"   # built-in résumé + JD + transcript
ANSWER="I cut p99 latency from 4s to 800ms with a Redis+Celery queue and a Saga compensator for duplicate shipments."

mkdir -p "$FRAMES" "$ASSETS"

b() { "$BROWSE" "$@" >/dev/null 2>&1 || true; }
js() { "$BROWSE" js "$1" >/dev/null 2>&1 || true; }
sleepjs() { "$BROWSE" js "new Promise(r=>setTimeout(()=>r(1),$1))" >/dev/null 2>&1 || true; }
HIDE_RAIL="(()=>{const r=document.querySelector('aside.right-rail');if(r)r.style.display='none';})()"

# Seed a live interview: New interview -> sample -> online card (loads résumé/JD/transcript),
# then fill the manual answer buffer + Add (this enables the Generate Q button).
seed() {
  b goto "$APP_URL"; sleepjs 1800
  b click "#btn-new-interview"; sleepjs 450
  b select "#interview-sample-select" "$SAMPLE"; sleepjs 350
  b click '[data-interview-type="online"]'; sleepjs 1500
}
fill_and_add() {
  b fill ".chat-manual-input" "$ANSWER"; sleepjs 250
  js "[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Add')?.click()"; sleepjs 450
}
trigger() {
  js "[...document.querySelectorAll('button')].find(b=>/generate q/i.test(b.textContent||''))?.click()"
}

# ── HERO: live Generate-Q flow (progress animating -> scored + ranked question card) ──────
capture_hero() {
  local P="$FRAMES/herofin"; mkdir -p "$P"; rm -f "$P"/*.png 2>/dev/null || true
  seed
  js "$HIDE_RAIL"; sleepjs 200          # reveal the progress timer/token meta
  fill_and_add
  trigger
  # Sample across the full generation (~430ms cadence is light enough to avoid the
  # headless page-recreate watchdog, dense enough to catch every phase + many timer ticks).
  local i=0 q=0 n=0
  while [ "$n" -lt 90 ]; do
    js "$HIDE_RAIL"
    "$BROWSE" screenshot --viewport "$(printf '%s/h_%04d.png' "$P" "$i")" >/dev/null 2>&1 || true
    q=$("$BROWSE" js "(()=>document.querySelector('.is-question-card')?1:0)()" 2>/dev/null | tr -d '\r ' || echo 0)
    i=$((i+1)); n=$((n+1))
    [ "$q" = "1" ] && break
    sleepjs 430
  done
  # Capture the finished scored card, then the expanded ranked list (rail still hidden).
  js "$HIDE_RAIL"; sleepjs 300
  js "document.querySelector('.is-question-card')?.scrollIntoView({block:'start'})"; sleepjs 400
  js "$HIDE_RAIL"; "$BROWSE" screenshot --viewport "$P/card_01.png" >/dev/null 2>&1 || true
  js "(()=>{const d=document.querySelector('.question-card__ranked');if(d)d.open=true;})()"; sleepjs 300
  js "document.querySelector('.is-question-card')?.scrollIntoView({block:'start'})"; sleepjs 250
  js "$HIDE_RAIL"; "$BROWSE" screenshot --viewport "$P/ranked_01.png" >/dev/null 2>&1 || true
}

encode_hero() {
  local P="$FRAMES/herofin" SRC="$FRAMES/herofin/src" CROP="crop=1052:430:272:90"
  mkdir -p "$SRC"; rm -f "$SRC"/*.png 2>/dev/null || true
  local idx=0 f base
  # progress frames (skip the generic pre-phase frame 0), cropped to the chat column
  for f in $(ls "$P"/h_*.png | sort); do
    base=$(basename "$f"); [ "$base" = "h_0000.png" ] && continue
    ffmpeg -y -i "$f" -vf "$CROP" "$(printf '%s/s_%05d.png' "$SRC" "$idx")" >/dev/null 2>&1; idx=$((idx+1))
  done
  local pend=$idx k
  for k in 1 2 3; do cp "$(printf '%s/s_%05d.png' "$SRC" $((pend-1)))" "$(printf '%s/s_%05d.png' "$SRC" "$idx")"; idx=$((idx+1)); done
  ffmpeg -y -i "$P/card_01.png"   -vf "$CROP" "$FRAMES/_c.png" >/dev/null 2>&1
  ffmpeg -y -i "$P/ranked_01.png" -vf "$CROP" "$FRAMES/_r.png" >/dev/null 2>&1
  for k in $(seq 1 28); do cp "$FRAMES/_c.png" "$(printf '%s/s_%05d.png' "$SRC" "$idx")"; idx=$((idx+1)); done
  for k in $(seq 1 30); do cp "$FRAMES/_r.png" "$(printf '%s/s_%05d.png' "$SRC" "$idx")"; idx=$((idx+1)); done
  # 15 fps over all-unique progress frames => smooth + readable; generated palette, light dither.
  ffmpeg -y -framerate 15 -i "$SRC/s_%05d.png" \
    -vf "scale=900:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=224:stats_mode=full[p];[s1][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle" \
    "$ASSETS/hero-generate-q.gif"
  # Crisp standalone stills from the same frames.
  ffmpeg -y -i "$P/card_01.png"   -vf "crop=1052:412:272:96" "$ASSETS/scored-followup.png"
  ffmpeg -y -i "$P/ranked_01.png" -vf "crop=1052:430:272:96" "$ASSETS/ranked-candidates.png"
}

# ── QUESTION BANK: semantic search typing + ranked results ────────────────────────────────
capture_bank() {
  local P="$FRAMES/bank"; mkdir -p "$P"; rm -f "$P"/*.png 2>/dev/null || true
  b goto "$APP_URL"; sleepjs 1700
  js "[...document.querySelectorAll('.history-row__title')].find(e=>/Question bank/i.test(e.textContent||''))?.closest('button,div')?.click()"; sleepjs 700
  js "[...document.querySelectorAll('.mode-toggle button,[role=tab]')].find(b=>/semantic/i.test(b.textContent||''))?.click()"; sleepjs 500
  local q="分布式锁" acc="" sel=".qbank-search input" fi=0 c
  "$BROWSE" screenshot --viewport "$(printf '%s/b_%04d.png' "$P" "$fi")" >/dev/null 2>&1; fi=$((fi+1))
  for ((c=0;c<${#q};c++)); do
    acc="${q:0:c+1}"
    js "(()=>{const el=document.querySelector('$sel');if(!el)return;const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;set.call(el,'$acc');el.dispatchEvent(new Event('input',{bubbles:true}));})()"
    sleepjs 130
    "$BROWSE" screenshot --viewport "$(printf '%s/b_%04d.png' "$P" "$fi")" >/dev/null 2>&1; fi=$((fi+1))
    "$BROWSE" screenshot --viewport "$(printf '%s/b_%04d.png' "$P" "$fi")" >/dev/null 2>&1; fi=$((fi+1))
  done
  sleepjs 350
  for c in $(seq 1 16); do
    "$BROWSE" screenshot --viewport "$(printf '%s/b_%04d.png' "$P" "$fi")" >/dev/null 2>&1; fi=$((fi+1)); sleepjs 120
  done
}
encode_bank() {
  local P="$FRAMES/bank" SEQ="$FRAMES/bank/seq"; mkdir -p "$SEQ"; rm -f "$SEQ"/*.png 2>/dev/null || true
  local idx=0 f s last
  for f in $(ls "$P"/b_*.png | sort); do
    s=$(stat -c%s "$f"); if [ "$s" -gt 100000 ]; then cp "$f" "$(printf '%s/s_%04d.png' "$SEQ" "$idx")"; idx=$((idx+1)); fi
  done
  last=$((idx-1)); local k
  for k in $(seq 1 12); do cp "$(printf '%s/s_%04d.png' "$SEQ" "$last")" "$(printf '%s/s_%04d.png' "$SEQ" "$idx")"; idx=$((idx+1)); done
  # No dither keeps flat-UI GIFs small; crop off the résumé rail; 14 fps.
  ffmpeg -y -framerate 14 -i "$SEQ/s_%04d.png" \
    -vf "crop=952:720:0:0,scale=820:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128:stats_mode=full[p];[s1][p]paletteuse=dither=none" \
    "$ASSETS/question-bank-search.gif"
}

# ── AUTO pill toggle (topbar) ─────────────────────────────────────────────────────────────
capture_auto() {
  local P="$FRAMES/auto"; mkdir -p "$P"; rm -f "$P"/*.png 2>/dev/null || true
  seed
  local fi=0 n
  shot() { "$BROWSE" screenshot --viewport "$(printf '%s/a_%04d.png' "$P" "$fi")" >/dev/null 2>&1; fi=$((fi+1)); }
  shot; shot
  js "document.querySelector('#auto-indicator')?.click()"; sleepjs 120; shot; sleepjs 120; shot; sleepjs 200; shot; shot
  sleepjs 250; shot; shot
  js "document.querySelector('#auto-indicator')?.click()"; sleepjs 120; shot; sleepjs 200; shot; shot
  js "document.querySelector('#auto-indicator')?.click()"; sleepjs 150; shot; shot; sleepjs 250; shot; shot
}
encode_auto() {
  local P="$FRAMES/auto" SEQ="$FRAMES/auto/seq"; mkdir -p "$SEQ"; rm -f "$SEQ"/*.png 2>/dev/null || true
  local idx=0 f s
  for f in $(ls "$P"/a_*.png | sort); do
    s=$(stat -c%s "$f"); if [ "$s" -gt 100000 ]; then cp "$f" "$(printf '%s/a_%04d.png' "$SEQ" "$idx")"; idx=$((idx+1)); fi
  done
  ffmpeg -y -framerate 12 -i "$SEQ/a_%04d.png" \
    -vf "crop=408:60:566:37,scale=760:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128:stats_mode=full[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3" \
    "$ASSETS/auto-toggle.gif"
}

# ── Static stills: Customize gallery, Pipeline Studio, full-app overview ───────────────────
capture_stills() {
  local P="$FRAMES/studio"; mkdir -p "$P"; rm -f "$P"/*.png 2>/dev/null || true
  b goto "$APP_URL"; sleepjs 1700
  b click "#btn-settings"; sleepjs 600
  js "document.querySelector('.mode-segmented__btn[data-mode=\"customize\"]')?.click()"; sleepjs 800
  js "document.querySelector('#customize-row')?.scrollIntoView({block:'center'})"; sleepjs 300
  "$BROWSE" screenshot --viewport "$P/gallery_00.png" >/dev/null 2>&1 || true
  js "document.querySelector('#open-pipeline-studio')?.click()"; sleepjs 900
  "$BROWSE" screenshot --viewport "$P/studio_02.png" >/dev/null 2>&1 || true
  # full-app overview (résumé rail visible)
  seed
  "$BROWSE" screenshot --viewport "$P/overview.png" >/dev/null 2>&1 || true
}
encode_stills() {
  local P="$FRAMES/studio"
  ffmpeg -y -i "$P/gallery_00.png" -vf "crop=684:680:298:20" "$ASSETS/customize-gallery.png"
  cp "$P/studio_02.png" "$ASSETS/pipeline-studio.png"
  cp "$P/overview.png"  "$ASSETS/app-overview.png"
}

main() {
  command -v ffmpeg >/dev/null || { echo "ffmpeg not found on PATH" >&2; exit 1; }
  capture_hero;   encode_hero
  capture_bank;   encode_bank
  capture_auto;   encode_auto
  capture_stills; encode_stills
  echo "Done. Assets written to: $ASSETS"
  ls -la "$ASSETS"
}

main "$@"
