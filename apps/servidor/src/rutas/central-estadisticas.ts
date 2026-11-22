import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, ErrorNegocio } from "../db.js";
import { sucursalesDe } from "../sesion.js";

/**
 * Estadísticas (administración): el panel de control de las ventas.
 *  - /central/estadisticas/resumen: hoy contra el mismo día de la semana pasada (hasta la misma hora),
 *    ventas por hora, sucursales, formas de pago, lo más vendido y «Merece atención».
 *  - /central/estadisticas/ventas: un período cualquiera contra el período anterior de igual duración.
 * Todo respeta las sucursales del usuario. Las notas de crédito (E34) restan.
 */
const uuid = z.string().uuid();
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const RD = "America/Santo_Domingo";
const SIGNO = "CASE WHEN v.tipo_documento = 'E34' THEN -1 ELSE 1 END";

export async function rutasCentralEstadisticas(app: FastifyInstance) {
  const empresaDe = (req: { headers: Record<string, unknown> }) => uuid.parse(req.headers["x-empresa-id"]);
  /** Condición de sucursales: de la empresa, de las que el usuario puede ver y, si se pidió, una sola. */
  const ENSUC = (col: string) =>
    `${col} IN (SELECT id FROM sucursales WHERE empresa_id = $1 AND ($2::uuid[] IS NULL OR id = ANY($2)) AND ($3::uuid IS NULL OR id = $3))`;

  app.get("/central/estadisticas/resumen", async (req) => {
    const { sucursalId } = z.object({ sucursalId: uuid.optional() }).parse(req.query);
    const p = [empresaDe(req), sucursalesDe(req), sucursalId ?? null];
    const dia = `(v.creado_en AT TIME ZONE '${RD}')::date`;
    const hoyRd = `(now() AT TIME ZONE '${RD}')::date`;
    // «Hasta la misma hora»: la semana pasada solo cuenta lo vendido hasta esta hora, para que la comparación sea justa
    const periodo = `(${dia} = ${hoyRd} OR (${dia} = ${hoyRd} - 7 AND v.creado_en <= now() - interval '7 days'))`;

    const [kpi, util, hora, suc, pago, top, anul, sync, cxc, bajoCosto, muerto] = await Promise.all([
      pool.query(
        `SELECT (${dia} = ${hoyRd}) AS es_hoy,
                COALESCE(SUM(${SIGNO} * v.total), 0)::text AS venta,
                COUNT(*) FILTER (WHERE v.tipo_documento <> 'E34')::int AS facturas
           FROM ventas v WHERE ${ENSUC("v.sucursal_id")} AND ${periodo} GROUP BY 1`, p),
      pool.query(
        `SELECT (u.fecha = ${hoyRd}) AS es_hoy, COALESCE(SUM(u.utilidad), 0)::text AS utilidad, COALESCE(SUM(u.venta_neta), 0)::text AS venta_neta
           FROM rpt_utilidad_producto u WHERE ${ENSUC("u.sucursal_id")} AND u.fecha IN (${hoyRd}, ${hoyRd} - 7) GROUP BY 1`, p),
      pool.query(
        `SELECT extract(hour FROM v.creado_en AT TIME ZONE '${RD}')::int AS hora, (${dia} = ${hoyRd}) AS es_hoy,
                COALESCE(SUM(${SIGNO} * v.total), 0)::text AS total
           FROM ventas v WHERE ${ENSUC("v.sucursal_id")} AND ${dia} IN (${hoyRd}, ${hoyRd} - 7) GROUP BY 1, 2 ORDER BY 1`, p),
      pool.query(
        `SELECT s.id, s.nombre, COALESCE(SUM(${SIGNO} * v.total), 0)::text AS venta
           FROM ventas v JOIN sucursales s ON s.id = v.sucursal_id
          WHERE ${ENSUC("v.sucursal_id")} AND ${dia} = ${hoyRd} GROUP BY s.id, s.nombre ORDER BY SUM(${SIGNO} * v.total) DESC`, p),
      pool.query(
        `SELECT f.forma_pago AS forma, COALESCE(SUM(f.monto), 0)::text AS monto
           FROM rpt_formas_pago f WHERE ${ENSUC("f.sucursal_id")} AND f.fecha = ${hoyRd}
          GROUP BY 1 HAVING SUM(f.monto) <> 0 ORDER BY SUM(f.monto) DESC`, p),
      pool.query(
        `SELECT u.nombre, u.sku, SUM(u.unidades)::text AS unidades, SUM(u.venta_neta)::text AS "ventaNeta"
           FROM rpt_utilidad_producto u WHERE ${ENSUC("u.sucursal_id")} AND u.fecha = ${hoyRd}
          GROUP BY u.nombre, u.sku HAVING SUM(u.unidades) > 0 ORDER BY SUM(u.venta_neta) DESC LIMIT 5`, p),
      // Quién anuló o devolvió facturas hoy (las notas de crédito enlazadas a una factura)
      pool.query(
        `SELECT us.nombre, COUNT(*)::int AS n,
                (SELECT ROUND(AVG(c.n), 1)::float FROM (SELECT COUNT(*) AS n FROM ventas x WHERE ${ENSUC("x.sucursal_id")} AND x.tipo_documento = 'E34'
                    AND x.venta_origen_id IS NOT NULL AND (x.creado_en AT TIME ZONE '${RD}')::date BETWEEN ${hoyRd} - 30 AND ${hoyRd} - 1
                  GROUP BY x.usuario_id, (x.creado_en AT TIME ZONE '${RD}')::date) c) AS promedio
           FROM ventas v JOIN usuarios us ON us.id = v.usuario_id
          WHERE ${ENSUC("v.sucursal_id")} AND v.tipo_documento = 'E34' AND v.venta_origen_id IS NOT NULL AND ${dia} = ${hoyRd}
          GROUP BY us.id, us.nombre HAVING COUNT(*) >= 3 ORDER BY COUNT(*) DESC LIMIT 3`, p),
      // Sucursales con servidor propio que llevan más de una hora sin comunicarse (sus ventas de hoy pueden estar incompletas)
      pool.query(
        `SELECT s.nombre, GREATEST(y.ultima_subida, y.ultima_bajada) AS ultimo
           FROM sucursales s JOIN sync_sucursales y ON y.sucursal_id = s.id
          WHERE ${ENSUC("s.id")} AND s.activo AND COALESCE(GREATEST(y.ultima_subida, y.ultima_bajada), 'epoch') < now() - interval '1 hour'
          ORDER BY 2 NULLS FIRST LIMIT 5`, p),
      pool.query(
        `SELECT COUNT(*)::int AS facturas, COUNT(DISTINCT f.cliente_id)::int AS clientes, COALESCE(SUM(f.pendiente), 0)::text AS valor,
                COALESCE(MAX(f.pendiente), 0)::text AS mayor
           FROM rpt_cxc_facturas f WHERE ${ENSUC("f.sucursal_id")} AND f.pendiente > 0 AND f.creado_en < now() - interval '30 days'`, p),
      pool.query(
        `SELECT u.nombre, u.sku, SUM(u.unidades)::text AS unidades, SUM(u.utilidad)::text AS utilidad,
                (SUM(u.venta_neta) / NULLIF(SUM(u.unidades), 0))::text AS precio, (SUM(u.costo) / NULLIF(SUM(u.unidades), 0))::text AS costo
           FROM rpt_utilidad_producto u WHERE ${ENSUC("u.sucursal_id")} AND u.fecha = ${hoyRd}
          GROUP BY u.producto_id, u.nombre, u.sku HAVING SUM(u.unidades) > 0 AND SUM(u.utilidad) < 0 ORDER BY SUM(u.utilidad) LIMIT 3`, p),
      // Dinero parado: existencias que no se venden hace más de 60 días (o nunca)
      pool.query(
        `SELECT COUNT(DISTINCT m.producto_id)::int AS productos, COALESCE(SUM(m.valor), 0)::text AS valor,
                (SELECT m2.nombre FROM rpt_stock_muerto m2 WHERE ${ENSUC("m2.sucursal_id")} ORDER BY m2.valor DESC LIMIT 1) AS mayor,
                (SELECT m2.valor::text FROM rpt_stock_muerto m2 WHERE ${ENSUC("m2.sucursal_id")} ORDER BY m2.valor DESC LIMIT 1) AS valor_mayor
           FROM rpt_stock_muerto m WHERE ${ENSUC("m.sucursal_id")}`, p),
    ]);

    const del = (filas: { es_hoy: boolean }[], hoy: boolean) => filas.find((f) => f.es_hoy === hoy) as Record<string, any> | undefined;
    const hoyK = del(kpi.rows, true), antK = del(kpi.rows, false);
    const hoyU = del(util.rows, true), antU = del(util.rows, false);
    const margen = (u?: Record<string, any>) => (u && Number(u.venta_neta) !== 0 ? (100 * Number(u.utilidad)) / Number(u.venta_neta) : null);
    const ticket = (k?: Record<string, any>) => (k && k.facturas > 0 ? Number(k.venta) / k.facturas : 0);

    const hallazgos: { tono: "grave" | "aviso"; titulo: string; detalle: string; ir: string; accion: string }[] = [];
    for (const b of bajoCosto.rows) {
      const perdida = Number(b.costo) - Number(b.precio);
      hallazgos.push({ tono: "grave", titulo: `${b.nombre} se vende bajo el costo`, detalle: `Pierde RD$ ${perdida.toFixed(2)} por unidad. Se vendieron ${Number(b.unidades)} hoy.`, ir: "productos", accion: "Ajustar precio" });
    }
    for (const a of anul.rows) {
      hallazgos.push({ tono: "grave", titulo: `${a.nombre} anuló o devolvió ${a.n} facturas hoy`, detalle: a.promedio ? `Lo habitual por cajero es ${a.promedio} al día.` : "Revise los motivos.", ir: "facturas", accion: "Ver facturas" });
    }
    for (const s of sync.rows) {
      const h = s.ultimo ? Math.floor((Date.now() - new Date(s.ultimo).getTime()) / 3600e3) : null;
      hallazgos.push({ tono: "aviso", titulo: `Sucursal ${s.nombre} sin sincronizar`, detalle: h === null ? "Nunca se ha comunicado. Sus ventas de hoy pueden estar incompletas." : `Última comunicación hace ${h} h. Sus ventas de hoy pueden estar incompletas.`, ir: "sucursales", accion: "Ver estado" });
    }
    if (cxc.rows[0].facturas > 0) {
      const c = cxc.rows[0];
      hallazgos.push({ tono: "aviso", titulo: `RD$ ${Number(c.valor).toLocaleString("es-DO", { maximumFractionDigits: 0 })} por cobrar con más de 30 días`, detalle: `${c.facturas} factura(s) de ${c.clientes} cliente(s).`, ir: "cxc", accion: "Ver clientes" });
    }

    if (muerto.rows[0].productos > 0) {
      const m = muerto.rows[0];
      hallazgos.push({ tono: "aviso", titulo: `${m.productos} producto(s) sin venderse en más de 60 días`, detalle: `RD$ ${Number(m.valor).toLocaleString("es-DO", { maximumFractionDigits: 0 })} al costo parados. El mayor: ${m.mayor} (RD$ ${Number(m.valor_mayor).toLocaleString("es-DO", { maximumFractionDigits: 0 })}).`, ir: "reportes", accion: "Ver stock muerto" });
    }
    return {
      fecha: (await pool.query(`SELECT ${hoyRd}::text AS f, to_char(now() AT TIME ZONE '${RD}', 'HH24:MI') AS hora`)).rows[0],
      kpis: {
        venta: { hoy: Number(hoyK?.venta ?? 0), antes: Number(antK?.venta ?? 0) },
        facturas: { hoy: hoyK?.facturas ?? 0, antes: antK?.facturas ?? 0 },
        ticket: { hoy: ticket(hoyK), antes: ticket(antK) },
        margen: { hoy: margen(hoyU), antes: margen(antU) },
      },
      porHora: Array.from({ length: 24 }, (_, h) => ({
        hora: h,
        hoy: Number(hora.rows.find((r) => r.hora === h && r.es_hoy)?.total ?? 0),
        antes: Number(hora.rows.find((r) => r.hora === h && !r.es_hoy)?.total ?? 0),
      })),
      porSucursal: suc.rows.map((s) => ({ id: s.id, nombre: s.nombre, venta: Number(s.venta) })),
      formasPago: pago.rows.map((f) => ({ forma: f.forma, monto: Number(f.monto) })),
      masVendidos: top.rows.map((t) => ({ nombre: t.nombre, sku: t.sku, unidades: Number(t.unidades), venta: Number(t.ventaNeta) })),
      hallazgos,
    };
  });

  app.get("/central/estadisticas/ventas", async (req) => {
    const f = z.object({ desde: fecha, hasta: fecha, sucursalId: uuid.optional() }).parse(req.query);
    if (f.desde > f.hasta) throw new ErrorNegocio("La fecha inicial es posterior a la final");
    const dias = Math.round((Date.parse(f.hasta) - Date.parse(f.desde)) / 86400e3) + 1;
    if (dias > 366) throw new ErrorNegocio("El período no puede pasar de un año");
    const p = [empresaDe(req), sucursalesDe(req), f.sucursalId ?? null, f.desde, f.hasta, dias];
    const dia = `(v.creado_en AT TIME ZONE '${RD}')::date`;
    const enRango = `${dia} BETWEEN $4::date AND $5::date`;
    const enAnterior = `${dia} BETWEEN $4::date - $6::int AND $4::date - 1`;

    const [serie, anterior, semana, cajeros, suc, pago] = await Promise.all([
      pool.query(
        `SELECT ${dia}::text AS fecha, COALESCE(SUM(${SIGNO} * v.total), 0)::text AS venta, COUNT(*) FILTER (WHERE v.tipo_documento <> 'E34')::int AS facturas
           FROM ventas v WHERE ${ENSUC("v.sucursal_id")} AND ${enRango} GROUP BY 1 ORDER BY 1`, p),
      pool.query(
        `SELECT COALESCE(SUM(${SIGNO} * v.total), 0)::text AS venta, COUNT(*) FILTER (WHERE v.tipo_documento <> 'E34')::int AS facturas
           FROM ventas v WHERE ${ENSUC("v.sucursal_id")} AND ${enAnterior}`, p),
      // Promedio por día de la semana (1 = lunes … 7 = domingo): ¿qué días se vende más?
      pool.query(
        `SELECT d.dow, ROUND(AVG(d.venta), 2)::text AS promedio, COUNT(*)::int AS dias
           FROM (SELECT extract(isodow FROM ${dia})::int AS dow, ${dia} AS fecha, SUM(${SIGNO} * v.total) AS venta
                   FROM ventas v WHERE ${ENSUC("v.sucursal_id")} AND ${enRango} GROUP BY 1, 2) d GROUP BY d.dow ORDER BY d.dow`, p),
      pool.query(
        `SELECT us.nombre, COALESCE(SUM(${SIGNO} * v.total), 0)::text AS venta, COUNT(*) FILTER (WHERE v.tipo_documento <> 'E34')::int AS facturas
           FROM ventas v JOIN usuarios us ON us.id = v.usuario_id WHERE ${ENSUC("v.sucursal_id")} AND ${enRango}
          GROUP BY us.id, us.nombre ORDER BY SUM(${SIGNO} * v.total) DESC LIMIT 10`, p),
      pool.query(
        `SELECT s.nombre, COALESCE(SUM(${SIGNO} * v.total), 0)::text AS venta, COUNT(*) FILTER (WHERE v.tipo_documento <> 'E34')::int AS facturas
           FROM ventas v JOIN sucursales s ON s.id = v.sucursal_id WHERE ${ENSUC("v.sucursal_id")} AND ${enRango}
          GROUP BY s.id, s.nombre ORDER BY SUM(${SIGNO} * v.total) DESC`, p),
      pool.query(
        `SELECT g.forma_pago AS forma, COALESCE(SUM(g.monto), 0)::text AS monto
           FROM rpt_formas_pago g WHERE ${ENSUC("g.sucursal_id")} AND g.fecha BETWEEN $4::date AND $5::date
          GROUP BY 1 HAVING SUM(g.monto) <> 0 ORDER BY SUM(g.monto) DESC`, p),
    ]);

    const venta = serie.rows.reduce((a, r) => a + Number(r.venta), 0);
    const facturas = serie.rows.reduce((a, r) => a + r.facturas, 0);
    return {
      desde: f.desde, hasta: f.hasta, dias,
      total: { venta, facturas, ticket: facturas ? venta / facturas : 0 },
      anterior: { venta: Number(anterior.rows[0].venta), facturas: anterior.rows[0].facturas },
      serie: serie.rows.map((r) => ({ fecha: r.fecha, venta: Number(r.venta), facturas: r.facturas })),
      porDiaSemana: semana.rows.map((r) => ({ dia: r.dow, promedio: Number(r.promedio), dias: r.dias })),
      porCajero: cajeros.rows.map((r) => ({ nombre: r.nombre, venta: Number(r.venta), facturas: r.facturas })),
      porSucursal: suc.rows.map((r) => ({ nombre: r.nombre, venta: Number(r.venta), facturas: r.facturas })),
      formasPago: pago.rows.map((r) => ({ forma: r.forma, monto: Number(r.monto) })),
    };
  });

  app.get("/central/estadisticas/productos", async (req) => {
    const f = z.object({ desde: fecha, hasta: fecha, sucursalId: uuid.optional() }).parse(req.query);
    if (f.desde > f.hasta) throw new ErrorNegocio("La fecha inicial es posterior a la final");
    if (Date.parse(f.hasta) - Date.parse(f.desde) > 366 * 86400e3) throw new ErrorNegocio("El período no puede pasar de un año");
    const p = [empresaDe(req), sucursalesDe(req), f.sucursalId ?? null, f.desde, f.hasta];
    const rango = "u.fecha BETWEEN $4::date AND $5::date";
    const [res, top, bajo, cat, abc, muerto] = await Promise.all([
      pool.query(
        `SELECT COUNT(DISTINCT u.producto_id) FILTER (WHERE u.unidades > 0)::int AS productos, COALESCE(SUM(u.unidades), 0)::text AS unidades,
                COALESCE(SUM(u.venta_neta), 0)::text AS venta_neta, COALESCE(SUM(u.utilidad), 0)::text AS utilidad
           FROM rpt_utilidad_producto u WHERE ${ENSUC("u.sucursal_id")} AND ${rango}`, p),
      pool.query(
        `SELECT u.nombre, u.sku, SUM(u.unidades)::text AS unidades, SUM(u.venta_neta)::text AS venta, SUM(u.utilidad)::text AS utilidad
           FROM rpt_utilidad_producto u WHERE ${ENSUC("u.sucursal_id")} AND ${rango}
          GROUP BY u.producto_id, u.nombre, u.sku HAVING SUM(u.unidades) > 0 ORDER BY SUM(u.venta_neta) DESC LIMIT 10`, p),
      // Los que dejan menos: vendidos con margen por debajo del 5 % o con pérdida (al menos 5 unidades para no alarmar por una venta suelta)
      pool.query(
        `SELECT u.nombre, u.sku, SUM(u.unidades)::text AS unidades, SUM(u.venta_neta)::text AS venta, SUM(u.utilidad)::text AS utilidad
           FROM rpt_utilidad_producto u WHERE ${ENSUC("u.sucursal_id")} AND ${rango}
          GROUP BY u.producto_id, u.nombre, u.sku
         HAVING SUM(u.unidades) >= 5 AND SUM(u.venta_neta) > 0 AND SUM(u.utilidad) / SUM(u.venta_neta) < 0.05
          ORDER BY SUM(u.utilidad) / SUM(u.venta_neta) LIMIT 8`, p),
      pool.query(
        `SELECT m.categoria AS nombre, SUM(m.venta_neta)::text AS venta, SUM(m.utilidad)::text AS utilidad
           FROM rpt_margen_base m WHERE ${ENSUC("m.sucursal_id")} AND m.fecha BETWEEN $4::date AND $5::date
          GROUP BY m.categoria HAVING SUM(m.venta_neta) <> 0 ORDER BY SUM(m.venta_neta) DESC LIMIT 10`, p),
      // Clasificación ABC de los últimos 90 días (fija, no sigue el período): cuántos productos hacen el 80 % de la venta
      pool.query(
        `SELECT a.clase, COUNT(*)::int AS productos, COALESCE(SUM(a.venta_neta_90d), 0)::text AS venta
           FROM rpt_rotacion_abc a WHERE ${ENSUC("a.sucursal_id")} GROUP BY a.clase ORDER BY a.clase`, p),
      pool.query(
        `SELECT m.nombre, m.sku, SUM(m.existencia)::text AS existencia, SUM(m.valor)::text AS valor, MIN(m.dias_sin_vender) AS dias
           FROM rpt_stock_muerto m WHERE ${ENSUC("m.sucursal_id")} GROUP BY m.producto_id, m.nombre, m.sku ORDER BY SUM(m.valor) DESC LIMIT 8`, p),
    ]);
    const r = res.rows[0];
    const margen = (u: string, v: string) => (Number(v) !== 0 ? (100 * Number(u)) / Number(v) : null);
    const fila = (x: { nombre: string; sku: string; unidades: string; venta: string; utilidad: string }) =>
      ({ nombre: x.nombre, sku: x.sku, unidades: Number(x.unidades), venta: Number(x.venta), utilidad: Number(x.utilidad), margen: margen(x.utilidad, x.venta) });
    return {
      desde: f.desde, hasta: f.hasta,
      resumen: { productos: r.productos, unidades: Number(r.unidades), venta: Number(r.venta_neta), utilidad: Number(r.utilidad), margen: margen(r.utilidad, r.venta_neta) },
      masVendidos: top.rows.map(fila),
      pocoMargen: bajo.rows.map(fila),
      porCategoria: cat.rows.map((c) => ({ nombre: c.nombre, venta: Number(c.venta), utilidad: Number(c.utilidad), margen: margen(c.utilidad, c.venta) })),
      abc: abc.rows.map((a) => ({ clase: a.clase, productos: a.productos, venta: Number(a.venta) })),
      stockMuerto: muerto.rows.map((m) => ({ nombre: m.nombre, sku: m.sku, existencia: Number(m.existencia), valor: Number(m.valor), dias: m.dias })),
    };
  });

  /**
   * Clientes y cobros: quién compra más, cuánto se cobró de crédito en el período (iniciales y abonos con recibo),
   * lo que se debe y qué tan atrasado está, quiénes deben más y cómo va la gestión de cobranza.
   * Lo que se debe es por cliente (no depende de la sucursal elegida); los cobros y las compras sí.
   */
  app.get("/central/estadisticas/clientes", async (req) => {
    const f = z.object({ desde: fecha, hasta: fecha, sucursalId: uuid.optional() }).parse(req.query);
    if (f.desde > f.hasta) throw new ErrorNegocio("La fecha inicial es posterior a la final");
    if (Date.parse(f.hasta) - Date.parse(f.desde) > 366 * 86400e3) throw new ErrorNegocio("El período no puede pasar de un año");
    const empresaId = empresaDe(req);
    const p = [empresaId, sucursalesDe(req), f.sucursalId ?? null, f.desde, f.hasta];
    const diaV = `(v.creado_en AT TIME ZONE '${RD}')::date`;
    const diaR = `(r.creado_en AT TIME ZONE '${RD}')::date`;
    const [deuda, deudores, cobros, formas, compran, gestiones] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) FILTER (WHERE saldo > 0)::int AS clientes, COALESCE(SUM(saldo) FILTER (WHERE saldo > 0), 0)::text AS saldo,
                COALESCE(SUM(al_dia), 0)::text AS al_dia, COALESCE(SUM(vencido_30), 0)::text AS v30, COALESCE(SUM(vencido_60), 0)::text AS v60, COALESCE(SUM(vencido_mas), 0)::text AS vmas,
                COUNT(*) FILTER (WHERE vencido_30 + vencido_60 + vencido_mas > 0)::int AS en_mora
           FROM rpt_cxc_antiguedad WHERE empresa_id = $1 AND saldo > 0`, [empresaId]),
      pool.query(
        `SELECT nombre, telefono, saldo::text, (vencido_30 + vencido_60 + vencido_mas)::text AS vencido,
                GREATEST(0, (CURRENT_DATE - (deuda_desde AT TIME ZONE '${RD}')::date))::int AS dias_deuda, ultimo_abono
           FROM rpt_cxc_antiguedad WHERE empresa_id = $1 AND saldo > 0 ORDER BY (vencido_30 + vencido_60 + vencido_mas) DESC, saldo DESC LIMIT 10`, [empresaId]),
      pool.query(
        `SELECT COUNT(*)::int AS recibos, COALESCE(SUM(r.monto), 0)::text AS total,
                COALESCE(SUM(r.monto) FILTER (WHERE r.tipo = 'INICIAL'), 0)::text AS iniciales, COALESCE(SUM(r.monto) FILTER (WHERE r.tipo = 'ABONO'), 0)::text AS abonos
           FROM recibos_ingreso r WHERE ${ENSUC("r.sucursal_id")} AND ${diaR} BETWEEN $4::date AND $5::date`, p),
      pool.query(
        `SELECT r.forma_pago AS forma, SUM(r.monto)::text AS monto FROM recibos_ingreso r
          WHERE ${ENSUC("r.sucursal_id")} AND ${diaR} BETWEEN $4::date AND $5::date GROUP BY r.forma_pago ORDER BY SUM(r.monto) DESC`, p),
      pool.query(
        `SELECT cl.nombre, COALESCE(SUM(${SIGNO} * (v.total - v.itbis - v.isc)), 0)::text AS venta, COUNT(*) FILTER (WHERE v.tipo_documento <> 'E34')::int AS facturas
           FROM ventas v JOIN clientes cl ON cl.id = v.cliente_id WHERE ${ENSUC("v.sucursal_id")} AND ${diaV} BETWEEN $4::date AND $5::date
          GROUP BY cl.id, cl.nombre HAVING SUM(${SIGNO} * (v.total - v.itbis - v.isc)) > 0 ORDER BY SUM(${SIGNO} * (v.total - v.itbis - v.isc)) DESC LIMIT 10`, p),
      pool.query(
        `SELECT g.resultado, COUNT(*)::int AS n FROM cobranza_gestiones g
          WHERE g.empresa_id = $1 AND (g.creada_en AT TIME ZONE '${RD}')::date BETWEEN $2::date AND $3::date GROUP BY g.resultado ORDER BY COUNT(*) DESC`, [empresaId, f.desde, f.hasta]),
    ]);
    const d = deuda.rows[0], c = cobros.rows[0];
    return {
      desde: f.desde, hasta: f.hasta,
      deuda: { clientes: d.clientes, saldo: Number(d.saldo), alDia: Number(d.al_dia), vencido30: Number(d.v30), vencido60: Number(d.v60), vencidoMas: Number(d.vmas), enMora: d.en_mora },
      cobros: { recibos: c.recibos, total: Number(c.total), iniciales: Number(c.iniciales), abonos: Number(c.abonos) },
      formasCobro: formas.rows.map((x) => ({ forma: x.forma, monto: Number(x.monto) })),
      deudores: deudores.rows.map((x) => ({ nombre: x.nombre, telefono: x.telefono, saldo: Number(x.saldo), vencido: Number(x.vencido), diasDeuda: x.dias_deuda, ultimoAbono: x.ultimo_abono })),
      compradores: compran.rows.map((x) => ({ nombre: x.nombre, venta: Number(x.venta), facturas: x.facturas })),
      gestiones: gestiones.rows.map((x) => ({ resultado: x.resultado, n: x.n })),
    };
  });
}
