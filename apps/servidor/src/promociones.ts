import type { PoolClient } from "pg";
import type { Cupon, Oferta } from "@factpos/compartido";
import { ErrorNegocio } from "./db.js";
import type { PresentacionVenta } from "./contexto.js";

type Q = Pick<PoolClient, "query">;

/**
 * Unidades que le quedan a una oferta con tope en la sucursal `$2`
 * (NULL = sin tope). Va dentro de un SELECT sobre `ofertas o`.
 */
export const SQL_RESTANTES = `CASE WHEN o.unidades_maximas IS NULL THEN NULL
  ELSE GREATEST(o.unidades_maximas - COALESCE((SELECT vv.unidades FROM v_oferta_vendidas vv
                                               WHERE vv.oferta_id = o.id AND vv.sucursal_id = $2), 0), 0)::text END`;

/**
 * Bloquea las ofertas con tope mientras se registra la venta, para que dos
 * cajas no vendan la misma unidad en oferta. Devuelve true si había alguna.
 */
export async function bloquearOfertasConTope(c: Q, ids: string[]): Promise<boolean> {
  if (!ids.length) return false;
  const r = await c.query("SELECT id FROM ofertas WHERE id = ANY($1::uuid[]) AND unidades_maximas IS NOT NULL ORDER BY id FOR UPDATE", [ids]);
  return (r.rowCount ?? 0) > 0;
}

/**
 * Ofertas activas que podrían aplicar a estas presentaciones (por presentación,
 * producto o categoría), filtradas por sucursal y nivel de precio.
 * La vigencia por fecha, día y hora la decide `mejorOferta` en el paquete compartido.
 */
export async function ofertasPara(
  c: Q,
  empresaId: string,
  sucursalId: string,
  listaPrecioId: string | null,
  productos: PresentacionVenta[],
): Promise<Map<string, Oferta[]>> {
  const mapa = new Map<string, Oferta[]>(productos.map((p) => [p.presentacionId, []]));
  if (!productos.length) return mapa;

  const r = await c.query(
    `SELECT DISTINCT o.id, o.nombre, o.tipo, o.valor, o.lleva, o.paga,
            o.cantidad_minima AS "cantidadMinima", o.inicia_en AS "iniciaEn", o.termina_en AS "terminaEn",
            o.dias_semana AS "diasSemana", o.hora_desde::text AS "horaDesde", o.hora_hasta::text AS "horaHasta",
            o.prioridad, a.presentacion_id, a.producto_id, a.categoria_id,
            ${SQL_RESTANTES} AS restantes
       FROM ofertas o
       JOIN oferta_alcance a ON a.oferta_id = o.id AND a.activo
      WHERE o.empresa_id = $1 AND o.activo
        AND now() >= o.inicia_en AND now() < o.termina_en
        AND (o.sucursales IS NULL OR $2::uuid = ANY(o.sucursales))
        AND (o.lista_precio_id IS NULL OR o.lista_precio_id = $3)
        AND (a.presentacion_id = ANY($4::uuid[]) OR a.producto_id = ANY($5::uuid[]) OR a.categoria_id = ANY($6::uuid[]))`,
    [
      empresaId, sucursalId, listaPrecioId,
      productos.map((p) => p.presentacionId),
      productos.map((p) => p.productoId),
      productos.map((p) => p.categoriaId).filter(Boolean),
    ],
  );

  for (const p of productos) {
    const aplicables = r.rows.filter(
      (o) => o.presentacion_id === p.presentacionId || o.producto_id === p.productoId || (o.categoria_id && o.categoria_id === p.categoriaId),
    );
    mapa.set(p.presentacionId, aplicables);
  }
  return mapa;
}

/** Busca y valida un cupón: vigencia, dueño y límites de uso. */
export async function validarCupon(
  c: Q, empresaId: string, sucursalId: string, codigo: string, clienteId?: string, bloquear = false,
): Promise<Cupon> {
  const r = await c.query(
    `SELECT id, codigo, tipo, valor, compra_minima AS "compraMinima", tope_descuento AS "topeDescuento",
            acumulable_con_ofertas AS "acumulableConOfertas", usos_maximos, usos_por_cliente, cliente_id,
            inicia_en, vence_en, activo, sucursales
       FROM cupones WHERE empresa_id = $1 AND upper(codigo) = upper($2)
       ${bloquear ? "FOR UPDATE" : ""}`, // al vender, evita que dos cajas usen a la vez el último cupón disponible
    [empresaId, codigo],
  );
  if (!r.rowCount) throw new ErrorNegocio("Cupón no válido");
  const cu = r.rows[0];
  const ahora = new Date();
  if (!cu.activo) throw new ErrorNegocio("El cupón está desactivado");
  if (ahora < cu.inicia_en) throw new ErrorNegocio("El cupón todavía no está vigente");
  if (cu.vence_en && ahora >= cu.vence_en) throw new ErrorNegocio("El cupón está vencido");
  if (cu.sucursales && !cu.sucursales.includes(sucursalId)) throw new ErrorNegocio("El cupón no es válido en esta sucursal");
  if (cu.cliente_id && cu.cliente_id !== clienteId) throw new ErrorNegocio("Este cupón es personal de otro cliente");

  const usos = await c.query<{ total: string; cliente: string }>(
    `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE cliente_id = $2) AS cliente FROM cupon_usos WHERE cupon_id = $1`,
    [cu.id, clienteId ?? null],
  );
  if (cu.usos_maximos !== null && Number(usos.rows[0].total) >= cu.usos_maximos) {
    throw new ErrorNegocio("El cupón ya alcanzó su límite de usos");
  }
  if (cu.usos_por_cliente !== null) {
    if (!clienteId) throw new ErrorNegocio("Este cupón requiere identificar al cliente");
    if (Number(usos.rows[0].cliente) >= cu.usos_por_cliente) throw new ErrorNegocio("El cliente ya usó este cupón");
  }
  return cu;
}
