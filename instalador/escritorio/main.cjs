'use strict';
const { app, BrowserWindow, dialog, shell } = require('electron');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { execFile } = require('node:child_process');

const args = process.argv.slice(1);
const modeArg = args.find(x => x.startsWith('--modo='));
const mode = modeArg ? modeArg.split('=')[1] : 'admin';
const allowed = new Set(['admin', 'caja']);
const selected = allowed.has(mode) ? mode : 'admin';
const configPath = path.join(app.getPath('userData'), 'conexion.json');
let config = {};
try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {}
const rawUrl = process.env.FACTPOS_SERVIDOR || config.servidor || 'http://127.0.0.1:3000';
let server;
try {
  server = new URL(rawUrl);
  if (!['http:', 'https:'].includes(server.protocol) || server.username || server.password) throw Error('URL inválida');
} catch { dialog.showErrorBox('FactPOS', 'La dirección del servidor no es válida.'); app.quit(); }

function available(url) {
  return new Promise(resolve => {
    const request = http.get(url, { timeout: 3500 }, response => { response.resume(); resolve(response.statusCode < 500); });
    request.on('error', () => resolve(false));
    request.on('timeout', () => { request.destroy(); resolve(false); });
  });
}
function localServer() {
  return ['localhost', '127.0.0.1', '[::1]'].includes(server.hostname);
}
function startInstalledServer() {
  // Only start the task created by the FactPOS server installer, never an arbitrary command.
  return new Promise(resolve => {
    if (process.platform !== 'win32' || !localServer()) return resolve(false);
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      "Start-ScheduledTask -TaskName 'FactPOS Servidor' -ErrorAction Stop"],
      { windowsHide: true, timeout: 10000 }, error => resolve(!error));
  });
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function checkWithRetry(endpoint, attempts = 12) {
  for (let i = 0; i < attempts; i++) {
    if (await available(endpoint)) return true;
    if (i < attempts - 1) await wait(1500);
  }
  return false;
}
async function start() {
  if (!server) return;
  const endpoint = new URL(selected === 'admin' ? '/admin/' : '/terminal/', server);
  let ok = server.protocol === 'http:' ? await available(endpoint) : true;
  if (!ok && localServer()) {
    const started = await startInstalledServer();
    if (started) ok = await checkWithRetry(endpoint);
  }
  if (!ok) {
    dialog.showErrorBox('FactPOS · Servidor no disponible', `No se pudo conectar a ${server.origin}.\n\nCompruebe que FactPOS Servidor esté instalado y en funcionamiento.`);
    app.quit(); return;
  }
  const win = new BrowserWindow({ width: 1280, height: 820, minWidth: 900, minHeight: 600, title: selected === 'admin' ? 'FactPOS Administración' : 'FactPOS Caja', autoHideMenuBar: true, backgroundColor: '#102b3a', webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } });
  win.removeMenu();
  win.webContents.setWindowOpenHandler(({ url }) => {
    try { if (new URL(url).origin !== server.origin && /^https?:/.test(url)) shell.openExternal(url); } catch {}
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    try { if (new URL(url).origin !== server.origin) event.preventDefault(); } catch { event.preventDefault(); }
  });
  win.loadURL(endpoint.toString());
}
app.whenReady().then(start);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
