'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { WebSocketServer } = require('ws');

// Names that almost always belong to virtual adapters (Docker, WSL, VPN,
// hypervisors). Phones cannot route to these IPs, so we want the real
// Wi-Fi/Ethernet adapter to appear first in the URL list.
const VIRTUAL_ADAPTER_PATTERNS = [
  /vethernet/i,
  /wsl/i,
  /vmware/i,
  /virtualbox/i,
  /hyper-?v/i,
  /docker/i,
  /tailscale/i,
  /zerotier/i,
  /\btap\b/i,
  /\btun\b/i,
  /loopback/i,
  /^ppp/i,
  /openvpn/i,
  /utun/i
];

function isVirtualAdapter(name = '') {
  return VIRTUAL_ADAPTER_PATTERNS.some((re) => re.test(name));
}

function isPrivateHost(host) {
  if (!host) return false;
  if (host === 'localhost') return true;
  // IPv4 dotted-quad. The mobile server binds 0.0.0.0 and only listens on
  // private-range Wi-Fi/Ethernet adapters in practice; anything outside
  // those ranges is either a public-IP misconfig or a DNS-rebinding attack.
  const m = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) {
    // IPv6 literal — accept loopback ::1 only; anything else rejected
    return host === '::1' || host === '[::1]';
  }
  const [a, b] = [parseInt(m[1], 10), parseInt(m[2], 10)];
  if (a === 127) return true;            // loopback
  if (a === 10) return true;             // RFC1918 10.0.0.0/8
  if (a === 192 && b === 168) return true; // RFC1918 192.168.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918 172.16.0.0/12
  if (a === 169 && b === 254) return true; // link-local 169.254.0.0/16
  return false;
}

function isPrivateOrigin(origin) {
  try {
    const u = new URL(origin);
    return isPrivateHost(u.hostname);
  } catch {
    return false;
  }
}

function getLanAddresses() {
  const real = [];
  const virtual = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        const entry = { name, address: iface.address, virtual: isVirtualAdapter(name) };
        if (entry.virtual) virtual.push(entry); else real.push(entry);
      }
    }
  }
  return [...real, ...virtual];
}

const MOBILE_PORT = 7823;
const MOBILE_HTML_PATH = path.join(__dirname, 'mobile.html');

function createMobileServer({ getGeminiRuntime, getScreenshotManager, notifyDesktop }) {
  const clients = new Set();
  const status = {
    listening: false,
    port: MOBILE_PORT,
    urls: [],
    clientCount: 0,
    error: null
  };

  function emitStatus() {
    if (typeof notifyDesktop === 'function') {
      try { notifyDesktop('mobile-server-status', { ...status }); } catch (_) { /* ignore */ }
    }
  }

  function refreshUrls() {
    status.urls = getLanAddresses().map(({ name, address, virtual }) => ({
      name,
      address,
      virtual: !!virtual,
      url: `http://${address}:${MOBILE_PORT}`
    }));
  }

  function setClientCount(n) {
    status.clientCount = n;
    emitStatus();
  }

  function broadcast(channel, data) {
    if (clients.size === 0) return;
    const message = JSON.stringify({ channel, data });
    for (const ws of clients) {
      if (ws.readyState === 1 /* WebSocket.OPEN */) {
        try { ws.send(message); } catch (_) { /* ignore dead socket */ }
      }
    }
  }

  function sendTo(ws, channel, data) {
    try {
      if (ws.readyState === 1) ws.send(JSON.stringify({ channel, data }));
    } catch (_) { /* ignore */ }
  }

  // ── HTTP server (serves mobile UI) ────────────────────────────────────────

  const httpServer = http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];

    if (url === '/' || url === '/index.html') {
      try {
        const html = fs.readFileSync(MOBILE_HTML_PATH, 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      } catch (err) {
        console.error('[MobileServer] failed to serve mobile.html', err);
        res.writeHead(500);
        res.end('Mobile UI unavailable');
      }
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  // ── WebSocket server ───────────────────────────────────────────────────────

  // maxPayload caps a single inbound frame at 256 KiB; defends the main
  // process against an OOM from a hostile peer (mobile server binds on the
  // LAN). The largest legitimate payload is an `ask-ai` contextString +
  // transcript, which is held well below this in `buildFilteredAiContextBundle`.
  //
  // verifyClient rejects DNS-rebinding attacks: the only legitimate Origin
  // for the mobile UI is no Origin (native phone WS) or one whose host
  // resolves to a private-range / loopback IP. Browsers honor Origin even
  // when a malicious public page DNS-rebinds to a LAN IP, so checking it
  // here cuts off the rebinding vector. Hosts like `localhost`, `127.x.x.x`,
  // `10.x`, `172.16.x-172.31.x`, `192.168.x` pass; everything else rejects.
  const wss = new WebSocketServer({
    server: httpServer,
    maxPayload: 256 * 1024,
    verifyClient: (info, callback) => {
      const origin = info.req.headers.origin;
      if (origin && !isPrivateOrigin(origin)) {
        console.warn(`[MobileServer] WS rejected: non-private Origin "${origin}"`);
        callback(false, 403, 'Forbidden origin');
        return;
      }
      const host = info.req.headers.host || '';
      if (!isPrivateHost(host.split(':')[0])) {
        console.warn(`[MobileServer] WS rejected: non-private Host "${host}"`);
        callback(false, 403, 'Forbidden host');
        return;
      }
      callback(true);
    },
  });

  wss.on('connection', (ws) => {
    clients.add(ws);
    setClientCount(clients.size);
    console.log(`[MobileServer] Client connected (total: ${clients.size})`);

    // Send initial state
    const screenshotMgr = getScreenshotManager();
    sendTo(ws, 'connected', {
      screenshotsCount: screenshotMgr ? screenshotMgr.getScreenshotsCount() : 0
    });

    ws.on('message', async (rawData, _isBinary) => {
      let msg;
      try {
        msg = JSON.parse(rawData.toString());
      } catch (_) {
        sendTo(ws, 'error', { message: 'Invalid message format' });
        return;
      }

      const geminiRuntime = getGeminiRuntime();
      const screenshotManager = getScreenshotManager();

      switch (msg.type) {

        // ── Screenshot ─────────────────────────────────────────────────────
        case 'take-screenshot': {
          if (!screenshotManager) {
            sendTo(ws, 'error', { message: 'Screenshot manager not ready' });
            break;
          }
          try {
            await screenshotManager.takeStealthScreenshot();
            // screenshot-taken-stealth is emitted via augmented sendToRenderer → broadcast
          } catch (err) {
            sendTo(ws, 'error', { message: `Screenshot failed: ${err.message}` });
          }
          break;
        }

        // ── Ask AI ─────────────────────────────────────────────────────────
        case 'ask-ai': {
          if (!geminiRuntime || !geminiRuntime.hasApiKeys()) {
            sendTo(ws, 'error', { message: 'No API key configured. Add it in the desktop Settings.' });
            break;
          }

          let contextString = typeof msg.contextString === 'string' ? msg.contextString.trim() : '';
          // Cap contextString at 32 KiB — a malicious LAN peer (or an
          // honest UI bug) could otherwise send an unbounded payload
          // that burns DashScope quota and pins the model's reasoning
          // budget. 32 KiB ≈ 8 k tokens, plenty for any reasonable
          // interview-coach context bundle but firmly bounded.
          const MAX_CONTEXT_BYTES = 32 * 1024;
          if (Buffer.byteLength(contextString, 'utf8') > MAX_CONTEXT_BYTES) {
            console.warn(`[MobileServer] ask-ai contextString truncated from ${Buffer.byteLength(contextString, 'utf8')} bytes`);
            // Truncate to the byte cap, accepting that we may chop a
            // multi-byte char in half (UTF-8 decoder downstream is
            // permissive; DashScope tokenizer treats truncated UTF-8
            // as the replacement char). Adequate for hostile-input
            // defense; a clean cut would need code-point walking.
            contextString = contextString.slice(0, MAX_CONTEXT_BYTES);
          }

          if (!contextString && !screenshotManager?.hasScreenshots()) {
            sendTo(ws, 'error', { message: 'Take a screenshot or type a question first.' });
            break;
          }

          // Fire-and-forget; stream events go back via broadcast
          (async () => {
            try {
              broadcast('ai-stream-start', { actionId: 'askAi' });

              const onChunk = ({ text, index }) => {
                broadcast('ai-stream-chunk', { actionId: 'askAi', text, index });
              };

              let text = '';

              if (screenshotManager && screenshotManager.hasScreenshots()) {
                const { imageParts } = await screenshotManager.buildImagePartsFromScreenshots({ strict: false });
                if (imageParts.length > 0) {
                  text = await geminiRuntime.executeWithKeyFailover((svc) => {
                    if (!svc || !svc.modelName) throw new Error('AI model not initialized');
                    return svc.askAiWithSessionContextAndScreenshots(imageParts, {
                      contextString,
                      transcriptContext: '',
                      sessionSummary: '',
                      screenshotCount: imageParts.length,
                      onChunk
                    });
                  });
                }
              }

              if (!text) {
                text = await geminiRuntime.executeWithKeyFailover((svc) => {
                  if (!svc || !svc.modelName) throw new Error('AI model not initialized');
                  return svc.askAiWithSessionContext({
                    contextString,
                    transcriptContext: '',
                    sessionSummary: '',
                    screenshotCount: 0,
                    onChunk
                  });
                });
              }

              broadcast('ai-stream-end', { actionId: 'askAi' });
            } catch (err) {
              console.error('[MobileServer] ask-ai error:', err.message);
              broadcast('ai-stream-end', { actionId: 'askAi' });
              broadcast('error', { message: err.message });
            }
          })();
          break;
        }

        // ── Clear conversation history ──────────────────────────────────────
        case 'clear-conversation': {
          try {
            const geminiService = geminiRuntime?.getService();
            if (geminiService) geminiService.clearHistory();
            if (screenshotManager?.clearStealth) screenshotManager.clearStealth();
            // Tell the desktop renderer to wipe its chat UI as well.
            if (typeof notifyDesktop === 'function') {
              notifyDesktop('clear-from-mobile', {});
            }
            broadcast('clear-done', {});
          } catch (err) {
            sendTo(ws, 'error', { message: `Clear failed: ${err.message}` });
          }
          break;
        }

        default:
          sendTo(ws, 'error', { message: `Unknown command: ${msg.type}` });
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      setClientCount(clients.size);
      console.log(`[MobileServer] Client disconnected (total: ${clients.size})`);
    });

    ws.on('error', (err) => {
      console.error('[MobileServer] WebSocket error:', err.message);
      clients.delete(ws);
      setClientCount(clients.size);
    });
  });

  // ── Start listening ────────────────────────────────────────────────────────

  httpServer.listen(MOBILE_PORT, '0.0.0.0', () => {
    refreshUrls();
    status.listening = true;
    status.error = null;
    emitStatus();
    console.log(`[MobileServer] Listening on 0.0.0.0:${MOBILE_PORT}`);
    console.log(`[MobileServer] Local:   http://localhost:${MOBILE_PORT}`);
    for (const { name, url, virtual } of status.urls) {
      const tag = virtual ? '  [virtual — phone probably cannot reach]' : '';
      console.log(`[MobileServer] Network: ${url}  (${name})${tag}`);
    }
    console.log('[MobileServer] On the phone, open one of the Network URLs.');
    console.log('[MobileServer] If the phone cannot reach the PC, allow inbound TCP 7823 in Windows Firewall.');
  });

  httpServer.on('error', (err) => {
    status.listening = false;
    status.error = err.message;
    emitStatus();
    if (err.code === 'EADDRINUSE') {
      console.error(`[MobileServer] Port ${MOBILE_PORT} already in use — mobile companion disabled`);
    } else {
      console.error('[MobileServer] HTTP server error:', err.message);
    }
  });

  return {
    broadcast,
    getStatus: () => ({ ...status }),
    emitStatus,
    close() {
      try {
        wss.close();
        httpServer.close();
        status.listening = false;
        status.clientCount = 0;
        emitStatus();
      } catch (_) { /* ignore */ }
    }
  };
}

module.exports = { createMobileServer };
