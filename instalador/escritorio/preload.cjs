'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('factpos', { empresa: v => ipcRenderer.send('factpos:empresa', v), ventana: m => ipcRenderer.send('factpos:ventana', m), alActualizar: f => ipcRenderer.on('factpos:actualizacion', (_e, m) => f(m)) });
