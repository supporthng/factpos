import type { FastifyInstance, FastifyRequest } from "fastify";

/**
 * Dirección real de quien llama. Detrás de Vercel/Cloudflare `req.ip` suele ser la del proxy (la misma para todos),
 * así que los límites por dirección usan las cabeceras que esas plataformas ponen.
 */
export function ipCliente(req: Pick<FastifyRequest, "headers" | "ip">): string {
  const h = req.headers;
  const una = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.split(",")[0]?.trim();
  return una(h["cf-connecting-ip"]) || una(h["x-vercel-forwarded-for"]) || una(h["x-real-ip"]) || una(h["x-forwarded-for"]) || req.ip || "?";
}

/** Contador por ventana de tiempo (en memoria; suficiente para frenar abuso desde una misma dirección). */
export function crearLimitador(max: number, ventanaMs: number) {
  const m = new Map<string, { n: number; desde: number }>();
  let ultimaLimpieza = Date.now();
  return (clave: string, ahora = Date.now()): boolean => {
    if (ahora - ultimaLimpieza > ventanaMs) {
      for (const [k, v] of m) if (ahora - v.desde > ventanaMs) m.delete(k);
      ultimaLimpieza = ahora;
    }
    const x = m.get(clave);
    if (!x || ahora - x.desde > ventanaMs) { m.set(clave, { n: 1, desde: ahora }); return true; }
    return ++x.n <= max;
  };
}

/** Rutas públicas (sin sesión) que se frenan con más fuerza: alguien podría usarlas para llenar la base o adivinar claves. */
const RUTAS_ESTRICTAS = /^\/(licencias\/(activar|renovar|solicitar|prospecto|traslado\/)|central\/entrar|cajas\/[^/]+\/entrar)/;

/**
 * Cabeceras de seguridad en todas las respuestas y límite de peticiones por dirección.
 * El límite solo corre donde llega internet (portal en la nube o servidor con túnel): en la red local de un negocio
 * muchas cajas comparten dirección y no se frenan.
 */
export function protegerWeb(app: FastifyInstance, opciones: { limitar: () => boolean }) {
  const general = crearLimitador(600, 60_000); // 600 por minuto
  const estricto = crearLimitador(30, 60_000); // 30 por minuto en rutas sensibles

  app.addHook("onRequest", async (req, rep) => {
    if (!opciones.limitar() || req.method === "OPTIONS") return;
    const ip = ipCliente(req);
    const ruta = req.url.split("?")[0];
    const ok = (req.method === "POST" && RUTAS_ESTRICTAS.test(ruta) ? estricto(`e:${ip}`) : true) && general(`g:${ip}`);
    if (!ok) return rep.code(429).header("retry-after", "60").send({ error: "Demasiadas solicitudes. Espere un minuto e intente de nuevo." });
  });

  app.addHook("onSend", async (req, rep, payload) => {
    rep.header("x-content-type-options", "nosniff");
    rep.header("x-frame-options", "SAMEORIGIN");
    rep.header("referrer-policy", "strict-origin-when-cross-origin");
    rep.header("permissions-policy", "camera=(self), microphone=(), geolocation=()");
    if (String(req.headers["x-forwarded-proto"] ?? "").split(",")[0] === "https") {
      rep.header("strict-transport-security", "max-age=31536000");
    }
    return payload;
  });
}
