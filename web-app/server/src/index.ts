import http from 'node:http';
import { createApp } from './app';
import { attachWebSocket } from './ws';
import { config, hasKey } from './config';

function main(): void {
  const app = createApp();
  const server = http.createServer(app);
  attachWebSocket(server);

  server.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(
      `[server] listening on http://localhost:${config.port} (ws ${'/ws'})` +
        ` — DashScope key ${hasKey() ? 'present' : 'MISSING'}`
    );
  });
}

main();
