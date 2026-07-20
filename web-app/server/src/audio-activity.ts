// Lightweight speech-presence guard for 16 kHz mono PCM16 frames. ASR providers
// may pause partial-transcript delivery for several seconds while a person is
// still speaking; using the actual audio energy keeps Auto from treating those
// provider chunk boundaries as conversational silence.

const MIN_ACTIVITY_SAMPLES = 160; // 10 ms at 16 kHz; rejects malformed/tiny payloads.
const SPEECH_RMS_THRESHOLD = 0.008; // about -42 dBFS: above room noise, below normal speech.

export function isAudiblePcm16Base64(pcmBase64: string): boolean {
  let pcm: Buffer;
  try {
    pcm = Buffer.from(String(pcmBase64 || ''), 'base64');
  } catch {
    return false;
  }
  const sampleCount = Math.floor(pcm.length / 2);
  if (sampleCount < MIN_ACTIVITY_SAMPLES) return false;

  let sumSquares = 0;
  for (let offset = 0; offset + 1 < pcm.length; offset += 2) {
    const normalized = pcm.readInt16LE(offset) / 32768;
    sumSquares += normalized * normalized;
  }
  return Math.sqrt(sumSquares / sampleCount) >= SPEECH_RMS_THRESHOLD;
}
