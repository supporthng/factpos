import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { pool } from "../db.js";
import { normalizarAlias } from "../rutas/central-compras.js";
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
  columnas?: string[];
  proveedor?: { nombre: string | null; rnc: string | null };
  numeroFactura?: string | null; ncf?: string | null; fecha?: string | null; vence?: string | null; condicion?: "CONTADO" | "CREDITO" | null;
  preciosIncluyenItbis: boolean; subtotal?: number | null; itbis?: number | null; total?: number | null;
  items: { codigo?: string | null; codigoBarras?: string | null; descripcion: string; cantidad: number; unidad?: string | null; unidadesPorEmpaque?: number | null; unidadesTotales?: number | null;
    precioUnitario: number; importe?: number | null; descuento?: number | null; impuestoSelectivo?: number | null; itbisLinea?: number | null; netoSinItbis?: number | null }[];
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

/** La columna de unidad habla de un empaque (caja, paquete, fardo…) o de un «NxM» (24x350ML) */
const ES_EMPAQUE = /^\s*(caja|caj|cj|cx|paq|pack|fardo|bulto|ca\s*$|\d+\s*pack|\d+\s*[x×]\s*\d)/i;
export const esEmpaque = (unidad: string | null | undefined) => ES_EMPAQUE.test(unidad ?? "");

/** Unidades por empaque: lo dice la IA o se deduce de «15x22 oz», «CJ6BOT», «CAJA06», «Caja-12», «CAJ / 24 PZA», «Paquete-10». Solo enteros de 2 a 1000. */
export function unidadesPorEmpaque(i: { unidadesPorEmpaque?: number | null; unidad?: string | null }): number | null {
  const d = Number(i.unidadesPorEmpaque);
  if (Number.isInteger(d) && d >= 2 && d <= 1000) return d;
  const u = i.unidad ?? "";
  const m = /^\s*(\d{1,4})\s*[x×]\s*\d/i.exec(u) ?? /(?:caja|caj|cj|ca|paquete|paq|pack)\D{0,3}(\d{1,3})/i.exec(u) ?? /(\d{1,3})\s*pack/i.exec(u);
  const n = m ? Number(m[1]) : 0;
  return n >= 2 && n <= 1000 ? n : null;
}

export async function rutasLectorFacturas(app: FastifyInstance) {
  const empresaDe = (req: { headers: Record<string, unknown> }) => uuid.parse(req.headers["x-empresa-id"]);

  /** Cuántas facturas le quedan este mes */
  app.get("/central/compras/lector/estado", async () => {
    try {
      return await llamarPortal<{ cupo: number; usadas: number; mes: string; disponible: boolean; pagoAutorizado: boolean; pagoSolicitado: boolean }>("/licencias/lector/estado", await credencialesPortal());
    } catch (e) {
      return { cupo: 0, usadas: 0, mes: "", disponible: false, error: (e as Error).message };
    }
  });

  /** Pide al proveedor autorizar la IA de pago para esta empresa */
  app.post("/central/compras/lector/solicitar-pago", async () =>
    llamarPortal<{ ok: boolean; yaEnviada?: boolean; yaAutorizada?: boolean }>("/licencias/lector/solicitar-pago", await credencialesPortal()));

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
    // Código de barras estándar (EAN/UPC/GTIN): se compara sin ceros a la izquierda, porque el mismo producto aparece como
    // UPC-A de 12, EAN-13 o GTIN-14 según quién lo imprima.
    const soloDig = (t: string | null | undefined) => (t ?? "").replace(/\D/g, "");
    const clave = (t: string) => t.replace(/^0+/, "");
    const barras = (i: { codigo?: string | null; codigoBarras?: string | null }) =>
      [...new Set([soloDig(i.codigoBarras), soloDig(i.codigo)].filter((d) => d.length >= 8 && d.length <= 14))];
    const variantes = [...new Set(f.items.flatMap((i) => barras(i)).flatMap((d) => [d, clave(d), clave(d).padStart(12, "0"), clave(d).padStart(13, "0"), clave(d).padStart(14, "0")]))];
    const porBarra = new Map<string, string>();      // clave sin ceros → presentación
    const porProveedor = new Map<string, string>();
    if (variantes.length) {
      for (const x of (await pool.query<{ codigo: string; presentacion_id: string }>("SELECT codigo, presentacion_id FROM codigos_barra WHERE empresa_id = $1 AND activo AND codigo = ANY($2)", [empresaId, variantes])).rows) porBarra.set(clave(x.codigo), x.presentacion_id);
    }
    if (codigos.length && prov) {
      for (const x of (await pool.query<{ codigo_proveedor: string; presentacion_id: string }>(
        `SELECT pp.codigo_proveedor, pr.id AS presentacion_id FROM producto_proveedores pp
           JOIN presentaciones pr ON pr.producto_id = pp.producto_id AND pr.es_principal
          WHERE pp.proveedor_id = $1 AND pp.activo AND pp.codigo_proveedor = ANY($2)`, [prov.id, codigos])).rows) porProveedor.set(x.codigo_proveedor, x.presentacion_id);
    }
    // Descripciones que ya se eligieron en compras anteriores de este proveedor
    const porAlias = new Map<string, string>();
    if (prov) {
      for (const x of (await pool.query<{ alias: string; presentacion_id: string }>("SELECT alias, presentacion_id FROM alias_factura WHERE proveedor_id = $1", [prov.id])).rows) porAlias.set(x.alias, x.presentacion_id);
    }
    const catalogo = (await pool.query<Candidato>(
      `SELECT pr.id AS "presentacionId", p.id AS "productoId", p.nombre, pr.nombre AS presentacion, pr.factor::text AS factor
         FROM presentaciones pr JOIN productos p ON p.id = pr.producto_id
        WHERE p.empresa_id = $1 AND p.activo AND p.tipo <> 'SERVICIO'`, [empresaId])).rows;
    const porId = new Map(catalogo.map((c) => [c.presentacionId, c]));

    const tasa = f.itbis && f.subtotal && f.subtotal > 0 ? Math.min(0.18, Math.max(0, f.itbis / f.subtotal)) : 0.18;
    let sumaNeto = 0;
    const items = f.items.map((i) => {
      const cod = (i.codigo ?? "").trim();
      const exacto = barras(i).map((d) => porBarra.get(clave(d))).find(Boolean) ?? porProveedor.get(cod) ?? porAlias.get(normalizarAlias(i.descripcion));
      let elegido = exacto ? porId.get(exacto) : undefined;
      let confianza: "CODIGO" | "NOMBRE" | "NINGUNA" = elegido ? "CODIGO" : "NINGUNA";
      const sugeridos = catalogo.map((c) => ({ c, s: parecido(i.descripcion, `${c.nombre} ${c.presentacion === "Unidad" ? "" : c.presentacion}`) }))
        .filter((x) => x.s > 0.25).sort((x, y) => y.s - x.s).slice(0, 4);
      if (!elegido && sugeridos[0] && sugeridos[0].s >= 0.75 && (!sugeridos[1] || sugeridos[0].s - sugeridos[1].s >= 0.1)) { elegido = sugeridos[0].c; confianza = "NOMBRE"; }
      // ---- Costo REAL de la línea, sin ITBIS: precio × cantidad − descuento + impuesto selectivo (ISC), repartido entre las unidades que llegaron
      const bruto = i.cantidad * i.precioUnitario;
      const neto = i.netoSinItbis && i.netoSinItbis > 0
        ? i.netoSinItbis
        : i.itbisLinea && i.itbisLinea > 0 ? i.itbisLinea / tasa
        : Math.max(0, bruto - (i.descuento ?? 0) + (i.impuestoSelectivo ?? 0)) / (f.preciosIncluyenItbis ? 1 + tasa : 1);
      // ---- Unidades sueltas: lo dice la IA (si es coherente) o se deduce de la columna de unidad («CAJ / 24 PZA», «15x22 oz»…)
      const emp = unidadesPorEmpaque(i);
      let unidades = i.cantidad;
      const ut = Number(i.unidadesTotales);
      if (ut > 0 && (Math.abs(ut - i.cantidad) < 1e-6 || (emp && Math.abs(ut - i.cantidad * emp) < 1e-6))) unidades = ut;
      else if (emp && esEmpaque(i.unidad)) unidades = i.cantidad * emp;
      const porEmpaque = unidades > i.cantidad + 1e-6 ? unidades / i.cantidad : 1; // unidades que trae cada empaque cobrado
      const costoUnidad = unidades > 0 ? neto / unidades : 0;
      let cantidad = i.cantidad;
      let costo = i.cantidad > 0 ? neto / i.cantidad : 0; // sin empaque: por lo cobrado (ya con descuento e impuesto selectivo)
      let porUnidad = false;
      const partes: string[] = [];
      if (porEmpaque > 1) partes.push(`${i.cantidad} × empaque de ${Math.round(porEmpaque * 100) / 100} (${i.unidad ?? ""}) = ${unidades} unidades`.replace(" ()", ""));
      if (i.descuento && i.descuento > 0) partes.push(`descuento −${i.descuento}`);
      if (i.impuestoSelectivo && i.impuestoSelectivo > 0) partes.push(`incluye selectivo +${i.impuestoSelectivo}`);
      if (porEmpaque > 1) {
        // Si el producto ya tiene la presentación «caja» de ese tamaño, se usa; si no, la presentación elegida (o por unidad)
        if (elegido) { const el = elegido; const caja = catalogo.find((c) => c.productoId === el.productoId && Math.abs(Number(c.factor) - porEmpaque) < 1e-6); if (caja) elegido = caja; }
        const fp = elegido ? Number(porId.get(elegido.presentacionId)?.factor ?? 1) : 1;
        if (elegido) { cantidad = unidades / fp; costo = costoUnidad * fp; }
        else { cantidad = unidades; costo = costoUnidad; porUnidad = true; }
      }
      const empaque = partes.length ? partes.join(" · ") : null;
      sumaNeto += neto;
      return {
        codigo: cod || null, codigoBarras: barras(i)[0] ?? null, descripcion: i.descripcion, unidad: i.unidad ?? null,
        cantidad: Math.round(cantidad * 10000) / 10000, costo: Math.round(costo * 10000) / 10000, importe: i.importe ?? null, porUnidad, empaque,
        presentacionId: elegido?.presentacionId ?? null, producto: elegido ? { nombre: elegido.nombre, presentacion: elegido.presentacion, factor: elegido.factor } : null,
        confianza, sugeridos: sugeridos.filter((x) => x.c.presentacionId !== elegido?.presentacionId).map((x) => x.c),
      };
    });

    // Cuadre: las líneas (sin ITBIS, con descuento y selectivo) deben sumar el subtotal de la factura; si no, falta una línea o una página
    const esperado = [f.subtotal, f.total != null && f.itbis != null ? f.total - f.itbis : null].filter((x): x is number => x != null && x > 0);
    const cuadra = !esperado.length || esperado.some((e) => Math.abs(sumaNeto - e) / e <= 0.02);
    const aviso = cuadra ? null : `Las líneas leídas suman ${Math.round(sumaNeto * 100) / 100} y la factura dice ${esperado[0]}: puede faltar una línea o una página (cada página se carga por separado), o algún precio quedó mal interpretado. Revise antes de registrar.`;

    return {
      cupo: r.cupo, usadas: r.usadas, aviso, columnas: f.columnas ?? [],
      proveedor: { id: prov?.id ?? null, nombreLeido: f.proveedor?.nombre ?? null, rncLeido: rnc || null },
      numeroFactura: f.numeroFactura ?? null, ncf: (f.ncf ?? "").replace(/\s/g, "").toUpperCase() || null,
      fecha: f.fecha ?? null, vence: f.vence ?? null, condicion: f.condicion ?? (f.vence ? "CREDITO" : null),
      preciosIncluyenItbis: f.preciosIncluyenItbis, subtotal: f.subtotal ?? null, itbis: f.itbis ?? null, total: f.total ?? null,
      items,
    };
  }
}
