const path = require('path');
const { BrowserWindow } = require('electron');

function createAssistantWindow({
  app,
  screen,
  defaultWidth,
  defaultHeight,
  minWidth,
  minHeight,
  hideFromScreenCapture,
  initialOpacity,
  launchHidden,
  nodeEnv
}) {
  console.log('Creating assistant window...');
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const x = Math.floor((width - defaultWidth) / 2);
  const y = 40;
  const windowOpacity = Number.isFinite(initialOpacity) ? initialOpacity : 1;

  console.log(`Window position: ${x}, ${y}, size: ${defaultWidth}x${defaultHeight}`);

  const mainWindow = new BrowserWindow({
    width: defaultWidth,
    height: defaultHeight,
    minWidth,
    minHeight,
    maxWidth: width,
    maxHeight: height,
    x,
    y,
    // Branded taskbar / window icon (mic glyph on a dark indigo-glow tile).
    // app.getAppPath() = repo root in dev, app dir when packaged.
    icon: path.join(app.getAppPath(), 'assets', 'app-icon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false,
      offscreen: false,
      webSecurity: false,
      allowRunningInsecureContent: true,
      experimentalFeatures: false,
      enableRemoteModule: false,
      sandbox: false
    },
    frame: false,
    transparent: true,
    alwaysOnTop: false,
    skipTaskbar: false,
    resizable: true,
    minimizable: true,
    maximizable: false,
    closable: true,
    focusable: true,
    show: false,
    opacity: windowOpacity,
    acceptFirstMouse: false,
    disableAutoHideCursor: true,
    enableLargerThanScreen: false,
    hasShadow: false,
    thickFrame: false,
    titleBarStyle: 'hidden',
    // Production stays fully transparent so the glass UI floats over whatever
    // is behind it. Dev paints a dark solid backdrop so the window is
    // unmistakably visible on Win11 where transparent+content-protection
    // sometimes composes to a blank rectangle on certain GPU drivers.
    backgroundColor: '#00000000'
  });

  const htmlPath = path.join(__dirname, 'renderer.html');
  console.log('Loading HTML from:', htmlPath);
  mainWindow.loadFile(htmlPath);

  // Permission handlers — only grant microphone / media to file://
  // origins (the local renderer). With `webSecurity: false` it's
  // theoretically possible for an unrelated origin to load into a
  // sub-frame; gate by requestingUrl so an external origin never
  // inherits the renderer's mic permission.
  function isLocalRendererOrigin(url) {
    if (typeof url !== 'string') return false;
    return url.startsWith('file://');
  }

  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const url = details?.requestingUrl ?? webContents?.getURL?.() ?? '';
    const local = isLocalRendererOrigin(url);
    console.log('Permission requested:', permission, 'origin:', url, 'local:', local);
    if (!local) {
      callback(false);
      return;
    }
    if (permission === 'microphone' || permission === 'media') {
      callback(true);
    } else {
      callback(false);
    }
  });

  mainWindow.webContents.session.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    if (!isLocalRendererOrigin(requestingOrigin)) {
      return false;
    }
    return permission === 'microphone' || permission === 'media';
  });

  // Hardened file:// handler — normalize and constrain the resolved
  // path to the app directory. Without this, `webSecurity: false`
  // combined with this handler would let any injected URI
  // (`file:///../../etc/passwd`-style) read arbitrary host files when
  // the renderer fetches via `<img>` / `<script>` / `fetch()`.
  const appRoot = path.resolve(app.getAppPath());
  mainWindow.webContents.session.protocol.registerFileProtocol('file', (request, callback) => {
    let pathname;
    try {
      pathname = decodeURI(request.url.replace('file:///', ''));
    } catch (err) {
      console.warn('[file-protocol] decodeURI failed', err);
      callback({ error: -10 }); // ERR_ACCESS_DENIED
      return;
    }
    const resolved = path.resolve(pathname);
    // The renderer.html lives inside appRoot; any resolved path that
    // escapes appRoot is either a misconfig or a traversal attempt.
    // path.resolve normalises `..` so a `file:///<appRoot>/../foo`
    // becomes whatever is one level up.
    if (!resolved.startsWith(appRoot + path.sep) && resolved !== appRoot) {
      console.warn(`[file-protocol] blocked out-of-app-root path: ${resolved}`);
      callback({ error: -10 });
      return;
    }
    callback(resolved);
  });

  if (process.platform === 'darwin') {
    mainWindow.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true
    });
    app.dock.hide();
    mainWindow.setHiddenInMissionControl(true);
  } else if (process.platform === 'win32') {
    mainWindow.setSkipTaskbar(false);
    mainWindow.setAppDetails({
      appId: 'com.wtatc.interviewer-copilot',
      relaunchDisplayName: 'Interviewer Copilot'
    });
  }

  mainWindow.setContentProtection(hideFromScreenCapture);
  console.log(
    `Content protection ${hideFromScreenCapture ? 'enabled' : 'disabled'} (HIDE_FROM_SCREEN_CAPTURE=${hideFromScreenCapture})`
  );

  mainWindow.setIgnoreMouseEvents(false);

  mainWindow.webContents.on('dom-ready', () => {
    console.log('DOM is ready');
  });

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('HTML finished loading');

    mainWindow.webContents.executeJavaScript(`
      console.log('Content check...');
      console.log('Document title:', document.title);
      console.log('Body exists:', !!document.body);
      console.log('App element exists:', !!document.getElementById('app'));
      console.log('Glass container exists:', !!document.querySelector('.glass-container'));

      document.body.style.background = 'transparent';

      if (document.body) {
        document.body.style.visibility = 'visible';
        document.body.style.display = 'block';
        console.log('Body made visible');
      }

      const app = document.getElementById('app');
      if (app) {
        app.style.visibility = 'visible';
        // The rebuilt shell is a CSS grid (.app-shell { display:grid }). Do NOT
        // force 'flex' here — an inline flex overrides the grid and lays the
        // titlebar + 3-pane body out side-by-side (broken layout + the drag
        // region ends up unreachable). Match the stylesheet.
        app.style.display = 'grid';
        console.log('App container made visible');
      }

      'Content visibility check complete';
    `).then((result) => {
      console.log('JavaScript result:', result);
      if (launchHidden) {
        console.log('Window initialized in hidden launch mode');
        return;
      }

      mainWindow.showInactive();
      console.log('Window shown in inactive mode with transparent background');
    }).catch((error) => {
      console.log('JavaScript execution failed:', error);
      if (!launchHidden) {
        mainWindow.showInactive();
      }
    });
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Failed to load:', errorCode, errorDescription);
  });

  mainWindow.webContents.on('console-message', (event, level, message) => {
    console.log(`Renderer console.${level}: ${message}`);
  });

  if (nodeEnv === 'development') {
    mainWindow.webContents.openDevTools();
  }

  return mainWindow;
}

module.exports = {
  createAssistantWindow
};
