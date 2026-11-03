import type { FastifyInstance } from "fastify";
import { verificarCupoSucursal } from "../licencia/cliente.js";
import { z } from "zod";
import { uuidv7, rncValido } from "@factpos/compartido";
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
      await verificarCupoSucursal(c, empresaDe(req)); // la licencia se cobra por sucursal
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
    if (b.activo === true) {
      const actual = (await pool.query("SELECT tipo, activo FROM sucursales WHERE id = $1", [id])).rows[0];
      if (actual && !actual.activo && actual.tipo === "TIENDA") await verificarCupoSucursal(pool, empresaDe(req), id);
    }
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
    const suc = await pool.query("SELECT 1 FROM sucursales WHERE id = $1 AND empresa_id = $2", [id, empresaDe(req)]);
    if (!suc.rowCount) throw new ErrorNegocio("Sucursal no encontrada", 404);
    const dup = await pool.query("SELECT 1 FROM almacenes WHERE sucursal_id = $1 AND lower(nombre) = lower($2)", [id, b.nombre]);
    if (dup.rowCount) throw new ErrorNegocio(`Ya existe un almacén «${b.nombre}» en esa sucursal`, 409);
    const nuevo = uuidv7();
    await pool.query("INSERT INTO almacenes (id, sucursal_id, nombre) VALUES ($1,$2,$3)", [nuevo, id, b.nombre]);
    rep.code(201);
    return { id: nuevo };
  });

  /** Libera la caja de la PC a la que quedó ligada: la próxima PC que abra FactPOS la podrá recibir. */
  app.post("/central/terminales/:id/liberar-equipo", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const r = await pool.query(
      `DELETE FROM cajas_equipos ce USING cajas ca JOIN sucursales s ON s.id = ca.sucursal_id
        WHERE ce.caja_id = ca.id AND ca.id = $1 AND s.empresa_id = $2`, [id, empresaDe(req)]);
    return { liberada: (r.rowCount ?? 0) > 0 };
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
  /** Datos del emisor para los documentos en carta (cotizaciones, facturas): empresa + la sucursal indicada (o la principal) */
  app.get("/central/empresa/impresion", async (req) => {
    const q = z.object({ sucursalId: uuid.optional() }).parse(req.query);
    const r = await pool.query(
      `SELECT COALESCE(e.nombre_comercial, e.razon_social) AS nombre, e.razon_social AS "razonSocial", e.rnc, m.logo,
              s.direccion, s.telefono
         FROM empresas e LEFT JOIN configuracion_marca m ON m.empresa_id = e.id
         LEFT JOIN LATERAL (SELECT direccion, telefono FROM sucursales
                             WHERE empresa_id = e.id AND activo AND ($2::uuid IS NULL OR id = $2)
                             ORDER BY (tipo = 'TIENDA') DESC, codigo LIMIT 1) s ON true
        WHERE e.id = $1`, [empresaDe(req), q.sucursalId ?? null]);
    return r.rows[0] ?? {};
  });

  // ---- Datos generales de la empresa ----
  /** El RNC está en uso fiscal (comprobantes emitidos o certificado cargado): cambiarlo rompería la facturación electrónica. */
  const rncBloqueado = async (e: string) =>
    !!(await pool.query("SELECT 1 FROM ecf_documentos WHERE empresa_id = $1 LIMIT 1", [e]).catch(() => ({ rowCount: 0 }))).rowCount
    || !!(await pool.query("SELECT 1 FROM certificados_digitales WHERE empresa_id = $1 LIMIT 1", [e]).catch(() => ({ rowCount: 0 }))).rowCount;

  app.get("/central/empresa", async (req) => {
    const e = empresaDe(req);
    const r = await pool.query(
      `SELECT rnc, razon_social AS "razonSocial", COALESCE(nombre_comercial, '') AS "nombreComercial", COALESCE(direccion, '') AS direccion,
              COALESCE(municipio, '') AS municipio, COALESCE(provincia, '') AS provincia, COALESCE(telefono, '') AS telefono,
              COALESCE(correo, '') AS correo, COALESCE(sitio_web, '') AS "sitioWeb", COALESCE(representante, '') AS representante
         FROM empresas WHERE id = $1`, [e]);
    if (!r.rows[0]) throw new ErrorNegocio("Empresa no encontrada", 404);
    return { ...r.rows[0], rncBloqueado: await rncBloqueado(e) };
  });

  const texto = (max: number) => z.string().trim().max(max).transform((v) => v || null).nullable().default(null);
  app.put("/central/empresa", async (req) => {
    const e = empresaDe(req);
    const b = z.object({
      rnc: z.string().trim().regex(/^\d{9}(\d{2})?$/, "El RNC debe tener 9 dígitos (11 si es cédula)"),
      razonSocial: z.string().trim().min(3, "Escriba la razón social").max(150),
      nombreComercial: texto(150), direccion: texto(200), municipio: texto(80), provincia: texto(80),
      telefono: z.string().trim().max(20).regex(/^[\d\s()+-]*$/, "El teléfono solo lleva números").transform((v) => v || null).nullable().default(null),
      correo: z.string().trim().toLowerCase().email("Correo inválido").max(120).or(z.literal("")).transform((v) => v || null).nullable().default(null),
      sitioWeb: texto(120), representante: texto(120),
    }).parse(req.body);
    const actual = (await pool.query<{ rnc: string }>("SELECT rnc FROM empresas WHERE id = $1", [e])).rows[0];
    if (!actual) throw new ErrorNegocio("Empresa no encontrada", 404);
    if (b.rnc !== actual.rnc) {
      if (await rncBloqueado(e)) throw new ErrorNegocio("El RNC no se puede cambiar: ya hay comprobantes electrónicos o un certificado de esta empresa. Escriba a soporte.", 409);
      if (b.rnc.length === 9 && !rncValido(b.rnc)) throw new ErrorNegocio("RNC inválido: el último dígito no coincide con el verificador de la DGII");
    }
    try {
      await enTransaccion(async (c) => {
        await c.query(
          `UPDATE empresas SET rnc = $2, razon_social = $3, nombre_comercial = $4, direccion = $5, municipio = $6, provincia = $7,
                  telefono = $8, correo = $9, sitio_web = $10, representante = $11, version = version + 1, actualizado_en = now()
            WHERE id = $1`,
          [e, b.rnc, b.razonSocial, b.nombreComercial, b.direccion, b.municipio, b.provincia, b.telefono, b.correo, b.sitioWeb, b.representante]);
        // La dirección del emisor en los comprobantes electrónicos sale de aquí
        const dir = [b.direccion, b.municipio, b.provincia].filter(Boolean).join(", ");
        if (dir.length >= 5) await c.query("UPDATE configuracion_fiscal SET direccion_emisor = $2 WHERE empresa_id = $1", [e, dir.slice(0, 200)]);
      });
    } catch (err: any) {
      if (err.code === "23505") throw new ErrorNegocio("Ese RNC ya está registrado en otra empresa", 409);
      throw err;
    }
    return { ok: true };
  });

  app.get("/central/marca", async (req) => {
    const r = await pool.query(
      `SELECT e.nombre_comercial AS nombre, m.logo, COALESCE(m.color_primario, '#2dd4bf') AS primario,
              CASE WHEN m.empresa_id IS NULL THEN '#0e1b26' ELSE m.color_secundario END AS secundario, COALESCE(m.logo_en_ticket, true) AS "logoEnTicket",
              COALESCE(m.usar_colores_logo, true) AS "usarColores",
              COALESCE(m.formato_ticket, '{}'::jsonb) AS formato
         FROM empresas e LEFT JOIN configuracion_marca m ON m.empresa_id = e.id WHERE e.id = $1`,
      [empresaDe(req)],
    );
    return r.rows[0];
  });

  app.put("/central/marca", async (req) => {
    const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color inválido");
    const b = z.object({
      logo: z.string().startsWith("data:image/").max(400000, "El logo es muy pesado").nullable(),
      primario: color, secundario: color.nullable(), logoEnTicket: z.boolean().default(true), usarColores: z.boolean().default(true),
    }).parse(req.body);
    await pool.query(
      `INSERT INTO configuracion_marca (empresa_id, logo, color_primario, color_secundario, logo_en_ticket, usar_colores_logo)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (empresa_id) DO UPDATE SET logo = $2, color_primario = $3, color_secundario = $4, logo_en_ticket = $5, usar_colores_logo = $6`,
      [empresaDe(req), b.logo, b.primario.toLowerCase(), b.secundario?.toLowerCase() ?? null, b.logoEnTicket, b.usarColores],
    );
    return { ok: true };
  });

  /** Diseño del ticket impreso (papel, letra, logo, datos que se muestran, encabezado y pie). */
  app.put("/central/marca/formato", async (req) => {
    const b = z.object({
      papel: z.enum(["58", "80"]), letra: z.enum(["pequena", "normal", "grande"]), logoTamano: z.enum(["pequeno", "mediano", "grande"]),
      mostrarRnc: z.boolean(), mostrarSucursal: z.boolean(), mostrarDireccion: z.boolean(), mostrarTelefono: z.boolean(),
      encabezadoExtra: z.string().max(240), mostrarCajero: z.boolean(), mostrarCliente: z.boolean(), mostrarAhorro: z.boolean(), mostrarQr: z.boolean(),
      pie: z.string().max(120), pieExtra: z.string().max(400),
    }).parse(req.body);
    await pool.query(
      `INSERT INTO configuracion_marca (empresa_id, formato_ticket) VALUES ($1, $2::jsonb)
       ON CONFLICT (empresa_id) DO UPDATE SET formato_ticket = $2::jsonb`,
      [empresaDe(req), JSON.stringify(b)]);
    return { ok: true };
  });

  /** Pantalla del cliente (segunda pantalla de la caja): bienvenida y ofertas que se muestran mientras no se cobra. */
  app.get("/central/marca/pantalla-cliente", async (req) =>
    (await pool.query("SELECT COALESCE(pantalla_cliente, '{}'::jsonb) AS p FROM configuracion_marca WHERE empresa_id = $1", [empresaDe(req)])).rows[0]?.p ?? {});
  app.put("/central/marca/pantalla-cliente", async (req) => {
    const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
    const b = z.object({
      activa: z.boolean(),
      bienvenida: z.string().trim().max(80),
      segundos: z.number().int().min(4).max(60),
      ofertas: z.array(z.object({
        id: z.string().min(8).max(60),
        titulo: z.string().trim().min(1, "Cada oferta necesita un título").max(60),
        texto: z.string().trim().max(160),
        precio: z.string().trim().max(30),
        imagen: z.string().startsWith("data:image/").max(260000, "Una imagen es muy pesada").nullable(),
        activa: z.boolean(),
        desde: fecha, hasta: fecha,
      })).max(10, "Máximo 10 ofertas"),
    }).parse(req.body);
    await pool.query(
      `INSERT INTO configuracion_marca (empresa_id, pantalla_cliente) VALUES ($1, $2::jsonb)
       ON CONFLICT (empresa_id) DO UPDATE SET pantalla_cliente = $2::jsonb`,
      [empresaDe(req), JSON.stringify(b)]);
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

  // ------------------------------------------------------------ Equipos de cada terminal
  const EquiposSchema = z.object({
    impresora: z.object({
      modo: z.enum(["DRIVER", "ESCPOS_USB", "ESCPOS_RED"]), nombre: z.string().trim().max(80).default(""),
      ip: z.string().trim().max(60).default(""), puerto: z.coerce.number().int().min(1).max(65535).default(9100),
      papelMm: z.union([z.literal(58), z.literal(80)]).default(80), cortar: z.boolean().default(true), copias: z.coerce.number().int().min(1).max(3).default(1),
    }),
    gaveta: z.object({ modo: z.enum(["NINGUNA", "POR_IMPRESORA", "PULSO_DIRECTO"]), abrirAlCobrarEfectivo: z.boolean().default(true) }),
    bascula: z.object({
      modo: z.enum(["NINGUNA", "ETIQUETADORA", "SERIAL"]), puerto: z.string().trim().max(30).default(""),
      baudios: z.coerce.number().int().min(1200).max(115200).default(9600), unidad: z.enum(["kg", "lb"]).default("kg"),
    }),
    datafono: z.object({
      modo: z.enum(["MANUAL", "INTEGRADO"]), marca: z.string().trim().max(40).default("Verifone"), modelo: z.string().trim().max(40).default(""),
      procesador: z.string().trim().max(40).default(""), ip: z.string().trim().max(60).default(""),
      puerto: z.coerce.number().int().min(1).max(65535).default(8080), terminalId: z.string().trim().max(40).default(""),
    }),
  });

  /** Terminales con la configuración de sus equipos */
  app.get("/central/terminales/equipos", async (req) => {
    const r = await pool.query(
      `SELECT c.id, c.nombre, s.nombre AS sucursal, c.equipos
         FROM cajas c JOIN sucursales s ON s.id = c.sucursal_id
        WHERE s.empresa_id = $1 AND c.activo ORDER BY s.codigo, c.numero`, [empresaDe(req)]);
    return r.rows;
  });

  app.put("/central/terminales/:id/equipos", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = EquiposSchema.parse(req.body);
    if (b.impresora.modo === "ESCPOS_RED" && !b.impresora.ip) throw new ErrorNegocio("Indique la dirección IP de la impresora de red");
    if (b.bascula.modo === "SERIAL" && !b.bascula.puerto) throw new ErrorNegocio("Indique el puerto de la báscula (por ejemplo COM3)");
    if (b.datafono.modo === "INTEGRADO" && !b.datafono.ip) throw new ErrorNegocio("Indique la dirección IP del datáfono");
    const r = await pool.query(
      `UPDATE cajas c SET equipos = $3 FROM sucursales s
        WHERE c.id = $1 AND s.id = c.sucursal_id AND s.empresa_id = $2 RETURNING c.id`,
      [id, empresaDe(req), JSON.stringify(b)]);
    if (!r.rowCount) throw new ErrorNegocio("Terminal no encontrada", 404);
    return { ok: true };
  });
}
