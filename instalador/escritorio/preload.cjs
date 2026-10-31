'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('factpos', { empresa: v => ipcRenderer.send('factpos:empresa', v) });
