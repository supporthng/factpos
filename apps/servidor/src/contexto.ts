import type { PoolClient } from "pg";
import { pool, ErrorNegocio } from "./db.js";

export interface ContextoCaja {
  cajaId: string;
  sucursalId: string;
  almacenId: string;
  empresaId: string;
}

/** A partir de la caja se deduce la sucursal, el almacén que descuenta y la empresa. */
export async function contextoCaja(cajaId: string, c: Pick<PoolClient, "query"> = pool): Promise<ContextoCaja> {
  const r = await c.query(
    `SELECT ca.id AS "cajaId", ca.sucursal_id AS "sucursalId", ca.almacen_id AS "almacenId", s.empresa_id AS "empresaId"
       FROM cajas ca JOIN sucursales s ON s.id = ca.sucursal_id
      WHERE ca.id = $1 AND ca.activo`,
    [cajaId],
  );
  if (!r.rowCount) throw new ErrorNegocio("Caja no encontrada o inactiva", 404);
  return r.rows[0];
}

export interface PresentacionVenta {
  presentacionId: string;
  productoId: string;
  sku: string;
  nombre: string;
  presentacion: string;
  factor: string;
  esPesable: boolean;
  controlaStock: boolean;
  precioIncluyeItbis: boolean;
  tasaItbis: string;
  precio: string | null;
  tipo: "INVENTARIABLE" | "SERVICIO" | "COMBO";
  permiteSinExistencia: boolean;
  precioVariable: boolean;
  precioVariableMin: string | null;
  precioVariableMax: string | null;
  listaPrecioId: string | null;
  categoriaId: string | null;
  existencia: string;
  costoPromedio: string;
}

/**
 * Consulta base para todo lo que la caja necesita de un producto.
 * Parámetros: $1 empresa, $2 sucursal, $3 almacén, $4 lista del cliente (o NULL).
 *
 * Precio: se busca en el nivel del cliente (Precio 1, 2 o 3); si el producto
 * no tiene precio en ese nivel, se usa el nivel predeterminado. Si la empresa
 * activó los precios por sucursal, el precio propio de la sucursal gana sobre el general.
 */
export const SQL_PRESENTACION = `
  WITH listas AS (
    SELECT (SELECT lp.id FROM listas_precio lp WHERE lp.empresa_id = $1 AND lp.es_predeterminada) AS predeterminada,
           COALESCE($4::uuid, (SELECT lp.id FROM listas_precio lp WHERE lp.empresa_id = $1 AND lp.es_predeterminada)) AS cliente
  )
  SELECT pr.id AS "presentacionId", p.id AS "productoId", p.sku, p.nombre, p.categoria_id AS "categoriaId",
         pr.nombre AS presentacion, pr.factor, p.es_pesable AS "esPesable",
         p.controla_stock AS "controlaStock", p.precio_incluye_impuesto AS "precioIncluyeItbis",
         p.tipo, p.permite_sin_existencia AS "permiteSinExistencia",
         p.precio_variable AS "precioVariable", p.precio_variable_min AS "precioVariableMin", p.precio_variable_max AS "precioVariableMax",
         i.tasa AS "tasaItbis",
         pc.precio, pc.lista_precio_id AS "listaPrecioId",
         CASE WHEN p.tipo = 'COMBO'
              THEN COALESCE((SELECT vc.cantidad FROM v_existencia_combos vc WHERE vc.combo_id = p.id AND vc.almacen_id = $3), 0)
              ELSE COALESCE(e.cantidad, 0) END AS existencia,
         COALESCE(e.costo_promedio, p.costo_promedio) AS "costoPromedio"
    FROM listas l
    CROSS JOIN presentaciones pr
    JOIN productos p ON p.id = pr.producto_id AND p.activo
    JOIN impuestos i ON i.id = p.impuesto_id
    LEFT JOIN existencias e ON e.producto_id = p.id AND e.almacen_id = $3
    LEFT JOIN LATERAL (
      SELECT x.precio, x.lista_precio_id FROM precios x
       WHERE x.presentacion_id = pr.id
         AND x.activo AND x.lista_precio_id IN (l.cliente, l.predeterminada)
         AND (x.sucursal_id IS NULL OR (x.sucursal_id = $2 AND (SELECT precios_por_sucursal FROM empresas WHERE id = $1)))
       ORDER BY (x.lista_precio_id = l.cliente) DESC, x.sucursal_id NULLS LAST
       LIMIT 1) pc ON TRUE
   WHERE p.empresa_id = $1
     AND NOT EXISTS (SELECT 1 FROM producto_sucursal ps
                      WHERE ps.producto_id = p.id AND ps.sucursal_id = $2 AND NOT ps.activo)`;
