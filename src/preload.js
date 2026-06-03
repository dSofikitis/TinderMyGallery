'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  pickFolder: (title) => ipcRenderer.invoke('pick-folder', title),
  initSession: (source, dest) => ipcRenderer.invoke('init-session', source, dest),
  scan: (folder) => ipcRenderer.invoke('scan', folder),
  onScanProgress: (cb) => {
    const listener = (_e, found) => cb(found);
    ipcRenderer.on('scan-progress', listener);
    return () => ipcRenderer.removeListener('scan-progress', listener);
  },
  keep: (item) => ipcRenderer.invoke('keep', item),
  discard: (item) => ipcRenderer.invoke('discard', item),
  undo: (entry) => ipcRenderer.invoke('undo', entry),
  thumbnail: (filePath) => ipcRenderer.invoke('thumbnail', filePath),
  preview: (filePath) => ipcRenderer.invoke('preview', filePath),
  abortSession: () => ipcRenderer.invoke('abort-session'),
  finish: () => ipcRenderer.invoke('finish'),
});
