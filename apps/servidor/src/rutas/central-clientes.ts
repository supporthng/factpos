import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { uuidv7, rncValido, cedulaValida } from "@factpos/compartido";
import { pool, enTransaccion, ErrorNegocio } from "../db.js";
import { encolarFilas } from "../sync/outbox.js";

/**
 * Clientes, desde la administración.
 * Aquí el nivel de precio (1, 2 o 3) es OBLIGATORIO al crear: lo decide quien da de alta al cliente.
 * Desde la caja el cliente nace con el precio 1 y solo un supervisor puede cambiarlo (/cajas/:id/clientes).
 */
const uuid = z.string().uuid();
const monto = z.string().regex(/^\d+(\.\d{1,2})?$/, "Monto inválido");

const Cliente = z.object({
  nombre: z.string().trim().min(3, "Escriba el nombre o la razón social").max(120),
  tipoDocumento: z.enum(["RNC", "CEDULA", "PASAPORTE", "NINGUNO"]).default("NINGUNO"),
  documento: z.string().trim().max(20).nullable().default(null),
  telefono: z.string().trim().max(20).nullable().default(null),
  correo: z.string().trim().toLowerCase().email("Correo inválido").max(120).nullable().or(z.literal("").transform(() => null)).default(null),
  direccion: z.string().trim().max(250).nullable().default(null),
  /** Obligatorio: 1, 2 o 3 */
  nivel: z.number({ required_error: "Elija el nivel de precio del cliente" }).int().min(1, "Elija el nivel de precio del cliente").max(3),
  limiteCredito: monto.default("0"),
  confirmarDocumento: z.boolean().default(false),
});

function documentoLimpio(b: z.infer<typeof Cliente>) {
  const doc = !b.documento || b.tipoDocumento === "NINGUNO" ? null
    : b.tipoDocumento === "PASAPORTE" ? b.documento.toUpperCase().replace(/\s/g, "") : b.documento.replace(/\D/g, "");
  if (b.tipoDocumento !== "NINGUNO" && !doc) throw new ErrorNegocio("Escriba el número del documento");
  if (b.tipoDocumento === "RNC" && !rncValido(doc!)) throw new ErrorNegocio("RNC inválido: revise los 9 dígitos (el último no coincide con el verificador de la DGII)");
  if (b.tipoDocumento === "CEDULA") {
    if (!/^\d{11}$/.test(doc!)) throw new ErrorNegocio("La cédula debe tener 11 dígitos");
    if (!cedulaValida(doc!) && !b.confirmarDocumento) throw new ErrorNegocio("El último dígito de la cédula no coincide: verifíquela con el documento");
  }
  if (b.tipoDocumento === "PASAPORTE" && !/^[A-Z0-9]{5,20}$/.test(doc!)) throw new ErrorNegocio("Pasaporte inválido");
  return doc;
}

export async function rutasCentralClientes(app: FastifyInstance) {
  const empresaDe = (req: { headers: Record<string, unknown> }) => uuid.parse(req.headers["x-empresa-id"]);
  const usuarioDe = (req: { headers: Record<string, unknown> }) => uuid.parse(req.headers["x-usuario-id"]);

  const SELECT = `SELECT c.id, c.nombre, c.tipo_documento AS "tipoDocumento", c.documento, c.telefono, c.correo, c.direccion,
                         lp.nivel, c.limite_credito::text AS "limiteCredito", c.activo, c.creado_en AS "creadoEn"
                    FROM clientes c LEFT JOIN listas_precio lp ON lp.id = c.lista_precio_id`;

  app.get("/central/clientes", async (req) => {
    const q = z.object({ q: z.string().trim().max(60).optional(), nivel: z.coerce.number().int().min(1).max(3).optional(), inactivos: z.string().optional() }).parse(req.query);
    const r = await pool.query(
      `${SELECT}
        WHERE c.empresa_id = $1
          AND ($2::text IS NULL OR c.nombre ILIKE '%' || $2 || '%' OR c.documento LIKE $2 || '%' OR c.telefono LIKE '%' || $2 || '%')
          AND ($3::int IS NULL OR lp.nivel = $3)
          AND ($4::boolean OR c.activo)
        ORDER BY c.nombre LIMIT 500`,
      [empresaDe(req), q.q && q.q.length >= 2 ? q.q : null, q.nivel ?? null, q.inactivos === "1"],
    );
    return r.rows;
  });

  app.post("/central/clientes", async (req, rep) => {
    const b = Cliente.parse(req.body);
    const empresaId = empresaDe(req);
    const doc = documentoLimpio(b);
    const id = uuidv7();
    try {
      await enTransaccion(async (c) => {
        const lista = (await c.query<{ id: string }>("SELECT id FROM listas_precio WHERE empresa_id = $1 AND nivel = $2", [empresaId, b.nivel])).rows[0];
        if (!lista) throw new ErrorNegocio(`No existe el precio ${b.nivel} en esta empresa`);
        await c.query(
          `INSERT INTO clientes (id, empresa_id, tipo_documento, documento, nombre, telefono, correo, direccion, lista_precio_id, limite_credito, creado_por)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [id, empresaId, b.tipoDocumento, doc, b.nombre, b.telefono, b.correo, b.direccion, lista.id, b.limiteCredito, usuarioDe(req)],
        );
        await encolarFilas(c, "clientes", [id]);
      });
    } catch (e: any) {
      if (e.code === "23505") throw new ErrorNegocio("Ya existe un cliente con ese documento", 409);
      throw e;
    }
    rep.code(201);
    return (await pool.query(`${SELECT} WHERE c.id = $1`, [id])).rows[0];
  });

  app.put("/central/clientes/:id", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = Cliente.extend({ activo: z.boolean().default(true) }).parse(req.body);
    const empresaId = empresaDe(req);
    const doc = documentoLimpio(b);
    try {
      await enTransaccion(async (c) => {
        const lista = (await c.query<{ id: string }>("SELECT id FROM listas_precio WHERE empresa_id = $1 AND nivel = $2", [empresaId, b.nivel])).rows[0];
        if (!lista) throw new ErrorNegocio(`No existe el precio ${b.nivel} en esta empresa`);
        const r = await c.query(
          `UPDATE clientes SET tipo_documento = $3, documento = $4, nombre = $5, telefono = $6, correo = $7, direccion = $8,
                  lista_precio_id = $9, limite_credito = $10, activo = $11, version = version + 1, actualizado_en = now()
            WHERE id = $1 AND empresa_id = $2`,
          [id, empresaId, b.tipoDocumento, doc, b.nombre, b.telefono, b.correo, b.direccion, lista.id, b.limiteCredito, b.activo],
        );
        if (!r.rowCount) throw new ErrorNegocio("Cliente no encontrado", 404);
        await encolarFilas(c, "clientes", [id]);
      });
    } catch (e: any) {
      if (e.code === "23505") throw new ErrorNegocio("Ya existe otro cliente con ese documento", 409);
      throw e;
    }
    return (await pool.query(`${SELECT} WHERE c.id = $1`, [id])).rows[0];
  });
}
