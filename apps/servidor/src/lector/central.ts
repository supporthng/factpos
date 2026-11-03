import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { pool } from "../db.js";
import { llamarPortal } from "../licencia/cliente.js";
import { credencialesPortal } from "../respaldo/respaldo.js";

/**
 * LECTOR DE FACTURAS (administración). Recibe la foto o el PDF, el portal lo lee con IA y aquí se
 * empareja con los proveedores y productos de la empresa. NO registra nada: devuelve un borrador que
 * la persona revisa en «Registrar compra».
 */
const uuid = z.string().uuid();

interface Trabajo { empresaId: string; creado: number; estado: "LEYENDO" | "LISTO" | "ERROR"; resultado?: unknown; error?: string; codigo?: number }
const trabajos = new Map<string, Trabajo>();

interface Leida {
  proveedor?: { nombre: string | null; rnc: string | null };
  numeroFactura?: string | null; ncf?: string | null; fecha?: string | null; vence?: string | null; condicion?: "CONTADO" | "CREDITO" | null;
  preciosIncluyenItbis: boolean; subtotal?: number | null; itbis?: number | null; total?: number | null;
  items: { codigo?: string | null; descripcion: string; cantidad: number; unidad?: string | null; unidadesPorEmpaque?: number | null; precioUnitario: number; importe?: number | null }[];
}
interface Candidato { presentacionId: string; productoId: string; nombre: string; presentacion: string; factor: string }

export const normalizar = (t: string) =>
  t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const palabras = (t: string) => normalizar(t).split(" ").filter((w) => w.length >= 2);

/** 0..1: qué tanto de lo escrito en la factura aparece en el nombre del producto (y viceversa) */
export function parecido(factura: string, producto: string) {
  const a = new Set(palabras(factura)), b = new Set(palabras(producto));
  if (!a.size || !b.size) return 0;
  let comunes = 0;
  for (const w of a) if (b.has(w)) comunes++;
  return (2 * comunes) / (a.size + b.size);
}

/** Unidades por empaque: lo dice la IA o se deduce de textos como «15x22 oz» o «12 x 1L». Solo enteros de 2 a 1000. */
export function unidadesPorEmpaque(i: { unidadesPorEmpaque?: number | null; unidad?: string | null }): number | null {
  const d = Number(i.unidadesPorEmpaque);
  if (Number.isInteger(d) && d >= 2 && d <= 1000) return d;
  const m = /^\s*(\d{1,4})\s*[x×]\s*\d/i.exec(i.unidad ?? "");
  const n = m ? Number(m[1]) : 0;
  return n >= 2 && n <= 1000 ? n : null;
}

export async function rutasLectorFacturas(app: FastifyInstance) {
  const empresaDe = (req: { headers: Record<string, unknown> }) => uuid.parse(req.headers["x-empresa-id"]);

  /** Cuántas facturas le quedan este mes */
  app.get("/central/compras/lector/estado", async () => {
    try {
      return await llamarPortal<{ cupo: number; usadas: number; mes: string; disponible: boolean }>("/licencias/lector/estado", await credencialesPortal());
    } catch (e) {
      return { cupo: 0, usadas: 0, mes: "", disponible: false, error: (e as Error).message };
    }
  });

  /**
   * La lectura con IA tarda 15-60 s. Para que ninguna conexión (celular, túnel, proxy) tenga que esperar tanto,
   * la petición solo ENCOLA el trabajo y responde al instante; la pantalla consulta el resultado cada pocos segundos.
   */
  app.post("/central/compras/leer-factura", { bodyLimit: 6 * 1024 * 1024 }, async (req) => {
    const b = z.object({ tipo: z.enum(["image/jpeg", "image/png", "image/webp", "application/pdf"]), datos: z.string().min(100) }).parse(req.body);
    const empresaId = empresaDe(req);
    for (const [k, t] of trabajos) if (Date.now() - t.creado > 15 * 60_000) trabajos.delete(k);
    const id = randomUUID();
    const t: Trabajo = { empresaId, creado: Date.now(), estado: "LEYENDO" };
    trabajos.set(id, t);
    leer(empresaId, b).then(
      (resultado) => { t.estado = "LISTO"; t.resultado = resultado; },
      (e) => { t.estado = "ERROR"; t.error = (e as Error).message || "No se pudo leer la factura"; t.codigo = (e as { statusCode?: number }).statusCode; },
    );
    return { trabajoId: id };
  });

  app.get("/central/compras/leer-factura/:id", async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const t = trabajos.get(id);
    if (!t || t.empresaId !== empresaDe(req)) return reply.code(404).send({ error: "La lectura ya no está disponible. Vuelva a cargar la factura." });
    if (t.estado === "LEYENDO") return { estado: "LEYENDO" };
    trabajos.delete(id);
    if (t.estado === "ERROR") return { estado: "ERROR", error: t.error, codigo: t.codigo };
    return { estado: "LISTO", resultado: t.resultado };
  });

  async function leer(empresaId: string, b: { tipo: string; datos: string }) {
    const r = await llamarPortal<{ factura: Leida; cupo: number; usadas: number }>("/licencias/lector/leer", { ...(await credencialesPortal()), tipo: b.tipo, datos: b.datos }, 70_000);
    const f = r.factura;

    // ---- Proveedor: por RNC, si no por nombre parecido
    const provs = (await pool.query<{ id: string; nombre: string; rnc: string | null }>("SELECT id, nombre, rnc FROM proveedores WHERE empresa_id = $1 AND activo", [empresaId])).rows;
    const rnc = (f.proveedor?.rnc ?? "").replace(/\D/g, "");
    let prov = rnc ? provs.find((p) => (p.rnc ?? "").replace(/\D/g, "") === rnc) : undefined;
    if (!prov && f.proveedor?.nombre) {
      const mejor = provs.map((p) => ({ p, s: parecido(f.proveedor!.nombre!, p.nombre) })).sort((x, y) => y.s - x.s)[0];
      if (mejor && mejor.s >= 0.6) prov = mejor.p;
    }

    // ---- Productos: código de barras → código del proveedor → nombre
    const codigos = [...new Set(f.items.map((i) => (i.codigo ?? "").trim()).filter(Boolean))];
    const porBarra = new Map<string, string>();
    const porProveedor = new Map<string, string>();
    if (codigos.length) {
      for (const x of (await pool.query<{ codigo: string; presentacion_id: string }>("SELECT codigo, presentacion_id FROM codigos_barra WHERE empresa_id = $1 AND activo AND codigo = ANY($2)", [empresaId, codigos])).rows) porBarra.set(x.codigo, x.presentacion_id);
      if (prov) {
        for (const x of (await pool.query<{ codigo_proveedor: string; presentacion_id: string }>(
          `SELECT pp.codigo_proveedor, pr.id AS presentacion_id FROM producto_proveedores pp
             JOIN presentaciones pr ON pr.producto_id = pp.producto_id AND pr.es_principal
            WHERE pp.proveedor_id = $1 AND pp.activo AND pp.codigo_proveedor = ANY($2)`, [prov.id, codigos])).rows) porProveedor.set(x.codigo_proveedor, x.presentacion_id);
      }
    }
    const catalogo = (await pool.query<Candidato>(
      `SELECT pr.id AS "presentacionId", p.id AS "productoId", p.nombre, pr.nombre AS presentacion, pr.factor::text AS factor
         FROM presentaciones pr JOIN productos p ON p.id = pr.producto_id
        WHERE p.empresa_id = $1 AND p.activo AND p.tipo <> 'SERVICIO'`, [empresaId])).rows;
    const porId = new Map(catalogo.map((c) => [c.presentacionId, c]));

    const tasa = f.itbis && f.subtotal && f.subtotal > 0 ? Math.min(0.18, Math.max(0, f.itbis / f.subtotal)) : 0.18;
    const items = f.items.map((i) => {
      const cod = (i.codigo ?? "").trim();
      const exacto = porBarra.get(cod) ?? porProveedor.get(cod);
      let elegido = exacto ? porId.get(exacto) : undefined;
      let confianza: "CODIGO" | "NOMBRE" | "NINGUNA" = elegido ? "CODIGO" : "NINGUNA";
      const sugeridos = catalogo.map((c) => ({ c, s: parecido(i.descripcion, `${c.nombre} ${c.presentacion === "Unidad" ? "" : c.presentacion}`) }))
        .filter((x) => x.s > 0.25).sort((x, y) => y.s - x.s).slice(0, 4);
      if (!elegido && sugeridos[0] && sugeridos[0].s >= 0.75 && (!sugeridos[1] || sugeridos[0].s - sugeridos[1].s >= 0.1)) { elegido = sugeridos[0].c; confianza = "NOMBRE"; }
      // Costo SIN ITBIS: si la factura imprime precios con ITBIS se le quita
      let cantidad = i.cantidad;
      let costo = f.preciosIncluyenItbis ? i.precioUnitario / (1 + tasa) : i.precioUnitario;
      // Empaque («5 × 15x22 oz» = 5 cajas de 15 botellas): el costo que importa es el de CADA UNIDAD
      const emp = unidadesPorEmpaque(i);
      let porUnidad = false;
      let empaque: string | null = null;
      if (emp) {
        empaque = `${i.cantidad} × empaque de ${emp} (${i.unidad ?? ""}) = ${i.cantidad * emp} unidades`.replace(" ()", "");
        if (elegido) { const el = elegido; const caja = catalogo.find((c) => c.productoId === el.productoId && Number(c.factor) === emp); if (caja) elegido = caja; }
        const fp = elegido ? Number(porId.get(elegido.presentacionId)?.factor ?? 1) : 1;
        if (elegido && fp === emp) { /* ya es la presentación «caja»: cantidad y costo van por caja */ }
        else if (elegido) { cantidad = (i.cantidad * emp) / fp; costo = (costo / emp) * fp; }
        else { cantidad = i.cantidad * emp; costo = costo / emp; porUnidad = true; }
      }
      return {
        codigo: cod || null, descripcion: i.descripcion, unidad: i.unidad ?? null,
        cantidad: Math.round(cantidad * 10000) / 10000, costo: Math.round(costo * 10000) / 10000, importe: i.importe ?? null, porUnidad, empaque,
        presentacionId: elegido?.presentacionId ?? null, producto: elegido ? { nombre: elegido.nombre, presentacion: elegido.presentacion, factor: elegido.factor } : null,
        confianza, sugeridos: sugeridos.filter((x) => x.c.presentacionId !== elegido?.presentacionId).map((x) => x.c),
      };
    });

    return {
      cupo: r.cupo, usadas: r.usadas,
      proveedor: { id: prov?.id ?? null, nombreLeido: f.proveedor?.nombre ?? null, rncLeido: rnc || null },
      numeroFactura: f.numeroFactura ?? null, ncf: (f.ncf ?? "").replace(/\s/g, "").toUpperCase() || null,
      fecha: f.fecha ?? null, vence: f.vence ?? null, condicion: f.condicion ?? (f.vence ? "CREDITO" : null),
      preciosIncluyenItbis: f.preciosIncluyenItbis, subtotal: f.subtotal ?? null, itbis: f.itbis ?? null, total: f.total ?? null,
      items,
    };
  }
}
