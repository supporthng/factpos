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

  /**
   * Ofertas vigentes ahora mismo en la sucursal (fecha, día y hora de RD) con los productos que abarcan,
   * para la pantalla de espera interactiva del verificador.
   */
  app.get("/verificador/ofertas", async (req) => {
    const { sucursal } = z.object({ sucursal: z.string().uuid() }).parse(req.query);
    const s = await pool.query<{ empresa_id: string }>("SELECT empresa_id FROM sucursales WHERE id = $1 AND activo", [sucursal]);
    if (!s.rowCount) throw new ErrorNegocio("Sucursal no encontrada", 404);
    const empresaId = s.rows[0].empresa_id;
    const of = await pool.query(
      `SELECT o.id, o.nombre, o.tipo, o.valor::text, o.lleva, o.paga, o.cantidad_minima::text AS "cantidadMinima", o.termina_en AS "terminaEn", o.prioridad
         FROM ofertas o
        WHERE o.empresa_id = $1 AND o.activo AND now() >= o.inicia_en AND now() < o.termina_en
          AND (o.sucursales IS NULL OR $2::uuid = ANY(o.sucursales))
          AND (o.lista_precio_id IS NULL OR o.lista_precio_id = (SELECT lp.id FROM listas_precio lp WHERE lp.empresa_id = $1 AND lp.es_predeterminada))
          AND (o.dias_semana IS NULL OR extract(dow FROM now() AT TIME ZONE 'America/Santo_Domingo')::int = ANY(o.dias_semana))
          AND (o.hora_desde IS NULL OR o.hora_hasta IS NULL OR (CASE WHEN o.hora_desde <= o.hora_hasta
                 THEN (now() AT TIME ZONE 'America/Santo_Domingo')::time >= o.hora_desde AND (now() AT TIME ZONE 'America/Santo_Domingo')::time < o.hora_hasta
                 ELSE (now() AT TIME ZONE 'America/Santo_Domingo')::time >= o.hora_desde OR (now() AT TIME ZONE 'America/Santo_Domingo')::time < o.hora_hasta END))
          AND (o.unidades_maximas IS NULL OR o.unidades_maximas > COALESCE((SELECT vv.unidades FROM v_oferta_vendidas vv WHERE vv.oferta_id = o.id AND vv.sucursal_id = $2), 0))
        ORDER BY o.prioridad DESC, o.termina_en LIMIT 20`, [empresaId, sucursal]);
    if (!of.rowCount) return [];
    const pr = await pool.query(
      `SELECT DISTINCT ON (a.oferta_id, pr.id) a.oferta_id AS "ofertaId", pr.id AS "presentacionId", p.id AS "productoId",
              TRIM(p.nombre || ' ' || pr.nombre) AS nombre,
              CASE WHEN p.imagen LIKE 'data:%' THEN '/imagenes/' || p.id::text || '?v=' || p.version::text ELSE p.imagen END AS imagen,
              (SELECT x.precio::text FROM precios x JOIN listas_precio lp ON lp.id = x.lista_precio_id AND lp.es_predeterminada
                WHERE x.presentacion_id = pr.id AND x.activo
                  AND (x.sucursal_id IS NULL OR (x.sucursal_id = $2 AND (SELECT precios_por_sucursal FROM empresas WHERE id = $3)))
                ORDER BY x.sucursal_id NULLS LAST LIMIT 1) AS precio
         FROM oferta_alcance a
         JOIN presentaciones pr ON pr.id = a.presentacion_id OR pr.producto_id = a.producto_id
              OR pr.producto_id IN (SELECT id FROM productos WHERE categoria_id = a.categoria_id AND a.categoria_id IS NOT NULL)
         JOIN productos p ON p.id = pr.producto_id AND p.activo AND p.empresa_id = $3
        WHERE a.oferta_id = ANY($1::uuid[]) AND a.activo
        ORDER BY a.oferta_id, pr.id`, [of.rows.map((o) => o.id), sucursal, empresaId]);
    const texto = (o: any) =>
      o.tipo === "PORCENTAJE" ? `${Number(o.valor)}% de descuento`
      : o.tipo === "PRECIO_ESPECIAL" ? `Precio especial ${formatoRD(o.valor)}`
      : o.tipo === "LLEVA_PAGA" ? `Lleve ${o.lleva}, pague ${o.paga}`
      : `Desde ${Number(o.cantidadMinima)} unidades a ${formatoRD(o.valor)} c/u`;
    const precioOferta = (o: any, precio: string | null) => {
      if (precio === null) return null;
      if (o.tipo === "PORCENTAJE") return (Number(precio) * (1 - Number(o.valor) / 100)).toFixed(2);
      if (o.tipo === "PRECIO_ESPECIAL" || o.tipo === "POR_VOLUMEN") return Number(o.valor).toFixed(2);
      return null; // lleve/pague: el precio unitario no cambia
    };
    return of.rows.map((o) => ({
      id: o.id, nombre: o.nombre, tipo: o.tipo, texto: texto(o), hasta: o.terminaEn,
      productos: pr.rows.filter((x) => x.ofertaId === o.id).slice(0, 30)
        .map((x) => ({ nombre: x.nombre, imagen: x.imagen, precio: x.precio, precioOferta: precioOferta(o, x.precio) })),
    })).filter((o) => o.productos.length);
  });

  /** Qué sucursal atiende este servidor y la marca de la empresa (la página la usa para no necesitar ?sucursal=). */
  app.get("/verificador/config", async (req) => {
    const { sucursal } = z.object({ sucursal: z.string().uuid().optional() }).parse(req.query);
    const r = await pool.query(
      `SELECT s.id AS "sucursalId", s.nombre, COALESCE(e.nombre_comercial, e.razon_social) AS empresa, m.logo,
              COALESCE(m.color_primario, '#c0362c') AS primario, CASE WHEN m.empresa_id IS NULL THEN '#10202e' ELSE m.color_secundario END AS secundario
         FROM sucursales s JOIN empresas e ON e.id = s.empresa_id LEFT JOIN configuracion_marca m ON m.empresa_id = e.id
        WHERE s.activo AND ($1::uuid IS NULL OR s.id = $1) ORDER BY s.nombre LIMIT 2`, [sucursal ?? null]);
    if (!r.rowCount) throw new ErrorNegocio("Sucursal no encontrada", 404);
    // Con varias sucursales y sin indicar cuál, no se adivina
    if (!sucursal && r.rowCount > 1) throw new ErrorNegocio("Este servidor atiende varias sucursales: abra el verificador con ?sucursal=ID", 409);
    return r.rows[0];
  });

  /** Permite instalar el verificador en la pantalla de inicio de Android (pantalla completa, sin barra del navegador). */
  app.get("/verificador/manifest.webmanifest", async (_req, rep) => {
    rep.type("application/manifest+json");
    return { name: "Verificador de precios", short_name: "Precios", start_url: "/verificador", display: "fullscreen", orientation: "any", background_color: "#10202e", theme_color: "#10202e", icons: [] };
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
