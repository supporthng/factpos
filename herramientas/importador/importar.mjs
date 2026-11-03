#!/usr/bin/env node
// Importador de datos de otros sistemas hacia FactPOS, por línea de comandos (la app usa el mismo núcleo).
//   node importar.mjs --fuente wilpos --archivo backup.sql                       (vista previa: no cambia nada)
//   node importar.mjs --fuente wilpos --archivo backup.sql --servidor https://... --usuario admin --clave ... --aplicar
import { importar } from "./nucleo.mjs";

const a = process.argv.slice(2);
const arg = (n, def) => { const i = a.indexOf("--" + n); return i < 0 ? def : (a[i + 1]?.startsWith("--") || a[i + 1] === undefined ? true : a[i + 1]); };
if (arg("ayuda") || !arg("archivo")) {
  console.log(`Uso: node importar.mjs --fuente wilpos --archivo <respaldo.sql> [opciones]
  --servidor URL     Servidor FactPOS (administración central)
  --usuario / --clave / --rnc   Credenciales de un administrador (--codigo si tiene verificación en dos pasos)
  --sucursal NOMBRE  Sucursal que recibe la existencia inicial (por omisión, la primera)
  --sin-fotos        No importar las fotos de los productos
  --dispositivo ID   Credencial de dispositivo, si el servidor la exige
  --salida CARPETA   Dónde dejar el informe y los CSV (por omisión ./salida-importacion)
  --aplicar          Hacer los cambios (sin esto solo se muestra qué pasaría)`);
  process.exit(arg("ayuda") ? 0 : 1);
}
const v = (n) => { const x = arg(n); return x === true ? undefined : x; };
try {
  await importar({ fuente: v("fuente"), archivo: v("archivo"), salida: v("salida"), aplicar: !!arg("aplicar"), sinFotos: !!arg("sin-fotos"),
    servidor: v("servidor"), usuario: v("usuario"), clave: v("clave"), rnc: v("rnc"), codigo: v("codigo"), dispositivo: v("dispositivo"), sucursal: v("sucursal") });
} catch (e) { console.error(e.message); process.exit(1); }
