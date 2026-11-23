// Fuente: respaldo .bak de SQL Server de Mónica (se lee directo, sin instalar SQL Server).
// Devuelve el MISMO formato normalizado que las demás fuentes, más las cuentas por cobrar (saldos iniciales).
import { readFileSync } from "node:fs";
import { RespaldoSql } from "../mdf.mjs";

export const nombre = "Monica";
export const extensiones = [".bak"];

const txt = (v) => (typeof v === "string" ? v.replace(/\u0000/g, "").replace(/\s+/g, " ").trim() : v == null ? "" : String(v));
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
const digitos = (v) => txt(v).replace(/\D/g, "");
const dinero = (v) => Math.round(num(v) * 100) / 100;
/** Fecha (Date de UTC medianoche) → «AAAA-MM-DD»; fuera de rango razonable → null */
const dia = (v) => (v instanceof Date && !Number.isNaN(v.getTime()) && v.getUTCFullYear() > 1990 && v.getUTCFullYear() < 2100 ? v.toISOString().slice(0, 10) : null);
/** Al mediodía de República Dominicana (UTC-4, sin horario de verano) para que el día no se corra al convertir */
const mediodia = (d) => (d ? `${d}T12:00:00-04:00` : null);
/** NCF de Mónica: «B0100005382      31/12/2026» → «B0100005382» */
const ncfDe = (v) => { const m = txt(v).toUpperCase().match(/\b([BE]\d{10,12})\b/); return m ? m[1] : null; };
const unir = (...p) => p.map(txt).filter(Boolean).join(", ");

export function leer(ruta) {
  const r = new RespaldoSql(readFileSync(ruta));
  const tablas = new Set(r.tablas().map((t) => t.nombre.toLowerCase()));
  for (const t of ["clientes", "factura", "factura_detalle", "docs_cc", "productos"]) {
    if (!tablas.has(t)) throw new Error(`Este respaldo no parece de Mónica: no tiene la tabla «${t}».`);
  }
  const tabla = (n) => (tablas.has(n.toLowerCase()) ? r.tabla(n) : []);

  const terminos = new Map(tabla("terminos_pago").map((t) => [num(t.termino_id), num(t.dias)]));
  const categoriaDe = new Map(tabla("categoria_producto").map((c) => [num(c.categoria_id), txt(c.Descripcion_categ)]));
  const crudosClientes = tabla("clientes");
  const clientePorId = new Map(crudosClientes.map((c) => [num(c.cliente_id), c]));
  const proveedoresCrudos = tabla("proveedores");
  const proveedorPorId = new Map(proveedoresCrudos.map((p) => [num(p.proveedor_id), p]));

  // ---------- Cuentas por cobrar: documentos de débito con saldo y créditos sin aplicar ----------
  const cxc = [];
  const aFavor = [];
  const conSaldo = new Set();
  let enMonedaExtranjera = 0;
  for (const d of tabla("docs_cc")) {
    if (txt(d.Estado_registro) !== "0") continue; // anulados
    const cli = clientePorId.get(num(d.cliente_id));
    if (!cli) continue;
    let saldo = dinero(d.Balance);
    if (saldo <= 0.009) continue;
    const extranjera = txt(d.Moneda) && txt(d.Moneda) !== "N";
    let nota = txt(d.descripcion_dcmto);
    if (extranjera) { // el saldo está en dólares: se pasa a pesos a la tasa del documento
      const tasa = num(d.tipo_cambio);
      if (tasa > 0) { nota = `${nota} (US$${saldo.toFixed(2)} a ${tasa})`.trim(); saldo = dinero(saldo * tasa); enMonedaExtranjera++; }
    }
    const fecha = dia(d.fecha_emision);
    if (txt(d.tipo) === "D") {
      conSaldo.add(num(d.cliente_id));
      cxc.push({ clienteOrigenId: num(d.cliente_id), cliente: txt(cli.nombre_clte), documento: ncfDe(d.ncf) ?? `Nro. ${txt(d.nro_dcmto)}`, referencia: `MON-CC-${num(d.cc_id)}`,
        fecha, vence: dia(d.fecha_vcmto) ?? fecha, saldo, nota });
    } else if (txt(d.tipo) === "C") {
      aFavor.push({ clienteOrigenId: num(d.cliente_id), cliente: txt(cli.nombre_clte), referencia: `MON-CC-${num(d.cc_id)}`, fecha, monto: saldo, nota: nota || txt(d.clase_registro) });
    }
  }

  // ---------- Clientes: los activos y los inactivos que todavía deben ----------
  const clientes = [];
  let inactivosOmitidos = 0;
  for (const c of crudosClientes) {
    const n = txt(c.nombre_clte);
    if (n.length < 2) continue;
    const activo = txt(c.clte_Activo).toUpperCase() !== "I";
    if (!activo && !conSaldo.has(num(c.cliente_id))) { inactivosOmitidos++; continue; }
    const dias = terminos.get(num(c.termino_id)) ?? 0;
    clientes.push({
      origenId: num(c.cliente_id), nombre: n, documento: digitos(c.registro_tributario),
      telefono: txt(c.telefono1) || txt(c.telefono2) || null, correo: txt(c.e_mail1) || null,
      direccion: unir(c.direccion1, c.direccion2, c.direccion3, c.ciudad, c.Provincia) || null, activo,
      limiteCredito: num(c.maximo_Credito) > 0 ? dinero(c.maximo_Credito) : 0, diasCredito: dias > 0 ? Math.min(365, Math.round(dias)) : 0,
    });
  }

  // ---------- Productos: producto_fisico 3 = artículo de inventario; 1 y 2 = servicios ----------
  const productos = [];
  let productosInactivosOmitidos = 0;
  for (const p of tabla("productos")) {
    const n = txt(p.descrip_producto);
    if (n.length < 2) continue;
    const servicio = num(p.producto_fisico) !== 3;
    const existencia = servicio ? 0 : Math.max(0, num(p.cant_total));
    if (num(p.situacion_producto) !== 1 && existencia <= 0) { productosInactivosOmitidos++; continue; }
    productos.push({
      origenId: num(p.producto_id), nombre: n, barras: null, categoria: categoriaDe.get(num(p.Categoria_id)) || null, servicio,
      precio: num(p.precio1) > 0 ? num(p.precio1) : 0, costo: num(p.costo) > 0 ? num(p.costo) : 0,
      existencia, minimo: Math.max(0, num(p.cant_minima)), pesable: false,
      itbis: txt(p.impto1_en_vtas).toLowerCase().startsWith("s") ? 0.18 : 0, imagen: null, proveedores: [],
      codigo: txt(p.codigo_producto) || null,
    });
  }
  const nombreProducto = new Map(tabla("productos").map((p) => [num(p.producto_id), txt(p.descrip_producto)]));

  // ---------- Proveedores y cuentas por pagar ----------
  const proveedores = proveedoresCrudos.filter((p) => txt(p.nombre_proveedor)).map((p) => ({
    origenId: num(p.proveedor_id), nombre: txt(p.nombre_proveedor), rnc: digitos(p.registro_tributario) || null, telefono: txt(p.telefono1) || null,
    activo: txt(p.proveedor_Activo).toUpperCase() !== "I",
  }));
  const cuentasPagar = tabla("docs_cp").filter((d) => txt(d.Estado_registro) === "0" && dinero(d.Balance) > 0.009 && txt(d.tipo) === "C").map((d) => ({
    proveedor: txt(proveedorPorId.get(num(d.proveedor_id))?.nombre_proveedor), descripcion: txt(d.descripcion_dcmto), total: dinero(d.Monto_dcmto),
    pagado: dinero(num(d.Monto_dcmto) - num(d.Balance)), saldo: dinero(d.Balance), vence: dia(d.fecha_vcmto), estado: "PENDIENTE", fecha: dia(d.fecha_emision),
  }));

  // ---------- Historial de facturas (solo consulta y reportes) ----------
  const lineasDe = new Map();
  for (const l of tabla("factura_detalle")) {
    const id = num(l.factura_id);
    if (!lineasDe.has(id)) lineasDe.set(id, []);
    const cantidad = num(l.cantidad), precio = num(l.precio_factura);
    lineasDe.get(id).push({ producto: nombreProducto.get(num(l.producto_id)) ?? `#${num(l.producto_id)}`, cantidad, precio, subtotal: dinero(cantidad * precio), costo: num(l.costo_producto) });
  }
  const historialVentas = tabla("factura").map((f) => {
    const cli = clientePorId.get(num(f.cliente_id));
    const ncf = ncfDe(f.ncf);
    return {
      id: num(f.factura_id), fecha: mediodia(dia(f.fecha_emision)), cliente: txt(cli?.nombre_clte) || txt(f.clte_direccion1),
      total: dinero(f.total), descuento: dinero(f.dscto_monto), itbis: dinero(f.impuesto_monto),
      metodo: [txt(f.tipo_documento), ncf].filter(Boolean).join(" ") || `Factura ${txt(f.nro_factura)}`,
      estado: num(f.anulada) === 1 ? "ANULADA" : "EMITIDA", numero: txt(f.nro_factura), lineas: lineasDe.get(num(f.factura_id)) ?? [],
    };
  });

  // ---------- Historial de compras ----------
  const comprasDe = new Map();
  for (const l of tabla("compras_detalle")) {
    const id = num(l.compra_id);
    if (!comprasDe.has(id)) comprasDe.set(id, { id, fecha: dia(l.fecha), proveedor: txt(proveedorPorId.get(num(l.proveedor_id))?.nombre_proveedor), lineas: [], total: 0 });
    const c = comprasDe.get(id);
    const costo = num(l.precio_compra);
    c.lineas.push({ producto: nombreProducto.get(num(l.producto_id)) ?? `#${num(l.producto_id)}`, cantidad: num(l.cantidad), costo });
    c.total = dinero(c.total + num(l.cantidad) * costo + num(l.impto_monto) - num(l.descto_monto));
  }
  const historialCompras = [...comprasDe.values()].map((c) => ({ id: c.id, fecha: c.fecha, proveedor: c.proveedor, factura: "", ncf: "", subtotal: c.total, itbis: 0, total: c.total, estado: "", metodo: "", lineas: c.lineas }));

  const usuarios = tabla("usuarios").map((u) => {
    const k = (re) => Object.keys(u).find((c) => re.test(c));
    return { nombre: txt(u[k(/^nombre/i) ?? "nombre"]), usuario: txt(u[k(/^(usuario|login|codigo)/i) ?? "usuario"]), rol: "", activo: true };
  }).filter((u) => u.nombre || u.usuario);

  // El «Balance» que Mónica guarda en cada cliente a veces no coincide con la suma de sus documentos: se carga la suma de los documentos
  // (es el detalle) y se avisa cuáles clientes difieren para que los revisen.
  const neto = new Map();
  for (const x of cxc) neto.set(x.clienteOrigenId, (neto.get(x.clienteOrigenId) ?? 0) + x.saldo);
  for (const x of aFavor) neto.set(x.clienteOrigenId, (neto.get(x.clienteOrigenId) ?? 0) - x.monto);
  const diferenciasSaldo = [];
  for (const c of crudosClientes) {
    const doc = dinero(neto.get(num(c.cliente_id)) ?? 0), guardado = dinero(c.Balance);
    if (Math.abs(doc - guardado) > 0.5) diferenciasSaldo.push({ cliente: txt(c.nombre_clte), documentos: doc, balanceGuardado: guardado, diferencia: dinero(doc - guardado) });
  }

  const categorias = [...new Set([...categoriaDe.values(), ...productos.map((p) => p.categoria).filter(Boolean)])].filter((c) => c.length >= 2);

  return {
    categorias, proveedores, clientes, productos, cuentasPagar, historialVentas, historialCompras, usuarios,
    cuentasCobrar: cxc, creditosAFavor: aFavor, diferenciasSaldo,
    avisos: [
      inactivosOmitidos ? `${inactivosOmitidos} clientes inactivos sin deuda no se importan.` : null,
      productosInactivosOmitidos ? `${productosInactivosOmitidos} productos o servicios inactivos sin existencia no se importan.` : null,
      diferenciasSaldo.length ? `${diferenciasSaldo.length} cliente(s) tienen un balance guardado en Mónica distinto a la suma de sus documentos (se carga la suma de los documentos; ver problemas.csv).` : null,
      enMonedaExtranjera ? `${enMonedaExtranjera} documento(s) por cobrar en dólares se pasaron a pesos con la tasa de cada documento.` : null,
    ].filter(Boolean),
  };
}
