// Núcleo del importador: lo usan la línea de comandos (importar.mjs) y la app (app.mjs).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as wilpos from "./fuentes/wilpos.mjs";

const FUENTES = { wilpos };

/** o: { fuente, archivo, salida, aplicar, sinFotos, servidor, usuario, clave, rnc, codigo, dispositivo, sucursal }. Lanza Error si algo impide seguir. */
export async function importar(o, emitir = console.log) {
  const fuente = FUENTES[o.fuente ?? "wilpos"];
  if (!fuente) throw new Error("Fuente desconocida");
  const datos = fuente.leer(String(o.archivo));
  const salida = String(o.salida ?? "./salida-importacion");
  mkdirSync(salida, { recursive: true });
  const aplicar = !!o.aplicar;
  const sinFotos = !!o.sinFotos;

// ---------- utilidades ----------
const csv = (filas, cols) => "﻿" + [cols.join(","), ...filas.map((f) => cols.map((c) => { const v = f[c] ?? ""; const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(","))].join("\n");
const escribir = (n, c) => writeFileSync(join(salida, n), c);
const rncValido = (d) => { // dígito verificador de la DGII
  if (!/^\d{9}$/.test(d)) return false;
  const p = [7, 9, 8, 6, 5, 4, 3, 2]; const s = p.reduce((t, x, i) => t + x * Number(d[i]), 0);
  const r = s % 11; const v = r === 0 ? 2 : r === 1 ? 1 : 11 - r; return v === Number(d[8]);
};
const informe = [];
const log = (t) => { informe.push(t); emitir(t); };

// ---------- resumen de lo leído ----------
log(`# Importación desde ${fuente.nombre}`);
log(`Archivo: ${o.archivo}  ·  Modo: ${aplicar ? "APLICAR" : "vista previa (no se cambia nada)"}`);
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
  const servidor = String(o.servidor ?? "").replace(/\/$/, "");
  if (!servidor || !o.usuario || !o.clave) { throw new Error("Para --aplicar hacen falta --servidor, --usuario y --clave."); }
  // Antes de entrar: ¿ahí hay de verdad un servidor FactPOS? (evita esperar minutos a una dirección equivocada)
  try {
    const d = await (await fetch(servidor + "/descubrir", { signal: AbortSignal.timeout(8000) })).json();
    if (d?.producto !== "FactPOS") throw new Error("no es FactPOS");
  } catch {
    throw new Error(`No encontré un servidor FactPOS en ${servidor}. Revise la dirección: es la de la PC donde está instalado FactPOS Servidor (en ella: ipconfig › Dirección IPv4, con :3000 al final). Si el importador corre en esa misma PC, use http://127.0.0.1:3000.`);
  }
  const disp = o.dispositivo ? { "x-dispositivo": String(o.dispositivo) } : {};
  let token = "";
  const api = async (ruta, metodo = "GET", cuerpo) => {
    const r = await fetch(servidor + ruta, { method: metodo, headers: { ...(cuerpo ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...disp }, body: cuerpo ? JSON.stringify(cuerpo) : undefined, signal: AbortSignal.timeout(90000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error ?? `Error ${r.status}`); e.estado = r.status; throw e; }
    return j;
  };
  const ses = await api("/central/entrar", "POST", { usuario: String(o.usuario), clave: String(o.clave), ...(o.rnc ? { rnc: String(o.rnc) } : {}), ...(o.codigo ? { codigo: String(o.codigo) } : {}) });
  if (ses.requiere2fa) { throw new Error("Ese usuario tiene verificación en dos pasos: agregue --codigo."); }
  token = ses.token;
  log(`Conectado a ${ses.empresa.nombre} como ${ses.usuario.nombre}.`);

  const aux = await api("/central/productos-auxiliares");
  const itbis18 = aux.impuestos.find((i) => Math.abs(i.tasa - 0.18) < 0.001) ?? aux.impuestos[0];
  const exento = aux.impuestos.find((i) => i.tasa === 0);
  if (!itbis18) { throw new Error("La empresa no tiene un ITBIS configurado."); }
  const sucs = await api("/central/sucursales");
  const nomSuc = (s) => s.sucursal ?? s.nombre;
  const idSuc = (s) => s.sucursal_id ?? s.sucursalId ?? s.id;
  const suc = o.sucursal ? sucs.find((s) => nomSuc(s).toLowerCase() === String(o.sucursal).toLowerCase()) : sucs[0];
  if (!suc) { throw new Error(`No encontré la sucursal. Disponibles: ${sucs.map(nomSuc).join(", ")}`); }
  log(`Sucursal que recibe la existencia: ${nomSuc(suc)}.`);

  log("Cargando categorías, proveedores y clientes…");
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
  // clientes (con "reemplazar": los ya importados se actualizan con los datos del backup nuevo)
  const prefijo = `${fuente.nombre.slice(0, 3).toUpperCase()}-`;
  let previos = { productos: [], clientes: [] };
  if (o.reemplazar) {
    previos = await api(`/central/importacion/existentes?prefijo=${encodeURIComponent(prefijo)}&sucursalId=${idSuc(suc)}`);
    log(`Reemplazo: en FactPOS hay ${previos.productos.length} productos y ${previos.clientes.length} clientes de importaciones anteriores.`);
  }
  const clientePrevio = new Map(previos.clientes.map((c) => [String(c.documento), c]));
  const clientesVistos = new Set();
  resultado.actualizados = { productos: 0, clientes: 0 };
  resultado.desactivados = { productos: 0, clientes: 0 };
  for (const c of clientes) {
    const cuerpoC = { nombre: c.nombre.slice(0, 120), tipoDocumento: c.tipo, documento: c.doc, telefono: c.telefono?.slice(0, 20) ?? null, correo: c.correo, direccion: c.direccion?.slice(0, 250) ?? null, confirmarDocumento: true };
    const previo = c.doc ? clientePrevio.get(String(c.doc).replace(/\D/g, "")) ?? clientePrevio.get(String(c.doc)) : null;
    if (previo) {
      clientesVistos.add(previo.id);
      try { await api(`/central/clientes/${previo.id}`, "PUT", { ...cuerpoC, nivel: previo.nivel, limiteCredito: previo.limiteCredito, diasCredito: previo.diasCredito, activo: true }); resultado.actualizados.clientes++; }
      catch (e) { problemas.push(["cliente", c.origenId, c.nombre, e.message]); }
      continue;
    }
    try {
      await api("/central/clientes", "POST", { ...cuerpoC, nivel: 1 });
      resultado.creados.clientes++;
    } catch (e) {
      if (e.estado === 409) resultado.existentes.clientes++; else problemas.push(["cliente", c.origenId, c.nombre, e.message]);
    }
  }
  // clientes que ya no vienen en el backup: se desactivan (solo los importados antes, con documento)
  if (o.reemplazar) {
    for (const c of previos.clientes) {
      if (clientesVistos.has(c.id) || !c.activo) continue;
      try {
        const fila = (await api(`/central/clientes?q=${encodeURIComponent(c.documento)}&inactivos=1`)).find((x) => x.id === c.id);
        if (!fila) continue;
        await api(`/central/clientes/${c.id}`, "PUT", { nombre: fila.nombre, tipoDocumento: fila.tipoDocumento, documento: fila.documento, telefono: fila.telefono, correo: fila.correo, direccion: fila.direccion, nivel: fila.nivel ?? 1, limiteCredito: fila.limiteCredito, diasCredito: fila.diasCredito, confirmarDocumento: true, activo: false });
        resultado.desactivados.clientes++;
      } catch (e) { problemas.push(["cliente", "", c.documento, `No se pudo desactivar: ${e.message}`]); }
    }
  }
  // productos (el SKU es el número que tenía en el sistema anterior, con prefijo, para poder volver a correr sin duplicar)
  const creados = [];
  const ajustes = [];
  const productoPrevio = new Map(previos.productos.map((x) => [x.sku, x]));
  const skusNuevos = new Set();
  log(`Cargando ${productos.length} productos (puede tardar varios minutos)…`);
  let hechos = 0;
  for (const p of productos) {
    if (++hechos % 25 === 0) log(`  productos: ${hechos} de ${productos.length}…`);
    const sku = `${fuente.nombre.slice(0, 3).toUpperCase()}-${p.origenId}`;
    skusNuevos.add(sku);
    const imagen = !sinFotos && p.imagen && p.imagen.length <= 400000 ? p.imagen : null;
    if (!sinFotos && p.imagen && !imagen) problemas.push(["producto", p.origenId, p.nombre, "Foto demasiado pesada: se importa sin foto"]);
    if (p.precio > 0 && p.precio % 5 !== 0) problemas.push(["producto", p.origenId, p.nombre, `Precio ${p.precio} no es múltiplo de 5: se importa como ${Math.round(p.precio / 5) * 5}`]);
    const cuerpo = {
      sku, nombre: p.nombre.slice(0, 120), categoriaId: p.categoria ? catId.get(p.categoria.toLowerCase()) ?? null : null,
      tipo: p.servicio ? "SERVICIO" : "INVENTARIABLE", impuestoId: (p.itbis === 0 && exento ? exento : itbis18).id, precioIncluyeItbis: true,
      esPesable: p.pesable, costoReferencia: p.costo.toFixed(4), imagen,
      presentaciones: [{ nombre: p.pesable ? "Libra" : "Unidad", factor: "1", codigos: p.barras ? [p.barras] : [], precios: { 1: (Math.round(p.precio / 5) * 5).toFixed(2) } }],
      sucursales: [{ sucursalId: idSuc(suc), stockMinimo: Math.max(0, p.minimo).toFixed(3) }],
      proveedores: p.proveedores.map((x) => ({ proveedorId: provId.get(x.proveedor.toLowerCase()), codigoProveedor: x.codigo || null, ultimoCosto: x.costo != null ? Number(x.costo).toFixed(4) : null, principal: false })).filter((x) => x.proveedorId).slice(0, 5),
    };
    if (cuerpo.proveedores[0]) cuerpo.proveedores[0].principal = true;
    const previo = productoPrevio.get(sku);
    if (previo) {
      try {
        const f = await api(`/central/productos/${previo.id}`);
        const n = {
          ...f, nombre: cuerpo.nombre, categoriaId: cuerpo.categoriaId, imagen: imagen ?? f.imagen ?? null, activo: true,
          precioVariableMin: f.precioVariable ? f.precioVariableMin : null, precioVariableMax: f.precioVariable ? f.precioVariableMax : null,
          costoReferencia: cuerpo.costoReferencia,
          presentaciones: f.presentaciones.map((pr, i) => i === 0 ? { ...pr, codigos: cuerpo.presentaciones[0].codigos, precios: { ...pr.precios, 1: cuerpo.presentaciones[0].precios[1] } } : pr),
          sucursales: f.sucursales.map(({ sucursalId, stockMinimo, stockMaximo, ubicacion, activo }) => ({ sucursalId, stockMinimo: sucursalId === idSuc(suc) ? cuerpo.sucursales[0].stockMinimo : stockMinimo || "0", stockMaximo: stockMaximo || null, ubicacion: ubicacion || null, activo })),
          proveedores: (f.proveedores ?? []).map(({ proveedorId, codigoProveedor, ultimoCosto, principal }) => ({ proveedorId, codigoProveedor: codigoProveedor || null, ultimoCosto: ultimoCosto || null, principal })),
          componentes: (f.componentes ?? []).map(({ productoId, cantidad }) => ({ productoId, cantidad })),
        };
        delete n.historialPrecios;
        await api(`/central/productos/${previo.id}`, "PUT", n);
        resultado.actualizados.productos++;
        if (!p.servicio) {
          const dif = Math.round((Math.max(0, p.existencia) - Number(previo.existencia)) * 1000) / 1000;
          if (dif !== 0) ajustes.push({ productoId: previo.id, tipo: dif > 0 ? "AJUSTE_ENTRADA" : "AJUSTE_SALIDA", cantidad: Math.abs(dif).toFixed(3), costoUnitario: p.costo.toFixed(4), nota: `Existencia según backup nuevo de ${fuente.nombre}` });
        }
      } catch (e) { problemas.push(["producto", p.origenId, p.nombre, `No se pudo actualizar: ${e.message}`]); }
      continue;
    }
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
  if (o.reemplazar) {
    // existencia: diferencia contra el kardex actual (ajustes de entrada/salida; el kardex nunca se borra)
    for (let i = 0; i < ajustes.length; i += 500) {
      const lote = ajustes.slice(i, i + 500);
      try { await api("/central/ajustes", "POST", { sucursalId: idSuc(suc), usuarioId: ses.usuario.id, motivo: `Reemplazo de existencia por nuevo backup de ${fuente.nombre}`, items: lote }); resultado.existencia += lote.length; }
      catch (e) { problemas.push(["existencia", "", `ajuste lote ${i / 500 + 1}`, e.message]); }
    }
    // productos importados antes que ya no están en el backup: se desactivan y se dejan en cero
    for (const pr of previos.productos) {
      if (skusNuevos.has(pr.sku) || !pr.activo) continue;
      try {
        const f = await api(`/central/productos/${pr.id}`);
        const n = { ...f, activo: false,
          precioVariableMin: f.precioVariable ? f.precioVariableMin : null, precioVariableMax: f.precioVariable ? f.precioVariableMax : null,
          costoReferencia: String(Number(f.costoReferencia) || 0),
          sucursales: f.sucursales.map(({ sucursalId, stockMinimo, stockMaximo, ubicacion, activo }) => ({ sucursalId, stockMinimo: stockMinimo || "0", stockMaximo: stockMaximo || null, ubicacion: ubicacion || null, activo })),
          proveedores: (f.proveedores ?? []).map(({ proveedorId, codigoProveedor, ultimoCosto, principal }) => ({ proveedorId, codigoProveedor: codigoProveedor || null, ultimoCosto: ultimoCosto || null, principal })),
          componentes: (f.componentes ?? []).map(({ productoId, cantidad }) => ({ productoId, cantidad })) };
        delete n.historialPrecios;
        await api(`/central/productos/${pr.id}`, "PUT", n);
        const ex = Number(pr.existencia);
        if (ex > 0) await api("/central/ajustes", "POST", { sucursalId: idSuc(suc), usuarioId: ses.usuario.id, motivo: `Producto ya no está en el backup de ${fuente.nombre}`, items: [{ productoId: pr.id, tipo: "AJUSTE_SALIDA", cantidad: ex.toFixed(3) }] });
        resultado.desactivados.productos++;
      } catch (e) { problemas.push(["producto", "", pr.sku, `No se pudo desactivar: ${e.message}`]); }
    }
  }
  // historial de ventas: solo consulta y reportes (no son facturas de FactPOS: sin e-NCF, sin tocar existencias, caja ni CxC)
  if (!o.sinHistorial && datos.historialVentas.length) {
    log(`Cargando ${datos.historialVentas.length} ventas del historial (solo consulta y reportes)…`);
    resultado.historial = { nuevas: 0, existentes: 0 };
    if (o.reemplazar) { try { const r = await api("/central/historial-ventas/vaciar", "POST", { origen: fuente.nombre }); log(`Historial anterior borrado (${r.borradas}) para cargarlo completo otra vez.`); } catch (e) { problemas.push(["historial", "", "", `No se pudo vaciar el anterior: ${e.message}`]); } }
    const validas = datos.historialVentas.filter((v) => v.fecha && !Number.isNaN(Date.parse(String(v.fecha).replace(" ", "T"))));
    for (const v of datos.historialVentas) if (!validas.includes(v)) problemas.push(["venta", v.id, "", "Fecha inválida: no se carga al historial"]);
    for (let i = 0; i < validas.length; i += 300) {
      const lote = validas.slice(i, i + 300).map((v) => ({
        origenId: String(v.id), fecha: new Date(String(v.fecha).replace(" ", "T")).toISOString(),
        cliente: v.cliente ?? "", metodo: String(v.metodo ?? ""), estado: String(v.estado ?? ""),
        descuento: Number(v.descuento) || 0, itbis: Number(v.itbis) || 0, total: Number(v.total) || 0,
        lineas: v.lineas.map((l) => ({ producto: String(l.producto).slice(0, 200), cantidad: Number(l.cantidad) || 0, precio: Number(l.precio) || 0, subtotal: Number(l.subtotal) || 0 })),
      }));
      try { const r = await api("/central/historial-ventas/importar", "POST", { sucursalId: idSuc(suc), origen: fuente.nombre, ventas: lote }); resultado.historial.nuevas += r.nuevas; resultado.historial.existentes += r.existentes; }
      catch (e) { problemas.push(["historial", "", `lote ${i / 300 + 1}`, e.message]); }
      if ((i / 300) % 10 === 9) log(`  historial: ${Math.min(i + 300, validas.length)} de ${validas.length}…`);
    }
    log(`Historial de ventas: ${resultado.historial.nuevas} cargadas, ${resultado.historial.existentes} ya estaban.`);
  }
  log(`Creados: ${JSON.stringify(resultado.creados)}  ·  Ya existían: ${JSON.stringify(resultado.existentes)}  ·  Existencia cargada en ${resultado.existencia} productos.` + (o.reemplazar ? `  ·  Actualizados: ${JSON.stringify(resultado.actualizados)}  ·  Desactivados: ${JSON.stringify(resultado.desactivados)}` : ""));
}

// ---------- informe ----------
escribir("problemas.csv", csv(problemas.map(([tipo, id, nombre, motivo]) => ({ tipo, id, nombre, motivo })), ["tipo", "id", "nombre", "motivo"]));
log(`Observaciones: ${problemas.length} (ver problemas.csv).`);
log(`Archivos en ${salida}: informe.md, problemas.csv, historial_ventas.csv, historial_compras.csv, cuentas_por_pagar_pendientes.csv, usuarios_del_sistema_anterior.csv`);
escribir("informe.md", informe.join("\n") + "\n");
  return { salida, problemas: problemas.length, resultado };
}
