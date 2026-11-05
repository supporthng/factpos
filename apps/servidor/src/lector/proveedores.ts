/**
 * Proveedores de IA del lector de facturas:
 *  - «gratis»: Google Gemini (GEMINI_API_KEY, modelo LECTOR_MODELO_GRATIS). Su capa gratuita tiene límites de uso y
 *    Google puede usar lo que se envía para mejorar sus productos.
 *  - «pago»: Claude de Anthropic (ANTHROPIC_API_KEY, modelo LECTOR_MODELO). Es el que ya estaba.
 * LECTOR_PROVEEDOR = «auto» (por omisión: gratis primero y, si falla o se agota, el de pago), «gratis» o «pago».
 */
export type Proveedor = "gratis" | "pago";
export interface Entorno { LECTOR_PROVEEDOR?: string; GEMINI_API_KEY?: string; ANTHROPIC_API_KEY?: string }

/** En qué orden se intentan los proveedores según lo configurado y las llaves que existan */
export function ordenProveedores(env: Entorno): Proveedor[] {
  const gratis = !!env.GEMINI_API_KEY, pago = !!env.ANTHROPIC_API_KEY;
  const modo = (env.LECTOR_PROVEEDOR ?? "auto").toLowerCase();
  if (modo === "gratis") return gratis ? ["gratis"] : [];
  if (modo === "pago") return pago ? ["pago"] : [];
  return [...(gratis ? ["gratis" as const] : []), ...(pago ? ["pago" as const] : [])];
}

export const MODELO_GRATIS = (env: { LECTOR_MODELO_GRATIS?: string } = process.env) => env.LECTOR_MODELO_GRATIS || "gemini-3.8-flash";

/** Cuerpo de la petición a Gemini: la misma factura y las mismas reglas, con el esquema escrito en las instrucciones */
export function cuerpoGemini(args: { tipo: string; datos: string; instrucciones: string; esquema: unknown }) {
  return {
    systemInstruction: { parts: [{ text: `${args.instrucciones}\nResponde ÚNICAMENTE con un objeto JSON (sin texto antes ni después, sin bloques de código) que cumpla este esquema:\n${JSON.stringify(args.esquema)}` }] },
    contents: [{ role: "user", parts: [{ inlineData: { mimeType: args.tipo, data: args.datos } }, { text: "Lea esta factura de compra." }] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0, maxOutputTokens: 8192 },
  };
}

/** Saca el JSON de la respuesta de Gemini y comprueba lo mínimo para que el resto del sistema funcione */
export function leerRespuestaGemini(d: unknown): Record<string, unknown> {
  const r = d as { candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]; promptFeedback?: { blockReason?: string } };
  const texto = r.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim();
  if (!texto) throw new Error(r.promptFeedback?.blockReason ? `Gemini rechazó el documento (${r.promptFeedback.blockReason})` : "Gemini no devolvió datos");
  const limpio = texto.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let obj: unknown;
  try { obj = JSON.parse(limpio); } catch { throw new Error(r.candidates?.[0]?.finishReason === "MAX_TOKENS" ? "La factura es muy larga para leerla de una vez" : "Gemini devolvió un texto que no es JSON"); }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw new Error("Gemini devolvió un resultado inesperado");
  const f = obj as Record<string, unknown>;
  if (!Array.isArray(f.items) || f.items.length === 0) throw new Error("Gemini no encontró productos en la factura");
  if (!f.items.every((i) => i && typeof i === "object" && typeof (i as { descripcion?: unknown }).descripcion === "string")) throw new Error("Gemini devolvió productos sin descripción");
  return { ...f, columnas: Array.isArray(f.columnas) ? f.columnas : [], preciosIncluyenItbis: f.preciosIncluyenItbis === true };
}
