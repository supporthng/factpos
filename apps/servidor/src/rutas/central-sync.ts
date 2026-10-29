import { procesarEnvios } from "../correo/envios.js";
import { versionActual } from "../actualizacion.js";
import { aplicarCambioLocal, esCambioLocal } from "../sync/subida-local.js";
import { licenciaParaSucursal } from "../licencia/cliente.js";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { createHash, timingSafeEqual } from "node:crypto";
import { huellaConexion } from "./sesion.js";
import { avisarPendientes, canales, cerrarSinComunicacion } from "../incidentes.js";
import { z } from "zod";
import { pool, enTransaccion, ErrorNegocio } from "../db.js";
import { aplicarFilas, aplicarKardex, conPuntoDeGuardado, modoSincronizacion } from "../sync/aplicar.js";

/**
 * Sincronización de los servidores de sucursal con la central (en la nube).
 *
 *   BAJADA  GET  /central/sync/cambios?sucursalId&desde   datos maestros + kardex que la central
 *                                                         registró para esa sucursal
 *   SUBIDA  POST /central/sync/subir                      lo que nació en la sucursal (ventas,
 *                                                         turnos, clientes, estado e-CF...)
 *   ESTADO  GET  /central/sync/estado                     cuándo habló cada sucursal por última vez
 *
 * Todo es idempotente: si un envío se repite (se cortó la conexión a mitad),
 * aplicarlo otra vez no cambia nada.
 */
const uuid = z.string().uuid();

/** Tablas que bajan, en orden de dependencia, con el filtro para la sucursal ($1 empresa, $2 sucursal). */
export const TABLAS_BAJADA: [string, string][] = [
  ["empresas", "id = $1"],
  ["sucursales", "empresa_id = $1"],
  ["almacenes", "sucursal_id IN (SELECT id FROM sucursales WHERE empresa_id = $1)"],
  ["cajas", "sucursal_id = $2"],
  ["impuestos", "empresa_id = $1"],
  ["roles", "empresa_id = $1"],
  ["usuarios", "empresa_id = $1"],
  ["categorias", "empresa_id = $1"],
  ["listas_precio", "empresa_id = $1"],
  ["proveedores", "empresa_id = $1"],
  ["productos", "empresa_id = $1"],
  ["lotes", "producto_id IN (SELECT id FROM productos WHERE empresa_id = $1)"],
  ["presentaciones", "producto_id IN (SELECT id FROM productos WHERE empresa_id = $1)"],
  ["codigos_barra", "empresa_id = $1"],
  ["precios", "(sucursal_id IS NULL OR sucursal_id = $2) AND lista_precio_id IN (SELECT id FROM listas_precio WHERE empresa_id = $1)"],
  ["producto_sucursal", "sucursal_id = $2"],
  ["producto_proveedores", "producto_id IN (SELECT id FROM productos WHERE empresa_id = $1)"],
  ["clientes", "empresa_id = $1"],
  ["ofertas", "empresa_id = $1"],
  ["oferta_alcance", "oferta_id IN (SELECT id FROM ofertas WHERE empresa_id = $1)"],
  ["cupones", "empresa_id = $1"],
  ["configuracion_fiscal", "empresa_id = $1"],
  ["configuracion_marca", "empresa_id = $1"],
  ["configuracion_sucursal", "sucursal_id = $2"],
  ["ecf_autorizaciones", "empresa_id = $1"],
  ["ecf_rangos", "sucursal_id = $2"],
  ["repartidores", "sucursal_id = $2"],
  ["transferencias", "destino_sucursal_id = $2 OR origen_sucursal_id = $2"],
  ["pedidos_sucursal", "sucursal_id = $2 OR surte_sucursal_id = $2"],
];

const LIMITE = 5000;

/**
 * ¿Quién está sincronizando? Cada servidor de sucursal manda su clave de conexión
 * (x-sucursal-clave), que solo sirve para SU sucursal. Por compatibilidad también se
 * acepta la CLAVE_ACCESO general de la nube.
 */
async function verificarConexion(req: FastifyRequest, sucursalId: string) {
  const propia = req.headers["x-sucursal-clave"];
  if (typeof propia === "string" && propia) {
    const r = await pool.query<{ clave_hash: string }>("SELECT clave_hash FROM sucursal_claves WHERE sucursal_id = $1", [sucursalId]);
    const h = r.rows[0]?.clave_hash;
    const dada = huellaConexion(propia);
    if (h && h.length === dada.length && timingSafeEqual(Buffer.from(h), Buffer.from(dada))) return;
    throw new ErrorNegocio("La clave de conexión no corresponde a esta sucursal: genere una nueva en Administración › Sucursales", 401);
  }
  const general = process.env.CLAVE_ACCESO;
  if (!general) return; // instalación de prueba sin claves
  const dada = req.headers["x-clave-acceso"];
  const huella = (t: string) => createHash("sha256").update(t).digest();
  if (typeof dada === "string" && timingSafeEqual(huella(dada), huella(general))) return;
  throw new ErrorNegocio("Falta la clave de conexión de la sucursal", 401);
}

export async function rutasCentralSync(app: FastifyInstance) {
  // ------------------------------------------------------------- BAJADA
  app.get("/central/sync/cambios", async (req) => {
    const f = z.object({
      sucursalId: uuid,
      desde: z.coerce.number().int().min(0).default(0),
      desdeKardex: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);
    await verificarConexion(req, f.sucursalId);
    const s = await pool.query<{ empresa_id: string }>("SELECT empresa_id FROM sucursales WHERE id = $1", [f.sucursalId]);
    if (!s.rowCount) throw new ErrorNegocio("Sucursal no encontrada", 404);
    const e = s.rows[0].empresa_id;
    const params = [e, f.sucursalId, f.desde];

    const cambios: Record<string, Record<string, unknown>[]> = {};
    let hasta = f.desde;
    let corte = Infinity; // si una tabla llegó al límite, se entrega solo hasta su última versión
    const anotar = (t: string, filas: Record<string, unknown>[]) => {
      if (!filas.length) return;
      cambios[t] = filas;
      const max = Number(filas[filas.length - 1].version);
      hasta = Math.max(hasta, max);
      if (filas.length === LIMITE) corte = Math.min(corte, max);
    };

    for (const [t, filtro] of TABLAS_BAJADA) {
      const r = await pool.query(
        `SELECT to_jsonb(x) AS f FROM ${t} x WHERE version > $3 AND $1::uuid IS NOT NULL AND $2::uuid IS NOT NULL AND (${filtro})
          ORDER BY version LIMIT ${LIMITE}`,
        params,
      );
      anotar(t, r.rows.map((x) => x.f));
    }

    // Si algo quedó cortado, todo se entrega hasta el mismo punto: así nunca llega
    // un registro sin lo que necesita (el resto viene en la próxima descarga).
    const maestrosCompletos = corte === Infinity;
    const version = maestrosCompletos ? hasta : corte;
    if (!maestrosCompletos) {
      for (const t of Object.keys(cambios)) {
        cambios[t] = cambios[t].filter((x) => Number(x.version) <= corte);
        if (!cambios[t].length) delete cambios[t];
      }
    }

    // Movimientos de inventario de esta sucursal registrados en la central
    // (traspasos, compras, ajustes, conteos). Las ventas nacen en la sucursal: no bajan.
    // Llevan su propio contador y solo se mandan cuando los datos maestros están al día
    // (un movimiento no puede llegar antes que su producto).
    //
    // Con el mismo contador bajan las cuentas por cobrar de TODA la empresa (salvo lo
    // que nació en las cajas de esta sucursal): así el saldo de un cliente es el mismo
    // en todas las tiendas. La venta y el turno de otra sucursal no existen aquí: se quitan.
    let versionKardex = f.desdeKardex, kardexCompleto = true;
    if (maestrosCompletos) {
      const [k, x] = await Promise.all([
        pool.query(
          `SELECT to_jsonb(k) AS f FROM kardex_movimientos k
            WHERE sucursal_id = $1 AND version > $2 AND documento_tipo IS DISTINCT FROM 'venta'
            ORDER BY version LIMIT ${LIMITE}`,
          [f.sucursalId, f.desdeKardex],
        ),
        pool.query(
          `SELECT CASE WHEN m.sucursal_id = $1 THEN to_jsonb(m) ELSE to_jsonb(m) - 'venta_id' - 'turno_id' END AS f
             FROM cxc_movimientos m JOIN clientes c ON c.id = m.cliente_id
            WHERE c.empresa_id = $3 AND m.version > $2 AND NOT (m.sucursal_id = $1 AND m.turno_id IS NOT NULL)
            ORDER BY m.version LIMIT ${LIMITE}`,
          [f.sucursalId, f.desdeKardex, e],
        ),
      ]);
      let corteK = Infinity;
      for (const q of [k, x]) if (q.rowCount === LIMITE) corteK = Math.min(corteK, Number(q.rows[q.rows.length - 1].f.version));
      const kardex = k.rows.map((r) => r.f).filter((r) => Number(r.version) <= corteK);
      const cxc = x.rows.map((r) => r.f).filter((r) => Number(r.version) <= corteK);
      if (kardex.length) cambios.kardex_movimientos = kardex;
      if (cxc.length) cambios.cxc_movimientos = cxc;
      kardexCompleto = corteK === Infinity;
      versionKardex = kardexCompleto
        ? Math.max(f.desdeKardex, ...[...kardex, ...cxc].map((r) => Number(r.version)))
        : corteK;
    }
    const completo = maestrosCompletos && kardexCompleto;

    // Componentes de combos: se manda la lista completa de cada combo que cambió
    const combos = await pool.query<{ combo_id: string; componentes: unknown[] }>(
      `SELECT p.id AS combo_id,
              COALESCE((SELECT jsonb_agg(to_jsonb(pc)) FROM producto_componentes pc WHERE pc.combo_id = p.id), '[]') AS componentes
         FROM productos p
        WHERE p.empresa_id = $1
          AND (p.version > $2 AND p.version <= $3
               OR EXISTS (SELECT 1 FROM producto_componentes pc WHERE pc.combo_id = p.id AND pc.version > $2 AND pc.version <= $3))
          AND (p.tipo = 'COMBO' OR EXISTS (SELECT 1 FROM producto_componentes pc WHERE pc.combo_id = p.id))`,
      [e, f.desde, version],
    );
    const componentes = Object.fromEntries(combos.rows.map((r) => [r.combo_id, r.componentes]));

    await pool.query(
      `INSERT INTO sync_sucursales (sucursal_id, ultima_bajada, version_bajada) VALUES ($1, now(), $2)
       ON CONFLICT (sucursal_id) DO UPDATE SET ultima_bajada = now(), version_bajada = $2`,
      [f.sucursalId, version],
    );
    // La sucursal volvió a hablar: se cierra su incidente (y se avisa a soporte)
    await cerrarSinComunicacion(f.sucursalId);
    if ((await canales()).length) await avisarPendientes((m) => req.log.warn(m)).catch(() => 0);
    // Huella del certificado digital vigente: si la sucursal tiene otro, lo pide de una vez
    const cert = await pool.query<{ huella: string }>(
      `SELECT c.huella FROM certificados_digitales c JOIN sucursales s ON s.id = $2 AND s.certificado_habilitado
        WHERE c.empresa_id = $1 AND c.activo`,
      [e, f.sucursalId],
    );
    // La licencia de la empresa viaja con cada sincronización (la sucursal la verifica sola)
    const licencia = await licenciaParaSucursal().catch(() => undefined);
    return { desde: f.desde, version, versionKardex, completo, cambios, componentes, certificado: cert.rows[0]?.huella ?? null, licencia,
      versionPrincipal: versionActual() };
  });

  // ------------------------------------------------------------- SUBIDA
  const esquemaSubida = z.object({
    sucursalId: uuid,
    equipo: z.string().max(80).optional(),
    appVersion: z.string().max(20).optional(),
    pendientes: z.number().int().min(0).optional(),
    items: z.array(z.object({
      id: z.union([z.string(), z.number()]),     // id local de la cola (para que la sucursal lo marque)
      tabla: z.string().max(40),
      registroId: uuid,
      payload: z.record(z.string(), z.any()),
    })).max(1000),
  });

  app.post("/central/sync/subir", { bodyLimit: 16 * 1024 * 1024 }, async (req) => {
    const b = esquemaSubida.parse(req.body);
    await verificarConexion(req, b.sucursalId);
    const s = await pool.query<{ empresa_id: string }>("SELECT empresa_id FROM sucursales WHERE id = $1", [b.sucursalId]);
    if (!s.rowCount) throw new ErrorNegocio("Sucursal no encontrada", 404);
    const empresaId = s.rows[0].empresa_id;

    const aplicados: (string | number)[] = [];
    const errores: { id: string | number; error: string }[] = [];

    await enTransaccion(async (c) => {
      // Una sola subida a la vez por sucursal (si se reintenta en paralelo, espera)
      await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`sync:${b.sucursalId}`]);
      await modoSincronizacion(c);
      for (const it of b.items) {
        const r = await conPuntoDeGuardado(c, () => esCambioLocal(it.tabla)
          ? aplicarCambioLocal(c, b.sucursalId, empresaId, it.tabla, it.payload) // administración local de la sucursal
          : aplicarSubida(c, b.sucursalId, it.tabla, it.payload));
        if (r.ok) aplicados.push(it.id);
        else errores.push({ id: it.id, error: r.error.message.slice(0, 300) });
      }
      await c.query(
        `INSERT INTO sync_sucursales (sucursal_id, ultima_subida, pendientes, errores, ultimo_error, equipo, app_version)
         VALUES ($1, now(), $2, $3, $4, $5, $6)
         ON CONFLICT (sucursal_id) DO UPDATE SET ultima_subida = now(), pendientes = $2, errores = $3,
                ultimo_error = COALESCE($4, CASE WHEN $3 = 0 THEN NULL ELSE sync_sucursales.ultimo_error END),
                equipo = COALESCE($5, sync_sucursales.equipo), app_version = COALESCE($6, sync_sucursales.app_version)`,
        [b.sucursalId, Math.max(0, (b.pendientes ?? b.items.length) - aplicados.length), errores.length,
         errores[0]?.error ?? null, b.equipo ?? null, b.appVersion ?? null],
      );
    });
    if (errores.length) req.log.warn({ sucursal: b.sucursalId, errores: errores.slice(0, 5) }, "sync: elementos no aplicados");
    // La sucursal volvió a hablar: se cierra su incidente y se avisa a soporte lo pendiente
    await cerrarSinComunicacion(b.sucursalId);
    if ((await canales()).length) await avisarPendientes((m) => req.log.warn(m)).catch(() => 0);
    // Llegaron cierres de caja: se envían por correo de una vez (sin esperar la vigilancia)
    if (b.items.some((i) => i.tabla === "turnos")) {
      await Promise.race([procesarEnvios((m) => req.log.warn(m)).catch(() => null), new Promise((r) => setTimeout(r, 8000))]);
    }
    return { aplicados, errores };
  });

  // ------------------------------------------------------------- ESTADO
  // ------------------------------------------------------- CERTIFICADO
  /**
   * El servidor de la sucursal pregunta por el certificado digital e informa
   * cuál tiene en uso (huella) y si tuvo algún problema al cargarlo. Solo se
   * le manda el certificado (cifrado) cuando es distinto del que tiene.
   */
  app.get("/central/sync/certificado", async (req) => {
    const f = z.object({
      sucursalId: uuid,
      huella: z.string().regex(/^[0-9a-f]{64}$/).optional(),
      error: z.string().max(300).optional(),
    }).parse(req.query);
    await verificarConexion(req, f.sucursalId);
    await pool.query(
      `INSERT INTO sync_sucursales (sucursal_id, certificado_huella, certificado_error, certificado_en) VALUES ($1,$2,$3,now())
       ON CONFLICT (sucursal_id) DO UPDATE SET certificado_huella = $2, certificado_error = $3, certificado_en = now()`,
      [f.sucursalId, f.huella ?? null, f.error ?? null],
    );
    const r = await pool.query(
      `SELECT s.certificado_habilitado AS habilitado, c.id, c.empresa_id, c.titular, c.emisor, c.numero_serie, c.valido_desde, c.vence, c.huella, c.cifrado, c.subido_por, c.subido_en
         FROM sucursales s LEFT JOIN certificados_digitales c ON c.empresa_id = s.empresa_id AND c.activo
        WHERE s.id = $1`,
      [f.sucursalId],
    );
    const { habilitado, ...c } = r.rows[0] ?? {};
    // Desactivada desde la Administración: no se le entrega (y la sucursal deja de usarlo)
    if (!habilitado) return { certificado: null, habilitado: false };
    if (!c.id) return { certificado: null, habilitado: true };
    if (c.huella === f.huella) return { igual: true };
    return { certificado: c };
  });

  app.get("/central/sync/estado", async (req) => {
    const empresaId = uuid.parse(req.headers["x-empresa-id"]);
    const r = await pool.query(
      `SELECT s.id AS "sucursalId", s.codigo, s.nombre, s.tipo,
              y.ultima_subida AS "ultimaSubida", y.ultima_bajada AS "ultimaBajada",
              y.pendientes, y.errores, y.ultimo_error AS "ultimoError", y.equipo, y.app_version AS "appVersion",
              GREATEST(y.ultima_subida, y.ultima_bajada) > now() - interval '2 minutes' AS "enLinea",
              EXTRACT(EPOCH FROM now() - GREATEST(y.ultima_subida, y.ultima_bajada))::int AS "segundos",
              (SELECT MAX(v.creado_en) FROM ventas v WHERE v.sucursal_id = s.id) AS "ultimaVenta"
         FROM sucursales s LEFT JOIN sync_sucursales y ON y.sucursal_id = s.id
        WHERE s.empresa_id = $1 AND s.activo
        ORDER BY s.codigo`,
      [empresaId],
    );
    return r.rows;
  });
}

type Pg = Parameters<typeof aplicarFilas>[0];
type Payload = Record<string, any>;

/** Aplica en la central un elemento de la cola de una sucursal. */
async function aplicarSubida(c: Pg, sucursalId: string, tabla: string, p: Payload) {
  const propio = (fila: Payload | undefined) => {
    if (fila?.sucursal_id && fila.sucursal_id !== sucursalId) throw new Error(`El registro pertenece a otra sucursal`);
  };
  switch (tabla) {
    case "ventas": {
      propio(p.venta);
      await aplicarFilas(c, "ventas", [p.venta], "insertar");
      await aplicarFilas(c, "venta_items", p.items, "insertar");
      await aplicarFilas(c, "venta_pagos", p.pagos, "insertar");
      await aplicarKardex(c, p.kardex);
      await aplicarFilas(c, "cxc_movimientos", p.cxc, "insertar");
      if (p.cupon) await aplicarFilas(c, "cupon_usos", [p.cupon], "insertar");
      if (p.ecf) {
        await aplicarFilas(c, "ecf_documentos", [p.ecf], "insertar");
        // La central lleva la cuenta de cuántos números usó cada sucursal
        if (p.ecf.rango_id && p.ecf.encf) {
          await c.query(
            `UPDATE ecf_rangos SET siguiente = LEAST(hasta + 1, GREATEST(siguiente, substr($2, 4)::bigint + 1))
              WHERE id = $1 AND siguiente <= substr($2, 4)::bigint`,
            [p.ecf.rango_id, p.ecf.encf],
          );
        }
      }
      await aplicarFilas(c, "auditoria", p.auditoria, "insertar");
      return;
    }
    case "turnos": {
      // Formato anterior: la fila directa; nuevo: { filas: [...] }
      const filas = p.filas ?? [p];
      filas.forEach(propio);
      await aplicarFilas(c, "turnos", filas, "reemplazar");
      return;
    }
    case "transferencias": {
      await aplicarFilas(c, "transferencias", [p.transferencia], "reemplazar");
      await aplicarFilas(c, "transferencia_items", p.items, "reemplazar");
      await aplicarKardex(c, p.kardex);
      return;
    }
    case "clientes": {
      for (const fila of p.filas as Payload[]) {
        const r = await conPuntoDeGuardadoAnidado(c, () => aplicarFilas(c, "clientes", [fila], "ultimo"));
        if (r === "duplicado") {
          // Otra sucursal registró el mismo documento al mismo tiempo: este queda
          // inactivo (las ventas que lo usan siguen siendo válidas).
          await aplicarFilas(c, "clientes", [{ ...fila, activo: false }], "ultimo");
        }
      }
      return;
    }
    case "incidentes":
      (p.filas as Payload[]).forEach(propio);
      await aplicarFilas(c, "incidentes", (p.filas as Payload[]).map((f) => ({ ...f, notificado_en: null, notificado_fin: null, resuelto_en: null, resuelto_por: null, nota: null })), "insertar");
      // Si ya existía (el corte terminó y se reenvía con su hora de fin), se actualiza el fin
      for (const f of p.filas as Payload[]) {
        await c.query("UPDATE incidentes SET hasta = $2, detalle = $3, actualizado_en = now() WHERE id = $1 AND hasta IS DISTINCT FROM $2",
          [f.id, f.hasta, f.detalle === null ? null : JSON.stringify(f.detalle)]);
      }
      return;
    case "pedidos_delivery":
      (p.filas as Payload[]).forEach(propio);
      await aplicarFilas(c, "pedidos_delivery", p.filas, "reemplazar");
      return;
    case "movimientos_caja":
    case "auditoria":
    case "cxc_movimientos":
      (p.filas as Payload[]).forEach(propio);
      await aplicarFilas(c, tabla, p.filas, "insertar");
      return;
    case "ecf_estado":
      for (const d of p.filas as Payload[]) {
        await c.query(
          `UPDATE ecf_documentos SET estado = $2, track_id = $3, mensajes = $4, enviado_en = $5, intentos = $6, actualizado_en = $7
            WHERE id = $1 AND sucursal_id = $8 AND actualizado_en <= $7`,
          [d.id, d.estado, d.track_id, d.mensajes === null ? null : JSON.stringify(d.mensajes), d.enviado_en, d.intentos, d.actualizado_en, sucursalId],
        );
      }
      return;
    default:
      throw new Error(`Tipo de dato desconocido: ${tabla}`);
  }
}

async function conPuntoDeGuardadoAnidado(c: Pg, fn: () => Promise<unknown>): Promise<"ok" | "duplicado"> {
  await c.query("SAVEPOINT sp_cliente");
  try {
    await fn();
    await c.query("RELEASE SAVEPOINT sp_cliente");
    return "ok";
  } catch (e: any) {
    await c.query("ROLLBACK TO SAVEPOINT sp_cliente");
    if (e.code === "23505") return "duplicado";
    throw e;
  }
}
