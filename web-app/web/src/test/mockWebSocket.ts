/**
 * A minimal WebSocket double for tests. Construct it via `installMockWebSocket`,
 * then drive it with `open()` / `emit()` / `closeServer()`. Captures everything
 * the client sends in `sent`.
 */
export class MockWebSocket {
  static instances: MockWebSocket[] = [];

  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly CONNECTING = MockWebSocket.CONNECTING;
  readonly OPEN = MockWebSocket.OPEN;
  readonly CLOSING = MockWebSocket.CLOSING;
  readonly CLOSED = MockWebSocket.CLOSED;

  url: string;
  readyState: number = MockWebSocket.CONNECTING;
  sent: string[] = [];

  onopen: ((this: WebSocket, ev: Event) => unknown) | null = null;
  onmessage: ((this: WebSocket, ev: MessageEvent) => unknown) | null = null;
  onclose: ((this: WebSocket, ev: CloseEvent) => unknown) | null = null;
  onerror: ((this: WebSocket, ev: Event) => unknown) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    if (this.readyState === MockWebSocket.CLOSED) {
      return;
    }
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.call(this as unknown as WebSocket, new CloseEvent('close'));
  }

  /** Simulate the server accepting the connection. */
  open(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.call(this as unknown as WebSocket, new Event('open'));
  }

  /** Simulate an inbound message (object is JSON-stringified for the client). */
  emit(payload: unknown): void {
    const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
    this.onmessage?.call(
      this as unknown as WebSocket,
      new MessageEvent('message', { data })
    );
  }

  static reset(): void {
    MockWebSocket.instances = [];
  }

  static last(): MockWebSocket {
    const instance = MockWebSocket.instances.at(-1);
    if (!instance) {
      throw new Error('No MockWebSocket was constructed');
    }
    return instance;
  }
}

/** Installs the mock as `global.WebSocket` and returns a restore function. */
export function installMockWebSocket(): () => void {
  const original = globalThis.WebSocket;
  MockWebSocket.reset();
  globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
  return () => {
    globalThis.WebSocket = original;
    MockWebSocket.reset();
  };
}
