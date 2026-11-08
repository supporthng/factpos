// Fuente: respaldo SQL de WilPOS (PostgreSQL, esquema "wilpos").
// Cada fuente devuelve el MISMO formato normalizado; el cargador no sabe de dónde vienen los datos.
// Para soportar otro sistema se agrega otro archivo aquí con la misma función `leer`.
import { leerInserts } from "../sql.mjs";

const TABLAS = ["productos", "categorias", "clientes", "proveedores", "stock_sucursal", "cuentas_pagar",
  "ventas", "venta_detalles", "venta_pagos", "compras", "compra_detalles", "usuarios", "productos_proveedores", "cliente_puntos"];

const solo = (v) => (v == null ? "" : String(v).trim());
const digitos = (v) => solo(v).replace(/\D/g, "");

export const nombre = "WilPOS";

export function leer(ruta) {
  const d = leerInserts(ruta, { tablas: TABLAS });
  const g = (t) => d[t] ?? [];

  const catPorNombre = new Map(g("categorias").map((c) => [solo(c.nombre), c]));
  const stockPorProducto = new Map();
  for (const s of g("stock_sucursal")) stockPorProducto.set(s.producto_id, s);
  const provPorId = new Map(g("proveedores").map((p) => [p.id, p]));
  const provDeProducto = new Map();
  for (const pp of g("productos_proveedores")) {
    const lista = provDeProducto.get(pp.producto_id) ?? [];
    lista.push(pp);
    provDeProducto.set(pp.producto_id, lista);
  }

  const productos = g("productos").filter((p) => !p.borrado).map((p) => {
    const st = stockPorProducto.get(p.id);
    const prov = (provDeProducto.get(p.id) ?? []).map((x) => ({ proveedor: solo(provPorId.get(x.proveedor_id)?.nombre), codigo: solo(x.codigo_proveedor), costo: x.ultimo_costo ?? null })).filter((x) => x.proveedor);
    return {
      origenId: p.id,
      nombre: solo(p.nombre),
      barras: solo(p.codigo_barra) || null,
      categoria: solo(p.categoria) || null,
      servicio: p.tipo === "servicio",
      precio: Number(p.precio_venta) || 0,
      costo: Number(p.costo) || 0,
      // La existencia viva de WilPOS está en productos.stock (cada venta y compra la actualiza; en un respaldo real coincidía con
      // el último movimiento de inventario en 433 de 434 productos). stock_sucursal queda desactualizada y solo se usa si el producto
      // no trae stock propio.
      existencia: p.stock != null ? Number(p.stock) || 0 : Number(st?.stock) || 0,
      minimo: p.stock_minimo != null ? Number(p.stock_minimo) || 0 : Number(st?.stock_minimo) || 0,
      pesable: !!p.venta_granel || p.unidad_medida === "lb",
      itbis: p.itebis ?? 0.18,
      imagen: typeof p.imagen === "string" && p.imagen.startsWith("data:image/") ? p.imagen : null,
      proveedores: prov,
    };
  });

  const clientes = g("clientes").filter((c) => solo(c.nombre).toLowerCase() !== "cliente general").map((c) => ({
    origenId: c.id, nombre: solo(c.nombre), documento: digitos(c.documento), telefono: solo(c.telefono) || null,
    correo: solo(c.email) || null, direccion: solo(c.direccion) || null, activo: c.activo !== false,
    puntos: (g("cliente_puntos").find((x) => x.cliente_id === c.id)?.puntos_actuales) ?? c.puntos_actuales ?? 0,
  }));

  const proveedores = g("proveedores").map((p) => ({
    origenId: p.id, nombre: solo(p.nombre), rnc: digitos(p.rnc_cedula) || null, telefono: solo(p.telefono) || null, activo: p.activo !== false,
  }));

  const cuentasPagar = g("cuentas_pagar").filter((c) => Number(c.saldo_pendiente) > 0).map((c) => ({
    proveedor: solo(provPorId.get(c.proveedor_id)?.nombre), descripcion: solo(c.descripcion), total: c.monto_total, pagado: c.monto_pagado,
    saldo: c.saldo_pendiente, vence: c.fecha_vencimiento, estado: c.estado, fecha: c.fecha_creacion,
  }));

  const detalles = new Map();
  for (const x of g("venta_detalles")) (detalles.get(x.venta_id) ?? detalles.set(x.venta_id, []).get(x.venta_id)).push(x);
  const nombreProd = new Map(g("productos").map((p) => [p.id, solo(p.nombre)]));
  const nombreCli = new Map(g("clientes").map((c) => [c.id, solo(c.nombre)]));
  const historialVentas = g("ventas").map((v) => ({
    id: v.id, fecha: v.fecha_venta, cliente: nombreCli.get(v.cliente_id) ?? "", total: v.total, descuento: v.descuento, itbis: v.impuestos,
    metodo: v.metodo_pago, estado: v.estado, lineas: (detalles.get(v.id) ?? []).map((l) => ({
      producto: nombreProd.get(l.producto_id) ?? `#${l.producto_id}`, cantidad: l.cantidad, precio: l.precio_unitario, subtotal: l.subtotal, costo: l.costo_unitario })),
  }));
  const dc = new Map();
  for (const x of g("compra_detalles")) (dc.get(x.compra_id) ?? dc.set(x.compra_id, []).get(x.compra_id)).push(x);
  const historialCompras = g("compras").map((c) => ({
    id: c.id, fecha: c.fecha_compra, proveedor: solo(provPorId.get(c.proveedor_id)?.nombre), factura: solo(c.numero_factura), ncf: solo(c.numero_ncf),
    subtotal: c.subtotal, itbis: c.itbis, total: c.total, estado: c.estado, metodo: c.metodo_pago,
    lineas: (dc.get(c.id) ?? []).map((l) => ({ producto: nombreProd.get(l.producto_id) ?? `#${l.producto_id}`, cantidad: l.cantidad, costo: l.costo_unitario ?? l.precio_unitario ?? null })),
  }));

  const usuarios = g("usuarios").map((u) => ({ nombre: solo(u.nombre), usuario: solo(u.usuario), rol: solo(u.rol), activo: u.activo !== false }));
  const categorias = [...new Set([...g("categorias").map((c) => solo(c.nombre)), ...productos.map((p) => p.categoria).filter(Boolean)])].filter(Boolean);
  void catPorNombre;
  return { categorias, proveedores, clientes, productos, cuentasPagar, historialVentas, historialCompras, usuarios };
}
