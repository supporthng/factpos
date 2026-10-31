'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('factpos', { empresa: v => ipcRenderer.send('factpos:empresa', v), alActualizar: f => ipcRenderer.on('factpos:actualizacion', (_e, m) => f(m)) });
