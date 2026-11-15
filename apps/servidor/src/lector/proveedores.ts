/**
 * Proveedores de IA del lector de facturas:
 *  - «gratis»: Google Gemini (GEMINI_API_KEY, modelo LECTOR_MODELO_GRATIS). Su capa gratuita tiene límites de uso y
 *    Google puede usar lo que se envía para mejorar sus productos.
 *  - «groq»: segundo lector gratuito (GROQ_API_KEY, modelo LECTOR_MODELO_GROQ, por omisión qwen/qwen3.8-27b). Solo lee imágenes (no PDF).
 *    Se usa cuando Gemini falla o está saturado.
 *  - «pago»: Claude de Anthropic (ANTHROPIC_API_KEY, modelo LECTOR_MODELO). Es el que ya estaba.
 * El de pago solo se usa si el proveedor autorizó a esa licencia (portal_licencias.lector_pago); sin esa autorización
 * nunca se llama a Claude, ni siquiera como respaldo. LECTOR_PROVEEDOR = «auto» (por omisión: gratis primero y, si falla
 * o se agota y la licencia está autorizada, el de pago), «gratis» (solo gratis) o «pago» (solo pago, si está autorizada).
 */
export type Proveedor = "gratis" | "groq" | "pago";
export interface Entorno { LECTOR_PROVEEDOR?: string; GEMINI_API_KEY?: string; GROQ_API_KEY?: string; ANTHROPIC_API_KEY?: string }

/** En qué orden se intentan los proveedores según lo configurado y las llaves que existan */
export function ordenProveedores(env: Entorno, pagoAutorizado = false): Proveedor[] {
  const gratis = !!env.GEMINI_API_KEY, groq = !!env.GROQ_API_KEY, pago = !!env.ANTHROPIC_API_KEY && pagoAutorizado;
  const modo = (env.LECTOR_PROVEEDOR ?? "auto").toLowerCase();
  if (modo === "gratis") return [...(gratis ? ["gratis" as const] : []), ...(groq ? ["groq" as const] : [])];
  if (modo === "groq") return groq ? ["groq"] : [];
  if (modo === "pago") return pago ? ["pago"] : [];
  return [...(gratis ? ["gratis" as const] : []), ...(groq ? ["groq" as const] : []), ...(pago ? ["pago" as const] : [])];
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
    systemInstruction: { parts: [{ text: `${sinHerramienta(args.instrucciones)}\nResponde ÚNICAMENTE con un objeto JSON (sin texto antes ni después, sin bloques de código) que cumpla este esquema:\n${JSON.stringify(args.esquema)}` }] },
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
  if (!Array.isArray(f.items) || f.items.length === 0) throw new Error(`Gemini no encontró productos en la factura${Object.keys(f).length ? ` (respondió: ${Object.keys(f).slice(0, 8).join(", ")}; items ${Array.isArray(f.items) ? "vacío" : "ausente"})` : ""}`);
  if (!f.items.every((i) => i && typeof i === "object" && typeof (i as { descripcion?: unknown }).descripcion === "string")) throw new Error("Gemini devolvió productos sin descripción");
  return { ...f, columnas: Array.isArray(f.columnas) ? f.columnas : [], preciosIncluyenItbis: f.preciosIncluyenItbis === true };
}

/**
 * Modelos Gemini «flash» que Google ofrece hoy (de la lista que devuelve su API), para usarlos cuando el configurado está saturado.
 * Solo nombres estables (sin «preview», «image», «tts»…), los más nuevos primero y «flash» antes que «flash-lite».
 */
export function elegirAlternos(lista: { name?: string; supportedGenerationMethods?: string[] }[], excluir: string[], max = 3): string[] {
  const vistos = new Set(excluir);
  return lista
    .map((m) => ({ nombre: (m.name ?? "").replace(/^models\//, ""), ok: (m.supportedGenerationMethods ?? []).includes("generateContent") }))
    .filter((m) => m.ok && /^gemini-\d+(\.\d+)?-flash(-lite)?$/.test(m.nombre) && !vistos.has(m.nombre))
    .map((m) => ({ ...m, version: parseFloat(m.nombre.split("-")[1]), lite: m.nombre.endsWith("-lite") }))
    .sort((a, b) => b.version - a.version || Number(a.lite) - Number(b.lite))
    .slice(0, max)
    .map((m) => m.nombre);
}

export const MODELO_GROQ = (env: { LECTOR_MODELO_GROQ?: string } = process.env) => env.LECTOR_MODELO_GROQ || "qwen/qwen3.8-27b";

/** Las instrucciones están escritas para Claude («llama a la herramienta…»); Gemini y Groq no tienen herramienta y la imitan con etiquetas */
export const sinHerramienta = (t: string) => t.replace(/Responde SIEMPRE y ÚNICAMENTE llamando a la herramienta registrar_factura[^.]*\./i, "").trim();

/** Petición a Groq (formato compatible con OpenAI): la imagen va en base64. No se usa su «modo JSON»: rechaza respuestas que no sean JSON perfecto; se extrae el JSON del texto */
export function cuerpoGroq(args: { modelo: string; tipo: string; datos: string; instrucciones: string; esquema: unknown }) {
  return {
    model: args.modelo,
    temperature: 0,
    max_tokens: 8192,
    messages: [
      { role: "system", content: `${sinHerramienta(args.instrucciones)}\nNo hay herramientas ni funciones: no uses etiquetas XML ni llamadas. Responde ÚNICAMENTE con un objeto JSON (sin texto antes ni después, sin bloques de código) que cumpla este esquema:\n${JSON.stringify(args.esquema)}` },
      { role: "user", content: [{ type: "image_url", image_url: { url: `data:${args.tipo};base64,${args.datos}` } }, { type: "text", text: "Lea esta factura de compra." }] },
    ],
  };
}

/** Cierre del objeto que abre en `desde` (respeta comillas y escapes); -1 si no cierra */
function cierreObjeto(t: string, desde: number): number {
  let nivel = 0, dentro = false;
  for (let i = desde; i < t.length; i++) {
    const c = t[i];
    if (dentro) { if (c === "\\") i++; else if (c === '"') dentro = false; continue; }
    if (c === '"') dentro = true;
    else if (c === "{") nivel++;
    else if (c === "}" && --nivel === 0) return i;
  }
  return -1;
}

/** Algunos modelos imitan una llamada a función: <parameter name="items">[…]</parameter>. Se arma el objeto con esos parámetros. */
function desdeParametros(t: string): string | null {
  if (!/<parameter\s+name="/i.test(t)) return null;
  const obj: Record<string, unknown> = {};
  for (const m of t.matchAll(/<parameter\s+name="([^"]+)"\s*>([\s\S]*?)(?=<\/parameter>|<parameter\s+name="|$)/gi)) {
    const v = m[2].trim().replace(/,(\s*[}\]])/g, "$1");
    try { obj[m[1]] = JSON.parse(v); } catch { obj[m[1]] = v; }
  }
  return Array.isArray(obj.items) ? JSON.stringify(obj) : null;
}

/**
 * Del texto que devolvió el modelo, se queda con el objeto JSON de la factura: quita <think>, bloques de código y texto alrededor,
 * y tolera comas sobrantes. Entre varios objetos posibles elige el primero que tenga «items».
 */
export function extraerJson(texto: string): string {
  const t = texto.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<think>[\s\S]*$/i, "").trim();
  const porParametros = desdeParametros(t);
  if (porParametros) return porParametros;
  let n = 0;
  for (let i = t.indexOf("{"); i >= 0 && n < 8; i = t.indexOf("{", i + 1), n++) {
    const f = cierreObjeto(t, i);
    if (f < 0) continue;
    const cand = t.slice(i, f + 1).replace(/,(\s*[}\]])/g, "$1");
    try { const o = JSON.parse(cand) as { items?: unknown }; if (Array.isArray(o.items)) return cand; } catch { /* siguiente */ }
  }
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  return a >= 0 && b > a ? t.slice(a, b + 1) : t;
}

/** Saca el JSON de la respuesta de Groq y aplica las mismas comprobaciones que con Gemini */
export function leerRespuestaGroq(d: unknown): Record<string, unknown> {
  const r = d as { choices?: { message?: { content?: string }; finish_reason?: string }[] };
  const texto = extraerJson(r.choices?.[0]?.message?.content ?? "");
  const adaptado = { candidates: [{ content: { parts: [{ text: texto }] }, finishReason: r.choices?.[0]?.finish_reason === "length" ? "MAX_TOKENS" : "STOP" }] };
  try { return leerRespuestaGemini(adaptado); }
  catch (e) {
    const m = (e as Error).message.replace(/Gemini/g, "Groq");
    // Para poder diagnosticar: se muestra el inicio de lo que respondió cuando no era JSON
    throw new Error(/no es JSON/.test(m) ? `${m} («${texto.replace(/\s+/g, " ").slice(0, 70)}…», ${texto.length} caracteres)` : m);
  }
}
