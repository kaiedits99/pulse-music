// Pulse for Windows: an Electron window onto the Pulse website.
//
// Deliberately thin. The browser, the phone app and this .exe all talk to the same server, so the
// catalog, the accounts and the messages are the same everywhere without any syncing code here.
// This file only does what a desktop shell should: remember which website to open, keep the
// window's own layout (no browser chrome), send outside links to the real browser, and give a
// readable page when the site cannot be reached.
const { app, BrowserWindow, Menu, shell, session, dialog, nativeTheme } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { normalizeWebsiteUrl, isSameSite } = require('./url.js');

const APP_ID = 'com.pulse.music.desktop';
const BG = '#08080a';
const IS_DEV = !app.isPackaged;

/** Preferences live in %APPDATA%/Pulse/config.json so an upgrade keeps them. */
const configPath = () => path.join(app.getPath('userData'), 'config.json');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/** A packaged build can ship a default address (CI writes config.json from the repo variable). */
function packagedConfig() {
  return readJson(path.join(app.getAppPath(), 'config.json')) || {};
}

/**
 * The address to open, best source first:
 *   1. what the person saved in the app (they can change it from the menu)
 *   2. PULSE_APP_URL from the environment (handy while developing)
 *   3. the address baked in when the installer was built
 */
function configuredUrl() {
  const saved = readJson(configPath())?.url;
  const candidate = saved || process.env.PULSE_APP_URL || packagedConfig().url;
  const result = normalizeWebsiteUrl(candidate || '');
  return result.ok ? result.url : null;
}

function saveUrl(url) {
  const result = normalizeWebsiteUrl(url);
  if (!result.ok) return result;
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify({ url: result.url }, null, 2));
  return result;
}

let mainWindow = null;
let setupWindow = null;

const page = (name) => path.join(__dirname, name);

/** A window that shows one of our own local pages (setup / offline), never remote content. */
function localWindow(file, { width = 560, height = 640, resizable = false } = {}) {
  const win = new BrowserWindow({
    width,
    height,
    resizable,
    show: false,
    backgroundColor: BG,
    title: 'Pulse',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: page('preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.removeMenu();
  win.loadFile(page(file));
  win.once('ready-to-show', () => win.show());
  return win;
}

function openSetup() {
  if (setupWindow) { setupWindow.focus(); return setupWindow; }
  setupWindow = localWindow('setup.html', { width: 620, height: 660 });
  setupWindow.on('closed', () => { setupWindow = null; });
  return setupWindow;
}

/** Keep the URL bar out of the way: the app exposes what it needs through the menu. */
function buildMenu() {
  const website = configuredUrl();
  return Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        {
          label: 'Open in browser',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => website && shell.openExternal(website)
        },
        { label: 'Change Pulse website…', click: () => openSetup() },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => mainWindow?.webContents.reload() },
        { label: 'Back', accelerator: 'Alt+Left', click: () => mainWindow?.webContents.navigationHistory?.goBack?.() },
        { label: 'Forward', accelerator: 'Alt+Right', click: () => mainWindow?.webContents.navigationHistory?.goForward?.() },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(IS_DEV ? [{ role: 'toggleDevTools' }] : [])
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Pulse',
          click: () => {
            dialog.showMessageBox({
              type: 'info',
              title: 'Pulse',
              message: `Pulse ${app.getVersion()}`,
              detail: `The same catalog, account and messages as the website.\n\nWebsite: ${configuredUrl() || '(not set)'}\nElectron ${process.versions.electron}`,
              buttons: ['OK']
            });
          }
        },
        {
          label: 'Problem connecting?',
          click: () => {
            dialog.showMessageBox({
              type: 'info',
              title: 'Connecting to Pulse',
              message: 'Pulse needs the address of your website',
              detail: 'Use File → Change Pulse website to point the app somewhere else. '
                + 'If the address is right, check that the site is awake and reachable in a browser.',
              buttons: ['OK']
            });
          }
        }
      ]
    }
  ]);
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: BG,
    title: 'Pulse',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    autoHideMenuBar: false,
    webPreferences: {
      preload: page('preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // The player must keep playing when the window is in the background — it is a music app.
      backgroundThrottling: false
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  if (process.env.PULSE_DESKTOP_DEBUG === 'true') mainWindow.webContents.openDevTools({ mode: 'detach' });

  // Anything outside the site opens in the real browser: sign-in with Google needs it, and so do
  // links people share.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const base = configuredUrl();
    if (base && isSameSite(url, base)) return;
    if (/^https?:/i.test(url)) { event.preventDefault(); shell.openExternal(url); }
  });

  const load = () => {
    const url = configuredUrl();
    if (!url) { mainWindow.loadFile(page('offline.html'), { query: { reason: 'unconfigured' } }); return; }
    mainWindow.loadURL(url);
  };
  mainWindow.__pulseLoad = load;

  // A phone hotspot, a sleeping free instance or a typo: show a page that explains and retries.
  mainWindow.webContents.on('did-fail-load', (event, code, description, url, isMainFrame) => {
    if (!isMainFrame) return;
    if (code === -3) return; // ERR_ABORTED: a redirect or a deliberate reload, not a failure
    const reason = /ERR_NAME_NOT_RESOLVED/i.test(description) ? 'notfound'
      : /ERR_INTERNET_DISCONNECTED/i.test(description) ? 'offline'
        : 'unreachable';
    mainWindow.loadFile(page('offline.html'), { query: { reason, detail: description, url } });
  });
  mainWindow.webContents.on('render-process-gone', () => {
    mainWindow?.loadFile(page('offline.html'), { query: { reason: 'crashed' } });
  });

  load();
  mainWindow.on('closed', () => { mainWindow = null; });
  return mainWindow;
}

/** One window, one instance: launching again focuses the copy that is already running. */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.setAppUserModelId(APP_ID);

  app.whenReady().then(() => {
    nativeTheme.themeSource = 'dark';

    // The app needs the microphone for voice notes (and camera for a profile photo if someone
    // picks one). Everything else — location, serial ports, MIDI — is refused.
    const ALLOWED = new Set(['media', 'notifications', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen']);
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
      callback(ALLOWED.has(permission));
    });
    session.defaultSession.setPermissionCheckHandler((webContents, permission) => ALLOWED.has(permission));

    // Downloads land in the normal Downloads folder through the usual save dialog.
    session.defaultSession.on('will-download', (event, item) => {
      item.once('done', (e, state) => {
        if (state === 'completed') {
          dialog.showMessageBox({
            type: 'info',
            message: 'Download complete',
            detail: `${item.getFilename()} was saved to ${path.dirname(item.getSavePath())}.`,
            buttons: ['OK']
          }).catch(() => {});
        }
      });
    });

    Menu.setApplicationMenu(buildMenu());

    if (configuredUrl()) createMainWindow();
    else openSetup();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        if (configuredUrl()) createMainWindow();
        else openSetup();
      }
    });
  });

  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}

// The setup page and the offline page talk to the main process through these channels only.
const { ipcMain } = require('electron');

ipcMain.handle('pulse:get-state', () => ({
  url: configuredUrl(),
  version: app.getVersion(),
  platform: process.platform
}));

ipcMain.handle('pulse:save-url', (event, raw) => {
  const result = saveUrl(raw);
  if (!result.ok) return result;
  Menu.setApplicationMenu(buildMenu());
  if (setupWindow) setupWindow.close();
  if (mainWindow) {
    mainWindow.loadURL(result.url);
  } else {
    createMainWindow();
  }
  return result;
});

ipcMain.handle('pulse:retry', () => {
  if (mainWindow?.__pulseLoad) mainWindow.__pulseLoad();
  else if (configuredUrl()) createMainWindow();
  return true;
});

ipcMain.handle('pulse:open-setup', () => { openSetup(); return true; });

ipcMain.handle('pulse:open-external', (event, url) => {
  if (/^https?:/i.test(String(url || ''))) shell.openExternal(url);
  return true;
});

ipcMain.handle('pulse:quit', () => { app.quit(); return true; });
