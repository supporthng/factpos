'use strict';
const { app, BrowserWindow, dialog, shell, ipcMain, screen } = require('electron');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { execFile } = require('node:child_process');
const crypto = require('node:crypto');
const os = require('node:os');

const ICON = path.join(__dirname, 'factpos.ico');
// La Caja guarda sus datos aparte de la Administración: así cada una puede tener una sola ventana abierta
if (process.argv.some(x => x === '--modo=caja')) app.setPath('userData', path.join(app.getPath('userData'), 'caja'));
const unica = app.requestSingleInstanceLock();
if (!unica) app.quit();
app.on('second-instance', () => { if (mainWindow && !mainWindow.isDestroyed()) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
if (process.platform === 'win32') app.setAppUserModelId('com.factpos.escritorio');
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
    const w = new BrowserWindow({ icon: ICON, width: 460, height: 250, resizable: false, minimizable: false, maximizable: false, autoHideMenuBar: true, title: 'FactPOS · Su empresa', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
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

// ------------------------------------------------------------------ Caja como aplicación
// La pantalla de la caja viaja DENTRO de la aplicación y se sirve solo en este equipo (127.0.0.1), así abre
// aunque el servidor de la sucursal esté apagado. Cuando el servidor sí responde y tiene una versión distinta
// de la pantalla, se descarga la nueva (queda lista para la próxima vez que se abra la caja).
const UI_PORT = 47831; // fijo: el almacenamiento de la caja (ventas guardadas, PIN) depende de la dirección
const UI_BUNDLED = app.isPackaged ? path.join(process.resourcesPath, 'terminal-ui') : path.join(__dirname, '..', '..', 'apps', 'terminal', 'dist');
const UI_CACHE = path.join(app.getPath('userData'), 'terminal-ui');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.webmanifest': 'application/manifest+json' };
const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');
function readOr(file) { try { return fs.readFileSync(file); } catch { return null; } }
function uiRoot() {
  const meta = readOr(path.join(UI_CACHE, 'meta.json'));
  const bundled = readOr(path.join(UI_BUNDLED, 'index.html'));
  try {
    const m = meta && JSON.parse(meta.toString());
    // La caché solo vale si se hizo sobre la misma pantalla que trae esta aplicación
    if (m && bundled && m.base === sha(bundled) && fs.existsSync(path.join(UI_CACHE, 'index.html'))) return UI_CACHE;
  } catch {}
  return UI_BUNDLED;
}
function startUiServer() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      try {
        const u = new URL(req.url, 'http://127.0.0.1');
        if (u.pathname === '/escritorio.json') {
          res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
          return res.end(JSON.stringify({ servidor: localUrl }));
        }
        if (u.pathname === '/principal') return principalApi(req, res, u);
        if (u.pathname === '/respaldo') return respaldoApi(req, res, u);
        if (u.pathname === '/sw.js') { res.writeHead(404); return res.end(); } // sin service worker: la aplicación ya funciona sin conexión
        const root = uiRoot();
        let rel = decodeURIComponent(u.pathname);
        if (rel === '/' || rel === '') rel = '/index.html';
        const file = path.normalize(path.join(root, rel));
        if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
        const data = readOr(file);
        if (!data) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache' });
        res.end(data);
      } catch { res.writeHead(400); res.end(); }
    });
    srv.on('error', () => resolve(false));
    srv.listen(UI_PORT, '127.0.0.1', () => resolve(true));
  });
}
function fetchBuf(url) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? require('node:https') : http;
    const req = transport.get(url, { timeout: 8000 }, r => {
      if (r.statusCode !== 200) { r.resume(); return reject(new Error('HTTP ' + r.statusCode)); }
      const parts = []; r.on('data', c => parts.push(c)); r.on('end', () => resolve(Buffer.concat(parts)));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('tiempo agotado')); });
  });
}
// ------------------------------------------------------------------ Caja principal
// Si se cae el servidor, las cajas se pasan existencia entre sí por la red local. La caja principal solo hace de
// buzón (guarda mensajes en memoria); quien decide cuánto da cada caja es esa misma caja, con su propio cupo.
const BUZON_PORT = 47832;
let buzonSrv = null;
let claveRed = null;
const buzones = new Map(); // cajaId -> { en, msgs[] }
function lanUrl() {
  const cand = [];
  for (const list of Object.values(os.networkInterfaces())) for (const i of list || []) if (i.family === 'IPv4' && !i.internal) cand.push(i.address);
  const ip = cand.find(a => /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(a)) || cand[0];
  return ip ? `http://${ip}:${BUZON_PORT}` : null;
}
function startBuzon() {
  if (buzonSrv) return;
  buzonSrv = http.createServer((req, res) => {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, x-clave-red', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'content-type': 'application/json' };
    const out = (code, obj) => { res.writeHead(code, cors); res.end(JSON.stringify(obj ?? {})); };
    if (req.method === 'OPTIONS') return out(204);
    if (!claveRed) return out(503, { error: 'sin clave' });
    const dada = Buffer.from(String(req.headers['x-clave-red'] || ''));
    const buena = Buffer.from(claveRed);
    if (dada.length !== buena.length || !crypto.timingSafeEqual(dada, buena)) return out(401, { error: 'clave' });
    const u = new URL(req.url, 'http://x');
    const box = id => { let b = buzones.get(id); if (!b) buzones.set(id, b = { en: 0, msgs: [] }); return b; };
    const push = (id, m) => { const b = box(id); if (b.msgs.length < 200) b.msgs.push(m); };
    if (req.method === 'GET' && u.pathname === '/buzon') {
      const id = u.searchParams.get('caja') || '';
      if (!/^[0-9a-f-]{36}$/.test(id)) return out(400);
      const b = box(id); b.en = Date.now();
      const msgs = b.msgs; b.msgs = [];
      return out(200, { msgs });
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', c => { body += c; if (body.length > 4096) req.destroy(); });
      req.on('end', () => {
        try {
          const m = JSON.parse(body);
          const num = Number(m.cantidad);
          const idOk = v => typeof v === 'string' && /^[0-9a-f-]{36}$/.test(v);
          if (!idOk(m.de) || !idOk(m.productoId) || !(num > 0) || num > 1e6) return out(400);
          if (u.pathname === '/pedir') {
            for (const [id, b] of buzones) if (id !== m.de && Date.now() - b.en < 30000) push(id, { tipo: 'pedir', de: m.de, productoId: m.productoId, cantidad: num });
            return out(200);
          }
          if (u.pathname === '/entregar' && idOk(m.para)) { push(m.para, { tipo: 'entrega', de: m.de, productoId: m.productoId, cantidad: num }); return out(200); }
          return out(404);
        } catch { return out(400); }
      });
      return;
    }
    out(404);
  });
  buzonSrv.on('error', () => { buzonSrv = null; });
  buzonSrv.listen(BUZON_PORT, '0.0.0.0');
}
function stopBuzon() { if (buzonSrv) { buzonSrv.close(); buzonSrv = null; } buzones.clear(); }
// La pantalla de esta misma caja enciende o apaga el papel de principal (solo desde 127.0.0.1)
function principalApi(req, res, u) {
  const origin = req.headers.origin;
  if (req.headers.host !== `127.0.0.1:${UI_PORT}` || (origin && origin !== `http://127.0.0.1:${UI_PORT}`)) { res.writeHead(403); return res.end(); }
  const json = (obj) => { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };
  if (req.method === 'GET') return json({ activo: !!config.principal, url: lanUrl() });
  let body = '';
  req.on('data', c => { body += c; if (body.length > 2048) req.destroy(); });
  req.on('end', () => {
    try {
      const m = JSON.parse(body);
      if (typeof m.clave === 'string' && m.clave.length >= 16 && m.clave.length < 200) claveRed = m.clave;
      if (typeof m.activo === 'boolean' && m.activo !== !!config.principal) { config.principal = m.activo; saveConfig(); }
      if (config.principal) startBuzon(); else stopBuzon();
      json({ activo: !!config.principal, url: lanUrl() });
    } catch { res.writeHead(400); res.end(); }
  });
}
// ------------------------------------------------------------------ Respaldo en archivo
// Copia en disco de las ventas guardadas sin servidor y de los e-NCF de reserva de cada caja (además de la base de la
// pantalla). Si se borra el perfil de la aplicación o se daña, las ventas se recuperan de este archivo.
const RESPALDO = path.join(app.getPath('userData'), 'respaldo');
function respaldoApi(req, res, u) {
  const origin = req.headers.origin;
  if (req.headers.host !== `127.0.0.1:${UI_PORT}` || (origin && origin !== `http://127.0.0.1:${UI_PORT}`)) { res.writeHead(403); return res.end(); }
  const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };
  const idOk = v => typeof v === 'string' && /^[0-9a-f-]{36}$/.test(v);
  if (req.method === 'GET') {
    const id = u.searchParams.get('caja');
    if (!idOk(id)) return json(400, {});
    const b = readOr(path.join(RESPALDO, id + '.json'));
    try { return json(200, b ? JSON.parse(b.toString()) : {}); } catch { return json(200, {}); }
  }
  const partes = []; let size = 0;
  req.on('data', c => { size += c.length; if (size > 20 * 1024 * 1024) req.destroy(); else partes.push(c); });
  req.on('end', () => {
    try {
      const m = JSON.parse(Buffer.concat(partes).toString());
      if (!idOk(m.cajaId) || !Array.isArray(m.pendientes) || !Array.isArray(m.reserva)) return json(400, {});
      fs.mkdirSync(RESPALDO, { recursive: true });
      const destino = path.join(RESPALDO, m.cajaId + '.json');
      const tmp = destino + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ cajaId: m.cajaId, guardado: new Date().toISOString(), pendientes: m.pendientes, reserva: m.reserva }));
      fs.renameSync(tmp, destino);
      json(200, { ok: true });
    } catch { json(500, {}); }
  });
}
let syncing = false;
// Descarga la pantalla de la caja que tiene el servidor si es distinta de la que se está usando. Todo o nada.
async function syncUi() {
  if (syncing || !server) return;
  syncing = true;
  try {
    const base = new URL('/terminal/', server);
    const indexBuf = await fetchBuf(new URL('index.html', base));
    const actual = readOr(path.join(uiRoot(), 'index.html'));
    if (actual && sha(actual) === sha(indexBuf)) return;
    const tmp = UI_CACHE + '.nuevo';
    fs.rmSync(tmp, { recursive: true, force: true });
    const hechos = new Set(['index.html']);
    const cola = [];
    const refs = (texto, desde, regex) => {
      for (const m of texto.matchAll(regex)) {
        const r = m[1].trim().replace(/^['"]|['"]$/g, '');
        if (!r || /^(data:|https?:|\/\/|#)/.test(r)) continue;
        const abs = new URL(r.split(/[?#]/)[0], desde);
        if (abs.origin !== base.origin || !abs.pathname.startsWith('/terminal/')) continue;
        const rel = decodeURIComponent(abs.pathname.slice('/terminal/'.length));
        if (rel && !hechos.has(rel)) { hechos.add(rel); cola.push(rel); }
      }
    };
    fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(path.join(tmp, 'index.html'), indexBuf);
    refs(indexBuf.toString('utf8'), new URL('index.html', base), /(?:src|href)=["']([^"']+)["']/g);
    while (cola.length) {
      const rel = cola.shift();
      const buf = await fetchBuf(new URL(rel, base));
      const dest = path.normalize(path.join(tmp, rel));
      if (!dest.startsWith(tmp + path.sep)) throw new Error('ruta no válida');
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, buf);
      if (rel.endsWith('.css')) refs(buf.toString('utf8'), new URL(rel, base), /url\(([^)]+)\)/g);
    }
    const bundled = readOr(path.join(UI_BUNDLED, 'index.html'));
    if (!bundled) throw new Error('sin pantalla base');
    fs.writeFileSync(path.join(tmp, 'meta.json'), JSON.stringify({ base: sha(bundled), hash: sha(indexBuf), en: new Date().toISOString() }));
    const viejo = UI_CACHE + '.viejo';
    fs.rmSync(viejo, { recursive: true, force: true });
    if (fs.existsSync(UI_CACHE)) fs.renameSync(UI_CACHE, viejo);
    fs.renameSync(tmp, UI_CACHE);
    fs.rmSync(viejo, { recursive: true, force: true });
  } catch { /* sin servidor o a medias: se queda la pantalla actual */ }
  finally { syncing = false; }
}
async function startCaja() {
  try { server = new URL(localUrl); } catch { server = null; }
  if (!await startUiServer()) {
    dialog.showErrorBox('FactPOS Caja', `No se pudo iniciar la caja: el puerto ${UI_PORT} de este equipo está ocupado por otro programa.`);
    app.quit(); return;
  }
  endpoint = new URL(`http://127.0.0.1:${UI_PORT}/`);
  if (config.principal) startBuzon(); // la clave llega cuando la pantalla habla con el servidor
  // Si el servidor está en este mismo equipo y no corre, se intenta encender sin hacer esperar a la caja
  if (server && localServer()) { available(server).then(ok => { if (!ok) startInstalledServer(); }); }
  openMain();
  syncUi();
  setInterval(syncUi, 5 * 60 * 1000).unref();
  watchUpdates();
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
  if (selected === 'caja') return startCaja();
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
  openMain();
  watchUpdates();
}

// Pantalla del cliente: segunda ventana (en el segundo monitor, si hay) con lo que se vende y las ofertas
let customerWindow = null;
function closeCustomer() { if (customerWindow && !customerWindow.isDestroyed()) customerWindow.destroy(); customerWindow = null; }
function openCustomer() {
  if (customerWindow && !customerWindow.isDestroyed()) { customerWindow.show(); customerWindow.focus(); return; }
  const pantallas = screen.getAllDisplays();
  const principal = screen.getPrimaryDisplay();
  const otra = pantallas.find(d => d.id !== principal.id);
  const area = (otra || principal).bounds;
  const url = new URL(endpoint.toString());
  url.hash = '/cliente';
  customerWindow = new BrowserWindow({
    icon: ICON, title: 'FactPOS · Pantalla del cliente', autoHideMenuBar: true, backgroundColor: '#0b1620',
    ...(otra ? { x: area.x, y: area.y, width: area.width, height: area.height, fullscreen: true } : { width: 1100, height: 700 }),
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
  });
  customerWindow.removeMenu();
  customerWindow.on('closed', () => { customerWindow = null; });
  customerWindow.loadURL(url.toString());
}

function openMain(onShown) {
  // Nunca dos ventanas principales: si ya hay una, esa es la que se usa
  if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus(); if (onShown) onShown(); return; }
  const win = new BrowserWindow({ show: false, icon: ICON, width: 1280, height: 820, minWidth: 900, minHeight: 600, title: selected === 'admin' ? 'FactPOS Administración' : 'FactPOS Caja', autoHideMenuBar: true, backgroundColor: '#102b3a', webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } });
  mainOpened = true;
  mainWindow = win;
  win.on('closed', closeCustomer);
  // La ventana se muestra cuando la pantalla terminó de cargar y dejó de recargarse (tras una actualización la pantalla
  // detecta la versión nueva y se recarga una vez): así el sistema aparece listo para escribir, sin parpadeos.
  let shown = false, calma = null;
  const mostrar = () => { if (shown || win.isDestroyed()) return; shown = true; clearTimeout(calma); clearTimeout(tope); win.show(); if (kiosko) win.setKiosk(true); win.focus(); win.webContents.focus(); if (onShown) onShown();
    // Con un segundo monitor, la pantalla del cliente se abre sola (se puede apagar con pantallaCliente:false en la configuración)
    if (selected === 'caja' && config.pantallaCliente !== false && screen.getAllDisplays().length > 1) setTimeout(() => { try { openCustomer(); win.focus(); } catch {} }, 1500);
  };
  // La Caja abre en modo kiosko (pantalla completa, sin barra de ventana). F11 alterna con ventana normal;
  // Ctrl+Mayús+Q cierra la caja (pide confirmación). Para abrirla siempre en ventana: --ventana en el acceso directo.
  const kiosko = selected === 'caja' && !args.includes('--ventana') && config.kiosko !== false;
  win.webContents.on('before-input-event', (event, input) => {
    if (selected !== 'caja' || input.type !== 'keyDown') return;
    if (input.key === 'F11') { event.preventDefault(); win.setKiosk(!win.isKiosk()); }
    else if (input.control && input.shift && input.key.toLowerCase() === 'q') {
      event.preventDefault();
      const r = dialog.showMessageBoxSync(win, { type: 'question', buttons: ['Cerrar la caja', 'Seguir vendiendo'], defaultId: 1, cancelId: 1, title: 'FactPOS Caja', message: '¿Cerrar FactPOS Caja?', detail: 'Las ventas guardadas se conservan en esta caja.', noLink: true });
      if (r === 0) app.quit();
    }
  });
  const tope = setTimeout(mostrar, 12000);
  win.webContents.on('did-start-loading', () => clearTimeout(calma));
  win.webContents.on('did-finish-load', () => { clearTimeout(calma); calma = setTimeout(mostrar, 1500); });
  win.webContents.on('did-fail-load', () => { clearTimeout(calma); calma = setTimeout(mostrar, 500); });
  win.removeMenu();
  win.webContents.setWindowOpenHandler(({ url }) => {
    try { const u = new URL(url); if (u.origin === endpoint.origin && u.hash.startsWith('#/cliente')) { openCustomer(); return { action: 'deny' }; } } catch {}
    try { if (new URL(url).origin !== endpoint.origin && /^https?:/.test(url)) shell.openExternal(url); } catch {}
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    try { if (new URL(url).origin !== endpoint.origin) event.preventDefault(); } catch { event.preventDefault(); }
  });
  win.loadURL(endpoint.toString());
}

// ------------------------------------------------------------------ actualizaciones
// Si el servidor se actualiza: se cierra todo, se muestra una ventana pequeña con el avance y,
// al terminar, el sistema se abre de nuevo (las pantallas piden usuario y contraseña porque la versión cambió).
let mainWindow = null;
let miniWindow = null;
let updating = false;
let updateStartedAt = 0;
let versionBefore = null;
function getJson(url) {
  return new Promise(resolve => {
    const transport = url.protocol === 'https:' ? require('node:https') : http;
    const req = transport.get(url, { timeout: 3000 }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => { try { resolve(res.statusCode === 200 ? JSON.parse(data) : null); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}
// En el equipo del servidor, el script de actualización deja el avance en un archivo (el servidor está apagado en pleno reinicio)
function readStateFile() {
  const roots = [];
  if (process.env.PORTABLE_EXECUTABLE_DIR) roots.push(path.resolve(process.env.PORTABLE_EXECUTABLE_DIR, '..'));
  roots.push('C:\\FactPOS');
  for (const r of roots) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(r, 'logs', 'actualizacion-estado.json'), 'utf8').replace(/^\uFEFF/, ''));
      if (j && Date.now() - new Date(j.en).getTime() < 20 * 60 * 1000) return j;
    } catch {}
  }
  return null;
}
function openMini() {
  miniWindow = new BrowserWindow({ icon: ICON, width: 440, height: 230, resizable: false, minimizable: false, maximizable: false, closable: false, alwaysOnTop: true, autoHideMenuBar: true, title: 'FactPOS · Actualizando', backgroundColor: '#102b3a', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  miniWindow.removeMenu();
  miniWindow.loadFile(path.join(__dirname, 'actualizando.html'));
}
function sendMini(msg) { if (miniWindow && !miniWindow.isDestroyed()) miniWindow.webContents.send('factpos:actualizacion', msg); }
function beginUpdate(state) {
  updating = true; updateStartedAt = Date.now(); versionBefore = state.version;
  mainOpened = false; // cerrar las ventanas no debe cerrar la aplicación
  closeCustomer();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
  mainWindow = null;
  openMini();
}
function finishUpdate(ok, text) {
  sendMini({ paso: text, porcentaje: 100, final: true, ok });
  // La ventana de avance se queda hasta que el sistema esté listo para usarse
  const cerrarMini = () => {
    if (miniWindow && !miniWindow.isDestroyed()) { miniWindow.setClosable(true); miniWindow.destroy(); }
    miniWindow = null; updating = false;
  };
  setTimeout(() => {
    sendMini({ paso: 'Abriendo el sistema…', porcentaje: 100, final: true, ok });
    if (selected === 'caja') syncUi().finally(() => openMain(cerrarMini)); else openMain(cerrarMini);
  }, ok ? 2000 : 4500);
}
function watchUpdates() {
  if (selected === 'admin' && config.empresa) return; // administración en la nube: la actualiza el portal
  if (!server) return;
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return; busy = true;
    try {
      const st = await getJson(new URL('/actualizacion/estado', server));
      if (!updating) {
        if (st && st.actualizando) beginUpdate(st);
      } else if (st && !st.actualizando) {
        updating = 'cerrando';
        const changed = st.version !== versionBefore;
        const failed = st.resultado && st.resultado.estado === 'ERROR';
        finishUpdate(!failed, failed ? 'No se pudo actualizar; se conservó la versión anterior.' : changed ? `FactPOS ${st.version} listo` : 'Actualización terminada');
      } else if (updating === true) {
        const f = st ? { paso: st.paso, porcentaje: st.porcentaje, destino: st.destino } : readStateFile();
        sendMini(st ? { paso: f.paso, porcentaje: f.porcentaje, destino: f.destino } : f ? { paso: f.paso, porcentaje: f.porcentaje, destino: f.version, reiniciando: !f.porcentaje } : { paso: 'Reiniciando el servidor…', porcentaje: null });
        if (Date.now() - updateStartedAt > 20 * 60 * 1000) { updating = 'cerrando'; finishUpdate(false, 'La actualización tardó demasiado. Se abrirá el sistema; avise a soporte.'); }
      }
    } finally { busy = false; }
  }, 2500);
  timer.unref();
}
if (unica) app.whenReady().then(start);
let mainOpened = false;
app.on('window-all-closed', () => { if (mainOpened && process.platform !== 'darwin') app.quit(); });
