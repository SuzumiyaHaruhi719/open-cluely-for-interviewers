import { randomUUID } from 'node:crypto';
import { isQwenTtsModel, type QwenTtsModel } from './config';

export interface TtsWsLike {
  readonly readyState: number;
  on(event: 'open' | 'message' | 'error' | 'close', listener: (...args: any[]) => void): void;
  send(data: string | Buffer): void;
  close(): void;
  terminate?(): void;
}

export interface TtsWsConstructor {
  new (url: string, options?: { headers?: Record<string, string> }): TtsWsLike;
}

export interface QwenTtsInput {
  text: string;
  model: QwenTtsModel;
  voice: string;
}

export interface QwenTtsDeps {
  WebSocket: TtsWsConstructor;
  apiKey: string;
  url: string;
  timeoutMs: number;
  now?: () => number;
}

export interface QwenTtsAudio {
  audio: Buffer;
  contentType: 'audio/mpeg';
  model: QwenTtsModel;
  elapsedMs: number;
}

export class QwenTtsInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QwenTtsInputError';
  }
}

export class QwenTtsUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QwenTtsUnavailableError';
  }
}

function frame(taskId: string, action: 'run-task' | 'continue-task' | 'finish-task', payload: object): string {
  return JSON.stringify({
    header: { action, task_id: taskId, streaming: 'duplex' },
    payload
  });
}

function runTask(taskId: string, input: QwenTtsInput): string {
  return frame(taskId, 'run-task', {
    model: input.model,
    task_group: 'audio',
    task: 'tts',
    function: 'SpeechSynthesizer',
    input: {},
    parameters: {
      voice: input.voice,
      volume: 50,
      text_type: 'PlainText',
      sample_rate: 22_050,
      rate: 1,
      format: 'mp3',
      pitch: 1,
      seed: 0,
      type: 0
    }
  });
}

function continueTask(taskId: string, input: QwenTtsInput): string {
  return frame(taskId, 'continue-task', {
    model: input.model,
    task_group: 'audio',
    task: 'tts',
    function: 'SpeechSynthesizer',
    input: { text: input.text }
  });
}

function finishTask(taskId: string): string {
  return frame(taskId, 'finish-task', { input: {} });
}

function publicProviderReason(header: { error_code?: unknown }): string {
  const code = typeof header.error_code === 'string' ? header.error_code.trim() : '';
  return code ? `Qwen Audio 3.0 暂不可用（${code.slice(0, 80)}）` : 'Qwen Audio 3.0 暂不可用';
}

/** One bounded DashScope SpeechSynthesizer request; no secret crosses this boundary. */
export async function synthesizeQwenTts(
  rawInput: QwenTtsInput,
  deps: QwenTtsDeps
): Promise<QwenTtsAudio> {
  const input = { ...rawInput, text: rawInput.text.trim(), voice: rawInput.voice.trim() };
  if (!input.text || input.text.length > 500) {
    throw new QwenTtsInputError('朗读文本长度必须为 1–500 字符');
  }
  if (!isQwenTtsModel(input.model)) {
    throw new QwenTtsInputError('不支持的 Qwen TTS 模型');
  }
  if (!input.voice) {
    throw new QwenTtsInputError('QWEN_TTS_VOICE 未配置');
  }
  if (!deps.apiKey.trim()) {
    throw new QwenTtsInputError('DASHSCOPE_API_KEY 未配置');
  }
  if (!deps.url.trim()) {
    throw new QwenTtsInputError('DASHSCOPE_TTS_WS_URL 未配置');
  }

  const now = deps.now ?? Date.now;
  const startedAt = now();
  const taskId = randomUUID().replaceAll('-', '');

  return await new Promise<QwenTtsAudio>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let socket: TtsWsLike | null = null;
    let settled = false;
    let submitted = false;

    const teardown = (): void => {
      const current = socket;
      socket = null;
      if (!current) return;
      try {
        if (typeof current.terminate === 'function') current.terminate();
        else current.close();
      } catch {
        // The request has already settled; transport cleanup errors are non-fatal.
      }
    };

    const settle = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      teardown();
      if (error) {
        reject(error);
        return;
      }
      const audio = Buffer.concat(chunks);
      if (audio.length === 0) {
        reject(new QwenTtsUnavailableError('Qwen Audio 3.0 未返回音频'));
        return;
      }
      resolve({
        audio,
        contentType: 'audio/mpeg',
        model: input.model,
        elapsedMs: Math.max(0, now() - startedAt)
      });
    };

    const timeout = setTimeout(
      () => settle(new QwenTtsUnavailableError('语音合成超时，请稍后重试')),
      Math.max(1, deps.timeoutMs)
    );

    try {
      socket = new deps.WebSocket(deps.url, {
        headers: {
          Authorization: `Bearer ${deps.apiKey}`,
          'X-DashScope-DataInspection': 'enable'
        }
      });
    } catch {
      settle(new QwenTtsUnavailableError('无法连接 Qwen Audio 3.0'));
      return;
    }

    socket.on('open', () => {
      if (settled || !socket) return;
      try {
        socket.send(runTask(taskId, input));
      } catch {
        settle(new QwenTtsUnavailableError('Qwen Audio 3.0 请求启动失败'));
      }
    });

    socket.on('message', (raw: unknown, isBinary?: boolean) => {
      if (settled) return;
      if (isBinary === true) {
        chunks.push(Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer));
        return;
      }

      let message: { header?: { event?: unknown; error_code?: unknown } };
      try {
        message = JSON.parse(String(raw));
      } catch {
        return;
      }
      const event = message.header?.event;
      if (event === 'task-started' && !submitted) {
        submitted = true;
        try {
          socket?.send(continueTask(taskId, input));
          socket?.send(finishTask(taskId));
        } catch {
          settle(new QwenTtsUnavailableError('Qwen Audio 3.0 文本提交失败'));
        }
        return;
      }
      if (event === 'task-finished') {
        settle();
        return;
      }
      if (event === 'task-failed') {
        settle(new QwenTtsUnavailableError(publicProviderReason(message.header ?? {})));
      }
    });

    socket.on('error', () => settle(new QwenTtsUnavailableError('Qwen Audio 3.0 连接失败')));
    socket.on('close', () => {
      if (!settled) settle(new QwenTtsUnavailableError('Qwen Audio 3.0 连接提前关闭'));
    });
  });
}
