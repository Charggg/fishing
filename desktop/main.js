/* =========================================================================
   DEEP CAST — desktop shell (Electron main process)

   The game itself is unchanged and still runs from a plain file:// double
   click. This wrapper exists for the things a browser tab cannot give it:
   a real fullscreen window, reliable pointer lock, a save that lives in a
   file instead of site data someone clears by accident, and a guarantee that
   WebGL2 is on a GPU rather than a software fallback.

   Deliberately no remote content, no node integration in the renderer, and a
   preload that exposes three functions. The renderer is the same untrusted-by
   -default web page it always was.
   ========================================================================= */
'use strict';
const { app, BrowserWindow, ipcMain, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');

/* In development the game sits next to this folder. In a packaged build the
   shell lives inside app.asar and the game is copied out to resources/game,
   so `../game` would point into the archive and load nothing. This is the
   classic packaged-only failure, which is why the build is smoke-tested
   after packaging rather than only in dev. */
const GAME_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'game')
  : path.join(__dirname, '..', 'game');
const SAVE_FILE = path.join(app.getPath('userData'), 'save.json');
const WINDOW_FILE = path.join(app.getPath('userData'), 'window.json');

/* Ask for the discrete GPU and let WebGL2 through even on drivers Chromium
   would normally blocklist. Someone who installed a native build wants the
   game to run, not a lecture about their driver. */
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}
function writeJSON(file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data));
    return true;
  } catch (e) { return false; }
}

let win = null;

function createWindow() {
  // Restore the last window box, but never off the edge of the current display.
  const saved = readJSON(WINDOW_FILE, null);
  const area = screen.getPrimaryDisplay().workAreaSize;
  const opts = {
    width: Math.min(saved && saved.width || 1600, area.width),
    height: Math.min(saved && saved.height || 900, area.height),
    minWidth: 900,
    minHeight: 560,
    backgroundColor: '#060d14',
    show: false,
    title: 'Deep Cast',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  };
  if (saved && Number.isInteger(saved.x) && Number.isInteger(saved.y)) {
    const fits = screen.getAllDisplays().some(d =>
      saved.x >= d.bounds.x - 40 && saved.y >= d.bounds.y - 40 &&
      saved.x < d.bounds.x + d.bounds.width && saved.y < d.bounds.y + d.bounds.height);
    if (fits) { opts.x = saved.x; opts.y = saved.y; }
  }

  win = new BrowserWindow(opts);
  if (saved && saved.fullscreen) win.setFullScreen(true);
  win.loadFile(path.join(GAME_DIR, 'index.html'));
  win.once('ready-to-show', () => win.show());

  // F11 fullscreen, and Escape must NOT leave fullscreen: the game uses Escape
  // for its own pause menu, and having it also drop out of fullscreen makes
  // pausing feel broken.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    } else if (input.key === 'F12') {
      win.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  const saveBox = () => {
    if (!win || win.isDestroyed()) return;
    const full = win.isFullScreen();
    const b = full ? (win.__lastNormal || win.getBounds()) : win.getBounds();
    if (!full) win.__lastNormal = b;
    writeJSON(WINDOW_FILE, { x: b.x, y: b.y, width: b.width, height: b.height, fullscreen: full });
  };
  win.on('resize', saveBox);
  win.on('move', saveBox);
  win.on('close', saveBox);
  win.on('closed', () => { win = null; });

  // Anything trying to open a new window or navigate away goes to the real
  // browser instead. Nothing in this game should ever do either.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) { e.preventDefault(); shell.openExternal(url); }
  });
}

/* The save. localStorage works fine inside Electron, but it is still browser
   site data — clearable, opaque, and impossible to back up. The desktop build
   mirrors it into a real JSON file under the OS app-data directory, and the
   renderer prefers that file when it exists. */
ipcMain.handle('save:read', () => readJSON(SAVE_FILE, null));
ipcMain.handle('save:write', (_e, data) => writeJSON(SAVE_FILE, data));
ipcMain.handle('save:path', () => SAVE_FILE);
ipcMain.handle('save:reveal', () => {
  if (fs.existsSync(SAVE_FILE)) shell.showItemInFolder(SAVE_FILE);
  else shell.openPath(path.dirname(SAVE_FILE));
});

app.whenReady().then(createWindow);
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
