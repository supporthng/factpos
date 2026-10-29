import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { uuidv7, rncValido, cedulaValida } from "@factpos/compartido";
import { pool, enTransaccion, ErrorNegocio } from "../db.js";
import { contextoCaja } from "../contexto.js";
import { verificarAutorizacion } from "../autorizacion.js";
import { encolarFilas } from "../sync/outbox.js";

const decimal2 = z.string().regex(/^\d+(\.\d{1,2})?$/, "Monto inválido");

export async function rutasTurnos(app: FastifyInstance) {
  app.get("/cajas", async () => {
    const r = await pool.query(
      `SELECT ca.id, ca.numero, ca.nombre, s.nombre AS sucursal
         FROM cajas ca JOIN sucursales s ON s.id = ca.sucursal_id
        WHERE ca.activo ORDER BY s.nombre, ca.numero`,
    );
    return r.rows;
  });

  /** Configuración que la terminal necesita al arrancar (incluye qué módulos están activos). */
  app.get("/cajas/:cajaId/config", async (req) => {
    const { cajaId } = z.object({ cajaId: z.string().uuid() }).parse(req.params);
    const r = await pool.query(
      `SELECT ca.id, ca.numero, ca.nombre, s.id AS "sucursalId", s.nombre AS sucursal,
              e.nombre_comercial AS empresa, e.rnc,
              COALESCE(cs.modulos, '{}'::jsonb) AS modulos,
              jsonb_build_object('logo', m.logo, 'primario', COALESCE(m.color_primario, '#2dd4bf'),
                                 'secundario', CASE WHEN m.empresa_id IS NULL THEN '#0e1b26' ELSE m.color_secundario END, 'logoEnTicket', COALESCE(m.logo_en_ticket, true)) AS marca
         FROM cajas ca JOIN sucursales s ON s.id = ca.sucursal_id JOIN empresas e ON e.id = s.empresa_id
         LEFT JOIN configuracion_sucursal cs ON cs.sucursal_id = s.id
         LEFT JOIN configuracion_marca m ON m.empresa_id = e.id
        WHERE ca.id = $1`,
      [cajaId],
    );
    if (!r.rowCount) throw new ErrorNegocio("Caja no encontrada", 404);
    const c = r.rows[0];
    return { ...c, modulos: { delivery: { activo: Boolean(c.modulos?.delivery?.activo) } } };
  });

  app.get("/cajas/:cajaId/usuarios", async (req) => {
    const { cajaId } = z.object({ cajaId: z.string().uuid() }).parse(req.params);
    const r = await pool.query(
      `SELECT u.id, u.nombre, u.pin_hash IS NOT NULL AS "tienePin" FROM usuarios u
         JOIN roles ro ON ro.id = u.rol_id
         JOIN cajas ca ON ca.id = $1 JOIN sucursales s ON s.id = ca.sucursal_id
        WHERE u.empresa_id = s.empresa_id AND u.activo
          AND ('*' = ANY(ro.permisos) OR 'venta.crear' = ANY(ro.permisos))
        ORDER BY u.nombre`,
      [cajaId],
    );
    return r.rows;
  });

  /** Búsqueda de clientes desde la terminal: nombre, teléfono, cédula o RNC. */
  app.get("/cajas/:cajaId/clientes", async (req) => {
    const { cajaId } = z.object({ cajaId: z.string().uuid() }).parse(req.params);
    const { q } = z.object({ q: z.string().trim().min(2).max(60) }).parse(req.query);
    const r = await pool.query(
      `SELECT c.id, c.nombre, c.tipo_documento AS "tipoDocumento", c.documento, c.telefono,
              lp.nivel, lp.nombre AS lista, c.limite_credito AS "limiteCredito",
              COALESCE((SELECT SUM(m.monto) FROM cxc_movimientos m WHERE m.cliente_id = c.id), 0) AS saldo
         FROM clientes c
         JOIN cajas ca ON ca.id = $1 JOIN sucursales s ON s.id = ca.sucursal_id AND s.empresa_id = c.empresa_id
         LEFT JOIN listas_precio lp ON lp.id = c.lista_precio_id
        WHERE c.activo AND (c.nombre ILIKE '%' || $2 || '%' OR c.documento LIKE $2 || '%'
                            OR regexp_replace(c.telefono, '\D', '', 'g') LIKE regexp_replace($2, '\D', '', 'g') || '%')
        ORDER BY c.nombre LIMIT 20`,
      [cajaId, q],
    );
    return r.rows;
  });

  app.get("/cajas/:cajaId/clientes/:clienteId", async (req) => {
    const { cajaId, clienteId } = z.object({ cajaId: z.string().uuid(), clienteId: z.string().uuid() }).parse(req.params);
    return clientePorId(cajaId, clienteId);
  });

  /**
   * Cliente nuevo desde la caja. Siempre entra con Precio 1: los precios 2 y 3
   * se asignan con permiso (abajo) o desde la Administración.
   */
  app.post("/cajas/:cajaId/clientes", async (req, rep) => {
    const { cajaId } = z.object({ cajaId: z.string().uuid() }).parse(req.params);
    // Con comprobante fiscal (lo normal): RNC o cédula obligatorios. Sin comprobante: documento opcional.
    const b = z.object({
      usuarioId: z.string().uuid(),
      nombre: z.string().trim().min(3, "Escriba el nombre o la razón social").max(120),
      paraComprobante: z.boolean().default(true),
      tipoDocumento: z.enum(["RNC", "CEDULA", "PASAPORTE", "NINGUNO"]).default("NINGUNO"),
      documento: z.string().trim().max(20).nullable().default(null),
      telefono: z.string().trim().max(20).nullable().default(null),
      /** La cédula no pasó el dígito verificador pero el cajero confirmó que está bien escrita */
      confirmarDocumento: z.boolean().default(false),
    }).parse(req.body);
    if (b.paraComprobante && !(["RNC", "CEDULA"].includes(b.tipoDocumento) && b.documento)) {
      throw new ErrorNegocio("Para factura con comprobante fiscal el RNC o la cédula es obligatorio");
    }
    const doc = !b.documento || b.tipoDocumento === "NINGUNO" ? null
      : b.tipoDocumento === "PASAPORTE" ? b.documento.toUpperCase().replace(/\s/g, "") : b.documento.replace(/\D/g, "");
    if (b.tipoDocumento !== "NINGUNO" && !doc) throw new ErrorNegocio("Escriba el número del documento");
    if (b.tipoDocumento === "RNC" && !rncValido(doc!)) throw new ErrorNegocio("RNC inválido: revise los 9 dígitos (el último no coincide con el verificador de la DGII)");
    if (b.tipoDocumento === "CEDULA") {
      if (!/^\d{11}$/.test(doc!)) throw new ErrorNegocio("La cédula debe tener 11 dígitos");
      if (!cedulaValida(doc!) && !b.confirmarDocumento) throw new ErrorNegocio("El último dígito de la cédula no coincide: verifíquela con el documento");
    }
    if (b.tipoDocumento === "PASAPORTE" && !/^[A-Z0-9]{5,20}$/.test(doc!)) throw new ErrorNegocio("Pasaporte inválido");
    const ctx = await contextoCaja(cajaId);
    const id = uuidv7();
    try {
      await enTransaccion(async (c) => {
        await c.query(
          `INSERT INTO clientes (id, empresa_id, tipo_documento, documento, nombre, telefono, lista_precio_id, limite_credito, creado_por)
           VALUES ($1, $2, $3, $4, $5, $6, (SELECT id FROM listas_precio WHERE empresa_id = $2 AND nivel = 1), 0, $7)`,
          [id, ctx.empresaId, b.tipoDocumento, doc, b.nombre, b.telefono, b.usuarioId],
        );
        await encolarFilas(c, "clientes", [id]);
      });
    } catch (e: any) {
      if (e.code === "23505") throw new ErrorNegocio("Ya existe un cliente con ese documento: búsquelo con F4", 409);
      throw e;
    }
    rep.code(201);
    return clientePorId(cajaId, id);
  });

  /** Cambiar el nivel de precio de un cliente: requiere el PIN de un supervisor con el permiso cliente.precio. */
  app.put("/cajas/:cajaId/clientes/:clienteId/precio", async (req) => {
    const { cajaId, clienteId } = z.object({ cajaId: z.string().uuid(), clienteId: z.string().uuid() }).parse(req.params);
    const b = z.object({ usuarioId: z.string().uuid(), nivel: z.number().int().min(1).max(3), autorizacion: z.string().max(2000) }).parse(req.body);
    const a = verificarAutorizacion(b.autorizacion, "cliente.precio", cajaId);
    const ctx = await contextoCaja(cajaId);
    await enTransaccion(async (c) => {
      const antes = (await c.query(
        `SELECT lp.nivel FROM clientes cl LEFT JOIN listas_precio lp ON lp.id = cl.lista_precio_id WHERE cl.id = $1 AND cl.empresa_id = $2 FOR UPDATE OF cl`,
        [clienteId, ctx.empresaId],
      )).rows[0];
      if (!antes) throw new ErrorNegocio("Cliente no encontrado", 404);
      await c.query("UPDATE clientes SET lista_precio_id = (SELECT id FROM listas_precio WHERE empresa_id = $2 AND nivel = $3) WHERE id = $1",
        [clienteId, ctx.empresaId, b.nivel]);
      const audId = uuidv7();
      await c.query(
        `INSERT INTO auditoria (id, sucursal_id, usuario_id, autorizado_por, accion, entidad, entidad_id, detalle)
         VALUES ($1, $2, $3, $4, 'cliente.precio', 'cliente', $5, $6)`,
        [audId, ctx.sucursalId, b.usuarioId, a.supervisorId, clienteId, JSON.stringify({ antes: antes.nivel ?? 1, ahora: b.nivel })],
      );
      await encolarFilas(c, "clientes", [clienteId]);
      await encolarFilas(c, "auditoria", [audId]);
    });
    return { ...(await clientePorId(cajaId, clienteId)), autorizadoPor: a.supervisor };
  });

  app.get("/cajas/:cajaId/turno", async (req) => {
    const { cajaId } = z.object({ cajaId: z.string().uuid() }).parse(req.params);
    const r = await pool.query(
      `SELECT t.id, t.abierto_en AS "abiertoEn", t.fondo_inicial AS "fondoInicial",
              u.id AS "usuarioId", u.nombre AS usuario
         FROM turnos t JOIN usuarios u ON u.id = t.usuario_id
        WHERE t.caja_id = $1 AND t.estado = 'ABIERTO'`,
      [cajaId],
    );
    return r.rows[0] ?? null;
  });

  app.post("/cajas/:cajaId/turno/abrir", async (req, rep) => {
    const { cajaId } = z.object({ cajaId: z.string().uuid() }).parse(req.params);
    const body = z.object({ usuarioId: z.string().uuid(), fondoInicial: decimal2 }).parse(req.body);

    const turno = await enTransaccion(async (c) => {
      const ctx = await contextoCaja(cajaId, c);
      const id = uuidv7();
      try {
        await c.query(
          `INSERT INTO turnos (id, sucursal_id, caja_id, usuario_id, abierto_en, fondo_inicial)
           VALUES ($1, $2, $3, $4, now(), $5)`,
          [id, ctx.sucursalId, cajaId, body.usuarioId, body.fondoInicial],
        );
      } catch (e: any) {
        if (e.code === "23505") throw new ErrorNegocio("Esta caja ya tiene un turno abierto", 409);
        throw e;
      }
      await c.query(
        `INSERT INTO sync_outbox (tabla, registro_id, operacion, payload)
         SELECT 'turnos', id, 'UPSERT', to_jsonb(t) FROM turnos t WHERE id = $1`,
        [id],
      );
      return { id };
    });
    rep.code(201);
    return turno;
  });
}

async function clientePorId(cajaId: string, clienteId: string) {
  const r = await pool.query(
    `SELECT c.id, c.nombre, c.tipo_documento AS "tipoDocumento", c.documento, c.telefono,
            COALESCE(lp.nivel, 1) AS nivel, lp.nombre AS lista, c.limite_credito AS "limiteCredito",
            COALESCE((SELECT SUM(m.monto) FROM cxc_movimientos m WHERE m.cliente_id = c.id), 0) AS saldo
       FROM clientes c
       JOIN cajas ca ON ca.id = $1 JOIN sucursales s ON s.id = ca.sucursal_id AND s.empresa_id = c.empresa_id
       LEFT JOIN listas_precio lp ON lp.id = c.lista_precio_id
      WHERE c.id = $2`,
    [cajaId, clienteId],
  );
  if (!r.rowCount) throw new ErrorNegocio("Cliente no encontrado", 404);
  return r.rows[0];
}
