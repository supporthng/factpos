#!/usr/bin/env node
// Importador de datos de otros sistemas hacia FactPOS (herramienta aparte, no forma parte de la aplicación).
//
//   node importar.mjs --fuente wilpos --archivo backup.sql                       (vista previa: no cambia nada)
//   node importar.mjs --fuente wilpos --archivo backup.sql --servidor https://... --usuario admin --clave ... --aplicar
//
// Sin --aplicar solo lee el archivo y escribe el informe. Con --aplicar crea categorías, proveedores, clientes y productos
// por la API de la administración (la misma que usa la aplicación) y carga la existencia inicial como ajuste del kardex.
// El historial (ventas, compras, cuentas por pagar) NO se carga como documentos: se deja en archivos CSV de consulta.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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

const fuente = await import(`./fuentes/${String(arg("fuente", "wilpos")).replace(/[^\w-]/g, "")}.mjs`);
const datos = fuente.leer(String(arg("archivo")));
const salida = String(arg("salida", "./salida-importacion"));
mkdirSync(salida, { recursive: true });
const aplicar = !!arg("aplicar");
const sinFotos = !!arg("sin-fotos");

// ---------- utilidades ----------
const csv = (filas, cols) => "﻿" + [cols.join(","), ...filas.map((f) => cols.map((c) => { const v = f[c] ?? ""; const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(","))].join("\n");
const escribir = (n, c) => writeFileSync(join(salida, n), c);
const rncValido = (d) => { // dígito verificador de la DGII
  if (!/^\d{9}$/.test(d)) return false;
  const p = [7, 9, 8, 6, 5, 4, 3, 2]; const s = p.reduce((t, x, i) => t + x * Number(d[i]), 0);
  const r = s % 11; const v = r === 0 ? 2 : r === 1 ? 1 : 11 - r; return v === Number(d[8]);
};
const informe = [];
const log = (t) => { informe.push(t); console.log(t); };

// ---------- resumen de lo leído ----------
log(`# Importación desde ${fuente.nombre}`);
log(`Archivo: ${arg("archivo")}  ·  Modo: ${aplicar ? "APLICAR" : "vista previa (no se cambia nada)"}`);
log(`Leído: ${datos.productos.length} productos, ${datos.categorias.length} categorías, ${datos.clientes.length} clientes, ${datos.proveedores.length} proveedores, ${datos.historialVentas.length} ventas, ${datos.historialCompras.length} compras, ${datos.cuentasPagar.length} cuentas por pagar con saldo.`);

// ---------- historial y consulta (siempre se genera) ----------
escribir("historial_ventas.csv", csv(datos.historialVentas.map((v) => ({ ...v, lineas: v.lineas.map((l) => `${l.cantidad} x ${l.producto} @ ${l.precio}`).join(" | ") })), ["id", "fecha", "cliente", "total", "descuento", "itbis", "metodo", "estado", "lineas"]));
escribir("historial_compras.csv", csv(datos.historialCompras.map((v) => ({ ...v, lineas: v.lineas.map((l) => `${l.cantidad} x ${l.producto} @ ${l.costo}`).join(" | ") })), ["id", "fecha", "proveedor", "factura", "ncf", "subtotal", "itbis", "total", "estado", "metodo", "lineas"]));
escribir("cuentas_por_pagar_pendientes.csv", csv(datos.cuentasPagar, ["proveedor", "descripcion", "total", "pagado", "saldo", "vence", "estado", "fecha"]));
escribir("usuarios_del_sistema_anterior.csv", csv(datos.usuarios, ["nombre", "usuario", "rol", "activo"]));
const saldoCxP = datos.cuentasPagar.reduce((t, c) => t + Number(c.saldo || 0), 0);
log(`Cuentas por pagar pendientes: ${datos.cuentasPagar.length} por RD$${saldoCxP.toLocaleString("es-DO", { minimumFractionDigits: 2 })} (queda en cuentas_por_pagar_pendientes.csv; no se carga como documento).`);

// ---------- validación previa ----------
const problemas = [];
const barrasVistas = new Map();
const productos = [];
for (const p of datos.productos) {
  if (p.nombre.length < 2) { problemas.push(["producto", p.origenId, p.nombre, "Nombre muy corto"]); continue; }
  let barras = p.barras;
  if (barras && barrasVistas.has(barras)) { problemas.push(["producto", p.origenId, p.nombre, `Código de barras repetido con #${barrasVistas.get(barras)}: se importa sin código`]); barras = null; }
  if (barras && barras.length > 30) { problemas.push(["producto", p.origenId, p.nombre, `Código demasiado largo (${barras.length} dígitos): se importa sin código`]); barras = null; }
  if (barras) barrasVistas.set(barras, p.origenId);
  productos.push({ ...p, barras });
}
const clientes = [];
for (const c of datos.clientes) {
  if (c.nombre.length < 3) { problemas.push(["cliente", c.origenId, c.nombre, "Nombre muy corto"]); continue; }
  let tipo = "NINGUNO", doc = null;
  if (c.documento.length === 9 && rncValido(c.documento)) { tipo = "RNC"; doc = c.documento; }
  else if (c.documento.length === 11) { tipo = "CEDULA"; doc = c.documento; }
  else if (c.documento) problemas.push(["cliente", c.origenId, c.nombre, `Documento "${c.documento}" no es un RNC ni una cédula válidos: se importa sin documento`]);
  clientes.push({ ...c, tipo, doc });
}
const sinBarras = productos.filter((p) => !p.barras).length;
log(`Se importarían: ${productos.length} productos (${sinBarras} sin código de barras), ${clientes.length} clientes, ${datos.proveedores.length} proveedores.`);
log(`Existencia inicial: ${productos.filter((p) => p.existencia > 0 && !p.servicio).length} productos con existencia, ${productos.reduce((t, p) => t + (p.servicio ? 0 : Math.max(0, p.existencia)), 0)} unidades.`);

// ---------- aplicar ----------
const resultado = { creados: { categorias: 0, proveedores: 0, clientes: 0, productos: 0 }, existentes: { categorias: 0, proveedores: 0, clientes: 0, productos: 0 }, existencia: 0 };
if (aplicar) {
  const servidor = String(arg("servidor", "")).replace(/\/$/, "");
  if (!servidor || !arg("usuario") || !arg("clave")) { console.error("Para --aplicar hacen falta --servidor, --usuario y --clave."); process.exit(1); }
  const disp = arg("dispositivo") ? { "x-dispositivo": String(arg("dispositivo")) } : {};
  let token = "";
  const api = async (ruta, metodo = "GET", cuerpo) => {
    const r = await fetch(servidor + ruta, { method: metodo, headers: { ...(cuerpo ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...disp }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error ?? `Error ${r.status}`); e.estado = r.status; throw e; }
    return j;
  };
  const ses = await api("/central/entrar", "POST", { usuario: String(arg("usuario")), clave: String(arg("clave")), ...(arg("rnc") ? { rnc: String(arg("rnc")) } : {}), ...(arg("codigo") ? { codigo: String(arg("codigo")) } : {}) });
  if (ses.requiere2fa) { console.error("Ese usuario tiene verificación en dos pasos: agregue --codigo."); process.exit(1); }
  token = ses.token;
  log(`Conectado a ${ses.empresa.nombre} como ${ses.usuario.nombre}.`);

  const aux = await api("/central/productos-auxiliares");
  const itbis18 = aux.impuestos.find((i) => Math.abs(i.tasa - 0.18) < 0.001) ?? aux.impuestos[0];
  const exento = aux.impuestos.find((i) => i.tasa === 0);
  if (!itbis18) { console.error("La empresa no tiene un ITBIS configurado."); process.exit(1); }
  const sucs = await api("/central/sucursales");
  const nomSuc = (s) => s.sucursal ?? s.nombre;
  const idSuc = (s) => s.sucursal_id ?? s.sucursalId ?? s.id;
  const suc = arg("sucursal") && arg("sucursal") !== true ? sucs.find((s) => nomSuc(s).toLowerCase() === String(arg("sucursal")).toLowerCase()) : sucs[0];
  if (!suc) { console.error(`No encontré la sucursal. Disponibles: ${sucs.map(nomSuc).join(", ")}`); process.exit(1); }
  log(`Sucursal que recibe la existencia: ${nomSuc(suc)}.`);

  // categorías
  const catId = new Map(aux.categorias.map((c) => [c.nombre.toLowerCase(), c.id]));
  for (const n of datos.categorias) {
    if (n.length < 2) continue;
    if (catId.has(n.toLowerCase())) { resultado.existentes.categorias++; continue; }
    try { const r = await api("/central/categorias", "POST", { nombre: n.slice(0, 40) }); catId.set(n.toLowerCase(), r.id); resultado.creados.categorias++; }
    catch (e) { problemas.push(["categoría", "", n, e.message]); }
  }
  // proveedores
  const provId = new Map(aux.proveedores.map((p) => [p.nombre.toLowerCase(), p.id]));
  for (const p of datos.proveedores) {
    if (p.nombre.length < 2) continue;
    if (provId.has(p.nombre.toLowerCase())) { resultado.existentes.proveedores++; continue; }
    const rnc = p.rnc && /^\d{9}(\d{2})?$/.test(p.rnc) ? p.rnc : null;
    if (p.rnc && !rnc) problemas.push(["proveedor", p.origenId, p.nombre, `RNC "${p.rnc}" inválido: se crea sin RNC`]);
    try { const r = await api("/central/proveedores", "POST", { nombre: p.nombre.slice(0, 80), rnc, telefono: p.telefono?.slice(0, 20) ?? null }); provId.set(p.nombre.toLowerCase(), r.id); resultado.creados.proveedores++; }
    catch (e) { problemas.push(["proveedor", p.origenId, p.nombre, e.message]); }
  }
  // clientes
  for (const c of clientes) {
    try {
      await api("/central/clientes", "POST", { nombre: c.nombre.slice(0, 120), tipoDocumento: c.tipo, documento: c.doc, telefono: c.telefono?.slice(0, 20) ?? null, correo: c.correo, direccion: c.direccion?.slice(0, 250) ?? null, nivel: 1, confirmarDocumento: true });
      resultado.creados.clientes++;
    } catch (e) {
      if (e.estado === 409) resultado.existentes.clientes++; else problemas.push(["cliente", c.origenId, c.nombre, e.message]);
    }
  }
  // productos (el SKU es el número que tenía en el sistema anterior, con prefijo, para poder volver a correr sin duplicar)
  const creados = [];
  for (const p of productos) {
    const sku = `${fuente.nombre.slice(0, 3).toUpperCase()}-${p.origenId}`;
    const imagen = !sinFotos && p.imagen && p.imagen.length <= 400000 ? p.imagen : null;
    if (!sinFotos && p.imagen && !imagen) problemas.push(["producto", p.origenId, p.nombre, "Foto demasiado pesada: se importa sin foto"]);
    const cuerpo = {
      sku, nombre: p.nombre.slice(0, 120), categoriaId: p.categoria ? catId.get(p.categoria.toLowerCase()) ?? null : null,
      tipo: p.servicio ? "SERVICIO" : "INVENTARIABLE", impuestoId: (p.itbis === 0 && exento ? exento : itbis18).id, precioIncluyeItbis: true,
      esPesable: p.pesable, costoReferencia: p.costo.toFixed(4), imagen,
      presentaciones: [{ nombre: p.pesable ? "Libra" : "Unidad", factor: "1", codigos: p.barras ? [p.barras] : [], precios: { 1: p.precio.toFixed(2) } }],
      sucursales: [{ sucursalId: idSuc(suc), stockMinimo: Math.max(0, p.minimo).toFixed(3) }],
      proveedores: p.proveedores.map((x) => ({ proveedorId: provId.get(x.proveedor.toLowerCase()), codigoProveedor: x.codigo || null, ultimoCosto: x.costo != null ? Number(x.costo).toFixed(4) : null, principal: false })).filter((x) => x.proveedorId).slice(0, 5),
    };
    if (cuerpo.proveedores[0]) cuerpo.proveedores[0].principal = true;
    try { const r = await api("/central/productos", "POST", cuerpo); resultado.creados.productos++; if (!p.servicio && p.existencia > 0) creados.push({ productoId: r.id, cantidad: p.existencia.toFixed(3), costoUnitario: p.costo.toFixed(4), nombre: p.nombre }); }
    catch (e) {
      if (/ya existe|existe un producto|duplicad/i.test(e.message) || e.estado === 409) resultado.existentes.productos++;
      else problemas.push(["producto", p.origenId, p.nombre, e.message]);
    }
  }
  // existencia inicial: un solo ajuste en el kardex (por lotes)
  const motivo = `Existencia inicial migrada de ${fuente.nombre}`;
  for (let i = 0; i < creados.length; i += 500) {
    const lote = creados.slice(i, i + 500);
    try { await api("/central/productos-existencia", "POST", { sucursalId: idSuc(suc), motivo, items: lote.map(({ nombre, ...x }) => x) }); resultado.existencia += lote.length; }
    catch (e) { problemas.push(["existencia", "", `lote ${i / 500 + 1}`, e.message]); }
  }
  log(`Creados: ${JSON.stringify(resultado.creados)}  ·  Ya existían: ${JSON.stringify(resultado.existentes)}  ·  Existencia cargada en ${resultado.existencia} productos.`);
}

// ---------- informe ----------
escribir("problemas.csv", csv(problemas.map(([tipo, id, nombre, motivo]) => ({ tipo, id, nombre, motivo })), ["tipo", "id", "nombre", "motivo"]));
log(`Observaciones: ${problemas.length} (ver problemas.csv).`);
log(`Archivos en ${salida}: informe.md, problemas.csv, historial_ventas.csv, historial_compras.csv, cuentas_por_pagar_pendientes.csv, usuarios_del_sistema_anterior.csv`);
escribir("informe.md", informe.join("\n") + "\n");
