#!/usr/bin/env node
// ============================================================================
// run-chats.mjs — the mic-less simulation DRIVER.
// ----------------------------------------------------------------------------
// Opens N concurrent WebSocket "chats" to the running copilot server
// (ws://localhost:8787/ws — WS_PATH is '/ws', confirmed from packages/contract),
// configures each with a DISTINCT feature mix + a sim transcript script, kicks
// off `audio-control start` (source 'mic'), and logs EVERY server message. The
// 'sim' ASR provider on the server then replays the script with speaker ids, so
// the whole cross-chat / auto-followup / 30s-interval / multi-speaker pipeline
// runs WITHOUT a microphone.
//
// Per chat it tracks + prints at the end: #transcripts, #partial/#final, distinct
// speakerIds seen, #progress, #result (auto vs manual via trigger), #hard/#transient
// errors, #'skipped', #reconnects. It splits server errors into:
//   - TRANSIENT (retryable: rate-limit/timeout/5xx/overload, or a 'skipped:' from
//     the analyze pipeline declining) — logged + counted, self-heals, NOT a fail.
//   - HARD (validation / unexpected / malformed) — a real anomaly that FAILS.
// HARD structural checks (also fail the verdict):
//   - multi-speaker collapse (a diarized chat that only ever saw ONE speakerId)
//   - cross-chat leakage (a result whose content matches ANOTHER chat's script,
//     or a requestId seen on a different chat's socket)
//   - no transcript at all (sim provider never replayed)
//   - auto NEVER firing — but only when the run was long enough to expect a fire
//     (interval: cadence+60s, agent: ~120s); shorter runs downgrade it to a NOTE.
//
// Built to survive a LONG continuous run (target 2h): a socket close/error while
// the run is still going triggers a backoff RECONNECT (re-sends the full
// configure + roles + start handshake) instead of ending the chat — only the
// duration timer finishes it. A HEARTBEAT line is appended every 60s for
// observability (tail logs/run.log to watch health). Finally it prints a per-chat
// SUMMARY table + an OVERALL PASS/ISSUES verdict (PASS = 0 HARD issues) plus a
// transient (self-healed) line so retryable hiccups are visible without failing.
//
// Usage:  node scripts/sim/run-chats.mjs [--chats N] [--duration-sec S] [--interval-ms MS]
// ============================================================================

import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, 'fixtures');
const LOGS_DIR = resolve(__dirname, 'logs');
const WS_URL = process.env.SIM_WS_URL || 'ws://localhost:8787/ws';

function parseArgs(argv) {
  const args = { chats: 3, durationSec: 120, intervalMs: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--chats') args.chats = Math.max(1, parseInt(argv[++i], 10) || 3);
    else if (a === '--duration-sec') args.durationSec = Math.max(5, parseInt(argv[++i], 10) || 120);
    // Override the interval cadence used by interval-mode chats. Lets a long
    // (e.g. 2h) run use a gentler cadence to limit DeepSeek API spend.
    else if (a === '--interval-ms') {
      const v = parseInt(argv[++i], 10);
      if (Number.isFinite(v) && v > 0) args.intervalMs = Math.max(1000, v);
    }
  }
  return args;
}

function loadFixture(idx) {
  const file = resolve(FIXTURES_DIR, `interview-${idx}.json`);
  if (!existsSync(file)) return null;
  try {
    const arr = JSON.parse(readFileSync(file, 'utf8'));
    if (Array.isArray(arr) && arr.length) return arr;
  } catch {
    /* fall through */
  }
  return null;
}

// A distinct feature mix per chat (cycled if --chats > 3). Exercises agent mode,
// 30s interval, and a faster 15s interval on a different mode — the three paths
// the user wants to debug.
function chatConfig(idx, script, intervalOverride) {
  // When --interval-ms is passed, override the per-mix autoIntervalMs of the
  // interval-mode chats (agent mode has no interval, so it's unaffected). The
  // label is rewritten to reflect the effective cadence so logs/summary match.
  const i30 = intervalOverride || 30000;
  const i15 = intervalOverride || 15000;
  const mixes = [
    {
      label: 'expert / agent / diarize',
      config: { asrProvider: 'sim', mode: 'expert', autoGenerate: true, autoMode: 'agent', diarize: true, simScript: script }
    },
    {
      label: `expert / interval@${Math.round(i30 / 1000)}s / diarize`,
      config: { asrProvider: 'sim', mode: 'expert', autoGenerate: true, autoMode: 'interval', autoIntervalMs: i30, diarize: true, simScript: script }
    },
    {
      label: `expert2 / interval@${Math.round(i15 / 1000)}s / diarize`,
      config: { asrProvider: 'sim', mode: 'expert2', autoGenerate: true, autoMode: 'interval', autoIntervalMs: i15, diarize: true, simScript: script }
    }
  ];
  return mixes[idx % mixes.length];
}

const now = () => new Date().toISOString();
const elapsed = (start) => `${((Date.now() - start) / 1000).toFixed(1)}s`;

// Short, comparable fingerprint of a chat's script content — used to detect
// cross-chat leakage (a result/transcript carrying ANOTHER chat's words).
function scriptFingerprints(script) {
  // Use a few distinctive substrings from the candidate turns.
  return script
    .filter((t) => t.speakerId === 1 && t.text.length >= 8)
    .map((t) => t.text.slice(0, 12))
    .slice(0, 6);
}

// Classify a server `type:'error'` message. TRANSIENT errors are retryable
// (rate-limit / timeout / upstream 5xx / overload) or a `skipped:` from the
// analyze pipeline declining — both are normal-ish and self-heal, so they are
// logged + counted but do NOT fail the verdict. Everything else is HARD.
const TRANSIENT_RE = /429|rate.?limit|timeout|timed out|ECONN|ETIMEDOUT|socket hang up|503|502|500|temporarily|overload|too many/i;
function classifyError(message) {
  const m = String(message || '');
  if (m.startsWith('skipped:')) return 'skipped';
  if (TRANSIENT_RE.test(m)) return 'transient';
  return 'hard';
}

// How long before we should reasonably EXPECT an auto fire, given the mode.
// For interval mode: one cadence + 60s slack. For agent mode: ~120s. Used to
// decide whether AUTO-NOT-FIRING is a hard issue or just a NOTE on short runs.
function autoFireWindowMs(cfg) {
  if (cfg.autoMode === 'interval') return (cfg.autoIntervalMs || 30000) + 60000;
  return 120000; // agent
}

function makeChat(idx, script, durationMs, combinedLog, intervalOverride) {
  const { label, config } = chatConfig(idx, script, intervalOverride);
  const logFile = resolve(LOGS_DIR, `chat-${idx}.log`);
  writeFileSync(logFile, `# chat ${idx} — ${label}\n# ${now()}\n`, 'utf8');

  const start = Date.now();
  const stats = {
    idx,
    label,
    transcripts: 0,
    partial: 0,
    final: 0,
    speakerIds: new Set(),
    progress: 0,
    results: 0,
    resultsAuto: 0,
    resultsManual: 0,
    errors: 0,
    skipped: 0,
    transientErrors: 0, // retryable server errors (rate-limit/timeout/5xx/overload)
    hardErrors: 0, // non-transient server errors (validation, unexpected, malformed)
    reconnects: 0, // WS drops we recovered from (NOT a hard failure)
    firstAutoMs: null,
    firstResultMs: null,
    requestIds: new Set(),
    anomalies: []
  };

  function log(line) {
    const entry = `[${elapsed(start)}] [chat${idx}] ${line}`;
    appendFileSync(logFile, entry + '\n');
    appendFileSync(combinedLog, entry + '\n');
  }

  function flag(msg) {
    stats.anomalies.push(msg);
    log(`ANOMALY: ${msg}`);
  }

  const myFingerprints = scriptFingerprints(script);

  return new Promise((resolveChat) => {
    let ws;
    let durationTimer = null; // fires ONCE at run end -> the only real finish()
    let heartbeatTimer = null;
    let reconnectTimer = null;
    let settled = false;
    let connecting = false; // guard so close+error don't double-schedule a reconnect
    // Backoff schedule for reconnects: 1s, 2s, 5s, then capped at 10s.
    const BACKOFFS = [1000, 2000, 5000, 10000];

    function clearTimers() {
      if (durationTimer) clearTimeout(durationTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      durationTimer = heartbeatTimer = reconnectTimer = null;
    }

    function finish(reason) {
      if (settled) return;
      settled = true;
      clearTimers();
      try {
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) ws.close();
      } catch {
        /* ignore */
      }
      log(`closed (${reason})`);
      resolveChat(stats);
    }

    // The run's hard deadline. When this fires we stop reconnecting and finish
    // cleanly — this is the ONLY path that resolves the chat during a healthy run.
    durationTimer = setTimeout(() => finish('duration-elapsed'), durationMs);

    // HEARTBEAT: emit a health line every 60s so someone tailing run.log can
    // watch a long (e.g. 2h) run stay alive.
    heartbeatTimer = setInterval(() => {
      if (settled) return;
      const spk = [...stats.speakerIds].sort().join(',') || 'none';
      log(
        `HEARTBEAT t=${elapsed(start)} results=${stats.results}(auto=${stats.resultsAuto}) ` +
          `transient=${stats.transientErrors} reconnects=${stats.reconnects} spk={${spk}}`
      );
    }, 60000);

    // Schedule a reconnect after a drop, UNLESS the run is already over. A drop
    // is NOT a hard failure: we re-open and re-send the full handshake.
    function scheduleReconnect(reason) {
      if (settled) return; // duration elapsed (or finishing) — let it end
      if (connecting) return; // a connect attempt is already in flight
      stats.reconnects += 1;
      const n = stats.reconnects;
      const delay = BACKOFFS[Math.min(n - 1, BACKOFFS.length - 1)];
      log(`RECONNECT #${n} (${reason}) — retrying in ${delay}ms`);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (settled) return;
        connect();
      }, delay);
    }

    // (Re)open the socket and wire all handlers. Called once initially and again
    // on every reconnect; re-sends the same configure + roles + start handshake.
    function connect() {
      connecting = true;
      try {
        ws = new WebSocket(WS_URL);
      } catch (err) {
        connecting = false;
        const reason = `ctor-error: ${err && err.message ? err.message : err}`;
        log(`<= ${reason}`);
        scheduleReconnect(reason);
        return;
      }

      ws.on('open', () => {
        connecting = false;
        log(`OPEN -> ${WS_URL}  mix="${label}"`);
        // 1) configure with the distinct mix + sim script.
        ws.send(JSON.stringify({ type: 'configure', config }));
        // 2) Tell the server speaker 1 is the candidate so AGENT-mode auto (which
        //    only feeds CANDIDATE finals) has a chance to fire. Interval mode feeds
        //    every final regardless, so this is mainly for chat0 (agent).
        ws.send(JSON.stringify({ type: 'set-speaker-role', speakerId: 1, role: 'candidate' }));
        ws.send(JSON.stringify({ type: 'set-speaker-role', speakerId: 0, role: 'interviewer' }));
        // 3) Start capture on the mic lane — this registers the sim session so the
        //    relay reports isCapturing()=true, which arms the auto-trigger gate.
        ws.send(JSON.stringify({ type: 'audio-control', action: 'start', source: 'mic' }));
        log('sent: configure + set-speaker-role x2 + audio-control(start,mic)');
      });

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        log(`RAW(non-json): ${String(raw).slice(0, 120)}`);
        return;
      }
      const t = msg.type;
      if (t === 'ready') {
        log(`<= ready sessionId=${msg.sessionId}`);
      } else if (t === 'transcript') {
        stats.transcripts += 1;
        if (msg.isFinal) stats.final += 1;
        else stats.partial += 1;
        if (typeof msg.speakerId === 'number') stats.speakerIds.add(msg.speakerId);
        // Detect a leaked ASR-error transcript (the relay surfaces provider errors
        // as a non-final transcript "[... error ...]").
        if (typeof msg.text === 'string' && /\[(ASR|Sim|Doubao|Xunfei)[^\]]*\]/i.test(msg.text)) {
          flag(`provider-error transcript: ${msg.text}`);
        }
        // Only log finals + the occasional partial to keep the log readable.
        if (msg.isFinal) {
          log(`<= transcript FINAL src=${msg.source} spk=${msg.speakerId ?? '-'} role=${msg.speaker ?? '-'} "${String(msg.text).slice(0, 40)}"`);
        }
      } else if (t === 'progress') {
        stats.progress += 1;
        if (msg.requestId) stats.requestIds.add(msg.requestId);
        log(`<= progress req=${msg.requestId} phase=${msg.phase} ${msg.index}/${msg.total} ${msg.status}`);
      } else if (t === 'result') {
        stats.results += 1;
        if (stats.firstResultMs === null) stats.firstResultMs = Date.now() - start;
        const trig = msg.trigger || 'manual';
        if (trig === 'auto') {
          stats.resultsAuto += 1;
          if (stats.firstAutoMs === null) stats.firstAutoMs = Date.now() - start;
        } else {
          stats.resultsManual += 1;
        }
        if (msg.requestId) stats.requestIds.add(msg.requestId);
        const primary = (msg.output && msg.output.primary_question) || '';
        const rankedN = Array.isArray(msg.ranked) ? msg.ranked.length : 0;
        log(`<= RESULT req=${msg.requestId} trigger=${trig} mode=${msg.mode} ranked=${rankedN} primary="${String(primary).slice(0, 50)}"`);
        // Cross-chat leakage check: does this result echo ANOTHER chat's script?
        const blob = JSON.stringify(msg).slice(0, 4000);
        for (let other = 0; other < ALL_FINGERPRINTS.length; other += 1) {
          if (other === idx) continue;
          for (const fp of ALL_FINGERPRINTS[other]) {
            if (fp && blob.includes(fp)) {
              flag(`CROSS-CHAT leakage: result content matches chat${other}'s script fragment "${fp}"`);
            }
          }
        }
      } else if (t === 'error') {
        stats.errors += 1;
        const m = String(msg.message || '');
        const kind = classifyError(m);
        if (kind === 'skipped') {
          // The analyze pipeline declining is normal — log it, count it, but it
          // does NOT fail the verdict.
          stats.skipped += 1;
          log(`<= TRANSIENT(skipped) req=${msg.requestId ?? '-'} message="${m}"`);
        } else if (kind === 'transient') {
          // Retryable upstream hiccup (rate-limit / timeout / 5xx / overload).
          // Logged + counted, self-heals, NOT a verdict failure.
          stats.transientErrors += 1;
          log(`<= TRANSIENT req=${msg.requestId ?? '-'} message="${m}"`);
        } else {
          // HARD error (validation, unexpected exception, malformed) — a real
          // anomaly that fails the verdict.
          stats.hardErrors += 1;
          flag(`HARD error message: "${m}" (req=${msg.requestId ?? '-'})`);
          log(`<= ERROR(hard) req=${msg.requestId ?? '-'} message="${m}"`);
        }
      } else if (t === 'session-context') {
        log('<= session-context');
      } else {
        log(`<= unknown type=${t}`);
      }
    });

      // A socket-level error is a TRANSPORT drop, not a verdict failure: the
      // 'close' that follows drives the reconnect. (If 'error' fires without a
      // following 'close', scheduleReconnect's `connecting` guard de-dupes.)
      ws.on('error', (err) => {
        const reason = err && err.message ? err.message : String(err);
        log(`<= socket-error ${reason}`);
        if (!settled && (!ws || ws.readyState === WebSocket.CLOSED)) {
          connecting = false;
          scheduleReconnect(`error:${reason}`);
        }
      });

      ws.on('close', (code) => {
        connecting = false;
        log(`<= socket close code=${code}`);
        // While the run is still going, a close means RECONNECT — not finish.
        // finish() only happens when the duration timer fires.
        if (!settled) scheduleReconnect(`close(${code})`);
      });
    }

    // Kick off the first connection.
    connect();
  });
}

// Shared across chats so each chat can compare a result against the OTHER chats'
// fingerprints. Filled in main() before chats start receiving results.
let ALL_FINGERPRINTS = [];

async function main() {
  const args = parseArgs(process.argv.slice(2));
  mkdirSync(LOGS_DIR, { recursive: true });
  const combinedLog = resolve(LOGS_DIR, 'run.log');
  writeFileSync(combinedLog, `# run.log — ${now()}  chats=${args.chats} duration=${args.durationSec}s  url=${WS_URL}\n`, 'utf8');

  // Load (or fall back per chat to) fixtures. Each chat gets a DISTINCT script so
  // cross-chat leakage is detectable.
  const scripts = [];
  for (let i = 0; i < args.chats; i += 1) {
    let s = loadFixture(i);
    if (!s) {
      // Reuse fixture 0 with an index marker so the chat still runs AND stays
      // distinguishable for the leakage check.
      const base = loadFixture(0) || [
        { speakerId: 0, text: `占位提问 chat${i}` },
        { speakerId: 1, text: `占位回答 chat${i}，这是兜底脚本。` }
      ];
      s = base.map((t) => ({ ...t, text: `【chat${i}】${t.text}` }));
      console.warn(`chat${i}: fixture interview-${i}.json missing — using a marked copy of interview-0.`);
    }
    scripts.push(s);
  }
  ALL_FINGERPRINTS = scripts.map(scriptFingerprints);

  console.log(`run-chats: ${args.chats} chat(s), ${args.durationSec}s, url=${WS_URL}` +
    (args.intervalMs ? `, interval-override=${args.intervalMs}ms` : ''));
  console.log(`logs: ${LOGS_DIR}/chat-<n>.log + run.log\n`);

  const durationMs = args.durationSec * 1000;
  const chats = [];
  for (let i = 0; i < args.chats; i += 1) {
    chats.push(makeChat(i, scripts[i], durationMs, combinedLog, args.intervalMs));
  }
  const allStats = await Promise.all(chats);

  printSummary(allStats, args, combinedLog);
}

function printSummary(allStats, args, combinedLog) {
  const lines = [];
  const out = (s) => {
    lines.push(s);
    console.log(s);
  };

  out('\n========================= PER-CHAT SUMMARY =========================');
  // Columns: tx/part/fin transcripts, distinct speakers, progress, results
  // (auto/man), HARD errors, transient (rate-limit/timeout/5xx), skipped,
  // reconnects, time-to-first-auto.
  const cols = ['tx', 'part', 'fin', 'spk', 'prog', 'res', 'auto', 'man', 'hard', 'tran', 'skip', 'recon'];
  out('chat'.padEnd(4) + 'mix'.padEnd(34) + cols.map((h) => h.padStart(6)).join('') + '  ' + '1stAuto');
  for (const s of allStats) {
    const spk = [...s.speakerIds].sort().join('|') || '-';
    const firstAuto = s.firstAutoMs === null ? 'never' : `${(s.firstAutoMs / 1000).toFixed(1)}s`;
    out(
      String(s.idx).padEnd(4) +
        s.label.slice(0, 33).padEnd(34) +
        [s.transcripts, s.partial, s.final, spk, s.progress, s.results, s.resultsAuto, s.resultsManual, s.hardErrors, s.transientErrors, s.skipped, s.reconnects]
          .map((v) => String(v).padStart(6))
          .join('') +
        '  ' +
        firstAuto
    );
  }

  // --- derived anomaly flags (post-run) ------------------------------------
  // HARD issues fail the verdict; NOTES are informational only (e.g. a short
  // smoke run where auto wasn't given enough time to fire).
  out('\n========================= ANOMALIES =========================');
  let totalIssues = 0; // HARD only
  const notes = [];
  const durationMs = args.durationSec * 1000;

  const requestIdOwners = new Map(); // requestId -> [chatIdx,...]
  for (const s of allStats) {
    for (const rid of s.requestIds) {
      if (!requestIdOwners.has(rid)) requestIdOwners.set(rid, []);
      requestIdOwners.get(rid).push(s.idx);
    }
  }
  // requestId appearing on >1 chat socket = cross-chat leakage. HARD.
  for (const [rid, owners] of requestIdOwners) {
    if (owners.length > 1) {
      out(`  [CROSS-CHAT] requestId ${rid} seen on chats ${owners.join(',')}`);
      totalIssues += 1;
    }
  }

  for (const s of allStats) {
    const cfg = chatConfig(s.idx, [], args.intervalMs).config;
    // auto-never-fired: only HARD when the run was long enough to expect a fire.
    // For interval mode that's (cadence + 60s); for agent ~120s. Shorter runs
    // (smoke tests) downgrade this to a NOTE so it isn't noise.
    if (s.resultsAuto === 0) {
      const windowMs = autoFireWindowMs(cfg);
      if (durationMs >= windowMs) {
        out(`  [AUTO-NOT-FIRING] chat${s.idx} (${s.label}): no result with trigger:'auto' in ${args.durationSec}s (expected within ${Math.round(windowMs / 1000)}s)`);
        totalIssues += 1;
      } else {
        notes.push(`  [NOTE] chat${s.idx} (${s.label}): no auto fire yet, but run (${args.durationSec}s) < expected window (${Math.round(windowMs / 1000)}s) — not a failure`);
      }
    }
    // multi-speaker collapse: diarized chat that only ever saw ONE speaker id. HARD.
    if (s.speakerIds.size <= 1) {
      out(`  [MULTI-SPEAKER-COLLAPSE] chat${s.idx}: saw speakerIds {${[...s.speakerIds].join(',') || 'none'}} (expected 0 AND 1)`);
      totalIssues += 1;
    }
    // no transcript at all = the sim provider never replayed (wiring problem). HARD.
    if (s.transcripts === 0) {
      out(`  [NO-TRANSCRIPT] chat${s.idx}: server emitted ZERO transcripts (sim provider not replaying?)`);
      totalIssues += 1;
    }
    // surface every per-message HARD anomaly collected live (hard errors,
    // leakage, provider-error transcripts). Transients/skips/reconnects are NOT
    // in here — they're tracked separately and reported as self-healed below.
    for (const a of s.anomalies) {
      out(`  [chat${s.idx}] ${a}`);
      totalIssues += 1;
    }
  }
  if (totalIssues === 0) out('  (no HARD issues)');
  if (notes.length) {
    out('  --- notes (informational, not failures) ---');
    for (const n of notes) out(n);
  }

  const totTransient = allStats.reduce((n, s) => n + s.transientErrors, 0);
  const totSkipped = allStats.reduce((n, s) => n + s.skipped, 0);
  const totReconnects = allStats.reduce((n, s) => n + s.reconnects, 0);

  const verdict = totalIssues === 0 ? 'PASS' : `ISSUES (${totalIssues} HARD flagged)`;
  out('\n========================= OVERALL VERDICT =========================');
  out(`  ${verdict}  (PASS = 0 HARD issues)`);
  out(`  totals: ${allStats.reduce((n, s) => n + s.results, 0)} results ` +
    `(${allStats.reduce((n, s) => n + s.resultsAuto, 0)} auto / ${allStats.reduce((n, s) => n + s.resultsManual, 0)} manual), ` +
    `${allStats.reduce((n, s) => n + s.hardErrors, 0)} hard errors`);
  out(`  transient (self-healed): ${totTransient} rate-limit/timeout, ${totSkipped} skipped, ${totReconnects} reconnects`);
  out('===================================================================');

  appendFileSync(combinedLog, '\n' + lines.join('\n') + '\n');
}

main().catch((err) => {
  console.error('run-chats FATAL:', err && err.stack ? err.stack : err);
  process.exit(1);
});
