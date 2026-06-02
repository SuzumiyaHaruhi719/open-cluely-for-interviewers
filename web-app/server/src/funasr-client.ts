// ============================================================================
// FunASR streaming-SPK realtime ASR client
// ----------------------------------------------------------------------------
// Connects to a self-hosted FunASR serve_realtime_ws server (2pass mode) that
// returns per-sentence speaker ids alongside the recognition result.
//
// Shape mirrors paraformer-client.ts and volc-client.ts: a createFunasrSession
// factory with injected WebSocket constructor (so tests can stub the transport)
// returning { sendAudio(pcm), stop(), isReady }.
//
// Protocol (FunASR serve_realtime_ws, 2pass mode):
//   1. open ws to the server url (no auth headers required for self-hosted)
//   2. on open, send a start frame (JSON) declaring mode, chunk_size, wav_format,
//      audio_fs, is_speaking=true, spk=true
//   3. stream raw PCM binary frames (16 kHz, 16-bit LE, mono)
//   4. receive JSON messages containing:
//      - sentences: locked (final) sentences with text + spk speaker id
//      - partial:   rolling in-progress text (no speaker id yet)
//      - is_final:  true on the last server message
//   5. send the string 'STOP' to signal end of speech; close the socket
//
// Locked sentence semantics: the server grows the `sentences` array as
// sentences are finalized. We track how many we have already emitted
// (lockedCount) and emit only the newly-added ones each message, so each
// locked sentence fires exactly once as a final transcript.
// ============================================================================

// Minimal structural type for the `ws` WebSocket we depend on. Declaring it
// here (instead of importing ws's types) lets tests inject a fake constructor
// without pulling the real socket in.
export interface WsLike {
  readonly readyState: number;
  on(event: 'open' | 'message' | 'error' | 'close', listener: (...args: any[]) => void): void;
  send(data: string | Buffer): void;
  close(): void;
}

export interface WsConstructor {
  new (url: string, options?: { headers?: Record<string, string> }): WsLike;
  readonly OPEN: number;
}

/** A recognized transcript from the FunASR server. */
export interface FunasrTranscript {
  text: string;
  isFinal: boolean;
  /** Speaker id from the server's SPK diarization, or null for partials. */
  speakerId: number | null;
}

export interface FunasrSessionDeps {
  /** The `ws` WebSocket constructor (injected so tests can stub the transport). */
  WebSocket: WsConstructor;
  /** WebSocket URL of the self-hosted FunASR serve_realtime_ws server. */
  url: string;
  /** Sample rate of the PCM we forward. Browser worklet emits 16 kHz. */
  sampleRate?: number;
  /** Optional hint for the diarization model (speaker_num). */
  speakerNum?: number;
  /** Called for every partial/final transcript this session produces. */
  onTranscript: (t: FunasrTranscript) => void;
  /** Called once when the socket opens and the start frame is sent. */
  onReady?: () => void;
  /** Called on a terminal error with a human-readable message. */
  onError?: (message: string) => void;
}

export interface FunasrSession {
  /** Forward one PCM frame (16-bit LE mono) to the recognizer. */
  sendAudio(pcm: Buffer): void;
  /** Send the STOP sentinel and close the socket. */
  stop(): void;
  /** True once the socket is open and the start frame has been sent. */
  readonly isReady: boolean;
}

/**
 * Build the start frame sent on open. Field names confirmed by the FunASR
 * serve_realtime_ws protocol (2pass mode with speaker diarization enabled).
 */
export function buildStartFrame(deps: FunasrSessionDeps): string {
  return JSON.stringify({
    mode: '2pass',
    chunk_size: [5, 10, 5],
    wav_format: 'pcm',
    audio_fs: deps.sampleRate ?? 16000,
    is_speaking: true,
    spk: true,
    ...(deps.speakerNum ? { speaker_num: deps.speakerNum } : {})
  });
}

/**
 * Open a FunASR streaming-SPK session. The socket connects, sends the start
 * frame on open, then forwards raw PCM binary frames. Each server message may
 * carry newly-locked sentences (emitted once as finals with their speaker id)
 * and/or a partial rolling text (emitted with speakerId=null). Audio sent
 * before the socket is open is dropped — callers should buffer at the capture
 * layer if zero-loss is required.
 */
export function createFunasrSession(deps: FunasrSessionDeps): FunasrSession {
  const ws = new deps.WebSocket(deps.url);
  let ready = false;
  /** Number of locked sentences already emitted; grows monotonically. */
  let lockedCount = 0;

  ws.on('open', () => {
    ready = true;
    ws.send(buildStartFrame(deps));
    deps.onReady?.();
  });

  ws.on('error', (err: unknown) => {
    deps.onError?.(err instanceof Error ? err.message : String(err));
  });

  ws.on('message', (raw: unknown) => {
    let msg: unknown;
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : (raw as { toString(): string }).toString());
    } catch {
      return; // ignore unparseable frames
    }

    const partial: string =
      typeof (msg as { partial?: unknown }).partial === 'string'
        ? (msg as { partial: string }).partial
        : '';
    if (partial) {
      deps.onTranscript({ text: partial, isFinal: false, speakerId: null });
    }

    const sentences: unknown[] = Array.isArray((msg as { sentences?: unknown }).sentences)
      ? (msg as { sentences: unknown[] }).sentences
      : [];

    // Emit only the sentences that are newly locked since the last message.
    // NOTE: FunASR re-clusters speakers globally on STOP, which can correct the
    // `spk` of EARLIER sentences. We deliberately do not re-emit already-locked
    // indices (lockedCount only moves forward), so a late correction to a past
    // sentence's speaker is not propagated. v1 accepts this: in-session cluster
    // ids are stable enough, and the one-tap role override (set-speaker-role)
    // lets the interviewer fix any mislabel. Revisit if STOP corrections prove
    // common in practice (would require re-emitting changed indices + the web
    // updating segments by id).
    for (let i = lockedCount; i < sentences.length; i++) {
      const s = sentences[i] as { text?: unknown; spk?: unknown } | null | undefined;
      deps.onTranscript({
        text: String(s?.text ?? ''),
        isFinal: true,
        speakerId: typeof s?.spk === 'number' ? s.spk : null
      });
    }
    lockedCount = Math.max(lockedCount, sentences.length);
  });

  return {
    sendAudio(pcm: Buffer): void {
      if (ready) ws.send(pcm);
    },
    stop(): void {
      try {
        ws.send('STOP');
      } finally {
        ws.close();
      }
    },
    get isReady(): boolean {
      return ready;
    }
  };
}
