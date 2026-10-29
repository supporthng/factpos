import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { leerCodigoBalanza, mejorOferta, formatoRD } from "@factpos/compartido";
import { pool, ErrorNegocio } from "../db.js";
import { SQL_PRESENTACION, type PresentacionVenta } from "../contexto.js";
import { ofertasPara } from "../promociones.js";
import { PAGINA_VERIFICADOR } from "../verificador-pagina.js";

/**
 * Verificador de precios.
 *
 * - GET /verificador?sucursal=<id>  → página lista para una tablet o kiosco.
 * - GET /verificador/:sucursalId/:codigo → JSON para cualquier otra app
 *   (por ejemplo tu verificador hecho en Streamlit), con el precio al detalle
 *   y la oferta vigente ya calculada.
 *
 * Funciona desde el servidor local, así sigue funcionando sin internet.
 */
export async function rutasVerificador(app: FastifyInstance) {
  app.get("/verificador", async (_req, rep) => {
    rep.type("text/html; charset=utf-8");
    return PAGINA_VERIFICADOR;
  });

  app.get("/verificador/:sucursalId/:codigo", async (req) => {
    const { sucursalId, codigo } = z
      .object({ sucursalId: z.string().uuid(), codigo: z.string().trim().min(1).max(30) })
      .parse(req.params);

    const s = await pool.query<{ empresa_id: string; almacen_id: string }>(
      `SELECT s.empresa_id, a.id AS almacen_id FROM sucursales s
         JOIN almacenes a ON a.sucursal_id = s.id AND a.es_principal
        WHERE s.id = $1 AND s.activo`,
      [sucursalId],
    );
    if (!s.rowCount) throw new ErrorNegocio("Sucursal no encontrada", 404);
    const { empresa_id: empresaId, almacen_id: almacenId } = s.rows[0];

    const buscar = async (cod: string, soloPesables = false) =>
      (await pool.query<PresentacionVenta>(
        `${SQL_PRESENTACION} ${soloPesables ? "AND p.es_pesable" : ""}
           AND pr.id = (SELECT presentacion_id FROM codigos_barra WHERE empresa_id = $1 AND codigo = $5 AND activo)`,
        [empresaId, sucursalId, almacenId, null, cod],
      )).rows[0];

    let p = await buscar(codigo);
    let peso: number | null = null;
    if (!p) {
      const b = leerCodigoBalanza(codigo);
      if (b) {
        p = await buscar(b.codigoProducto, true);
        peso = b.valor;
      }
    }
    if (!p || p.precio === null) throw new ErrorNegocio("Producto no encontrado", 404);

    // Precios por nivel (para clientes por mayor)
    const niveles = await pool.query<{ nivel: number; lista: string; precio: string }>(
      `SELECT lp.nivel, lp.nombre AS lista, x.precio FROM precios x
         JOIN listas_precio lp ON lp.id = x.lista_precio_id
        WHERE x.presentacion_id = $1 AND x.activo AND lp.nivel IS NOT NULL
          AND (x.sucursal_id IS NULL OR (x.sucursal_id = $2 AND (SELECT precios_por_sucursal FROM empresas e JOIN sucursales s ON s.empresa_id = e.id WHERE s.id = $2)))
        ORDER BY lp.nivel, x.sucursal_id NULLS LAST`,
      [p.presentacionId, sucursalId],
    );
    const porNivel = new Map<number, { lista: string; precio: string }>();
    for (const n of niveles.rows) if (!porNivel.has(n.nivel)) porNivel.set(n.nivel, n);

    const ofertas = (await ofertasPara(pool, empresaId, sucursalId, p.listaPrecioId, [p])).get(p.presentacionId) ?? [];
    const cantidadPrueba = peso ?? 1;
    const oferta = mejorOferta(ofertas, { cantidad: cantidadPrueba, precioUnitario: p.precio });
    // Para 2x1, 3x2 y por volumen, se informa aunque con 1 unidad no aplique
    const promocion = oferta
      ? { nombre: oferta.nombre, precioOferta: oferta.precioEfectivo }
      : ofertas.length
        ? { nombre: ofertas.sort((a, b) => b.prioridad - a.prioridad)[0].nombre, precioOferta: null }
        : null;

    return {
      codigo,
      descripcion: `${p.nombre} ${p.presentacion}`.trim(),
      sku: p.sku,
      precio: p.precio,
      precioTexto: formatoRD(p.precio),
      itbisIncluido: p.precioIncluyeItbis,
      pesable: p.esPesable,
      peso,
      importe: peso !== null ? formatoRD(Number(p.precio) * peso) : null,
      promocion,
      niveles: [...porNivel.entries()].map(([nivel, v]) => ({ nivel, lista: v.lista, precio: v.precio })),
      disponible: Number(p.existencia) > 0,
    };
  });
}
