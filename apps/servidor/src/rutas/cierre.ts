import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import { z } from "zod";
import { Decimal } from "decimal.js";
import { pool, enTransaccion, ErrorNegocio } from "../db.js";
import { contextoCaja } from "../contexto.js";
import { leerToken } from "../sesion.js";
import { usuarioVigente } from "./sesion.js";
import { FORMAS_CONTADAS, diferenciaCierre, efectivoContado, efectivoEsperado, esperadoPorForma } from "./cuadre.js";

/**
 * Cuadre y cierre de la caja registradora.
 *
 * - Cuadre del turno (reporte X): cómo va el turno abierto, sin cerrarlo.
 * - Cierre del turno (reporte Z): conteo CIEGO. El cajero cuenta billetes y
 *   monedas y declara lo de tarjeta y transferencia SIN ver lo esperado; el
 *   sistema compara y guarda la diferencia. Después del cierre no se factura
 *   en ese turno.
 * - Cuadre de caja del día: todos los turnos de la caja en una fecha.
 */
type Q = Pick<PoolClient, "query">;

/** Billetes y monedas de RD$ que se cuentan en la gaveta. */
export const DENOMINACIONES = [2000, 1000, 500, 200, 100, 50, 25, 10, 5, 1] as const;
/** Formas de pago que se cuentan al cerrar (el crédito no entra a la gaveta). */
const CONTADAS = FORMAS_CONTADAS;

/** Todo lo que se necesita para el reporte X o Z de un turno. */
export async function reporteTurno(c: Q, turnoId: string) {
  const t = (await c.query(
    `SELECT t.id, t.caja_id AS "cajaId", t.usuario_id AS "usuarioId", t.estado, t.abierto_en AS "abiertoEn", t.cerrado_en AS "cerradoEn",
            t.fondo_inicial::text AS "fondoInicial", t.declarado, t.esperado, t.diferencia::text AS diferencia,
            t.conteo, t.conteo_apertura AS "conteoApertura", t.notas, u.nombre AS cajero, uc.nombre AS "cerradoPor", ca.nombre AS caja, s.nombre AS sucursal,
            cu.ventas_efectivo::text AS "ventasEfectivo", cu.entradas::text AS entradas, cu.salidas::text AS salidas
       FROM turnos t JOIN usuarios u ON u.id = t.usuario_id LEFT JOIN usuarios uc ON uc.id = t.cerrado_por
       JOIN cajas ca ON ca.id = t.caja_id JOIN sucursales s ON s.id = t.sucursal_id
       JOIN rpt_cuadre_turno cu ON cu.turno_id = t.id
      WHERE t.id = $1`,
    [turnoId],
  )).rows[0];
  if (!t) throw new ErrorNegocio("Turno no encontrado", 404);

  const [ventas, pagos, anuladas, movs, anuDetalle] = await Promise.all([
    c.query(
      `SELECT COUNT(*) FILTER (WHERE tipo_documento NOT IN ('E34','ANU')) AS facturas,
              COUNT(*) FILTER (WHERE tipo_documento IN ('E31','B01','B14','B15')) AS "creditoFiscal",
              COALESCE(SUM(CASE WHEN tipo_documento IN ('E34','ANU') THEN -total ELSE total END), 0)::text AS total,
              COALESCE(SUM(CASE WHEN tipo_documento IN ('E34','ANU') THEN -itbis ELSE itbis END), 0)::text AS itbis,
              COALESCE(SUM(CASE WHEN tipo_documento IN ('E34','ANU') THEN -descuento ELSE descuento END), 0)::text AS descuentos,
              COALESCE(SUM(CASE WHEN tipo_documento IN ('E34','ANU') THEN 0 ELSE propina_legal END), 0)::text AS propinas,
              MIN(numero_interno) FILTER (WHERE tipo_documento NOT IN ('E34','ANU')) AS "primeraFactura",
              MAX(numero_interno) FILTER (WHERE tipo_documento NOT IN ('E34','ANU')) AS "ultimaFactura"
         FROM ventas WHERE turno_id = $1`,
      [turnoId],
    ),
    c.query(
      `SELECT forma_pago AS "formaPago", SUM(monto)::text AS monto, SUM(operaciones)::int AS operaciones
         FROM rpt_formas_pago WHERE turno_id = $1 GROUP BY forma_pago ORDER BY forma_pago`,
      [turnoId],
    ),
    c.query(
      `SELECT COUNT(*)::int AS cantidad, COALESCE(SUM(total), 0)::text AS monto FROM ventas WHERE turno_id = $1 AND tipo_documento IN ('E34','ANU')`,
      [turnoId],
    ),
    // Retiros, gastos, sencillo, abonos y liquidaciones de delivery del turno
    c.query(
      `SELECT m.tipo, m.monto::text AS monto, m.forma_pago AS "formaPago", m.concepto, m.categoria, m.creado_en AS "creadoEn",
              a.nombre AS "autorizadoPor"
         FROM movimientos_caja m LEFT JOIN usuarios a ON a.id = m.autorizado_por
        WHERE m.turno_id = $1 ORDER BY m.creado_en`,
      [turnoId],
    ),
    // Detalle de las facturas anuladas del turno: cuál factura, cuánto, el motivo y quién autorizó
    c.query(
      `SELECT n.numero_interno AS numero, o.numero_interno AS factura, n.total::text AS monto, n.motivo, n.creado_en AS "creadoEn",
              a.nombre AS "autorizadoPor"
         FROM ventas n JOIN ventas o ON o.id = n.venta_origen_id LEFT JOIN usuarios a ON a.id = n.autorizado_por
        WHERE n.turno_id = $1 AND n.tipo_documento IN ('E34','ANU') ORDER BY n.creado_en`,
      [turnoId],
    ),
  ]);
  // Abonos de clientes cobrados con tarjeta o transferencia: no van a la gaveta, pero se cuadran
  const abonosPor = (f: string) => movs.rows.filter((m) => m.tipo === "ABONO_CLIENTE" && m.formaPago === f)
    .reduce((a, m) => a.plus(m.monto), new Decimal(0));
  const resumenMov = (tipo: string) => movs.rows.filter((m) => m.tipo === tipo).reduce((a, m) => a.plus(m.monto), new Decimal(0)).toFixed(2);

  const porForma = new Map(pagos.rows.map((p) => [p.formaPago, p]));
  const efectivoEsp = efectivoEsperado({ fondoInicial: t.fondoInicial, ventasEfectivo: t.ventasEfectivo, entradas: t.entradas, salidas: t.salidas });
  const esperado: Record<string, string> = esperadoPorForma({
    fondoInicial: t.fondoInicial, ventasEfectivo: t.ventasEfectivo, entradas: t.entradas, salidas: t.salidas,
    ventasTarjeta: porForma.get("TARJETA")?.monto ?? 0, ventasTransferencia: porForma.get("TRANSFERENCIA")?.monto ?? 0,
    abonosTarjeta: abonosPor("TARJETA"), abonosTransferencia: abonosPor("TRANSFERENCIA"),
  });
  return {
    turno: t,
    ventas: ventas.rows[0],
    formasPago: pagos.rows,
    anulaciones: anuladas.rows[0],
    anuladas: anuDetalle.rows,
    efectivo: { fondo: t.fondoInicial, ventas: t.ventasEfectivo, entradas: t.entradas, salidas: t.salidas, esperado: efectivoEsp.toFixed(2) },
    movimientos: movs.rows,
    resumenMovimientos: {
      retiros: resumenMov("RETIRO"), gastos: resumenMov("GASTO"), sencillo: resumenMov("DEPOSITO"),
      abonos: resumenMov("ABONO_CLIENTE"), delivery: resumenMov("LIQUIDACION_DELIVERY"),
    },
    // Cerrado: lo que se guardó al cerrar; abierto: lo que se espera a esta hora
    esperado: t.estado === "CERRADO" ? t.esperado ?? esperado : esperado,
  };
}

/** Administradores y supervisores ven los turnos de todos; un cajero solo los suyos. */
async function quienVe(req: { headers: Record<string, unknown> }, cajaId: string): Promise<{ usuarioId: string; todos: boolean }> {
  const s = leerToken(req.headers["x-sesion-caja"] as string | undefined);
  if (!s || s.t !== "caja" || s.c !== cajaId) throw new ErrorNegocio("Su sesión en la caja terminó: vuelva a entrar con su PIN", 401);
  const v = await usuarioVigente(s.u);
  if (!v.activo) throw new ErrorNegocio("Su usuario fue desactivado", 401);
  const todos = v.permisos.includes("*") || ["venta.anular", "venta.descuento", "venta.corregir"].some((p) => v.permisos.includes(p));
  return { usuarioId: s.u, todos };
}

export async function rutasCierre(app: FastifyInstance) {
  const uuid = z.string().uuid();

  /** Cuadre del turno abierto (reporte X). */
  app.get("/cajas/:cajaId/turno/cuadre", async (req) => {
    const { cajaId } = z.object({ cajaId: uuid }).parse(req.params);
    const quien = await quienVe(req, cajaId);
    const t = await pool.query("SELECT id, usuario_id FROM turnos WHERE caja_id = $1 AND estado = 'ABIERTO'", [cajaId]);
    if (!t.rowCount) throw new ErrorNegocio("La caja no tiene un turno abierto");
    if (!quien.todos && t.rows[0].usuario_id !== quien.usuarioId) throw new ErrorNegocio("Este turno es de otro cajero: solo un supervisor o administrador puede ver su cuadre", 403);
    return reporteTurno(pool, t.rows[0].id);
  });

  /**
   * Cierre ciego del turno (reporte Z). El cajero manda su conteo; el sistema
   * calcula lo esperado, guarda la diferencia y cierra.
   */
  app.post("/cajas/:cajaId/turno/cerrar", async (req) => {
    const { cajaId } = z.object({ cajaId: uuid }).parse(req.params);
    const monto = z.string().regex(/^\d+(\.\d{1,2})?$/, "Monto inválido");
    const b = z.object({
      usuarioId: uuid,
      /** Cantidad de billetes/monedas por denominación: {"2000": 3, "500": 4} */
      conteo: z.record(z.enum(DENOMINACIONES.map(String) as [string, ...string[]]), z.number().int().min(0).max(100000)).default({}),
      // Si no se mandan, se toman de las ventas del turno (el cajero solo cuenta el efectivo)
      tarjeta: monto.optional(),
      transferencia: monto.optional(),
      notas: z.string().trim().max(300).nullable().default(null),
    }).parse(req.body);

    const turnoId = await enTransaccion(async (c) => {
      const t = (await c.query("SELECT id FROM turnos WHERE caja_id = $1 AND estado = 'ABIERTO' FOR UPDATE", [cajaId])).rows[0];
      if (!t) throw new ErrorNegocio("La caja no tiene un turno abierto");
      const rep = await reporteTurno(c, t.id);
      const efectivo = efectivoContado(b.conteo);
      const declarado: Record<string, string> = {
        EFECTIVO: efectivo.toFixed(2),
        TARJETA: new Decimal(b.tarjeta ?? (rep.esperado as Record<string, string>).TARJETA ?? "0").toFixed(2),
        TRANSFERENCIA: new Decimal(b.transferencia ?? (rep.esperado as Record<string, string>).TRANSFERENCIA ?? "0").toFixed(2),
      };
      const diferencia = diferenciaCierre(declarado as Record<(typeof CONTADAS)[number], string>, rep.esperado as Record<(typeof CONTADAS)[number], string>);
      await c.query(
        `UPDATE turnos SET estado = 'CERRADO', cerrado_en = now(), cerrado_por = $2, declarado = $3, esperado = $4,
                diferencia = $5, conteo = $6, notas = $7
          WHERE id = $1`,
        [t.id, b.usuarioId, JSON.stringify(declarado), JSON.stringify(rep.esperado), diferencia.toFixed(2), JSON.stringify(b.conteo), b.notas],
      );
      await c.query(
        `INSERT INTO sync_outbox (tabla, registro_id, operacion, payload)
         SELECT 'turnos', id, 'UPSERT', to_jsonb(t) FROM turnos t WHERE id = $1`,
        [t.id],
      );
      return t.id as string;
    });
    // Si la empresa tiene activo el envío del cierre por correo, sale ya (no espera la próxima vuelta de la vigilancia).
    // Es una tarea aparte: si falla o no hay correo configurado, el cierre de caja no se afecta.
    void import("../correo/envios.js").then((m) => m.procesarEnvios()).catch(() => {});
    return reporteTurno(pool, turnoId);
  });

  /** Reporte Z de un turno ya cerrado (para reimprimirlo). */
  app.get("/cajas/:cajaId/turnos/:turnoId", async (req) => {
    const { cajaId, turnoId } = z.object({ cajaId: uuid, turnoId: uuid }).parse(req.params);
    const quien = await quienVe(req, cajaId);
    const r = await reporteTurno(pool, turnoId);
    if (r.turno.cajaId !== cajaId) throw new ErrorNegocio("Turno no encontrado", 404);
    if (!quien.todos && (r.turno as { usuarioId?: string }).usuarioId !== quien.usuarioId) throw new ErrorNegocio("Solo puede ver sus propios turnos", 403);
    if (r.turno.estado !== "CERRADO") throw new ErrorNegocio("El turno sigue abierto");
    return r;
  });

  /** Cuadre de caja del día: todos los turnos de esta caja en la fecha (hora de RD). */
  app.get("/cajas/:cajaId/cuadre-dia", async (req) => {
    const { cajaId } = z.object({ cajaId: uuid }).parse(req.params);
    const { fecha } = z.object({ fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).parse(req.query);
    const quien = await quienVe(req, cajaId);
    const soloMio = quien.todos ? null : quien.usuarioId;
    // Bares y discotecas: la jornada (la noche) termina a las 6:00 a. m.; de madrugada, «hoy» sigue siendo la noche que empezó ayer.
    // Las tiendas siguen con el día de calendario.
    const ctxDia = await contextoCaja(cajaId);
    const tn = (await pool.query<{ t: string }>("SELECT tipo_negocio AS t FROM empresas WHERE id = $1", [ctxDia.empresaId])).rows[0]?.t ?? "TIENDA";
    const desfaseH = tn === "TIENDA" ? 0 : 6;
    const hoy = (await pool.query<{ d: string }>("SELECT ((now() AT TIME ZONE 'America/Santo_Domingo') - make_interval(hours => $1))::date::text AS d", [desfaseH])).rows[0].d;
    const fechaDia = fecha ?? hoy;
    const r = await pool.query(
      `SELECT t.id, u.nombre AS cajero, t.estado, t.abierto_en AS "abiertoEn", t.cerrado_en AS "cerradoEn",
              t.diferencia::text AS diferencia, t.declarado, t.esperado,
              COALESCE((SELECT SUM(CASE WHEN v.tipo_documento IN ('E34','ANU') THEN -v.total ELSE v.total END) FROM ventas v WHERE v.turno_id = t.id), 0)::text AS ventas,
              (SELECT COUNT(*) FROM ventas v WHERE v.turno_id = t.id AND v.tipo_documento NOT IN ('E34','ANU'))::int AS facturas
         FROM turnos t JOIN usuarios u ON u.id = t.usuario_id
        WHERE t.caja_id = $1 AND ($3::uuid IS NULL OR t.usuario_id = $3)
          AND ((t.abierto_en AT TIME ZONE 'America/Santo_Domingo') - make_interval(hours => $4))::date = $2::date
        ORDER BY t.abierto_en`,
      [cajaId, fechaDia, soloMio, desfaseH],
    );
    const pagos = await pool.query(
      `SELECT f.forma_pago AS "formaPago", SUM(f.monto)::text AS monto
         FROM rpt_formas_pago f JOIN turnos t ON t.id = f.turno_id
        WHERE t.caja_id = $1 AND ($3::uuid IS NULL OR t.usuario_id = $3)
          AND ((t.abierto_en AT TIME ZONE 'America/Santo_Domingo') - make_interval(hours => $4))::date = $2::date
        GROUP BY f.forma_pago ORDER BY f.forma_pago`,
      [cajaId, fechaDia, soloMio, desfaseH],
    );
    const suma = (k: "ventas" | "diferencia") => r.rows.reduce((a, x) => a.plus(x[k] ?? 0), new Decimal(0)).toFixed(2);
    return {
      fecha: fechaDia,
      turnos: r.rows,
      formasPago: pagos.rows,
      totales: { ventas: suma("ventas"), diferencia: suma("diferencia"), facturas: r.rows.reduce((a, x) => a + x.facturas, 0) },
    };
  });
}
