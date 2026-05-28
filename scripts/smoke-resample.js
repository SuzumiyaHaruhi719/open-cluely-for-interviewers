// End-to-end resample smoke: feed a synthetic 44.1kHz stereo int16 sine
// through the same mixStereo + downsample functions the runtime uses, dump
// the 16kHz mono bytes, and report energy + rate so we know paraformer will
// see a valid frame instead of noise/garbage.

const path = require('path');
const fs = require('fs');
const { _mixStereoInt16ToMono, _downsampleInt16 } = require(path.resolve(__dirname, '..', 'src', 'services', 'process-loopback', 'service.js'));

const IN_RATE = 44100;
const OUT_RATE = 16000;
const FREQ = 440; // A4 tone
const DURATION_S = 1.0;
const AMPLITUDE = 16000;

const totalFrames = Math.round(IN_RATE * DURATION_S);
const stereoBytes = totalFrames * 4;
const buf = Buffer.allocUnsafe(stereoBytes);
for (let i = 0; i < totalFrames; i += 1) {
  const t = i / IN_RATE;
  const v = Math.round(Math.sin(2 * Math.PI * FREQ * t) * AMPLITUDE);
  buf.writeInt16LE(v, i * 4);
  buf.writeInt16LE(v, i * 4 + 2); // L=R for a mono-equivalent test tone
}

const mono = _mixStereoInt16ToMono(buf);
const down = _downsampleInt16(mono, IN_RATE, OUT_RATE);

const expectedMonoSamples = totalFrames;
const expectedDownSamples = Math.floor(expectedMonoSamples / (IN_RATE / OUT_RATE));
console.log(`stereo input bytes  = ${buf.length} (frames=${totalFrames})`);
console.log(`mono output bytes   = ${mono.length}   (samples=${mono.length / 2}, expected ${expectedMonoSamples})`);
console.log(`16k downsampled     = ${down.length} (samples=${down.length / 2}, expected ${expectedDownSamples})`);

let sumSq = 0;
let nonZero = 0;
for (let i = 0; i < down.length; i += 2) {
  const s = down.readInt16LE(i);
  sumSq += s * s;
  if (s !== 0) nonZero += 1;
}
const rms = Math.sqrt(sumSq / (down.length / 2));
console.log(`downsampled RMS     = ${rms.toFixed(1)}  (non-zero samples=${nonZero})`);
console.log(`downsampled head    =`, down.subarray(0, 32).toString('hex'));

fs.writeFileSync(path.resolve(__dirname, 'resample-output.pcm'), down);
console.log(`Wrote ${down.length} bytes to scripts/resample-output.pcm`);

if (down.length === 0) {
  console.error('FAIL: empty output');
  process.exit(1);
}
if (rms < 1000) {
  console.error(`FAIL: RMS too low (${rms.toFixed(1)}), expected ~${(AMPLITUDE / Math.sqrt(2)).toFixed(0)}`);
  process.exit(1);
}
console.log('PASS');
