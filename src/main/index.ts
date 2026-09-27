import { app, BrowserWindow, session } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { torManager, startTor, stopTor } from './tor'
import { registerIpcHandlers } from './ipc'
import { getStore } from './store'
import { initIPFS } from './services/ipfs'
import { initTorTransport } from './services/torTransport'

let splashWindow: BrowserWindow | null = null
let mainWindow: BrowserWindow | null = null
let revealed = false

/**
 * Content-Security-Policy. In production we lock the renderer down to 'self' and
 * blob: — it makes no direct remote requests (everything goes through IPC to the
 * main process, whose Node-side traffic is Tor-routed via torTransport.ts). In
 * dev we must loosen script/connect rules so the Vite dev server + HMR work.
 */
function cspForEnvironment(): string {
  if (is.dev) {
    return [
      "default-src 'self' blob: data:",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self' ws: wss: http: https:"
    ].join('; ')
  }
  return [
    "default-src 'self' blob:",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'"
  ].join('; ')
}

function applyContentSecurityPolicy(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [cspForEnvironment()]
      }
    })
  })
}

function splashMarkup(): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body { margin: 0; height: 100%; }
      body {
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        background: #0a0a0f; color: #f0f0f0;
        font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
        border: 2px solid #1f2937; box-sizing: border-box; user-select: none;
      }
      .brand { font-size: 26px; font-weight: 800; letter-spacing: -0.5px; }
      .brand span { color: #4ade80; }
      .spinner {
        margin: 22px 0 18px; width: 34px; height: 34px; border-radius: 50%;
        border: 3px solid #1f2937; border-top-color: #4ade80;
        animation: spin 0.9s linear infinite;
      }
      @keyframes spin { to { transform: rotate(360deg); } }
      .msg { font-size: 13px; color: #9ca3af; min-height: 18px; }
      .barwrap { margin-top: 16px; width: 240px; height: 4px; background: #1f2937; }
      .bar { height: 100%; width: 0%; background: #4ade80; transition: width 0.3s ease; }
    </style>
  </head>
  <body>
    <div class="brand">Press<span>Chain</span></div>
    <div class="spinner"></div>
    <div class="msg" id="msg">Connecting to Tor network…</div>
    <div class="barwrap"><div class="bar" id="bar"></div></div>
    <script>
      window.__update = function (state, progress, message) {
        var msg = document.getElementById('msg');
        var bar = document.getElementById('bar');
        if (message) msg.textContent = message;
        if (typeof progress === 'number') bar.style.width = Math.max(0, Math.min(100, progress)) + '%';
        if (state === 'error') { bar.style.background = '#ef4444'; }
      };
    </script>
  </body>
</html>`
}

function createSplashWindow(): void {
  splashWindow = new BrowserWindow({
    width: 460,
    height: 300,
    frame: false,
    resizable: false,
    center: true,
    show: false,
    backgroundColor: '#0a0a0f',
    webPreferences: { sandbox: true }
  })

  splashWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(splashMarkup()))
  splashWindow.once('ready-to-show', () => splashWindow?.show())
  splashWindow.webContents.on('did-finish-load', () => pushSplashUpdate())
}

function pushSplashUpdate(): void {
  if (!splashWindow || splashWindow.isDestroyed()) return
  const { state, progress } = torManager.getTorStatus()
  const message = torManager.getMessage()
  const js = `window.__update && window.__update(${JSON.stringify(state)}, ${progress}, ${JSON.stringify(
    message
  )});`
  splashWindow.webContents.executeJavaScript(js).catch(() => {})
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    frame: true,
    backgroundColor: '#0a0a0f',
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false, // never enable
      contextIsolation: true, // required for contextBridge
      sandbox: true, // extra process isolation
      webSecurity: true,
      allowRunningInsecureContent: false,
      // DevTools are unavailable in the packaged build (see step 6).
      devTools: !app.isPackaged
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    // Hand off from the splash once the main window is on screen.
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.destroy()
      splashWindow = null
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Never open external links — in the app or the OS browser (that would leak
  // outside Tor). All windows are denied.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** Show the main window exactly once, whether Tor succeeded or failed. */
function revealMainWindow(): void {
  if (revealed) return
  revealed = true
  createMainWindow()
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('org.presschain.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Security: block navigation to any origin other than our own renderer, and
  // deny all attempts to open new windows.
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event, url) => {
      const devUrl = process.env['ELECTRON_RENDERER_URL']
      const isOwnRenderer = (devUrl && url.startsWith(devUrl)) || url.startsWith('file://')
      if (!isOwnRenderer) event.preventDefault()
    })
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  })

  applyContentSecurityPolicy()
  registerIpcHandlers()

  // Preload the Tor transport (ESM deps + SOCKS agent) so Node-side RPC/IPFS
  // requests are ready to route through Tor. Guards still fail closed if Tor
  // isn't ready when a request is actually made.
  initTorTransport().catch((err) => console.error('[tor-transport] init failed:', err))

  // If the user has previously completed IPFS setup, re-attach the stored
  // delegation. Guarded + fire-and-forget so a failure never blocks startup.
  const savedProof = getStore().get('ipfsProof')
  if (savedProof) {
    initIPFS(savedProof).catch((err) => console.error('[ipfs] init failed:', err))
  }

  // Splash first, then bring Tor up behind it.
  createSplashWindow()

  torManager.on('progress', (progress: number) => {
    pushSplashUpdate()
    mainWindow?.webContents.send('tor:progress', progress)
  })
  torManager.on('state', (status: { state: string }) => {
    pushSplashUpdate()
    if (status.state === 'ready' || status.state === 'error') {
      revealMainWindow()
    }
  })

  // Resolves on ready OR graceful error; reveal the app either way.
  await startTor()
  revealMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      if (revealed) createMainWindow()
      else createSplashWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  stopTor()
})
