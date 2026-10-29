import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { uuidv7 } from "@factpos/compartido";
import { pool, enTransaccion, ErrorNegocio } from "../db.js";
import { huellaConexion } from "./sesion.js";

/**
 * Alta de servidores (en la central). Tres caminos, el que sea más cómodo:
 *
 *  A. SOLICITUD (lo normal): el servidor recién instalado se anuncia y aparece en
 *     Administración › Sucursales › «Servidores esperando alta». Solo se confirma
 *     a qué sucursal corresponde (GET /central/alta/pendientes + POST aprobar).
 *  B. CÓDIGO DE INSTALACIÓN: la Administración genera un código para una sucursal
 *     (POST /central/alta/codigo); al instalar el servidor se escribe y queda dado
 *     de alta solo (POST /central/alta/canjear, sin sesión).
 *  C. CÓDIGO DEL SERVIDOR: se escribe en la Administración el código que muestra
 *     el servidor (equivale a confirmar su solicitud).
 *
 *  Detalle del camino A/C:
 *  1. El servidor recién instalado en una tienda pide un código:
 *       POST /central/alta/solicitar            → { codigo: "K7PD-4QX9", sondeo }
 *     y lo muestra (instalador, registro y http://<servidor>:3000/alta).
 *  2. En Administración › Sucursales › «Dar de alta un servidor» se escribe el
 *     código y se elige (o crea) la sucursal:
 *       GET  /central/alta/:codigo              → qué equipo es
 *       POST /central/alta/aprobar              → { codigo, sucursalId }
 *  3. El servidor pregunta cada pocos segundos con su token de sondeo:
 *       POST /central/alta/estado               → PENDIENTE | APROBADO
 *     Al estar aprobado recibe, UNA vez, su sucursal, una clave de conexión
 *     nueva y el PIN_SECRETO; los guarda en su .env y empieza a sincronizar.
 *
 * El código solo sirve para encontrar la solicitud: lo que se entrega exige
 * además el token que solo tiene el servidor (aquí se guarda su huella).
 * Cada sucursal tiene una sola clave: dar de alta un servidor para una
 * sucursal que ya tenía uno lo reemplaza (el viejo deja de sincronizar).
 */
const uuid = z.string().uuid();
const VIGENCIA_HORAS = 24;
const VIGENCIA_CODIGO_DIAS = 7; // códigos generados en la Administración
const REENTREGA_MIN = 10; // si se perdió la respuesta, el mismo servidor puede volver a recibirla
const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin 0/O ni 1/I

const nuevoCodigo = () => {
  const c = Array.from({ length: 8 }, () => ALFABETO[randomInt(ALFABETO.length)]).join("");
  return `${c.slice(0, 4)}-${c.slice(4)}`;
};
/** Acepta "k7pd4qx9", "K7PD 4QX9", "K7PD-4QX9"… */
export const normalizarCodigo = (t: string) => {
  const c = t.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/O/g, "0").replace(/I/g, "1");
  return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
};
const codigo = z.string().trim().min(8).max(12).transform(normalizarCodigo)
  .refine((c) => /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(c), "El código tiene 8 letras y números, como K7PD-4QX9");
const huella = (t: string) => createHash("sha256").update(`factpos:alta:${t}`).digest("hex");
const igual = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Genera la clave de conexión de la sucursal (solo se guarda su huella) y arma lo que recibe el servidor. */
async function entregar(c: { query: typeof pool.query }, a: { codigo: string; sucursal_id: string; empresa_id: string; aprobado_por: string | null }) {
  const secreto = process.env.PIN_SECRETO;
  if (!secreto) throw new ErrorNegocio("La central no tiene PIN_SECRETO configurado (Vercel › Environment Variables)", 503);
  const s = (await c.query(
    `SELECT s.nombre, s.codigo, COALESCE(e.nombre_comercial, e.razon_social) AS empresa
       FROM sucursales s JOIN empresas e ON e.id = s.empresa_id WHERE s.id = $1`, [a.sucursal_id],
  )).rows[0] as { nombre: string; codigo: string; empresa: string } | undefined;
  const clave = `fps_${randomBytes(24).toString("base64url")}`;
  await c.query(
    `INSERT INTO sucursal_claves (sucursal_id, clave_hash, creada_por) VALUES ($1, $2, $3)
     ON CONFLICT (sucursal_id) DO UPDATE SET clave_hash = $2, creada_en = now(), creada_por = $3`,
    [a.sucursal_id, huellaConexion(clave), a.aprobado_por],
  );
  await c.query("UPDATE altas_servidor SET entregado_en = COALESCE(entregado_en, now()) WHERE codigo = $1", [a.codigo]);
  return {
    estado: "APROBADO" as const, sucursalId: a.sucursal_id, empresaId: a.empresa_id,
    sucursal: s?.nombre ?? null, sucursalCodigo: s?.codigo ?? null, empresa: s?.empresa ?? null,
    clave, pinSecreto: secreto,
  };
}

// Freno simple para quien pruebe códigos al azar (por IP, en esta instancia)
const intentos = new Map<string, { n: number; desde: number }>();
function frenarIp(ip: string) {
  const ahora = Date.now();
  const x = intentos.get(ip);
  if (!x || ahora - x.desde > 15 * 60_000) { intentos.set(ip, { n: 1, desde: ahora }); return; }
  if (++x.n > 20) throw new ErrorNegocio("Demasiados intentos con códigos equivocados. Espere 15 minutos.", 429);
}

export async function rutasCentralAlta(app: FastifyInstance) {
  const empresaDe = (req: { headers: Record<string, unknown> }) => uuid.parse(req.headers["x-empresa-id"]);
  const usuarioDe = (req: { headers: Record<string, unknown> }) => uuid.parse(req.headers["x-usuario-id"]);

  // ---------------------------------------------------------------- servidor (sin sesión)
  app.post("/central/alta/solicitar", async (req, rep) => {
    const b = z.object({
      equipo: z.string().trim().max(80).optional(), version: z.string().trim().max(40).optional(),
      rnc: z.string().trim().regex(/^\d{9}(\d{2})?$/, "RNC de 9 u 11 dígitos").optional().or(z.literal("").transform(() => undefined)),
    }).parse(req.body ?? {});
    await pool.query("DELETE FROM altas_servidor WHERE expira_en < now() - interval '1 day'");
    const abiertas = await pool.query<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM altas_servidor WHERE aprobado_en IS NULL AND expira_en > now()");
    if (abiertas.rows[0].n >= 300) throw new ErrorNegocio("Hay demasiadas solicitudes de alta abiertas; intente más tarde", 429);
    const sondeo = randomBytes(24).toString("base64url");
    for (let intento = 0; intento < 5; intento++) {
      const c = nuevoCodigo();
      const r = await pool.query(
        `INSERT INTO altas_servidor (codigo, sondeo_hash, equipo, version, ip, rnc, expira_en)
         VALUES ($1, $2, $3, $4, $5, $6, now() + make_interval(hours => $7)) ON CONFLICT (codigo) DO NOTHING
         RETURNING expira_en AS "expiraEn"`,
        [c, huella(sondeo), b.equipo ?? null, b.version ?? null, req.ip ?? null, b.rnc ?? null, VIGENCIA_HORAS],
      );
      if (r.rowCount) { rep.code(201); return { codigo: c, sondeo, expiraEn: r.rows[0].expiraEn }; }
    }
    throw new ErrorNegocio("No se pudo generar el código; intente de nuevo", 503);
  });

  app.post("/central/alta/estado", async (req) => {
    const b = z.object({ codigo, sondeo: z.string().min(20).max(80) }).parse(req.body);
    const a = (await pool.query(
      `SELECT codigo, sondeo_hash, sucursal_id, empresa_id, aprobado_por, aprobado_en, entregado_en, descartado_en, expira_en < now() AS vencido,
              entregado_en < now() - make_interval(mins => $2) AS "entregaVieja"
         FROM altas_servidor WHERE codigo = $1`, [b.codigo, REENTREGA_MIN],
    )).rows[0];
    if (!a || !a.sondeo_hash || !igual(a.sondeo_hash, huella(b.sondeo))) throw new ErrorNegocio("Código desconocido: pida uno nuevo", 404);
    if (a.descartado_en) throw new ErrorNegocio("La Administración rechazó esta solicitud", 410);
    if (!a.aprobado_en) {
      if (a.vencido) throw new ErrorNegocio("El código venció sin darse de alta: pida uno nuevo", 410);
      return { estado: "PENDIENTE" };
    }
    if (a.entregaVieja) throw new ErrorNegocio("Este código ya se usó", 410);
    return enTransaccion((c) => entregar(c, a));
  });

  /** Camino B: el instalador trae el código que generó la Administración para una sucursal. */
  app.post("/central/alta/canjear", async (req) => {
    const b = z.object({ codigo, equipo: z.string().trim().max(80).optional(), version: z.string().trim().max(40).optional() }).parse(req.body);
    const ip = req.ip ?? "?";
    return enTransaccion(async (c) => {
      const a = (await c.query(
        `SELECT codigo, sucursal_id, empresa_id, aprobado_por, entregado_en, equipo,
                entregado_en < now() - make_interval(mins => $2) AS "entregaVieja"
           FROM altas_servidor
          WHERE codigo = $1 AND origen = 'ADMINISTRACION' AND descartado_en IS NULL AND expira_en > now()
          FOR UPDATE`, [b.codigo, REENTREGA_MIN],
      )).rows[0];
      if (!a) { frenarIp(ip); throw new ErrorNegocio("Código de instalación no válido o vencido: genere otro en Administración › Sucursales", 404); }
      // Si se cortó la respuesta, el MISMO equipo puede reintentar unos minutos
      if (a.entregado_en && (a.entregaVieja || (a.equipo && b.equipo && a.equipo !== b.equipo))) throw new ErrorNegocio("Ese código de instalación ya se usó", 410);
      await c.query("UPDATE altas_servidor SET equipo = $2, version = $3, ip = $4 WHERE codigo = $1",
        [a.codigo, b.equipo ?? null, b.version ?? null, ip]);
      await c.query(
        `INSERT INTO auditoria (id, sucursal_id, usuario_id, accion, entidad, entidad_id, detalle)
         VALUES ($1, $2, $3, 'sucursal.alta_servidor', 'sucursal', $2, $4)`,
        [uuidv7(), a.sucursal_id, a.aprobado_por, JSON.stringify({ codigo: a.codigo, equipo: b.equipo, via: "codigo_de_instalacion" })],
      );
      return entregar(c, a);
    });
  });

  // ---------------------------------------------------------------- administración (con sesión)
  /** Servidores que se instalaron y esperan que se confirme su sucursal, y los códigos de instalación vigentes. */
  app.get("/central/alta/pendientes", async (req) => {
    const e = empresaDe(req);
    const [solicitudes, codigos] = await Promise.all([
      pool.query(
        `SELECT a.codigo, a.equipo, a.version, a.ip, a.rnc, a.creado_en AS "creadoEn", a.expira_en AS "expiraEn"
           FROM altas_servidor a
          WHERE a.origen = 'SERVIDOR' AND a.aprobado_en IS NULL AND a.descartado_en IS NULL AND a.expira_en > now()
            AND (a.rnc IS NULL OR a.rnc = (SELECT rnc FROM empresas WHERE id = $1))
          ORDER BY a.creado_en DESC LIMIT 50`, [e]),
      pool.query(
        `SELECT a.codigo, a.sucursal_id AS "sucursalId", a.expira_en AS "expiraEn", a.entregado_en AS "usadoEn", a.equipo
           FROM altas_servidor a
          WHERE a.origen = 'ADMINISTRACION' AND a.empresa_id = $1 AND a.descartado_en IS NULL
            AND (a.entregado_en IS NULL AND a.expira_en > now() OR a.entregado_en > now() - interval '1 day')
          ORDER BY a.creado_en DESC`, [e]),
    ]);
    return { solicitudes: solicitudes.rows, codigos: codigos.rows };
  });

  /** Camino B: código de instalación para una sucursal (reemplaza al anterior sin usar). */
  app.post("/central/alta/codigo", async (req, rep) => {
    const b = z.object({ sucursalId: uuid }).parse(req.body);
    const e = empresaDe(req), u = usuarioDe(req);
    const ok = await pool.query("SELECT 1 FROM sucursales WHERE id = $1 AND empresa_id = $2 AND activo", [b.sucursalId, e]);
    if (!ok.rowCount) throw new ErrorNegocio("Sucursal no encontrada o desactivada", 404);
    await pool.query(
      `UPDATE altas_servidor SET descartado_en = now()
        WHERE origen = 'ADMINISTRACION' AND sucursal_id = $1 AND entregado_en IS NULL AND descartado_en IS NULL`, [b.sucursalId]);
    for (let intento = 0; intento < 5; intento++) {
      const c = nuevoCodigo();
      const r = await pool.query(
        `INSERT INTO altas_servidor (codigo, origen, empresa_id, sucursal_id, aprobado_por, aprobado_en, creado_por, expira_en)
         VALUES ($1, 'ADMINISTRACION', $2, $3, $4, now(), $4, now() + make_interval(days => $5)) ON CONFLICT (codigo) DO NOTHING
         RETURNING expira_en AS "expiraEn"`, [c, e, b.sucursalId, u, VIGENCIA_CODIGO_DIAS]);
      if (r.rowCount) { rep.code(201); return { codigo: c, expiraEn: r.rows[0].expiraEn }; }
    }
    throw new ErrorNegocio("No se pudo generar el código; intente de nuevo", 503);
  });

  /** Rechazar una solicitud (un equipo que no es de la empresa) o anular un código de instalación. */
  app.post("/central/alta/descartar", async (req) => {
    const b = z.object({ codigo }).parse(req.body);
    const r = await pool.query(
      `UPDATE altas_servidor SET descartado_en = now()
        WHERE codigo = $1 AND descartado_en IS NULL
          AND ((origen = 'SERVIDOR' AND aprobado_en IS NULL) OR (origen = 'ADMINISTRACION' AND empresa_id = $2 AND entregado_en IS NULL))
        RETURNING codigo`, [b.codigo, empresaDe(req)]);
    if (!r.rowCount) throw new ErrorNegocio("Ese código ya se usó o no existe", 410);
    return { ok: true };
  });

  app.get("/central/alta/:codigo", async (req) => {
    const p = z.object({ codigo }).parse(req.params);
    const a = (await pool.query(
      `SELECT a.codigo, a.equipo, a.version, a.ip, a.creado_en AS "creadoEn", a.expira_en AS "expiraEn",
              a.expira_en < now() AS vencido, a.aprobado_en AS "aprobadoEn", a.entregado_en AS "entregadoEn", s.nombre AS sucursal
         FROM altas_servidor a LEFT JOIN sucursales s ON s.id = a.sucursal_id
        WHERE a.codigo = $1 AND a.origen = 'SERVIDOR' AND (a.empresa_id IS NULL OR a.empresa_id = $2)`, [p.codigo, empresaDe(req)],
    )).rows[0];
    if (!a) throw new ErrorNegocio("No existe ese código. Revise que el servidor esté encendido, con internet, y copie el código que muestra.", 404);
    return a;
  });

  app.post("/central/alta/aprobar", async (req) => {
    const b = z.object({ codigo, sucursalId: uuid }).parse(req.body);
    const empresaId = empresaDe(req);
    return enTransaccion(async (c) => {
      const s = (await c.query<{ nombre: string; conClave: boolean; equipo: string | null }>(
        `SELECT s.nombre, EXISTS (SELECT 1 FROM sucursal_claves k WHERE k.sucursal_id = s.id) AS "conClave",
                (SELECT equipo FROM sync_sucursales y WHERE y.sucursal_id = s.id) AS equipo
           FROM sucursales s WHERE s.id = $1 AND s.empresa_id = $2 AND s.activo`, [b.sucursalId, empresaId],
      )).rows[0];
      if (!s) throw new ErrorNegocio("Sucursal no encontrada o desactivada", 404);
      const r = await c.query(
        `UPDATE altas_servidor SET empresa_id = $2, sucursal_id = $3, aprobado_por = $4, aprobado_en = now()
          WHERE codigo = $1 AND origen = 'SERVIDOR' AND aprobado_en IS NULL AND descartado_en IS NULL AND expira_en > now() RETURNING equipo`,
        [b.codigo, empresaId, b.sucursalId, usuarioDe(req)],
      );
      if (!r.rowCount) {
        const ya = await c.query("SELECT aprobado_en IS NOT NULL AS usado FROM altas_servidor WHERE codigo = $1", [b.codigo]);
        throw new ErrorNegocio(ya.rows[0]?.usado ? "Ese código ya se usó" : "El código no existe o venció: en el servidor se genera uno nuevo solo", 410);
      }
      await c.query(
        `INSERT INTO auditoria (id, sucursal_id, usuario_id, accion, entidad, entidad_id, detalle)
         VALUES ($1, $2, $3, 'sucursal.alta_servidor', 'sucursal', $2, $4)`,
        [uuidv7(), b.sucursalId, usuarioDe(req), JSON.stringify({ codigo: b.codigo, equipo: r.rows[0].equipo, reemplaza: s.conClave ? s.equipo : null })],
      );
      return { ok: true, sucursal: s.nombre, equipo: r.rows[0].equipo, reemplaza: s.conClave ? (s.equipo ?? "el servidor anterior") : null };
    });
  });
}
