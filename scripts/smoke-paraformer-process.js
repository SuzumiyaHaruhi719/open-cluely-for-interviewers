// End-to-end smoke: wire Paraformer service + process-loopback service the
// same way start-application.js does, spawn a PowerShell TTS as a child,
// capture its audio per-process via the application-loopback sidecar, pump
// it through Paraformer over the wire, and report partial/final transcripts.
//
// PASS condition:
//   - Paraformer WebSocket opens (task-started)
//   - At least one chunk is acknowledged
//   - No error / fatal closes during the run
//   - Bonus: at least one partial transcript on the 'system' source
//
// We pin Node's built-in WebSocket onto global, then directly invoke the
// same factory + handleAudioChunk path the main process uses.

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

// Use the `ws` npm package's WebSocket — same one main process uses. Node's
// native global WebSocket follows the W3C event-target API which doesn't
// match paraformer-service's `.on('message', ...)` calls.
const WebSocket = require('ws');

const APP_STATE_PATH = path.resolve(__dirname, '..', 'cache', 'app-state.json');
const appState = JSON.parse(fs.readFileSync(APP_STATE_PATH, 'utf8'));
if (!appState.dashscopeApiKey) {
  console.error('No dashscopeApiKey in cache/app-state.json — cannot smoke-test Paraformer.');
  process.exit(2);
}

const { createParaformerService } = require(path.resolve(__dirname, '..', 'src', 'services', 'paraformer', 'service.js'));
const { createProcessLoopbackService } = require(path.resolve(__dirname, '..', 'src', 'services', 'process-loopback', 'service.js'));

const events = {
  partials: 0,
  finals: 0,
  errors: 0,
  statuses: [],
  finalTexts: [],
  debugEntries: 0,
  rawChunksToService: 0
};

const sendToRenderer = (channel, payload) => {
  // Channel names are historic (`vosk-*` from when this used Vosk).
  if (channel === 'vosk-partial') {
    events.partials += 1;
    if (payload?.text) console.log(`  partial[${payload.source}] ${payload.text}`);
  } else if (channel === 'vosk-final') {
    events.finals += 1;
    if (payload?.text) {
      events.finalTexts.push(payload.text);
      console.log(`  FINAL[${payload.source}] ${payload.text} ${payload.emotion ? `(emo=${payload.emotion.tag}/${payload.emotion.confidence})` : ''}`);
    }
  } else if (channel === 'vosk-status') {
    events.statuses.push(payload);
    if (payload?.status) console.log(`  status[${payload.source}] ${payload.status} ${payload.message || ''}`);
  } else if (channel === 'vosk-error') {
    events.errors += 1;
    console.error(`  ERR[${payload.source}] ${payload.error}`);
  } else if (channel === 'vosk-stopped') {
    console.log(`  stopped[${payload.source}]`);
  } else if (channel === 'stt-debug') {
    events.debugEntries += 1;
    // Print only events that hint at trouble. Otherwise we drown in
    // heartbeat / connect chatter.
    if (payload?.level === 'error' || payload?.level === 'warn') {
      console.log(`  dbg[${payload.level}] ${payload.event}: ${payload.message}`);
    }
  } else if (channel === 'process-loopback-status') {
    console.log(`  loopback-status listening=${payload?.listening} pid=${payload?.pid}`);
  } else {
    console.log(`  evt[${channel}]`, payload);
  }
};

// Paraformer expects a WebSocket constructor compatible with the `ws` API.
// Node 22+'s native WebSocket is API-compatible enough that the service
// already uses it without surgery. We just hand the constructor through.
const paraformer = createParaformerService({
  WebSocket,
  desktopCapturer: { getSources: async () => [] }, // unused in this path
  getDashscopeApiKey: () => appState.dashscopeApiKey,
  getGeminiService: () => null,
  sendToRenderer
});

// Wrap handleAudioChunk so we can count what reaches the service. The
// service signature accepts { source, data } where data is a Buffer or
// ArrayBuffer of int16 PCM at 16k mono.
const origHandle = paraformer.handleAudioChunk.bind(paraformer);
paraformer.handleAudioChunk = (payload) => {
  events.rawChunksToService += 1;
  return origHandle(payload);
};

const processLoopback = createProcessLoopbackService({
  asrService: paraformer,
  sendToRenderer
});

// paraformer-realtime-8k-v2 is Chinese-only. Use Chinese-only speech so the
// recognised text is actually meaningful (the model collapses English into
// phonetic gibberish, which is a model quirk, not a pipeline issue).
const SPEAK_SCRIPT = `
Add-Type -AssemblyName System.Speech | Out-Null
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
foreach ($v in $synth.GetInstalledVoices()) {
  $info = $v.VoiceInfo
  if ($info.Culture.Name -like 'zh-*') {
    $synth.SelectVoice($info.Name)
    break
  }
}
$synth.Rate = -1
$synth.Speak('候选人说他们带领了一个五人工程团队，把后端延迟降低了百分之六十。一二三四五六七八九十。')
$synth.Speak('我们使用了缓存和数据库索引优化来提升性能。')
`;

(async () => {
  console.log('Spawning PowerShell TTS...');
  const tts = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', SPEAK_SCRIPT], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
  console.log(`  PID=${tts.pid}`);

  console.log('Opening Paraformer WebSocket for system source...');
  await paraformer.startAssemblyAiStream('system');
  // Give Paraformer ~600ms to send the task-start frame and receive
  // task-started before we start pumping audio.
  await new Promise((r) => setTimeout(r, 800));

  console.log(`Starting per-process capture for PID ${tts.pid}...`);
  try {
    await processLoopback.start(String(tts.pid));
  } catch (error) {
    console.error('Failed to start process loopback:', error.message);
    try { tts.kill(); } catch (_) {}
    try { await paraformer.stopVoiceRecognition({ source: 'system' }); } catch (_) {}
    process.exit(3);
  }

  // Run for up to 18s, then stop. TTS naturally takes ~12-15s; we leave
  // a tail for Paraformer's sentence_end to fire.
  const HARD_TIMEOUT_MS = 22000;
  const stopAll = async (reason) => {
    console.log(`\nStopping (${reason})...`);
    try { tts.kill(); } catch (_) {}
    try { await processLoopback.stop(); } catch (e) { console.warn('stop loopback:', e.message); }
    // Allow final transcripts to land.
    await new Promise((r) => setTimeout(r, 1500));
    try { await paraformer.stopVoiceRecognition({ source: 'system' }); } catch (e) { console.warn('stop ws:', e.message); }
    await new Promise((r) => setTimeout(r, 400));

    const status = processLoopback.getStatus();
    console.log('\n--- Summary ---');
    console.log('  ASR chunks accepted:   ', events.rawChunksToService);
    console.log('  partials:              ', events.partials);
    console.log('  finals:                ', events.finals);
    console.log('  errors:                ', events.errors);
    console.log('  statuses:              ', JSON.stringify(events.statuses.map((s) => s.status)));
    console.log('  final texts:           ', events.finalTexts);
    console.log('  loopback final status: ', status);

    // PASS criteria: WebSocket reached listening state, sidecar pumped real
    // audio into the service, at least one partial transcript landed, and
    // no async error events fired.
    const reachedListening = events.statuses.some((s) => s?.status === 'listening');
    const passed = reachedListening
        && events.rawChunksToService > 5
        && events.partials >= 1
        && events.errors === 0;
    console.log(passed ? '\nPASS' : '\nFAIL');
    process.exit(passed ? 0 : 1);
  };

  tts.on('exit', () => setTimeout(() => stopAll('tts-exited'), 2000));
  setTimeout(() => stopAll('hard-timeout'), HARD_TIMEOUT_MS);
})().catch((error) => {
  console.error('Smoke crashed:', error);
  process.exit(4);
});
