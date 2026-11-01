import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, ErrorNegocio } from "../db.js";
import { autorizarLicencia } from "../respaldo/portal.js";

/**
 * Portal: LECTOR DE FACTURAS con IA (Claude).
 * La llave de la API vive solo aquí (ANTHROPIC_API_KEY); las instalaciones piden la lectura y el portal
 * valida la licencia y descuenta del cupo mensual que el proveedor asignó a esa licencia (lector_cupo, 0 = apagado).
 *   ANTHROPIC_API_KEY   LECTOR_MODELO (por omisión claude-sonnet-5-5)
 */
const MODELO = () => process.env.LECTOR_MODELO || "claude-sonnet-5-5";
const MAX_BYTES = 3 * 1024 * 1024;          // el portal (Vercel) acepta cuerpos de ~4.5 MB; base64 agrega un tercio
const mesActual = () => new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 7);

const HERRAMIENTA = {
  name: "registrar_factura",
  description: "Registra los datos de una factura de compra de un proveedor, tal como están impresos.",
  input_schema: {
    type: "object",
    properties: {
      proveedor: { type: "object", properties: { nombre: { type: ["string", "null"] }, rnc: { type: ["string", "null"], description: "RNC del proveedor, solo dígitos" } }, required: ["nombre", "rnc"] },
      numeroFactura: { type: ["string", "null"] },
      ncf: { type: ["string", "null"], description: "Comprobante fiscal (NCF o e-NCF), p. ej. B0100000001 o E310000000001" },
      fecha: { type: ["string", "null"], description: "Fecha de la factura, AAAA-MM-DD" },
      vence: { type: ["string", "null"], description: "Fecha de vencimiento si es a crédito, AAAA-MM-DD" },
      condicion: { type: ["string", "null"], enum: ["CONTADO", "CREDITO", null] },
      preciosIncluyenItbis: { type: "boolean", description: "true si los precios unitarios impresos ya incluyen el ITBIS" },
      subtotal: { type: ["number", "null"] }, itbis: { type: ["number", "null"] }, total: { type: ["number", "null"] },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            codigo: { type: ["string", "null"], description: "Código o código de barras del producto si aparece" },
            descripcion: { type: "string" },
            cantidad: { type: "number" },
            unidad: { type: ["string", "null"], description: "Unidad o presentación (caja, unidad, docena…) si aparece" },
            precioUnitario: { type: "number", description: "Precio por unidad tal como está impreso" },
            importe: { type: ["number", "null"], description: "Importe de la línea tal como está impreso" },
          },
          required: ["descripcion", "cantidad", "precioUnitario"],
        },
      },
    },
    required: ["items", "preciosIncluyenItbis"],
  },
} as const;

const INSTRUCCIONES = "Eres un asistente que lee facturas de proveedores de la República Dominicana. Extrae SOLO lo que está impreso; " +
  "si un dato no aparece, usa null. No inventes productos ni cifras. Los números van sin separador de miles. " +
  "Llama a la herramienta registrar_factura con el resultado.";

export async function rutasPortalLector(app: FastifyInstance) {
  app.post("/licencias/lector/estado", async (req) => {
    const l = await autorizarLicencia(req.body);
    const u = (await pool.query<{ usadas: number }>("SELECT usadas FROM portal_lector_uso WHERE licencia_id = $1 AND mes = $2", [l.id, mesActual()])).rows[0]?.usadas ?? 0;
    return { cupo: l.lector_cupo, usadas: u, mes: mesActual(), disponible: !!process.env.ANTHROPIC_API_KEY };
  });

  app.post("/licencias/lector/leer", { bodyLimit: 6 * 1024 * 1024 }, async (req) => {
    const l = await autorizarLicencia(req.body);
    const b = z.object({ tipo: z.enum(["image/jpeg", "image/png", "image/webp", "application/pdf"]), datos: z.string().min(100) }).parse(req.body);
    if (!process.env.ANTHROPIC_API_KEY) throw new ErrorNegocio("El lector de facturas todavía no está disponible. Su proveedor lo activará pronto.", 503);
    if (Buffer.byteLength(b.datos, "base64") > MAX_BYTES) throw new ErrorNegocio("El archivo es muy pesado (máx. 3 MB). Tome la foto con menos resolución o envíe un PDF más liviano.", 413);
    if (l.lector_cupo <= 0) throw new ErrorNegocio("El lector de facturas no está incluido en su licencia. Pídale a su proveedor que lo active.", 402);
    const mes = mesActual();
    // Se reserva un cupo antes de llamar a la IA (evita pasarse con lecturas simultáneas) y se devuelve si falla
    const reservado = await pool.query(
      `INSERT INTO portal_lector_uso (licencia_id, mes, usadas) VALUES ($1, $2, 1)
       ON CONFLICT (licencia_id, mes) DO UPDATE SET usadas = portal_lector_uso.usadas + 1
       WHERE portal_lector_uso.usadas < $3 RETURNING usadas`, [l.id, mes, l.lector_cupo]);
    if (!reservado.rowCount) throw new ErrorNegocio(`Ya usó las ${l.lector_cupo} facturas de este mes. Pídale a su proveedor ampliar el cupo.`, 402);
    const devolver = () => pool.query("UPDATE portal_lector_uso SET usadas = GREATEST(usadas - 1, 0) WHERE licencia_id = $1 AND mes = $2", [l.id, mes]).catch(() => undefined);
    try {
      const bloque = b.tipo === "application/pdf"
        ? { type: "document", source: { type: "base64", media_type: b.tipo, data: b.datos } }
        : { type: "image", source: { type: "base64", media_type: b.tipo, data: b.datos } };
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: MODELO(), max_tokens: 4096, system: INSTRUCCIONES,
          tools: [HERRAMIENTA], tool_choice: { type: "tool", name: HERRAMIENTA.name },
          messages: [{ role: "user", content: [bloque, { type: "text", text: "Lea esta factura de compra." }] }],
        }),
        signal: AbortSignal.timeout(55_000),
      });
      const d = (await r.json().catch(() => ({}))) as { content?: { type: string; input?: unknown }[]; error?: { message?: string } };
      if (!r.ok) throw new Error(d.error?.message ?? `HTTP ${r.status}`);
      const uso = d.content?.find((x) => x.type === "tool_use")?.input;
      if (!uso) throw new Error("La IA no devolvió datos");
      return { factura: uso, cupo: l.lector_cupo, usadas: reservado.rows[0].usadas as number };
    } catch (e) {
      await devolver();
      app.log.warn(`Lector de facturas: ${(e as Error).message}`);
      throw new ErrorNegocio("No se pudo leer la factura. Intente con una foto más nítida y de frente, o regístrela a mano. (No se descontó de su cupo.)", 502);
    }
  });

  /** Panel del proveedor: cupo mensual de facturas de un cliente */
  app.put("/central/portal/clientes/:id/lector", async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = z.object({ cupo: z.number().int().min(0).max(100000) }).parse(req.body);
    const r = await pool.query("UPDATE portal_licencias SET lector_cupo = $2, actualizado_en = now() WHERE cliente_id = $1 RETURNING id", [id, b.cupo]);
    if (!r.rowCount) throw new ErrorNegocio("Ese cliente no tiene licencia", 404);
    return { ok: true };
  });
}
