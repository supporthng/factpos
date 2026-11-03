'use strict';
// Arranque de FactPOS Escritorio. Su único trabajo es decidir qué código ejecutar:
//  · el que viene dentro del programa (app.cjs), o
//  · uno más nuevo que el servidor de la sucursal le dio a esta caja (carpeta «codigo»), si pasa la revisión de integridad.
// Así la ventana de escritorio se actualiza sola junto con el servidor, sin reinstalar. Si el código nuevo falla al arrancar
// (3 intentos sin llegar a mostrarse) o no coincide con su huella, se descarta y se usa el del programa.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { app } = require('electron');

const BASE = __dirname;
const carpeta = path.join(app.getPath('userData'), 'codigo'); // se calcula ANTES de que app.cjs cambie userData
const leerJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const partes = (v) => String(v || '0').split('.').map((x) => parseInt(x, 10) || 0);
const mayor = (a, b) => { const x = partes(a), y = partes(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };

let versionEmpaquetada = '0';
try { versionEmpaquetada = fs.readFileSync(path.join(BASE, 'codigo-version.txt'), 'utf8').trim() || '0'; } catch {}

let destino = path.join(BASE, 'app.cjs');
let versionEnUso = versionEmpaquetada;
let usaCache = false;
const metaRuta = path.join(carpeta, 'meta.json');
const meta = leerJson(metaRuta);
if (meta && meta.archivos && mayor(meta.version, versionEmpaquetada) && (meta.arranques || 0) < 3) {
  try {
    const ok = Object.entries(meta.archivos).every(([n, h]) => /^[\w.-]+$/.test(n) && sha(fs.readFileSync(path.join(carpeta, n))) === h)
      && fs.existsSync(path.join(carpeta, 'app.cjs'));
    if (ok) {
      meta.arranques = (meta.arranques || 0) + 1;
      fs.writeFileSync(metaRuta, JSON.stringify(meta));
      destino = path.join(carpeta, 'app.cjs'); versionEnUso = meta.version; usaCache = true;
    }
  } catch {}
}
if (!usaCache && meta && (meta.arranques || 0) >= 3) { try { fs.rmSync(carpeta, { recursive: true, force: true }); } catch {} }

global.__factposBase = BASE;            // íconos y demás archivos que solo vienen con el programa
global.__factposCarpetaCodigo = carpeta;
global.__factposVersionCodigo = versionEnUso;
// app.cjs avisa cuando ya mostró la ventana: el código nuevo se da por bueno
global.__factposListo = () => { if (!usaCache) return; try { const m = leerJson(metaRuta); if (m) { m.arranques = 0; fs.writeFileSync(metaRuta, JSON.stringify(m)); } } catch {} };

try { require(destino); }
catch (e) {
  if (!usaCache) throw e;
  try { fs.rmSync(carpeta, { recursive: true, force: true }); } catch {}
  global.__factposVersionCodigo = versionEmpaquetada;
  require(path.join(BASE, 'app.cjs'));
}
