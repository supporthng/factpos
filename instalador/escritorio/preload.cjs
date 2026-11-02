'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('factpos', { empresa: v => ipcRenderer.send('factpos:empresa', v), turno: v => ipcRenderer.send('factpos:turno', !!v), alIntentarCerrar: f => ipcRenderer.on('factpos:intento-cierre', () => f()), cerrar: () => ipcRenderer.send('factpos:cerrar'), ventana: m => ipcRenderer.send('factpos:ventana', m), alActualizar: f => ipcRenderer.on('factpos:actualizacion', (_e, m) => f(m)) });
