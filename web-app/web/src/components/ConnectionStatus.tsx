import type { SocketStatus } from '../lib/useCopilotSocket';

interface ConnectionStatusProps {
  status: SocketStatus;
  sessionId: string | null;
}

const LABELS: Record<SocketStatus, string> = {
  connecting: 'Connecting',
  open: 'Connected',
  reconnecting: 'Reconnecting',
  closed: 'Disconnected'
};

/** A pill summarizing the live WebSocket connection state. */
export function ConnectionStatus({ status, sessionId }: ConnectionStatusProps) {
  const label = LABELS[status];
  const title = sessionId ? `Session ${sessionId}` : undefined;
  return (
    <span className="conn" data-status={status} title={title}>
      <span className="conn-dot" aria-hidden="true" />
      {label}
    </span>
  );
}
