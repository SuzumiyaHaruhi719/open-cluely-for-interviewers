'use strict';

// Launcher that strips ELECTRON_RUN_AS_NODE before spawning the Electron binary.
// Without this, shells that already export ELECTRON_RUN_AS_NODE=1 (some IDE
// terminals do) cause `electron .` to start in pure-Node mode — no window, and
// `require('electron')` returns a path string instead of the Electron API.

const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const electronBinary = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

// On Windows, bare `--enable-logging` makes Chromium log to stderr, which causes
// EACH Electron subprocess (browser/main, GPU, renderer, utility) to AllocConsole
// — i.e. several console windows pop up on launch. Route logging to a file
// instead (`--enable-logging=file`), which keeps dev logs without any console
// windows. Node-side console.log still flows to the launching terminal via the
// inherited stdio below.
const logFile = path.join(os.tmpdir(), 'open-cluely-electron.log');
const passthrough = [];
let wantsLogging = false;
for (const a of process.argv.slice(2)) {
  if (a === '--enable-logging' || a.startsWith('--enable-logging=')) { wantsLogging = true; continue; }
  passthrough.push(a);
}
const args = ['.', ...passthrough];
if (wantsLogging) args.push('--enable-logging=file', `--log-file=${logFile}`, '--log-level=0');

// windowsHide stops a stray console window from being created on Windows; stdio
// is inherited so Node-side logs still flow to the launching terminal.
const child = spawn(electronBinary, args, { stdio: 'inherit', env, windowsHide: true });

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

child.on('error', (err) => {
  console.error('[run-electron] Failed to spawn Electron:', err.message);
  process.exit(1);
});
