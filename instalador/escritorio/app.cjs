'use strict';
const { app, BrowserWindow, dialog, shell, ipcMain, screen, session } = require('electron');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { execFile } = require('node:child_process');
const crypto = require('node:crypto');
const os = require('node:os');
const dgram = require('node:dgram');

const ICON = path.join(global.__factposBase || __dirname, 'factpos.ico');
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
const PORTAL = (process.env.FACTPOS_PORTAL_URL || 'https://factpos.app').replace(/\/+$/, '');
// config.apuntado: dirección que Administración le ordenó usar (gana sobre la del acceso directo)
// Una dirección guardada a medias (sin http://, con espacios o barras de más) no debe impedir abrir la app
function urlValida(u) {
  if (typeof u !== 'string') return '';
  let t = u.trim().replace(/\/+$/, '');
  if (!t) return '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) t = 'http://' + t;
  try { const x = new URL(t); return ['http:', 'https:'].includes(x.protocol) && !x.username && !x.password && x.hostname ? t : ''; } catch { return ''; }
}
let localUrl = [config.apuntado, urlArg ? urlArg.slice('--servidor='.length) : '', process.env.FACTPOS_SERVIDOR, config.servidor].map(urlValida).find(Boolean) || 'http://127.0.0.1:3000';
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
// ---- Búsqueda del servidor de la sucursal en la red (la hace este programa, que sí puede usar UDP; la pantalla no)
function redesLocales() {
  const out = [];
  for (const lista of Object.values(os.networkInterfaces())) for (const i of lista || []) {
    if (i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.')) out.push(i);
  }
  return out;
}
function difusion(i) { // dirección de broadcast de la red de esa tarjeta
  const ip = i.address.split('.').map(Number), m = i.netmask.split('.').map(Number);
  return ip.map((b, k) => (b | (255 ^ m[k]))).join('.');
}
const hallado = (d, url) => ({ url, empresa: d.empresa ?? null, sucursales: Array.isArray(d.sucursales) ? d.sucursales : [], equipo: d.equipo ?? '' });
// El servidor contesta «FACTPOS?» en el puerto UDP 41234 con sus datos (igual que el instalador de la caja)
function buscarPorUdp(ms = 1500) {
  return new Promise(resolve => {
    const hallados = new Map();
    let s;
    try { s = dgram.createSocket('udp4'); } catch { return resolve([]); }
    let listo = false;
    const fin = () => { if (listo) return; listo = true; try { s.close(); } catch {} resolve([...hallados.values()]); };
    s.on('error', fin);
    s.on('message', (msg, r) => {
      try {
        const d = JSON.parse(msg.toString());
        if (d && d.producto === 'FactPOS') { const url = `http://${r.address}:${d.puerto || 3000}`; hallados.set(url, hallado(d, url)); }
      } catch {}
    });
    s.bind(0, () => {
      try { s.setBroadcast(true); } catch {}
      const pregunta = Buffer.from('FACTPOS?');
      for (const dest of new Set(['255.255.255.255', ...redesLocales().map(difusion)])) { try { s.send(pregunta, 41234, dest); } catch {} }
    });
    setTimeout(fin, ms);
  });
}
function probarHttp(url, ms) {
  return new Promise(resolve => {
    const req = http.get(`${url}/descubrir`, { timeout: ms }, r => {
      if (r.statusCode !== 200) { r.resume(); return resolve(null); }
      let t = '';
      r.on('data', c => { t += c; if (t.length > 20000) req.destroy(); });
      r.on('end', () => { try { const d = JSON.parse(t); resolve(d && d.producto === 'FactPOS' ? hallado(d, url) : null); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}
// Si el router no deja pasar el broadcast: se prueba el puerto 3000 en toda la red de cada tarjeta de este equipo
async function barrerRedes() {
  const hallados = [];
  for (const base of new Set(redesLocales().map(i => i.address.split('.').slice(0, 3).join('.')))) {
    const urls = Array.from({ length: 254 }, (_, k) => `http://${base}.${k + 1}:3000`);
    for (let k = 0; k < urls.length; k += 127) (await Promise.all(urls.slice(k, k + 127).map(u => probarHttp(u, 500)))).forEach(e => e && hallados.push(e));
    if (hallados.length) break;
  }
  return hallados;
}
async function descubrirRed() { const u = await buscarPorUdp(); return u.length ? u : barrerRedes(); }

function startUiServer() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      try {
        const u = new URL(req.url, 'http://127.0.0.1');
        if (u.pathname === '/escritorio.json') {
          res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
          // La caja solo usa servidores de SU red local. Sin tarjetas de red no se puede saber (null): ahí no se toca nada.
          const hayRed = redesLocales().length > 0;
          const pedido = u.searchParams.get('servidor');
          return res.end(JSON.stringify({ servidor: !hayRed || enMiRed(localUrl) ? localUrl : '', enRed: pedido && hayRed ? enMiRed(pedido) : null }));
        }
        if (u.pathname === '/descubrir-red') {
          if (req.headers.host !== `127.0.0.1:${UI_PORT}`) { res.writeHead(403); return res.end(); }
          const responder = lista => { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(lista)); };
          descubrirRed().then(responder, () => responder([]));
          return;
        }
        if (u.pathname === '/principal') return principalApi(req, res, u);
        if (u.pathname === '/respaldo') return respaldoApi(req, res, u);
        if (u.pathname === '/respaldo-pausadas') return respaldoPausadasApi(req, res, u);
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
// Ventas en pausa: copia en archivo (además de localStorage de la pantalla), porque lo guardado por la pantalla puede perderse
// si el proceso se cierra a la fuerza al actualizar. Un archivo por caja; se escribe en cada cambio.
function respaldoPausadasApi(req, res, u) {
  const origin = req.headers.origin;
  if (req.headers.host !== `127.0.0.1:${UI_PORT}` || (origin && origin !== `http://127.0.0.1:${UI_PORT}`)) { res.writeHead(403); return res.end(); }
  const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };
  const idOk = v => typeof v === 'string' && /^[0-9a-f-]{36}$/.test(v);
  const archivo = id => path.join(RESPALDO, 'pausadas-' + id + '.json');
  if (req.method === 'GET') {
    const id = u.searchParams.get('caja');
    if (!idOk(id)) return json(400, {});
    const b = readOr(archivo(id));
    try { return json(200, b ? JSON.parse(b.toString()) : {}); } catch { return json(200, {}); }
  }
  const partes = []; let size = 0;
  req.on('data', c => { size += c.length; if (size > 5 * 1024 * 1024) req.destroy(); else partes.push(c); });
  req.on('end', () => {
    try {
      const m = JSON.parse(Buffer.concat(partes).toString());
      if (!idOk(m.cajaId) || !Array.isArray(m.pausadas)) return json(400, {});
      fs.mkdirSync(RESPALDO, { recursive: true });
      const destino = archivo(m.cajaId);
      const tmp = destino + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ cajaId: m.cajaId, guardado: new Date().toISOString(), pausadas: m.pausadas }));
      fs.renameSync(tmp, destino);
      json(200, { ok: true });
    } catch { json(500, {}); }
  });
}
// app.exit no pasa por before-quit: se vacía a disco lo que la pantalla guardó (ventas en pausa, etc.) antes de salir
function salirYa() { try { session.defaultSession.flushStorageData(); } catch { /* sin sesión */ } setTimeout(() => app.exit(0), 300); }
let syncing = false;
// Código de la ventana de escritorio (este mismo programa): si el servidor trae uno más nuevo, se descarga, se verifica su huella
// y se aplica la próxima vez que se abra la caja (lo carga main.cjs). Todo o nada.
const CODIGO_ARCHIVOS = ['app.cjs', 'preload.cjs', 'actualizando.html'];
const versionMayor = (a, b) => { const x = String(a || '0').split('.').map(n => parseInt(n, 10) || 0), y = String(b || '0').split('.').map(n => parseInt(n, 10) || 0); for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
let sincronizandoCodigo = false;
async function syncCodigo() {
  if (sincronizandoCodigo || !server || !global.__factposCarpetaCodigo || !deMiRed(server.origin)) return;
  sincronizandoCodigo = true;
  try {
    const base = new URL('/escritorio-codigo/', server);
    const man = JSON.parse((await fetchBuf(new URL('manifest.json', base))).toString('utf8'));
    if (!man || !man.version || !versionMayor(man.version, global.__factposVersionCodigo)) return;
    if (!man.archivos || CODIGO_ARCHIVOS.some(n => !/^[0-9a-f]{64}$/.test(man.archivos[n] || ''))) return;
    const carpeta = global.__factposCarpetaCodigo, tmp = carpeta + '.nuevo';
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    const huellas = {};
    for (const n of CODIGO_ARCHIVOS) {
      const buf = await fetchBuf(new URL(n, base));
      if (sha(buf) !== man.archivos[n]) throw new Error('huella distinta: ' + n);
      fs.writeFileSync(path.join(tmp, n), buf);
      huellas[n] = man.archivos[n];
    }
    fs.writeFileSync(path.join(tmp, 'meta.json'), JSON.stringify({ version: man.version, archivos: huellas, arranques: 0, en: new Date().toISOString() }));
    const viejo = carpeta + '.viejo';
    fs.rmSync(viejo, { recursive: true, force: true });
    if (fs.existsSync(carpeta)) fs.renameSync(carpeta, viejo);
    fs.renameSync(tmp, carpeta);
    fs.rmSync(viejo, { recursive: true, force: true });
    return true; // código nuevo guardado: se aplica al reiniciar
  } catch { return false; /* sin servidor o a medias: se queda el código actual */ }
  finally { sincronizandoCodigo = false; }
}
// Descarga la pantalla de la caja que tiene el servidor si es distinta de la que se está usando. Todo o nada.
async function syncUi() {
  if (syncing || !server || !deMiRed(server.origin)) return false; // nunca se baja la pantalla de un servidor de otra red
  syncing = true;
  try {
    const base = new URL('/terminal/', server);
    const indexBuf = await fetchBuf(new URL('index.html', base));
    const actual = readOr(path.join(uiRoot(), 'index.html'));
    if (actual && sha(actual) === sha(indexBuf)) return false;
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
    fs.writeFileSync(path.join(tmp, 'meta.json'), JSON.stringify({ base: sha(bundled), hash: sha(indexBuf), origen: base.origin, en: new Date().toISOString() }));
    const viejo = UI_CACHE + '.viejo';
    fs.rmSync(viejo, { recursive: true, force: true });
    if (fs.existsSync(UI_CACHE)) fs.renameSync(UI_CACHE, viejo);
    fs.renameSync(tmp, UI_CACHE);
    fs.rmSync(viejo, { recursive: true, force: true });
    return true; // había una pantalla nueva y ya está guardada
  } catch { return false; /* sin servidor o a medias: se queda la pantalla actual */ }
  finally { syncing = false; }
}
// Arranque: se dibuja de inmediato una ventanita de «Abriendo…» (antes no se veía nada hasta que la caja estaba lista)
// y se anota cuánto tarda cada etapa en arranque.log (carpeta de datos de la app) para saber dónde se va el tiempo.
let splash = null;
const t0 = Date.now();
function marca(etapa) {
  try { fs.appendFileSync(path.join(app.getPath('userData'), 'arranque.log'), `${new Date().toISOString()} +${Date.now() - t0}ms ${etapa}\n`); } catch { /* es solo diagnóstico */ }
}
function abrirSplash() {
  try {
    splash = new BrowserWindow({ icon: ICON, width: 380, height: 190, frame: false, resizable: false, movable: false, minimizable: false, maximizable: false, closable: false, skipTaskbar: true, alwaysOnTop: true, center: true, backgroundColor: '#102b3a', title: 'FactPOS' });
    splash.removeMenu();
    const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#102b3a;color:#fff;font:600 20px Segoe UI,sans-serif">
<div style="width:34px;height:34px;border:4px solid rgba(255,255,255,.25);border-top-color:#fff;border-radius:50%;animation:g 1s linear infinite;margin-bottom:18px"></div>
FactPOS<div style="font:400 14px Segoe UI,sans-serif;opacity:.8;margin-top:6px">Abriendo la caja…</div><style>@keyframes g{to{transform:rotate(360deg)}}</style>`;
    splash.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  } catch { splash = null; }
}
function cerrarSplash() { try { if (splash && !splash.isDestroyed()) { splash.setClosable(true); splash.destroy(); } } catch { /* ya cerrada */ } splash = null; }

async function startCaja() {
  marca('inicio'); abrirSplash();
  mostrarEscritorio(); // por si la vez anterior se cerró a la fuerza con el escritorio oculto
  try { server = new URL(localUrl); } catch { server = null; }
  if (!await startUiServer()) {
    cerrarSplash();
    dialog.showErrorBox('FactPOS Caja', `No se pudo iniciar la caja: el puerto ${UI_PORT} de este equipo está ocupado por otro programa.`);
    app.quit(); return;
  }
  endpoint = new URL(`http://127.0.0.1:${UI_PORT}/`);
  marca('servidor de pantalla listo');
  if (config.principal) startBuzon(); // la clave llega cuando la pantalla habla con el servidor
  // Si el servidor está en este mismo equipo y no corre, se intenta encender sin hacer esperar a la caja
  if (server && localServer()) { available(server).then(ok => { if (!ok) startInstalledServer(); }); }
  // Antes de abrir la ventana se revisa si el servidor trae una pantalla o un código más nuevo (como mucho 2,5 s: sin servidor se abre igual).
  // Así la caja abre YA con la versión nueva y no hace falta cerrarla y volverla a abrir.
  await Promise.race([asegurarServidor(), new Promise(r => setTimeout(r, 8000))]);
  // La pantalla guardada de una vez anterior solo vale si vino de un servidor de esta red (si no, p. ej. la de otra sucursal, se descarta)
  try {
    const m = JSON.parse(fs.readFileSync(path.join(UI_CACHE, 'meta.json'), 'utf8'));
    if (!m.origen || !deMiRed(m.origen)) fs.rmSync(UI_CACHE, { recursive: true, force: true });
  } catch { /* sin pantalla guardada */ }
  marca('servidor localizado');
  const revision = await Promise.race([Promise.all([syncUi(), syncCodigo()]), new Promise(r => setTimeout(() => r(null), 2500))]);
  marca('revisión de pantalla y código lista');
  if (revision && revision[1] === true && !args.includes('--codigo-nuevo')) {
    // El código de esta ventana de escritorio solo se carga al arrancar: se reinicia una sola vez para usar el nuevo
    try { app.relaunch({ args: process.argv.slice(1).concat('--codigo-nuevo') }); salirYa(); return; } catch { /* sigue con el actual */ }
  }
  openMain();
  // Con la caja abierta: si llega una pantalla nueva y no hay un turno en curso, se recarga sola (con turno abierto espera al próximo arranque)
  setInterval(async () => { if (await syncUi() && mainWindow && !mainWindow.isDestroyed() && !turnoAbierto) { try { mainWindow.webContents.reloadIgnoringCache(); } catch {} } }, 5 * 60 * 1000).unref();
  setInterval(syncCodigo, 30 * 60 * 1000).unref();
  // Si el servidor deja de responder (por ejemplo cambió su IP), se vuelve a buscar en la red y la pantalla se recarga con la dirección nueva
  let buscando = false;
  setInterval(async () => {
    if (buscando || (server && localServer())) return; buscando = true;
    try {
      const antes = localUrl;
      if (await asegurarServidor() && localUrl !== antes && mainWindow && !mainWindow.isDestroyed() && !turnoAbierto) { try { mainWindow.webContents.reloadIgnoringCache(); } catch {} }
    } finally { buscando = false; }
  }, 5 * 60 * 1000).unref();
  watchUpdates();
}

// La caja no depende de una dirección fija: si el servidor no responde (cambió la IP, otro router, equipo nuevo), lo busca en la red.
// Se adopta el que tenga el mismo nombre de equipo que el último conocido, o el único que haya; si hay varios y ninguno coincide, no adivina.
// ¿La dirección está en la red de ESTE equipo? (o es el propio equipo). Una dirección de internet, o de otra red, es de otra sucursal.
function enMiRed(url) {
  let h; try { h = new URL(url).hostname; } catch { return false; }
  if (['localhost', '127.0.0.1', '[::1]', 'factpos.local'].includes(h)) return true;
  const ip = h.split('.').map(Number);
  if (ip.length !== 4 || ip.some(Number.isNaN)) return false;
  return redesLocales().some(i => { const a = i.address.split('.').map(Number), m = i.netmask.split('.').map(Number); return a.every((b, k) => (b & m[k]) === (ip[k] & m[k])); });
}
// Sin tarjetas de red no se puede saber: se considera de la red (no se bloquea nada).
const deMiRed = (url) => redesLocales().length === 0 || enMiRed(url);
async function asegurarServidor() {
  const guardado = server && enMiRed(server.origin);
  if (guardado && await available(server)) {
    if (!localServer()) probarHttp(server.origin, 1500).then(d => { if (d && d.equipo && d.equipo !== config.servidorEquipo) { config.servidorEquipo = d.equipo; saveConfig(); } });
    return true;
  }
  // El guardado no está en esta red (p. ej. quedó apuntando a otra sucursal por su dirección de internet) o no responde: se busca en la red local.
  const lista = await descubrirRed().catch(() => []);
  if (server && lista.some(x => x.url === server.origin)) return true;
  const elegido = lista.find(x => config.servidorEquipo && x.equipo === config.servidorEquipo) ?? (lista.length === 1 ? lista[0] : null);
  if (!elegido) return !!(server && await available(server)); // nada nuevo en la red: se queda con el guardado
  try {
    const nuevo = new URL(elegido.url);
    localUrl = nuevo.origin; server = nuevo;
    config.servidor = nuevo.origin; if (config.apuntado) config.apuntado = nuevo.origin;
    if (elegido.equipo) config.servidorEquipo = elegido.equipo;
    saveConfig();
    return true;
  } catch { return false; }
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
  // Igual que la caja: antes de abrir, la administración se asegura de mostrar lo más nuevo. Se vacía la caché del navegador
  // (así la página se pide de nuevo al servidor) y, si el servidor trae código nuevo de esta ventana de escritorio, se reinicia una sola vez.
  if (selected === 'admin') {
    try { await session.defaultSession.clearCache(); } catch { /* sigue con lo que haya */ }
    if (!config.empresa) {
      const codigo = await Promise.race([syncCodigo(), new Promise(r => setTimeout(() => r(null), 4000))]);
      if (codigo === true && !args.includes('--codigo-nuevo')) {
        try { app.relaunch({ args: process.argv.slice(1).concat('--codigo-nuevo') }); salirYa(); return; } catch { /* sigue con el actual */ }
      }
    }
    setInterval(syncCodigo, 30 * 60 * 1000).unref();
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
    ...(otra ? { x: area.x, y: area.y, width: area.width, height: area.height, fullscreen: true } : { width: 1100, height: 700, alwaysOnTop: true }),
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
  });
  customerWindow.removeMenu();
  // Con una sola pantalla la caja (kiosko) está por encima de todo: la ventana del cliente se pone al mismo nivel para que se vea
  if (!otra) { try { customerWindow.setAlwaysOnTop(true, 'screen-saver'); } catch {} }
  customerWindow.on('closed', () => { customerWindow = null; });
  customerWindow.loadURL(url.toString());
  // Si la pantalla del cliente queda vacía (falló la carga o no dibujó nada), se recarga sola
  const cw = customerWindow;
  const revisar = async () => {
    if (cw.isDestroyed()) return false;
    try { const n = await cw.webContents.executeJavaScript('(document.body && document.body.innerText || "").trim().length'); if (n > 0) return true; } catch {}
    try { cw.webContents.loadURL(url.toString()); } catch {}
    return false;
  };
  cw.webContents.on('did-fail-load', (_e, codigo, _d, _u, principal) => { if (principal && codigo !== -3) setTimeout(() => { if (!cw.isDestroyed()) { try { cw.webContents.loadURL(url.toString()); } catch {} } }, 2500); });
  cw.webContents.on('render-process-gone', () => setTimeout(() => { if (!cw.isDestroyed()) { try { cw.webContents.loadURL(url.toString()); } catch {} } }, 1000));
  let intentos = 0;
  const vigia = setInterval(async () => { if (cw.isDestroyed() || ++intentos > 6) { clearInterval(vigia); return; } if (await revisar()) clearInterval(vigia); }, 4000);
  vigia.unref();
}

// ---------------------------------------------------------------------------------------------------- Impresión de la caja
// Qué impresora usa esta terminal y qué pasó en los últimos intentos (para revisar errores como «el papel sale largo» desde Configuración).
const IMP_CFG = path.join(app.getPath('userData'), 'impresion.json');
const IMP_LOG = path.join(app.getPath('userData'), 'impresion.log');
// estaciones: impresora propia de cada estación de comandas (cocina, barra…), por id de estación; las demás salen por `impresora`
function limpiarEstaciones(e) {
  const o = {};
  if (e && typeof e === 'object') for (const k of Object.keys(e).slice(0, 40)) { if (/^[0-9a-f-]{8,40}$/i.test(k) && typeof e[k] === 'string' && e[k]) o[k] = e[k].slice(0, 200); }
  return o;
}
let impCfg = { impresora: '', ancho: 80, estaciones: {} };
try { const c = JSON.parse(fs.readFileSync(IMP_CFG, 'utf8')); if (c && typeof c === 'object') impCfg = { impresora: String(c.impresora || ''), ancho: c.ancho === 58 ? 58 : 80, estaciones: limpiarEstaciones(c.estaciones) }; } catch {}
const registroImp = [];
function anotarImpresion(r) {
  const fila = { en: new Date().toISOString(), impresora: impCfg.impresora || '(predeterminada)', ancho: impCfg.ancho, ...r };
  registroImp.unshift(fila); registroImp.length = Math.min(registroImp.length, 20);
  try { fs.appendFileSync(IMP_LOG, JSON.stringify(fila) + '\n'); } catch {}
}
async function midoTicket(wc) {
  try {
    const mm = await wc.executeJavaScript(`(() => { const t = document.getElementById('ticket'); if (!t) return 0;
      const z = parseFloat(getComputedStyle(document.getElementById('root') || document.body).zoom) || 1;
      return Math.ceil(t.getBoundingClientRect().height / z * 25.4 / 96); })()`);
    return mm > 20 && mm < 2000 ? mm : 0;
  } catch { return 0; }
}
function opcionesImp(mm, impresora) {
  const o = { silent: true, printBackground: false, margins: { marginType: 'none' } };
  const destino = impresora === undefined ? impCfg.impresora : impresora;
  if (destino) o.deviceName = destino;
  if (mm) o.pageSize = { width: impCfg.ancho * 1000, height: (mm + 8) * 1000 };   // micras: el largo exacto del ticket
  return o;
}
// Imprime el contenido de una ventana con la impresora elegida; resuelve { ok, motivo }.
function imprimirVentana(wc, mm, impresora) {
  return new Promise(resolve => {
    try { wc.print(opcionesImp(mm, impresora), (ok, motivo) => resolve({ ok: !!ok, motivo: ok ? '' : String(motivo || 'no se pudo imprimir') })); }
    catch (e) { resolve({ ok: false, motivo: String(e && e.message || e) }); }
  });
}
function registrarImpresionIpc() {
  const deLaCaja = e => mainWindow && !mainWindow.isDestroyed() && e.sender === mainWindow.webContents;
  ipcMain.handle('factpos:impresion-estado', async e => {
    if (!deLaCaja(e)) return null;
    let lista = [];
    try { lista = (await mainWindow.webContents.getPrintersAsync()).map(p => ({ nombre: p.name, mostrar: p.displayName || p.name, descripcion: p.description || '', predeterminada: !!p.isDefault, estado: p.status })); } catch {}
    return { impresoras: lista, impresora: impCfg.impresora, ancho: impCfg.ancho, estaciones: impCfg.estaciones, registro: registroImp };
  });
  ipcMain.handle('factpos:impresion-guardar', async (e, c) => {
    if (!deLaCaja(e) || !c) return false;
    impCfg = { impresora: typeof c.impresora === 'string' ? c.impresora.slice(0, 200) : '', ancho: c.ancho === 58 ? 58 : 80, estaciones: limpiarEstaciones(c.estaciones) };
    try { fs.writeFileSync(IMP_CFG, JSON.stringify(impCfg)); } catch {}
    return true;
  });
  ipcMain.handle('factpos:impresion-prueba', async (e, elegida) => {
    if (!deLaCaja(e)) return { ok: false, motivo: 'no permitido' };
    const destino = typeof elegida === 'string' && elegida ? elegida.slice(0, 200) : impCfg.impresora;
    const w = new BrowserWindow({ show: false, width: 400, height: 600, webPreferences: { sandbox: true } });
    try {
      const lineas = ['FactPOS · Prueba de impresión', new Date().toLocaleString('es-DO'), 'Impresora: ' + (destino || '(predeterminada)'), 'Papel: ' + impCfg.ancho + ' mm', '------------------------------', 'Si ve este texto completo y el papel', 'se corta justo debajo de la última línea,', 'la impresión está bien configurada.', '------------------------------', 'Fin de la prueba'];
      const html = `<!doctype html><meta charset="utf-8"><body style="margin:0"><div id="ticket" style="width:${impCfg.ancho - 8}mm;padding:2mm 4mm;font:12px Consolas,monospace">${lineas.map(l => `<div>${l.replace(/[<&]/g, '')}</div>`).join('')}</div>`;
      await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
      const mm = await midoTicket(w.webContents);
      const r = await imprimirVentana(w.webContents, mm, destino);
      anotarImpresion({ origen: 'prueba', mm, impresora: destino || '(predeterminada)', ...r });
      return { ...r, mm };
    } catch (x) { const r = { ok: false, motivo: String(x && x.message || x) }; anotarImpresion({ origen: 'prueba', mm: 0, ...r }); return r; }
    finally { try { w.destroy(); } catch {} }
  });
}
function openMain(onShown) {
  // Nunca dos ventanas principales: si ya hay una, esa es la que se usa
  if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus(); if (onShown) onShown(); return; }
  const win = new BrowserWindow({ show: false, icon: ICON, width: 1280, height: 820, minWidth: 900, minHeight: 600, title: selected === 'admin' ? 'FactPOS Administración' : 'FactPOS Caja', autoHideMenuBar: true, backgroundColor: '#102b3a', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } });
  mainOpened = true;
  mainWindow = win;
  // La pantalla de entrada del admin es solo el cuadro pequeño; al entrar la ventana vuelve a su tamaño normal
  win.webContents.on('ipc-message', (_e, canal, modo) => {
    if (canal === 'factpos:turno') { turnoAbierto = !!modo; return; }
    if (canal === 'factpos:cerrar') { app.quit(); return; }
    if (canal === 'factpos:imprimir') {
      // Impresión directa por la impresora elegida en Configuración (o la predeterminada de Windows), sin el cuadro de imprimir.
      // Si no se pudo (sin impresora, apagada), se abre el cuadro normal para que el cajero elija otra en vez de perder el comprobante.
      // Se pide una página del largo exacto del ticket: el controlador suele traer un largo de papel fijo y sale papel en blanco de sobra.
      (async () => {
        let css = null;
        // Una comanda trae el id de su estación: si esta terminal le asignó una impresora, sale por ella; si no, por la de la caja
        const propia = typeof modo === 'string' && modo ? (impCfg.estaciones[modo] || '') : '';
        const destino = propia || impCfg.impresora;
        const origen = typeof modo === 'string' && modo ? 'comanda' : 'ticket';
        try {
          if (impCfg.ancho === 58) css = await win.webContents.insertCSS('@media print { #ticket { width: 50mm !important; } }');
          const mm = await midoTicket(win.webContents);
          let r = await imprimirVentana(win.webContents, mm, destino);
          anotarImpresion({ origen, mm, impresora: destino || '(predeterminada)', ...r });
          // La impresora de la estación está apagada o no responde: la comanda sale por la de la caja en vez de perderse
          if (!r.ok && propia && !win.isDestroyed()) {
            r = await imprimirVentana(win.webContents, mm, impCfg.impresora);
            anotarImpresion({ origen: 'comanda (respaldo)', mm, impresora: impCfg.impresora || '(predeterminada)', ...r });
          }
          if (!r.ok && !win.isDestroyed()) { try { win.webContents.print({ silent: false, printBackground: false }); } catch {} }
        } catch (x) {
          anotarImpresion({ origen: 'ticket', mm: 0, ok: false, motivo: String(x && x.message || x) });
          try { win.webContents.print({ silent: false, printBackground: false }); } catch {}
        } finally { if (css) { try { win.webContents.removeInsertedCSS(css); } catch {} } }
      })();
      return;
    }
    if (canal === 'factpos:minimizar') { minimizarAutorizado = true; mostrarEscritorio(); try { win.setAlwaysOnTop(false); win.setKiosk(false); win.minimize(); } catch {} return; }
    if (canal !== 'factpos:ventana' || selected !== 'admin' || win.isDestroyed() || win.isKiosk()) return;
    if (modo === 'entrar') {
      if (win.isMaximized()) win.unmaximize();
      win.setMinimumSize(420, 560); win.setResizable(false); win.setMaximizable(false); win.setSize(460, 620); win.center();
    } else if (modo === 'app') {
      win.setResizable(true); win.setMaximizable(true); win.setMinimumSize(900, 600); win.setSize(1280, 820); win.center();
    }
  });
  win.on('closed', closeCustomer);
  // Seguridad de la caja: con el turno abierto la ventana no se cierra (Alt+F4, cerrar, Ctrl+Mayús+Q): la pantalla pide
  // el PIN de un supervisor. Al apagar Windows o al actualizar sí se deja cerrar.
  win.on('close', (e) => {
    if (selected !== 'caja' || !turnoAbierto || saliendo || updating || win.isDestroyed()) return;
    e.preventDefault();
    try { win.webContents.send('factpos:intento-cierre'); } catch {}
  });
  // La ventana se muestra cuando la pantalla terminó de cargar y dejó de recargarse (tras una actualización la pantalla
  // detecta la versión nueva y se recarga una vez): así el sistema aparece listo para escribir, sin parpadeos.
  let shown = false, calma = null;
  const mostrar = () => { if (shown || win.isDestroyed()) return; shown = true; clearTimeout(calma); clearTimeout(tope); win.show(); cerrarSplash(); marca('ventana mostrada'); try { global.__factposListo && global.__factposListo(); } catch {} if (kiosko) { win.setKiosk(true); ocultarEscritorio(); iniciarVigiaAnydesk(); } win.focus(); win.webContents.focus(); if (onShown) onShown();
    // Con un segundo monitor, la pantalla del cliente se abre sola (se puede apagar con pantallaCliente:false en la configuración)
    if (selected === 'caja' && config.pantallaCliente !== false && screen.getAllDisplays().length > 1) setTimeout(() => { try { openCustomer(); win.focus(); } catch {} }, 1500);
  };
  // La Caja abre en modo kiosko (pantalla completa, sin barra de ventana). F11 alterna con ventana normal;
  // Ctrl+Mayús+Q cierra la caja (pide confirmación). Para abrirla siempre en ventana: --ventana en el acceso directo.
  const kiosko = selected === 'caja' && !args.includes('--ventana');
  // Caja bloqueada: mientras está abierta (modo kiosko) no se puede minimizar, salir de pantalla completa, abrir otras ventanas
  // ni cambiar con F11. Para salir hace falta el permiso de un supervisor (Ctrl+Mayús+Q o Salir). Con --ventana no se bloquea.
  // Soporte remoto: mientras AnyDesk tenga una ventana a la vista (solicitud de conexión o sesión abierta) la caja no se pone
  // encima ni le quita el foco. En reposo AnyDesk no tiene ventanas, así que el cliente no puede abrirlo.
  let anydeskVisible = false, vigiaAnydesk = null;
  const iniciarVigiaAnydesk = () => {
    if (process.platform !== 'win32' || vigiaAnydesk) return;
    const ps = [
      "Add-Type -Namespace W -Name U -MemberDefinition '[DllImport(\"user32.dll\")] public static extern bool EnumWindows(EnumProc p, IntPtr l); public delegate bool EnumProc(IntPtr h, IntPtr l); [DllImport(\"user32.dll\")] public static extern bool IsWindowVisible(IntPtr h); [DllImport(\"user32.dll\")] public static extern int GetWindowTextLength(IntPtr h); [DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);'",
      "$ult=-1",
      "while($true){ $ids=@(Get-Process -Name AnyDesk -ErrorAction SilentlyContinue | ForEach-Object { $_.Id }); $hay=0",
      "if($ids.Count -gt 0){ $cb=[W.U+EnumProc]{ param($h,$l) if([W.U]::IsWindowVisible($h) -and [W.U]::GetWindowTextLength($h) -gt 0){ $p=[uint32]0; [void][W.U]::GetWindowThreadProcessId($h,[ref]$p); if($ids -contains [int]$p){ $script:hay=1 } }; return $true }; [void][W.U]::EnumWindows($cb,[IntPtr]::Zero) }",
      "if($hay -ne $ult){ $ult=$hay; [Console]::Out.WriteLine($hay); [Console]::Out.Flush() }; Start-Sleep -Milliseconds 1000 }",
    ].join('; ');
    try {
      vigiaAnydesk = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', ps], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      let resto = '';
      vigiaAnydesk.stdout.on('data', (d) => {
        resto += d.toString();
        const lineas = resto.split(/\r?\n/); resto = lineas.pop();
        for (const l of lineas) {
          if (l.trim() === '1') { anydeskVisible = true; try { win.setAlwaysOnTop(false); } catch {} }
          else if (l.trim() === '0') { anydeskVisible = false; setTimeout(fijar, 50); }
        }
      });
      vigiaAnydesk.on('exit', () => { vigiaAnydesk = null; anydeskVisible = false; });
      win.on('closed', () => { try { vigiaAnydesk && vigiaAnydesk.kill(); } catch {} });
    } catch { vigiaAnydesk = null; }
  };
  const bloqueada = () => kiosko && selected === 'caja' && !saliendo && !updating && !win.isDestroyed();
  const fijar = () => { if (!bloqueada() || anydeskVisible) return; try { win.setAlwaysOnTop(true, 'screen-saver'); if (!win.isKiosk()) win.setKiosk(true); } catch {} };
  // Minimizar solo con el permiso de un supervisor: si se intenta sin permiso, la ventana vuelve y la pantalla pide el PIN
  win.on('minimize', () => {
    if (!bloqueada()) return;
    if (minimizarAutorizado) { minimizarAutorizado = false; return; }
    try { win.restore(); win.focus(); win.webContents.send('factpos:intento-minimizar'); } catch {}
  });
  win.on('restore', () => { if (bloqueada()) { ocultarEscritorio(); setTimeout(fijar, 50); } });
  win.on('leave-full-screen', () => { if (bloqueada()) setTimeout(fijar, 50); });
  win.on('show', fijar);
  win.on('blur', () => { if (bloqueada()) setTimeout(() => { try { if (bloqueada() && !anydeskVisible && !win.isFocused() && !win.getChildWindows().length && !(customerWindow && !customerWindow.isDestroyed() && customerWindow.isFocused())) { win.setAlwaysOnTop(true, 'screen-saver'); win.moveTop(); } } catch {} }, 300); });
  win.webContents.on('before-input-event', (event, input) => {
    if (selected !== 'caja' || input.type !== 'keyDown') return;
    if (input.key === 'F11') { event.preventDefault(); if (!bloqueada()) win.setKiosk(!win.isKiosk()); }
    else if (bloqueada() && ((input.alt && input.key === 'F4') || (input.control && input.key === 'w') || (input.control && input.key === 'W') || input.key === 'F12' || (input.control && input.shift && /^[ij]$/i.test(input.key)))) { event.preventDefault(); if (input.key === 'F4') { try { win.webContents.send('factpos:intento-cierre'); } catch {} } }
    else if (input.control && input.shift && input.key.toLowerCase() === 'q') {
      event.preventDefault();
      if (turnoAbierto) { try { win.webContents.send('factpos:intento-cierre'); } catch {} return; }
      const r = dialog.showMessageBoxSync(win, { type: 'question', buttons: ['Cerrar la caja', 'Seguir vendiendo'], defaultId: 1, cancelId: 1, title: 'FactPOS Caja', message: '¿Cerrar FactPOS Caja?', detail: 'Las ventas guardadas se conservan en esta caja.', noLink: true });
      if (r === 0) app.quit();
    }
  });
  const tope = setTimeout(mostrar, 6000);
  // Salvavidas: la caja bloqueada nunca debe dejar solo un fondo azul. Si la pantalla falla al cargar, se cierra el proceso de
  // dibujo o se queda en blanco, se recarga sola; si no se recupera, se devuelve el escritorio de Windows para poder salir.
  let fallos = 0, reintento = null;
  const recargar = () => { if (win.isDestroyed() || updating) return; fallos++; if (fallos >= 3) mostrarEscritorio(); try { win.webContents.loadURL(endpoint.toString()); } catch {} };
  win.webContents.on('did-fail-load', (_e, codigo, _d, _u, principal) => { if (principal && codigo !== -3 && selected === 'caja') { clearTimeout(reintento); reintento = setTimeout(recargar, 3000); } });
  win.webContents.on('render-process-gone', () => { if (selected === 'caja') { clearTimeout(reintento); reintento = setTimeout(recargar, 1000); } });
  win.webContents.on('unresponsive', () => { if (selected !== 'caja') return; clearTimeout(reintento); reintento = setTimeout(() => { if (!win.isDestroyed() && !updating) { try { win.webContents.reloadIgnoringCache(); } catch {} } }, 15000); });
  const vigiaPantalla = setInterval(async () => {
    if (win.isDestroyed()) { clearInterval(vigiaPantalla); return; }
    if (selected !== 'caja' || !shown || updating) return;
    try {
      const n = await win.webContents.executeJavaScript('(document.body && document.body.innerText || "").trim().length');
      if (n > 0) { fallos = 0; return; }
      recargar();
    } catch { recargar(); }
  }, 10000);
  vigiaPantalla.unref();
  win.webContents.on('did-start-loading', () => clearTimeout(calma));
  // La ventana se muestra en cuanto la pantalla está armada (dom-ready), sin esperar a que termine de cargar todo (imágenes, etc.): antes podía tardar hasta el tope
  win.webContents.on('dom-ready', () => { marca('pantalla armada'); clearTimeout(calma); calma = setTimeout(mostrar, 700); });
  win.webContents.on('did-finish-load', () => { marca('pantalla cargada'); clearTimeout(calma); calma = setTimeout(mostrar, 400); });
  win.webContents.on('did-fail-load', () => { clearTimeout(calma); calma = setTimeout(mostrar, 500); });
  win.removeMenu();
  win.webContents.setWindowOpenHandler(({ url }) => {
    try { const u = new URL(url); if (u.origin === endpoint.origin && u.hash.startsWith('#/cliente')) { openCustomer(); return { action: 'deny' }; } } catch {}
    try { if (!bloqueada() && new URL(url).origin !== endpoint.origin && /^https?:/.test(url)) shell.openExternal(url); } catch {}
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    try {
      const u = new URL(url);
      if (u.origin === endpoint.origin) return;
      event.preventDefault();
      // En la administración, un enlace de descarga (instaladores) se entrega al navegador del sistema; en la caja bloqueada no
      if (!bloqueada() && u.protocol === 'https:') shell.openExternal(url);
    } catch { event.preventDefault(); }
  });
  win.loadURL(endpoint.toString());
}

// ------------------------------------------------------------------ actualizaciones
// Si el servidor se actualiza: se cierra todo, se muestra una ventana pequeña con el avance y,
// al terminar, el sistema se abre de nuevo (las pantallas piden usuario y contraseña porque la versión cambió).
let mainWindow = null;
let minimizarAutorizado = false;
// ---- Escritorio oculto mientras la caja está abierta (solo Windows) ----
// La tecla Windows, el menú Inicio y la barra de tareas son del Explorador de Windows: mientras la caja está en modo kiosko se
// cierra el Explorador (y se desactiva el Administrador de tareas del usuario) y se devuelve al cerrar la caja, al minimizar con
// permiso o al actualizar. Si la caja se cerrara a la fuerza, la próxima vez que abra lo recupera (marca en disco).
const { spawn } = require('node:child_process');
const MARCA_ESCRITORIO = path.join(app.getPath('userData'), 'escritorio-oculto.flag');
const CLAVE_DIRECTIVA = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\System';
let escritorioOculto = false;
let vigilanteEscritorio = null;
// Windows reinicia el Explorador solo cuando se cierra a la fuerza (por eso reaparecían la barra de tareas y el menú Inicio):
// mientras la caja esté bloqueada se vuelve a cerrar cada segundo.
const cerrarExplorador = () => {
  try { execFile('taskkill', ['/f', '/im', 'explorer.exe'], { windowsHide: true }, () => {}); } catch {}
  if (bloquearTecladoWindows()) cerrarTecladoWindows();
};
// ---- Teclado táctil de Windows: la caja trae el suyo (Teclado.tsx), así que el de Windows no debe salir encima ----
// Mientras la caja está bloqueada se desactiva su aparición automática (valor de usuario, sin permisos de administrador) y se
// cierran TabTip.exe / osk.exe si aparecen. Al salir se devuelve el valor anterior. Se apaga con bloquearTecladoWindows:false.
const bloquearTecladoWindows = () => config.bloquearTecladoWindows !== false;
const CLAVE_TECLADO = 'HKCU\\Software\\Microsoft\\TabletTip\\1.7';
// TouchKeyboardTapInvoke es el ajuste «Mostrar el teclado táctil» de Windows 10/11 (0 = nunca); los otros dos son de versiones anteriores
const VALORES_TECLADO = ['EnableDesktopModeAutoInvoke', 'DisableNewKeyboardExperience', 'TouchKeyboardTapInvoke'];
const RESPALDO_TECLADO = path.join(app.getPath('userData'), 'teclado-windows-previo.json');
const cerrarTecladoWindows = () => { for (const exe of ['TabTip.exe', 'osk.exe']) { try { execFile('taskkill', ['/f', '/im', exe], { windowsHide: true }, () => {}); } catch {} } };
function bloquearTeclado() {
  if (process.platform !== 'win32' || !bloquearTecladoWindows()) return;
  try {
    // Solo se guarda el valor original la primera vez (si ya hay respaldo, un cierre anterior quedó sin restaurar)
    if (!fs.existsSync(RESPALDO_TECLADO)) {
      const previo = {};
      let pendientes = VALORES_TECLADO.length;
      const guardar = () => { if (--pendientes === 0) { try { fs.writeFileSync(RESPALDO_TECLADO, JSON.stringify(previo)); } catch {} aplicar(); } };
      for (const v of VALORES_TECLADO) {
        execFile('reg', ['query', CLAVE_TECLADO, '/v', v], { windowsHide: true }, (err, out) => {
          const m = !err && /REG_DWORD\s+0x([0-9a-f]+)/i.exec(String(out));
          previo[v] = m ? parseInt(m[1], 16) : null;
          guardar();
        });
      }
    } else aplicar();
  } catch {}
  function aplicar() {
    try { execFile('reg', ['add', CLAVE_TECLADO, '/v', 'EnableDesktopModeAutoInvoke', '/t', 'REG_DWORD', '/d', '0', '/f'], { windowsHide: true }, () => {}); } catch {}
    try { execFile('reg', ['add', CLAVE_TECLADO, '/v', 'DisableNewKeyboardExperience', '/t', 'REG_DWORD', '/d', '1', '/f'], { windowsHide: true }, () => {}); } catch {}
    try { execFile('reg', ['add', CLAVE_TECLADO, '/v', 'TouchKeyboardTapInvoke', '/t', 'REG_DWORD', '/d', '0', '/f'], { windowsHide: true }, () => {}); } catch {}
    cerrarTecladoWindows();
  }
}
function restaurarTeclado() {
  if (process.platform !== 'win32' || !fs.existsSync(RESPALDO_TECLADO)) return;
  let previo = {};
  try { previo = JSON.parse(fs.readFileSync(RESPALDO_TECLADO, 'utf8')); } catch {}
  for (const v of VALORES_TECLADO) {
    try {
      if (typeof previo[v] === 'number') execFile('reg', ['add', CLAVE_TECLADO, '/v', v, '/t', 'REG_DWORD', '/d', String(previo[v]), '/f'], { windowsHide: true }, () => {});
      else execFile('reg', ['delete', CLAVE_TECLADO, '/v', v, '/f'], { windowsHide: true }, () => {});
    } catch {}
  }
  try { fs.rmSync(RESPALDO_TECLADO, { force: true }); } catch {}
}
function ocultarEscritorio() {
  if (process.platform !== 'win32' || escritorioOculto) return;
  escritorioOculto = true;
  try { fs.writeFileSync(MARCA_ESCRITORIO, String(Date.now())); } catch {}
  try { execFile('reg', ['add', CLAVE_DIRECTIVA, '/v', 'DisableTaskMgr', '/t', 'REG_DWORD', '/d', '1', '/f'], { windowsHide: true }, () => {}); } catch {}
  bloquearTeclado();
  cerrarExplorador();
  if (!vigilanteEscritorio) vigilanteEscritorio = setInterval(cerrarExplorador, 1000);
}
function mostrarEscritorio() {
  if (process.platform !== 'win32' || (!escritorioOculto && !fs.existsSync(MARCA_ESCRITORIO))) return;
  escritorioOculto = false;
  if (vigilanteEscritorio) { clearInterval(vigilanteEscritorio); vigilanteEscritorio = null; }
  try { fs.rmSync(MARCA_ESCRITORIO, { force: true }); } catch {}
  restaurarTeclado();
  try { execFile('reg', ['delete', CLAVE_DIRECTIVA, '/v', 'DisableTaskMgr', '/f'], { windowsHide: true }, () => {}); } catch {}
  try { spawn('explorer.exe', [], { detached: true, stdio: 'ignore' }).unref(); } catch {}
  // Red de seguridad contra la pantalla negra al salir: un «taskkill» que ya iba en camino puede matar el Explorador recién
  // abierto. Un ayudante aparte, que sigue vivo cuando la caja ya se cerró, revisa unos segundos después y lo vuelve a abrir si falta.
  try {
    spawn('cmd.exe', ['/d', '/s', '/c', '"ping -n 4 127.0.0.1 >nul & tasklist /fi "imagename eq explorer.exe" | find /i "explorer.exe" >nul || start "" explorer.exe"'],
      { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true }).unref();
  } catch {}
}
app.on('will-quit', mostrarEscritorio);
process.on('exit', mostrarEscritorio);
process.on('uncaughtException', (e) => { try { mostrarEscritorio(); } catch {} throw e; });
let turnoAbierto = false; // lo informa la pantalla de la caja
let saliendo = false;   // se está cerrando la aplicación a propósito
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
  roots.push(path.resolve(path.dirname(process.execPath), '..')); // instalada descomprimida: <instalación>\escritorio\FactPOS-Escritorio.exe
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
  // La página se escribe directamente en el documento (about:blank): así no depende del tipo MIME que Windows asocie
  // a .html ni a data: URL, que en algunos equipos mostraba el código de la página como texto.
  let html = '';
  try { html = fs.readFileSync(path.join(__dirname, 'actualizando.html'), 'utf8'); } catch {}
  if (!html) { try { miniWindow.loadFile(path.join(__dirname, 'actualizando.html')); } catch {} return; }
  miniWindow.webContents.once('did-finish-load', () => {
    if (miniWindow && !miniWindow.isDestroyed()) miniWindow.webContents.executeJavaScript('document.open();document.write(' + JSON.stringify(html) + ');document.close();').catch(() => {});
  });
  miniWindow.loadURL('about:blank');
}
function sendMini(msg) { if (miniWindow && !miniWindow.isDestroyed()) miniWindow.webContents.send('factpos:actualizacion', msg); }
function beginUpdate(state) {
  updating = true; updateStartedAt = Date.now(); versionBefore = state.version;
  mostrarEscritorio();
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
  // Caja en OTRO equipo que el servidor: no se cierra ni se reinicia sola cuando el servidor se actualiza (podría haber una venta en curso).
  // La versión nueva se aplica la próxima vez que se abra la caja (así no se detiene la facturación).
  if (selected === 'caja' && !localServer()) return;
  let busy = false, versionConocida = null, sinRespuesta = 0;
  const timer = setInterval(async () => {
    if (busy) return; busy = true;
    try {
      const st = await getJson(new URL('/actualizacion/estado', server));
      if (!updating) {
        // El servidor puede reiniciarse entre dos revisiones (o quedar sin responder unos segundos): la actualización se detecta
        // por el archivo de estado (equipo del servidor), por el cambio de versión o porque el servidor volvió con otra versión.
        sinRespuesta = st ? 0 : sinRespuesta + 1;
        const archivo = !st && sinRespuesta >= 2 ? readStateFile() : null;
        if (st && st.actualizando) beginUpdate(st);
        else if (archivo && archivo.estado === 'EN_CURSO') beginUpdate({ version: versionConocida, ...archivo });
        else if (st && versionConocida && st.version && st.version !== versionConocida && !st.actualizando) {
          // La actualización terminó mientras no se miraba: se muestra el cuadro y se vuelve a abrir el sistema con lo nuevo
          beginUpdate({ version: versionConocida });
          updating = 'cerrando';
          finishUpdate(true, `FactPOS ${String(st.version).replace(/\.0$/, '')} listo`);
        }
        if (st && st.version) versionConocida = st.version;
      } else if (st && !st.actualizando) {
        updating = 'cerrando';
        const changed = st.version !== versionBefore;
        const failed = st.resultado && st.resultado.estado === 'ERROR';
        finishUpdate(!failed, failed ? 'No se pudo actualizar; se conservó la versión anterior.' : changed ? `FactPOS ${String(st.version).replace(/\.0$/, '')} listo` : 'Actualización terminada');
      } else if (updating === true) {
        const f = st ? { paso: st.paso, porcentaje: st.porcentaje, destino: st.destino } : readStateFile();
        sendMini(st ? { paso: f.paso, porcentaje: f.porcentaje, destino: String(f.destino ?? '').replace(/\.0$/, '') } : f ? { paso: f.paso, porcentaje: f.porcentaje, destino: String(f.version ?? '').replace(/\.0$/, ''), reiniciando: !f.porcentaje } : { paso: 'Reiniciando el servidor…', porcentaje: null });
        if (Date.now() - updateStartedAt > 20 * 60 * 1000) { updating = 'cerrando'; finishUpdate(false, 'La actualización tardó demasiado. Se abrirá el sistema; avise a soporte.'); }
      }
    } finally { busy = false; }
  }, 2500);
  timer.unref();
}
// Administración ve este equipo en la red y puede apuntarlo al servidor: contesta por UDP (Caja 41236, Administración 41237)
// Regla de Windows para que Administración pueda preguntarle a este equipo (UDP 41236/41237, solo red local). El instalador ya la crea;
// esto cubre las instalaciones anteriores y solo funciona si el programa tiene permisos de administrador (si no, no hace nada).
function abrirFirewallEquipo() {
  if (process.platform !== 'win32') return;
  const nombre = 'FactPOS equipo en la red';
  try {
    execFile('netsh', ['advfirewall', 'firewall', 'show', 'rule', `name=${nombre}`], { windowsHide: true, timeout: 20000 }, (err) => {
      if (!err) return;
      try { execFile('netsh', ['advfirewall', 'firewall', 'add', 'rule', `name=${nombre}`, 'dir=in', 'action=allow', 'protocol=UDP', 'localport=41236,41237', 'remoteip=LocalSubnet,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16', 'profile=any'], { windowsHide: true, timeout: 20000 }, () => {}); } catch {}
    });
  } catch {}
}
function responderEquipos() {
  abrirFirewallEquipo();
  const puerto = selected === 'caja' ? 41236 : 41237;
  const privada = ip => { const a = String(ip).split('.').map(Number); return a[0] === 10 || (a[0] === 172 && a[1] >= 16 && a[1] <= 31) || (a[0] === 192 && a[1] === 168); };
  if (!config.id) { config.id = crypto.randomBytes(8).toString('hex'); saveConfig(); }
  let s;
  try { s = dgram.createSocket({ type: 'udp4', reuseAddr: true }); } catch { return; }
  s.on('error', () => { try { s.close(); } catch {} });
  s.on('message', async (msg, quien) => {
    const texto = msg.toString('utf8').trim();
    const enviar = o => { try { s.send(Buffer.from(JSON.stringify(o)), quien.port, quien.address); } catch {} };
    if (!privada(quien.address)) return;
    if (texto === 'FACTPOS-EQUIPOS?') {
      enviar({ producto: 'FactPOS-equipo', tipo: selected, id: config.id, nombre: os.hostname(), version: app.getVersion(), plataforma: process.platform === 'win32' ? 'Windows' : process.platform,
        servidor: config.empresa && selected === 'admin' ? PORTAL : (server ? server.origin : localUrl) });
    } else if (texto.startsWith('FACTPOS-APUNTAR ')) {
      try {
        if (selected === 'admin' && config.empresa) return enviar({ ok: false, error: 'Esta Administración usa la nube de la empresa, no un servidor local' });
        const u = new URL(String(JSON.parse(texto.slice(16)).url));
        if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return enviar({ ok: false, error: 'Orden no permitida' });
        if (!(await probarHttp(u.origin, 2500))) return enviar({ ok: false, error: 'En esa dirección no responde un servidor FactPOS' });
        if (server && server.origin === u.origin) return enviar({ ok: true });
        config.servidor = u.origin; config.apuntado = u.origin; localUrl = u.origin; saveConfig();
        enviar({ ok: true });
        // Se reinicia la app para que tome la dirección nueva (la Caja la usa también para su servidor interno)
        setTimeout(() => { try { app.relaunch(); salirYa(); } catch {} }, 600);
      } catch (e) { enviar({ ok: false, error: String(e && e.message || e).slice(0, 120) }); }
    }
  });
  s.bind(puerto);
}
if (unica) app.whenReady().then(registrarImpresionIpc);
if (unica) app.whenReady().then(responderEquipos);
if (unica) app.whenReady().then(start);
let mainOpened = false;
app.on('before-quit', () => { saliendo = true; try { session.defaultSession.flushStorageData(); } catch { /* sin sesión */ } });
app.on('window-all-closed', () => { if (mainOpened && process.platform !== 'darwin') app.quit(); });
