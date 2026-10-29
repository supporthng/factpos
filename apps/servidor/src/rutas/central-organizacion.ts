import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { uuidv7 } from "@factpos/compartido";
import { pool, enTransaccion, ErrorNegocio } from "../db.js";

/** Sucursales y terminales (cajas) de la empresa. */
const uuid = z.string().uuid();

export async function rutasCentralOrganizacion(app: FastifyInstance) {
  const empresaDe = (req: { headers: Record<string, unknown> }) => uuid.parse(req.headers["x-empresa-id"]);

  app.get("/central/organizacion", async (req) => {
    const r = await pool.query(
      `SELECT s.id, s.codigo, s.nombre, s.direccion, s.telefono, s.activo, s.tipo,
              COALESCE((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'nombre', a.nombre, 'principal', a.es_principal) ORDER BY a.es_principal DESC, a.nombre)
                          FROM almacenes a WHERE a.sucursal_id = s.id), '[]') AS almacenes,
              COALESCE((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'numero', c.numero, 'nombre', c.nombre, 'activo', c.activo,
                                  'almacen', (SELECT nombre FROM almacenes WHERE id = c.almacen_id),
                                  'turnoAbierto', EXISTS (SELECT 1 FROM turnos t WHERE t.caja_id = c.id AND t.estado = 'ABIERTO'),
                                  'ultimaVenta', (SELECT MAX(creado_en) FROM ventas v WHERE v.caja_id = c.id)) ORDER BY c.numero)
                          FROM cajas c WHERE c.sucursal_id = s.id), '[]') AS terminales
         FROM sucursales s WHERE s.empresa_id = $1 ORDER BY s.codigo`,
      [empresaDe(req)],
    );
    return r.rows;
  });

  /** Nueva sucursal: se crea con su almacén principal y su primera terminal. */
  app.post("/central/sucursales", async (req, rep) => {
    const b = z.object({
      codigo: z.string().trim().min(1).max(10), nombre: z.string().trim().min(2).max(80),
      direccion: z.string().max(200).optional(), telefono: z.string().max(20).optional(),
    }).parse(req.body);
    const r = await enTransaccion(async (c) => {
      const id = uuidv7(), alm = uuidv7(), caja = uuidv7();
      try {
        await c.query("INSERT INTO sucursales (id, empresa_id, codigo, nombre, direccion, telefono) VALUES ($1,$2,$3,$4,$5,$6)",
          [id, empresaDe(req), b.codigo.toUpperCase(), b.nombre, b.direccion ?? null, b.telefono ?? null]);
      } catch (e: any) {
        if (e.code === "23505") throw new ErrorNegocio("Ya existe una sucursal con ese código", 409);
        throw e;
      }
      await c.query("INSERT INTO almacenes (id, sucursal_id, nombre, es_principal) VALUES ($1,$2,'Piso de venta',true)", [alm, id]);
      await c.query("INSERT INTO cajas (id, sucursal_id, numero, nombre, almacen_id) VALUES ($1,$2,1,'Caja 1',$3)", [caja, id, alm]);
      await c.query("INSERT INTO configuracion_sucursal (sucursal_id, modulos) VALUES ($1, '{\"delivery\":{\"activo\":false}}')", [id]);
      return { id, almacenId: alm, cajaId: caja };
    });
    rep.code(201);
    return r;
  });

  app.patch("/central/sucursales/:id", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ nombre: z.string().trim().min(2).max(80).optional(), direccion: z.string().max(200).optional(),
      telefono: z.string().max(20).optional(), activo: z.boolean().optional() }).parse(req.body);
    const r = await pool.query(
      `UPDATE sucursales SET nombre = COALESCE($2, nombre), direccion = COALESCE($3, direccion),
              telefono = COALESCE($4, telefono), activo = COALESCE($5, activo)
        WHERE id = $1 AND empresa_id = $6 RETURNING id, nombre, activo`,
      [id, b.nombre ?? null, b.direccion ?? null, b.telefono ?? null, b.activo ?? null, empresaDe(req)],
    );
    if (!r.rowCount) throw new ErrorNegocio("Sucursal no encontrada", 404);
    return r.rows[0];
  });

  app.post("/central/sucursales/:id/almacenes", async (req, rep) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ nombre: z.string().trim().min(2).max(60) }).parse(req.body);
    const nuevo = uuidv7();
    await pool.query("INSERT INTO almacenes (id, sucursal_id, nombre) VALUES ($1,$2,$3)", [nuevo, id, b.nombre]);
    rep.code(201);
    return { id: nuevo };
  });

  /** Nueva terminal de venta en una sucursal. */
  app.post("/central/sucursales/:id/terminales", async (req, rep) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ nombre: z.string().trim().min(2).max(40).optional(), almacenId: uuid.optional() }).parse(req.body);
    const r = await enTransaccion(async (c) => {
      await c.query("SELECT 1 FROM sucursales WHERE id = $1 AND empresa_id = $2 FOR UPDATE", [id, empresaDe(req)]);
      const n = (await c.query("SELECT COALESCE(MAX(numero), 0) + 1 AS n FROM cajas WHERE sucursal_id = $1", [id])).rows[0].n;
      const alm = b.almacenId ?? (await c.query("SELECT id FROM almacenes WHERE sucursal_id = $1 AND es_principal", [id])).rows[0]?.id;
      if (!alm) throw new ErrorNegocio("La sucursal no tiene almacén principal");
      const nuevo = uuidv7();
      await c.query("INSERT INTO cajas (id, sucursal_id, numero, nombre, almacen_id) VALUES ($1,$2,$3,$4,$5)",
        [nuevo, id, n, b.nombre ?? `Caja ${n}`, alm]);
      return { id: nuevo, numero: n };
    });
    rep.code(201);
    return r;
  });

  // ---- Marca (tema camaleón) ----
  app.get("/central/marca", async (req) => {
    const r = await pool.query(
      `SELECT e.nombre_comercial AS nombre, m.logo, COALESCE(m.color_primario, '#2dd4bf') AS primario,
              CASE WHEN m.empresa_id IS NULL THEN '#0e1b26' ELSE m.color_secundario END AS secundario, COALESCE(m.logo_en_ticket, true) AS "logoEnTicket"
         FROM empresas e LEFT JOIN configuracion_marca m ON m.empresa_id = e.id WHERE e.id = $1`,
      [empresaDe(req)],
    );
    return r.rows[0];
  });

  app.put("/central/marca", async (req) => {
    const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color inválido");
    const b = z.object({
      logo: z.string().startsWith("data:image/").max(400000, "El logo es muy pesado").nullable(),
      primario: color, secundario: color.nullable(), logoEnTicket: z.boolean().default(true),
    }).parse(req.body);
    await pool.query(
      `INSERT INTO configuracion_marca (empresa_id, logo, color_primario, color_secundario, logo_en_ticket)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (empresa_id) DO UPDATE SET logo = $2, color_primario = $3, color_secundario = $4, logo_en_ticket = $5`,
      [empresaDe(req), b.logo, b.primario.toLowerCase(), b.secundario?.toLowerCase() ?? null, b.logoEnTicket],
    );
    return { ok: true };
  });

  app.patch("/central/terminales/:id", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ nombre: z.string().trim().min(2).max(40).optional(), activo: z.boolean().optional() }).parse(req.body);
    const r = await pool.query(
      "UPDATE cajas SET nombre = COALESCE($2, nombre), activo = COALESCE($3, activo) WHERE id = $1 RETURNING id, nombre, activo",
      [id, b.nombre ?? null, b.activo ?? null],
    );
    if (!r.rowCount) throw new ErrorNegocio("Terminal no encontrada", 404);
    return r.rows[0];
  });
}
