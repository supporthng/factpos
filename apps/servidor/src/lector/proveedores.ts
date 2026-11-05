/**
 * Proveedores de IA del lector de facturas:
 *  - «gratis»: Google Gemini (GEMINI_API_KEY, modelo LECTOR_MODELO_GRATIS). Su capa gratuita tiene límites de uso y
 *    Google puede usar lo que se envía para mejorar sus productos.
 *  - «pago»: Claude de Anthropic (ANTHROPIC_API_KEY, modelo LECTOR_MODELO). Es el que ya estaba.
 * El de pago solo se usa si el proveedor autorizó a esa licencia (portal_licencias.lector_pago); sin esa autorización
 * nunca se llama a Claude, ni siquiera como respaldo. LECTOR_PROVEEDOR = «auto» (por omisión: gratis primero y, si falla
 * o se agota y la licencia está autorizada, el de pago), «gratis» (solo gratis) o «pago» (solo pago, si está autorizada).
 */
export type Proveedor = "gratis" | "pago";
export interface Entorno { LECTOR_PROVEEDOR?: string; GEMINI_API_KEY?: string; ANTHROPIC_API_KEY?: string }

/** En qué orden se intentan los proveedores según lo configurado y las llaves que existan */
export function ordenProveedores(env: Entorno, pagoAutorizado = false): Proveedor[] {
  const gratis = !!env.GEMINI_API_KEY, pago = !!env.ANTHROPIC_API_KEY && pagoAutorizado;
  const modo = (env.LECTOR_PROVEEDOR ?? "auto").toLowerCase();
  if (modo === "gratis") return gratis ? ["gratis"] : [];
  if (modo === "pago") return pago ? ["pago"] : [];
  return [...(gratis ? ["gratis" as const] : []), ...(pago ? ["pago" as const] : [])];
}

export const MODELO_GRATIS = (env: { LECTOR_MODELO_GRATIS?: string } = process.env) => env.LECTOR_MODELO_GRATIS || "gemini-3.8-flash";
/** Modelo gratuito de respaldo cuando el principal está saturado (503) o sin cupo (429) */
export const MODELO_GRATIS_RESPALDO = (env: { LECTOR_MODELO_GRATIS_RESPALDO?: string } = process.env) => env.LECTOR_MODELO_GRATIS_RESPALDO ?? ""; // sin respaldo por omisión: Google retira modelos viejos para llaves nuevas
/** Modelos gratuitos a intentar, en orden y sin repetir */
export const modelosGratis = (env: { LECTOR_MODELO_GRATIS?: string; LECTOR_MODELO_GRATIS_RESPALDO?: string } = process.env) =>
  [...new Set([MODELO_GRATIS(env), MODELO_GRATIS_RESPALDO(env)].filter(Boolean))];

/** Cuerpo de la petición a Gemini: la misma factura y las mismas reglas, con el esquema escrito en las instrucciones */
export function cuerpoGemini(args: { tipo: string; datos: string; instrucciones: string; esquema: unknown; pensamiento?: string }) {
  return {
    systemInstruction: { parts: [{ text: `${args.instrucciones}\nResponde ÚNICAMENTE con un objeto JSON (sin texto antes ni después, sin bloques de código) que cumpla este esquema:\n${JSON.stringify(args.esquema)}` }] },
    contents: [{ role: "user", parts: [{ inlineData: { mimeType: args.tipo, data: args.datos } }, { text: "Lea esta factura de compra." }] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0, maxOutputTokens: 8192, ...(args.pensamiento ? { thinkingConfig: { thinkingLevel: args.pensamiento } } : {}) },
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
