import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { uuidv7 } from "@factpos/compartido";
import { pool, ErrorNegocio } from "../db.js";

/**
 * Planilla de impuestos (Fiscal): la tasa de cada impuesto que usa el sistema (ITBIS, ISC, otros) y la propina legal.
 * Las tasas se escriben en porcentaje (18 = 18 %) y se guardan como fracción (0.18). Bajan a todas las sucursales por la sincronización.
 * (El permiso lo da admin.fiscal: ver permisoDeRuta.)
 */
const uuid = z.string().uuid();
const Impuesto = z.object({
  nombre: z.string().trim().min(2, "Escriba el nombre").max(60),
  tipo: z.enum(["ITBIS", "ISC", "PROPINA", "OTRO"]),
  porcentaje: z.number().min(0, "La tasa no puede ser negativa").max(100, "La tasa no puede pasar de 100 %"),
  activo: z.boolean().default(true),
});

export async function rutasCentralImpuestos(app: FastifyInstance) {
  const empresaDe = (req: { headers: Record<string, unknown> }) => uuid.parse(req.headers["x-empresa-id"]);

  app.get("/central/impuestos", async (req) => {
    const r = await pool.query(
      `SELECT i.id, i.nombre, i.tipo, (i.tasa * 100)::float AS porcentaje, i.activo,
              (SELECT COUNT(*)::int FROM productos p WHERE p.impuesto_id = i.id) AS productos
         FROM impuestos i WHERE i.empresa_id = $1
        ORDER BY i.activo DESC, CASE i.tipo WHEN 'ITBIS' THEN 1 WHEN 'PROPINA' THEN 2 WHEN 'ISC' THEN 3 ELSE 4 END, i.tasa DESC, i.nombre`, [empresaDe(req)]);
    return r.rows;
  });

  app.post("/central/impuestos", async (req, rep) => {
    const b = Impuesto.parse(req.body);
    const id = uuidv7();
    try {
      await pool.query("INSERT INTO impuestos (id, empresa_id, nombre, tipo, tasa, activo) VALUES ($1,$2,$3,$4,$5,$6)", [id, empresaDe(req), b.nombre, b.tipo, b.porcentaje / 100, b.activo]);
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw new ErrorNegocio("Ya hay una propina legal activa: edite esa en lugar de crear otra");
      throw e;
    }
    rep.code(201);
    return { id };
  });

  app.put("/central/impuestos/:id", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = Impuesto.parse(req.body);
    const empresaId = empresaDe(req);
    const ex = (await pool.query<{ tipo: string; productos: number }>(
      "SELECT i.tipo, (SELECT COUNT(*)::int FROM productos p WHERE p.impuesto_id = i.id) AS productos FROM impuestos i WHERE i.id = $1 AND i.empresa_id = $2", [id, empresaId])).rows[0];
    if (!ex) throw new ErrorNegocio("Impuesto no encontrado", 404);
    if (ex.tipo !== b.tipo) throw new ErrorNegocio("No se puede cambiar el tipo de un impuesto: cree uno nuevo");
    if (!b.activo && ex.productos > 0) throw new ErrorNegocio(`${ex.productos} producto(s) usan este impuesto: cámbieles el impuesto antes de desactivarlo`);
    try {
      await pool.query("UPDATE impuestos SET nombre = $3, tasa = $4, activo = $5, version = version + 1, actualizado_en = now() WHERE id = $1 AND empresa_id = $2", [id, empresaId, b.nombre, b.porcentaje / 100, b.activo]);
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw new ErrorNegocio("Ya hay una propina legal activa");
      throw e;
    }
    return { ok: true };
  });
}
