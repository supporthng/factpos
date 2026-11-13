/**
 * Modo claro/oscuro de la Administración (por equipo).
 *  - sistema: sigue el ajuste del teléfono o del equipo.
 *  - horario: oscuro entre la hora de inicio y la de fin (por defecto 7:00 pm a 6:00 am), claro el resto del día.
 *  - claro / oscuro: fijo.
 * En celulares, sin haber elegido nada, el modo es «horario».
 */
const CLAVE = "factpos.admin.modo-tema";
export type ModoTema = "sistema" | "horario" | "claro" | "oscuro";
export interface AjusteTema { modo: ModoTema; desde: string; hasta: string }
export const MODOS_TEMA: Record<ModoTema, string> = { sistema: "Como el equipo", horario: "Por horario", claro: "Claro", oscuro: "Oscuro" };

const esCelular = () => { try { return window.matchMedia("(pointer: coarse)").matches; } catch { return false; } };

export function leerAjusteTema(): AjusteTema {
  const base: AjusteTema = { modo: esCelular() ? "horario" : "sistema", desde: "19:00", hasta: "06:00" };
  try {
    const v = JSON.parse(localStorage.getItem(CLAVE) || "null") as Partial<AjusteTema> | null;
    if (!v) return base;
    return {
      modo: v.modo && v.modo in MODOS_TEMA ? v.modo : base.modo,
      desde: /^\d{2}:\d{2}$/.test(v.desde ?? "") ? v.desde! : base.desde,
      hasta: /^\d{2}:\d{2}$/.test(v.hasta ?? "") ? v.hasta! : base.hasta,
    };
  } catch { return base; }
}

const minutos = (hm: string) => { const [h, m] = hm.split(":").map(Number); return h * 60 + m; };

/** ¿Es de noche según el horario? Funciona también cuando el rango cruza la medianoche (19:00 → 06:00). */
export function esNoche(desde: string, hasta: string, ahora = new Date()): boolean {
  const t = ahora.getHours() * 60 + ahora.getMinutes();
  const a = minutos(desde), b = minutos(hasta);
  if (a === b) return false;
  return a < b ? t >= a && t < b : t >= a || t < b;
}

export function aplicarModoTema() {
  const { modo, desde, hasta } = leerAjusteTema();
  const raiz = document.documentElement;
  const oscuro = modo === "oscuro" || (modo === "horario" && esNoche(desde, hasta));
  const claro = modo === "claro" || (modo === "horario" && !oscuro);
  if (oscuro) raiz.setAttribute("data-theme", "dark");
  else if (claro) raiz.setAttribute("data-theme", "light");
  else raiz.removeAttribute("data-theme");
}

export function guardarAjusteTema(a: AjusteTema) {
  try { localStorage.setItem(CLAVE, JSON.stringify(a)); } catch { /* sin almacenamiento */ }
  aplicarModoTema();
}

/** Aplica el modo al abrir y lo revisa cada minuto (y al volver a la app) para que el cambio de horario ocurra solo. */
export function iniciarModoTema() {
  aplicarModoTema();
  setInterval(aplicarModoTema, 60_000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) aplicarModoTema(); });
}
