import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { z } from "zod";
import { ErrorNegocio } from "../db.js";

/**
 * Videos promocionales (solo portal): la voz de cada escena se genera con IA (ElevenLabs).
 *  - ELEVENLABS_API_KEY: la clave de la cuenta del proveedor. Se pone SOLO en las variables del servidor (Vercel), nunca en el código ni en el chat.
 *  - ELEVENLABS_VOZ_ID: la voz por defecto (el «voice_id» que se ve en la cuenta de ElevenLabs).
 *  - ELEVENLABS_MODELO: opcional; por defecto eleven_multilingual_v2.
 * Una misma frase con la misma voz se guarda un rato en memoria para no gastar crédito si se pide otra vez.
 */
const MODELO = () => process.env.ELEVENLABS_MODELO?.trim() || "eleven_multilingual_v2";
const cache = new Map<string, string>();
const MAX_CACHE = 60;

const Cuerpo = z.object({
  texto: z.string().trim().min(2).max(700),
  vozId: z.string().trim().regex(/^[A-Za-z0-9]{8,40}$/).optional(),
});

export async function rutasPortalVideos(app: FastifyInstance) {
  app.get("/central/portal/videos/estado", async () => ({
    configurado: !!process.env.ELEVENLABS_API_KEY?.trim(),
    vozPorDefecto: process.env.ELEVENLABS_VOZ_ID?.trim() || null,
    modelo: MODELO(),
  }));

  /** Devuelve el audio mp3 de la frase en base64 (el navegador lo reproduce y lo puede descargar). */
  app.post("/central/portal/videos/voz", async (req) => {
    const clave = process.env.ELEVENLABS_API_KEY?.trim();
    if (!clave) throw new ErrorNegocio("Falta configurar ELEVENLABS_API_KEY en las variables del servidor del portal.");
    const b = Cuerpo.parse(req.body);
    const voz = b.vozId || process.env.ELEVENLABS_VOZ_ID?.trim();
    if (!voz) throw new ErrorNegocio("Falta la voz: ponga ELEVENLABS_VOZ_ID en el servidor o escriba el identificador de la voz.");
    const huella = createHash("sha256").update(`${voz}|${MODELO()}|${b.texto}`).digest("hex");
    const hecho = cache.get(huella);
    if (hecho) return { audio: hecho, formato: "mp3", reutilizado: true };
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voz}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "content-type": "application/json", "xi-api-key": clave },
      body: JSON.stringify({ text: b.texto, model_id: MODELO(), language_code: "es" }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!r.ok) {
      const detalle = (await r.text().catch(() => "")).slice(0, 200);
      throw new ErrorNegocio(r.status === 401 ? "ElevenLabs rechazó la clave (revise ELEVENLABS_API_KEY)." : `ElevenLabs respondió ${r.status}. ${detalle}`);
    }
    const audio = Buffer.from(await r.arrayBuffer()).toString("base64");
    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value as string);
    cache.set(huella, audio);
    return { audio, formato: "mp3", reutilizado: false };
  });
}
