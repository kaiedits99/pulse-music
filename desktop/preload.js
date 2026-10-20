// The only bridge between the app's own pages and the main process.
//
// Nothing here reads files, runs commands or touches the site's data — it can ask which website is
// configured, save a new address, retry, or open a link in the real browser. The page that uses it
// most is the first-run setup screen.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pulseDesktop', {
  getState: () => ipcRenderer.invoke('pulse:get-state'),
  saveUrl: (url) => ipcRenderer.invoke('pulse:save-url', url),
  retry: () => ipcRenderer.invoke('pulse:retry'),
  openSetup: () => ipcRenderer.invoke('pulse:open-setup'),
  openExternal: (url) => ipcRenderer.invoke('pulse:open-external', url),
  quit: () => ipcRenderer.invoke('pulse:quit')
});
