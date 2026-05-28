// Smoke test: spawn a PowerShell TTS speaker as a child, capture its audio via
// application-loopback for ~8 seconds, dump raw PCM bytes to disk, and report
// stats so we can verify the sidecar's emitted PCM format.

const al = require('application-loopback');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const OUTPUT = path.resolve(__dirname, 'loopback-sample.raw');
const SPEAK_SCRIPT = `
Add-Type -AssemblyName System.Speech | Out-Null
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.Rate = -1
$synth.Speak('Testing application loopback capture. The candidate said they led a team of five engineers and reduced backend latency by sixty percent. Two thousand twenty six is the year. Lambda functions handle peak traffic.')
`;

(async () => {
  const tts = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', SPEAK_SCRIPT], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
  console.log(`Spawned PowerShell TTS, PID=${tts.pid}`);

  // The sidecar uses PROCESS_LOOPBACK_INCLUDE_TARGET_PROCESS_TREE so capturing
  // the powershell PID should also capture its TTS engine child.
  const fd = fs.openSync(OUTPUT, 'w');
  let bytes = 0;
  let chunkCount = 0;
  let firstChunk = null;
  const start = Date.now();

  al.startAudioCapture(String(tts.pid), {
    onData: (chunk) => {
      if (!firstChunk) firstChunk = Buffer.from(chunk);
      fs.writeSync(fd, chunk);
      bytes += chunk.length;
      chunkCount += 1;
    }
  });

  const stop = () => {
    al.stopAudioCapture(String(tts.pid));
    fs.closeSync(fd);
    const elapsed = Date.now() - start;
    console.log(`Captured ${bytes} bytes in ${elapsed}ms across ${chunkCount} chunks`);
    if (firstChunk) {
      console.log(`First chunk len=${firstChunk.length}, head hex=`, firstChunk.subarray(0, 32).toString('hex'));
    }
    const bps = bytes / (elapsed / 1000);
    console.log(`Bytes/sec: ${bps.toFixed(0)}`);
    console.log(`Hints:  48k stereo float32 = 384000 B/s`);
    console.log(`        48k stereo int16   = 192000 B/s`);
    console.log(`        44.1k stereo int16 = 176400 B/s`);
    console.log(`        16k mono int16     = 32000 B/s`);
    process.exit(0);
  };

  tts.on('exit', (code) => {
    console.log(`TTS exited (code=${code}). Letting capture drain 500ms...`);
    setTimeout(stop, 500);
  });

  // Hard deadline so we never hang forever.
  setTimeout(() => {
    try { tts.kill(); } catch (_) {}
    stop();
  }, 15000);
})();
