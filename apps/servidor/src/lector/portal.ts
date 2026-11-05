import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, ErrorNegocio } from "../db.js";
import { autorizarLicencia } from "../respaldo/portal.js";
import { cuerpoGemini, leerRespuestaGemini, modelosGratis, ordenProveedores, type Proveedor } from "./proveedores.js";

/**
 * Portal: LECTOR DE FACTURAS con IA (Claude).
 * La llave de la API vive solo aquí (ANTHROPIC_API_KEY); las instalaciones piden la lectura y el portal
 * valida la licencia y descuenta del cupo mensual que el proveedor asignó a esa licencia (lector_cupo, 0 = apagado).
 *   ANTHROPIC_API_KEY   LECTOR_MODELO (por omisión claude-sonnet-5-5)            → opción de pago (Claude)
 *   GEMINI_API_KEY      LECTOR_MODELO_GRATIS                                         → opción gratuita (Google Gemini, con límites)
 *   LECTOR_PROVEEDOR    auto (gratis primero y, si falla, pago) | gratis | pago
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
      columnas: { type: "array", items: { type: "string" }, description: "PRIMERO: los encabezados de la tabla de productos, en orden, cada uno con lo que significa en esta factura. Ej.: «CANTIDAD (cajas)», «PRECIO (por caja, sin ITBIS)», «DESCUENTO % y valor», «ISCe+ISCav (selectivo, aparte)», «IMPORTE (sin ITBIS)». Así se decide si el precio es por caja o por unidad y si el importe incluye ITBIS." },
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
            codigo: { type: ["string", "null"], description: "Código INTERNO del proveedor para este producto (columna «Código», «Item», «Material», «SAP», «Artículo»)" },
            codigoBarras: { type: ["string", "null"], description: "Código de barras estándar (EAN-13, UPC-A de 12 o GTIN de 8 a 14 dígitos) SOLO si la factura lo imprime (columna «Código de barras», «EAN», o debajo de la descripción). Solo dígitos. No lo confundas con el código interno." },
            descripcion: { type: "string" },
            cantidad: { type: "number" },
            unidad: { type: ["string", "null"], description: "Texto de la columna de unidad / presentación tal como está impreso (p. ej. «15x22 oz», «70cl», «CAJA»)" },
            unidadesTotales: { type: ["number", "null"], description: "Cuántas unidades sueltas (botellas, latas, fundas…) llegaron en TOTAL en esta línea. Si la cantidad está en cajas/paquetes: cantidad × unidades por empaque. Si la cantidad ya está en botellas/unidades, es igual a la cantidad." },
            descuento: { type: ["number", "null"], description: "Descuento de la línea en MONTO (no %), tal como está impreso o calculado (cantidad × precio × %). 0 o null si no hay." },
            impuestoSelectivo: { type: ["number", "null"], description: "Impuesto selectivo al consumo (ISC, «ISCe + ISCav», «Selectivo») de la línea en MONTO, SOLO si se imprime en una columna aparte y no está dentro del precio." },
            itbisLinea: { type: ["number", "null"], description: "ITBIS de la línea en monto, si la línea lo trae." },
            netoSinItbis: { type: ["number", "null"], description: "Valor de la línea SIN ITBIS = cantidad × precio − descuento + impuesto selectivo (si el precio impreso incluye ITBIS, divídelo entre 1.18). Debe cuadrar con la columna de importe/total de la línea y con itbisLinea ÷ 0.18." },
            unidadesPorEmpaque: { type: ["integer", "null"], description: "Cuántas unidades trae cada empaque que se cobra en esta línea, SOLO si la columna de unidad lo indica (p. ej. «15x22 oz» → 15, «24 UND» → 24, «12x1L» → 12). Si cada cantidad es una unidad suelta (p. ej. «70cl», «UND»), null." },
            precioUnitario: { type: "number", description: "Precio por unidad tal como está impreso" },
            importe: { type: ["number", "null"], description: "Importe de la línea tal como está impreso" },
          },
          required: ["descripcion", "cantidad", "precioUnitario"],
        },
      },
    },
    required: ["columnas", "items", "preciosIncluyenItbis"],
  },
} as const;

const INSTRUCCIONES = "Eres un asistente que lee facturas de proveedores de la República Dominicana. Extrae SOLO lo que está impreso; " +
  "si un dato no aparece, usa null. No inventes productos ni cifras. Los números van sin separador de miles. " +
  "GUÍA DE FACTURAS DE PROVEEDORES: " +
  "(1) «cantidad» es lo que se cobra en la línea, en la unidad de la factura (cajas si la unidad es CAJA/CAJ/CJ/CA/CJ6BOT/CAJA06/Paquete; botellas o unidades si es BOT/UND/PZA). " +
  "(2) El empaque se deduce de la unidad o la descripción: «6/750ML», «12/75 CL», «24x350ML», «15x22 oz» (15), «6X4X355ML» (6×4=24), «CAJ / 24 PZA», «CAJA06», «CJ12BOT», «Caja-12», «Paquete-10», «12 Pzas», «4P». Un volumen solo («700ML», «75cl», «1.75L») NO es empaque. Anótalo en unidadesPorEmpaque. " +
  "(2b) Si la descripción lleva «NxVOLUMEN» (p. ej. «JW BLUE 6x75 CL», «OLD PARR 12x75 CL», «TEQUILA 6x75 CL») el producto se vende en cajas de N aunque la columna de unidad diga UND o CA: cantidad = cajas, unidadesPorEmpaque = N, unidadesTotales = cantidad × N. Una unidad «12PACK» / «6PACK» es un paquete de 12 / 6 unidades pequeñas (p. ej. «144X5CL 12PACK»: cantidad = paquetes, unidadesPorEmpaque = 12). " +
    "(3) El «precio» puede ser por caja o por unidad aunque la columna diga «Precio Und.»: compruébalo con el importe de la línea (cantidad × precio ≈ importe antes de descuento). Si la cantidad viene en botellas pero el precio es por caja (p. ej. «6 BOT» de «12/700ML»), usa el ITBIS de la línea para deducir el valor real (ITBIS ÷ 0.18). " +
  "(4) Descuentos por línea (%, «Desc. Línea», «Descuento comercial») y el impuesto selectivo al consumo (ISC) que algunas facturas de licores muestran en una columna aparte forman parte del COSTO: llénalos en descuento e impuestoSelectivo y calcula netoSinItbis. Un descuento general al pie (que no está por línea) no se reparte: déjalo fuera. " +
  "(5) Hay facturas con precios que ya incluyen ITBIS (recibos de caja con marca «I18»): preciosIncluyenItbis = true. En otras, el importe de la línea ya es sin ITBIS. " +
  "(6) Si es una página de varias («Página 1 / 2»), lee solo las líneas de esta página. " +
  "Responde SIEMPRE y ÚNICAMENTE llamando a la herramienta registrar_factura con el resultado; no escribas texto.";

export async function rutasPortalLector(app: FastifyInstance) {
  app.post("/licencias/lector/estado", async (req) => {
    const l = await autorizarLicencia(req.body);
    const u = (await pool.query<{ usadas: number }>("SELECT usadas FROM portal_lector_uso WHERE licencia_id = $1 AND mes = $2", [l.id, mesActual()])).rows[0]?.usadas ?? 0;
    const pedida = !l.lector_pago && !!(await pool.query("SELECT 1 FROM portal_eventos WHERE licencia_id = $1 AND tipo = 'LECTOR_PAGO_SOLICITADO' AND creado_en > now() - interval '30 days'", [l.id])).rowCount;
    return { cupo: l.lector_cupo, usadas: u, mes: mesActual(), disponible: ordenProveedores(process.env, l.lector_pago).length > 0, pagoAutorizado: l.lector_pago, pagoSolicitado: pedida };
  });

  /** El cliente pide usar la IA de pago (la gratuita por omisión no le sirve): queda como aviso para el proveedor, una vez al día */
  app.post("/licencias/lector/solicitar-pago", async (req) => {
    const l = await autorizarLicencia(req.body);
    if (l.lector_pago) return { ok: true, yaAutorizada: true };
    const ya = await pool.query("SELECT 1 FROM portal_eventos WHERE licencia_id = $1 AND tipo = 'LECTOR_PAGO_SOLICITADO' AND creado_en > now() - interval '1 day'", [l.id]);
    if (ya.rowCount) return { ok: true, yaEnviada: true };
    const c = await pool.query<{ cliente_id: string }>("SELECT cliente_id FROM portal_licencias WHERE id = $1", [l.id]);
    await pool.query("INSERT INTO portal_eventos (id, licencia_id, cliente_id, tipo, detalle) VALUES (gen_random_uuid(), $1, $2, 'LECTOR_PAGO_SOLICITADO', '{}')", [l.id, c.rows[0]?.cliente_id ?? null]);
    return { ok: true, yaEnviada: false };
  });

  app.post("/licencias/lector/leer", { bodyLimit: 6 * 1024 * 1024 }, async (req) => {
    const l = await autorizarLicencia(req.body);
    const b = z.object({ tipo: z.enum(["image/jpeg", "image/png", "image/webp", "application/pdf"]), datos: z.string().min(100) }).parse(req.body);
    const orden = ordenProveedores(process.env, l.lector_pago);
    if (!orden.length) throw new ErrorNegocio("El lector de facturas todavía no está disponible. Su proveedor lo activará pronto.", 503);
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
      const leer: Record<Proveedor, () => Promise<unknown>> = {
        pago: async () => {
          const bloque = b.tipo === "application/pdf"
            ? { type: "document", source: { type: "base64", media_type: b.tipo, data: b.datos } }
            : { type: "image", source: { type: "base64", media_type: b.tipo, data: b.datos } };
          const r = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
            body: JSON.stringify({
              model: MODELO(), max_tokens: 4096, system: INSTRUCCIONES,
              tools: [HERRAMIENTA], tool_choice: { type: "auto" }, // los modelos nuevos no aceptan forzar la herramienta: se le exige en las instrucciones
              messages: [{ role: "user", content: [bloque, { type: "text", text: "Lea esta factura de compra." }] }],
            }),
            signal: AbortSignal.timeout(55_000),
          });
          const d = (await r.json().catch(() => ({}))) as { content?: { type: string; input?: unknown }[]; error?: { message?: string } };
          if (!r.ok) throw new Error(d.error?.message ?? `HTTP ${r.status}`);
          const uso = d.content?.find((x) => x.type === "tool_use")?.input;
          if (!uso) throw new Error("La IA no devolvió datos");
          return uso;
        },
        gratis: async () => {
          // Si el modelo principal está saturado (503) o sin cupo (429), se prueba el de respaldo antes de rendirse
          let ultimo = "Gemini no respondió";
          const hasta = Date.now() + 52_000;
          const turnos = modelosGratis().flatMap((m) => [m, m, m]); // cada modelo hasta 3 veces (con pausa) si responde saturado
          for (const [n, modelo] of turnos.entries()) {
            if (Date.now() > hasta) break;
            if (n > 0 && turnos[n - 1] === modelo) await new Promise((r) => setTimeout(r, 2500));
            const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent`, {
              method: "POST",
              headers: { "x-goog-api-key": process.env.GEMINI_API_KEY!, "content-type": "application/json" },
              body: JSON.stringify(cuerpoGemini({ tipo: b.tipo, datos: b.datos, instrucciones: INSTRUCCIONES, esquema: HERRAMIENTA.input_schema })),
              signal: AbortSignal.timeout(25_000),
            }).catch((e) => { ultimo = `${modelo}: ${(e as Error).message}`; return null; });
            if (!r) continue;
            const d = (await r.json().catch(() => ({}))) as { error?: { message?: string } };
            if (r.status === 429 || r.status === 503 || r.status === 500) { ultimo = r.status === 429 ? "Se agotó el límite de lecturas gratuitas por ahora" : (d.error?.message ?? `HTTP ${r.status}`); app.log.warn(`Gemini ${modelo}: ${ultimo}`); continue; }
            if (!r.ok) throw new Error(d.error?.message ?? `HTTP ${r.status}`);
            return leerRespuestaGemini(d);
          }
          throw new Error(ultimo);
        },
      };
      // Se intenta en orden; si el gratuito falla o se agota y hay opción de pago, se usa esa
      let factura: unknown, usado: Proveedor | null = null, ultimoError: Error | null = null;
      for (const p of orden) {
        try { factura = await leer[p](); usado = p; break; }
        catch (e) { ultimoError = e as Error; app.log.warn(`Lector de facturas (${p}): ${(e as Error).message}`); }
      }
      if (!usado) throw ultimoError ?? new Error("Sin proveedor disponible");
      return { factura, proveedor: usado, cupo: l.lector_cupo, usadas: reservado.rows[0].usadas as number };
    } catch (e) {
      await devolver();
      app.log.warn(`Lector de facturas: ${(e as Error).message}`);
      const motivo = (e as Error).message.replace(/\s+/g, " ").slice(0, 180);
      throw new ErrorNegocio(`No se pudo leer la factura: ${motivo}. Si la foto es nítida, avise a su proveedor con este mensaje. (No se descontó de su cupo.)`, 502);
    }
  });

  /** Panel del proveedor: cupo mensual de facturas de un cliente */
  app.put("/central/portal/clientes/:id/lector", async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = z.object({ cupo: z.number().int().min(0).max(100000), pago: z.boolean().optional() }).parse(req.body);
    const r = await pool.query("UPDATE portal_licencias SET lector_cupo = $2, lector_pago = COALESCE($3, lector_pago), actualizado_en = now() WHERE cliente_id = $1 RETURNING id", [id, b.cupo, b.pago ?? null]);
    if (!r.rowCount) throw new ErrorNegocio("Ese cliente no tiene licencia", 404);
    return { ok: true };
  });
}
