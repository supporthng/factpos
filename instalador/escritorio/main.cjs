'use strict';
const { app, BrowserWindow, dialog, shell, ipcMain } = require('electron');
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
const urlArg = args.find(x => x.startsWith('--servidor='));
const PORTAL = (process.env.FACTPOS_PORTAL_URL || 'https://factpos.vercel.app').replace(/\/+$/, '');
const localUrl = (urlArg ? urlArg.slice('--servidor='.length) : '') || process.env.FACTPOS_SERVIDOR || config.servidor || 'http://127.0.0.1:3000';
let server;
let endpoint;
function saveConfig() { try { fs.mkdirSync(path.dirname(configPath), { recursive: true }); fs.writeFileSync(configPath, JSON.stringify(config, null, 2)); } catch {} }
// Administración: si el usuario eligió la nube de su empresa, se usa esa; si no, el servidor local.
function resolveTarget() {
  try {
    if (selected === 'admin' && config.empresa) {
      server = new URL(PORTAL);
      endpoint = new URL(`/${config.empresa}/`, server);
    } else {
      server = new URL(localUrl);
      if (!['http:', 'https:'].includes(server.protocol) || server.username || server.password) throw Error('URL inválida');
      endpoint = new URL(selected === 'admin' ? '/admin/' : '/terminal/', server);
    }
    return true;
  } catch { dialog.showErrorBox('FactPOS', 'La dirección del servidor no es válida.'); return false; }
}
function askCompany() {
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (done) return; done = true; ipcMain.removeAllListeners('factpos:empresa'); if (!w.isDestroyed()) w.destroy(); resolve(v); };
    const w = new BrowserWindow({ width: 460, height: 250, resizable: false, minimizable: false, maximizable: false, autoHideMenuBar: true, title: 'FactPOS · Su empresa', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    w.removeMenu();
    ipcMain.on('factpos:empresa', (_e, v) => finish(typeof v === 'string' ? v.trim().toLowerCase() : null));
    w.on('closed', () => finish(null));
    const html = `<!doctype html><meta charset="utf-8"><body style="font:14px Segoe UI,sans-serif;margin:24px;color:#102b3a">
<h3 style="margin:0 0 8px">Administración en la nube</h3>
<p style="margin:0 0 12px">Escriba el nombre corto de su empresa (ej. royalliquorstore).</p>
<input id="e" autofocus style="width:100%;box-sizing:border-box;padding:8px;font-size:15px">
<p id="m" style="color:#b00020;height:18px;margin:6px 0"></p>
<button id="ok" style="padding:8px 18px">Continuar</button> <button id="no" style="padding:8px 18px">Cancelar</button>
<script>
const e=document.getElementById('e'),m=document.getElementById('m');
const go=()=>{const v=e.value.trim().toLowerCase();if(!/^[a-z0-9][a-z0-9-]{1,40}$/.test(v)){m.textContent='Nombre no válido (letras, números y guiones).';return;}window.factpos.empresa(v)};
document.getElementById('ok').onclick=go;document.getElementById('no').onclick=()=>window.factpos.empresa(null);
e.addEventListener('keydown',ev=>{if(ev.key==='Enter')go()});
</script>`;
    w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  });
}

function available(url) {
  return new Promise(resolve => {
    const transport = url.protocol === 'https:' ? require('node:https') : http;
    const request = transport.get(url, { timeout: 3500 }, response => { response.resume(); resolve(response.statusCode < 500); });
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
  if (!resolveTarget()) { app.quit(); return; }
  let ok = await available(endpoint);
  if (!ok && localServer() && !(selected === 'admin' && config.empresa)) {
    const started = await startInstalledServer();
    if (started) ok = await checkWithRetry(endpoint);
  }
  while (!ok) {
    const nube = selected === 'admin';
    const buttons = nube ? ['Reintentar', 'Usar la nube de mi empresa', 'Cerrar'] : ['Reintentar', 'Cerrar'];
    const r = dialog.showMessageBoxSync({ type: 'error', title: 'FactPOS', message: 'FactPOS · Servidor no disponible',
      detail: `No se pudo conectar a ${endpoint.href}.\n\nSi este equipo no tiene FactPOS Servidor instalado, ${nube ? 'use la nube de su empresa.' : 'instale el servidor o indique la dirección del servidor de la tienda.'}`,
      buttons, defaultId: 0, cancelId: buttons.length - 1, noLink: true });
    if (r === buttons.length - 1) { app.quit(); return; }
    if (nube && r === 1) {
      const slug = await askCompany();
      if (!slug) continue;
      config.empresa = slug; saveConfig();
    }
    if (!resolveTarget()) { app.quit(); return; }
    ok = await available(endpoint);
    if (!ok && localServer() && !config.empresa) { if (await startInstalledServer()) ok = await checkWithRetry(endpoint); }
  }
  const win = new BrowserWindow({ width: 1280, height: 820, minWidth: 900, minHeight: 600, title: selected === 'admin' ? 'FactPOS Administración' : 'FactPOS Caja', autoHideMenuBar: true, backgroundColor: '#102b3a', webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } });
  mainOpened = true;
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
let mainOpened = false;
app.on('window-all-closed', () => { if (mainOpened && process.platform !== 'darwin') app.quit(); });
