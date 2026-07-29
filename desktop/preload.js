/* Preload: the only bridge between the game page and the OS.
   Three save functions and a flag, nothing else. The game checks for
   window.DEEPCAST_DESKTOP and falls back to localStorage when it is absent,
   which is what keeps the browser build working unchanged. */
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('DEEPCAST_DESKTOP', {
  version: process.versions.electron,
  platform: process.platform,
  readSave: () => ipcRenderer.invoke('save:read'),
  writeSave: data => ipcRenderer.invoke('save:write', data),
  savePath: () => ipcRenderer.invoke('save:path'),
  revealSave: () => ipcRenderer.invoke('save:reveal')
});
