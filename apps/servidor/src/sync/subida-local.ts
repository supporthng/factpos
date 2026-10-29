import { aplicarFilas, aplicarKardex } from "./aplicar.js";

/**
 * En la NUBE: aplica lo que se cambió en la administración LOCAL de una
 * sucursal (migración 0030: la cola trae "local:<tabla>").
 *
 *  - Catálogo y configuración: gana el cambio más reciente (si en la nube se
 *    cambió el mismo dato después, se queda el de la nube).
 *  - Compras, ajustes, conteos y sus movimientos de inventario: se insertan
 *    una sola vez. Si el número del ajuste ya lo usó la nube, se le da otro.
 *  - Borrados (códigos de barra, precios, alcances de oferta…): se borra la fila.
 * Nada puede tocar otra empresa ni otra sucursal.
 */
type Pg = Parameters<typeof aplicarFilas>[0];
type Fila = Record<string, unknown>;

const LLAVES: Record<string, string[]> = {
  codigos_barra: ["codigo", "empresa_id"],
  producto_proveedores: ["producto_id", "proveedor_id"],
  producto_sucursal: ["producto_id", "sucursal_id"],
  producto_componentes: ["combo_id", "componente_id"],
  configuracion_marca: ["empresa_id"],
  configuracion_sucursal: ["sucursal_id"],
};
/** Filas que solo pueden ser de la sucursal que sube */
const DE_LA_SUCURSAL = new Set(["almacenes", "repartidores", "configuracion_sucursal", "producto_sucursal", "compras",
  "ajustes_inventario", "conteos_fisicos", "kardex_movimientos"]);
/** Documentos: se insertan una vez y no se reescriben */
const UNA_VEZ = new Set(["compras", "compra_items", "ajuste_items", "conteo_items", "kardex_movimientos"]);
const PERMITIDAS = new Set(["categorias", "proveedores", "productos", "presentaciones", "lotes", "codigos_barra", "precios",
  "producto_proveedores", "producto_sucursal", "producto_componentes", "listas_precio", "impuestos", "ofertas", "oferta_alcance",
  "cupones", "roles", "usuarios", "repartidores", "almacenes", "configuracion_marca", "configuracion_sucursal",
  "compras", "compra_items", "ajustes_inventario", "ajuste_items", "conteos_fisicos", "conteo_items", "kardex_movimientos"]);

export const esCambioLocal = (tabla: string) => tabla.startsWith("local:");

export async function aplicarCambioLocal(c: Pg, sucursalId: string, empresaId: string, tablaCola: string, p: { filas?: Fila[]; borrar?: Fila[] }) {
  const tabla = tablaCola.slice("local:".length);
  if (!PERMITIDAS.has(tabla)) throw new Error(`La administración local no puede cambiar ${tabla}`);
  const revisar = (f: Fila) => {
    if ("empresa_id" in f && f.empresa_id && f.empresa_id !== empresaId) throw new Error("El registro es de otra empresa");
    if (DE_LA_SUCURSAL.has(tabla) && f.sucursal_id !== sucursalId) throw new Error("El registro es de otra sucursal");
    // Un precio por sucursal solo puede ser el de esta (el general, sucursal_id vacío, vale para todas)
    if (tabla === "precios" && f.sucursal_id && f.sucursal_id !== sucursalId) throw new Error("El precio es de otra sucursal");
  };

  if (p.borrar?.length) {
    const llave = LLAVES[tabla] ?? ["id"];
    for (const f of p.borrar) {
      revisar(f);
      await c.query(`DELETE FROM ${tabla} WHERE ${llave.map((k, i) => `${k} = $${i + 1}`).join(" AND ")}`, llave.map((k) => f[k]));
    }
    return;
  }
  const filas = p.filas ?? [];
  filas.forEach(revisar);
  if (!filas.length) return;

  if (tabla === "kardex_movimientos") { await aplicarKardex(c, filas); return; }
  if (tabla === "ajustes_inventario") {
    for (const f of filas) {
      const ya = await c.query("SELECT 1 FROM ajustes_inventario WHERE id = $1", [f.id]);
      if (ya.rowCount) { await aplicarFilas(c, tabla, [f], "ultimo"); continue; }
      const choca = await c.query("SELECT 1 FROM ajustes_inventario WHERE sucursal_id = $1 AND numero = $2", [f.sucursal_id, f.numero]);
      if (choca.rowCount) {
        f.numero = (await c.query<{ n: string }>("SELECT COALESCE(MAX(numero), 0) + 1 AS n FROM ajustes_inventario WHERE sucursal_id = $1", [f.sucursal_id])).rows[0].n;
      }
      await aplicarFilas(c, tabla, [f], "insertar");
    }
    return;
  }
  await aplicarFilas(c, tabla, filas, UNA_VEZ.has(tabla) ? "insertar" : "actualizado_en" in filas[0] ? "ultimo" : "reemplazar");
}
