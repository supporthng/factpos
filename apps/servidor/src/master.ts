import { activarLicencia, filaLicencia, PORTAL_URL } from "./licencia/cliente.js";
import { estadoTunel, iniciarTunel, reportarTunel, tunelActivo } from "./tunel.js";
import { guardarEnEnv } from "./sync/alta.js";

/**
 * Arranque del servidor MASTER de un negocio (MODO=central instalado en su
 * oficina o tienda principal, no en Vercel):
 *  1. Abre el túnel de Cloudflare (TUNEL=cloudflare) y le avisa al portal su
 *     dirección cada vez que cambia (y cada 30 min, por si el portal no la tenía).
 *  2. Si el instalador dejó LICENCIA_CLAVE, activa la licencia sola (y la borra
 *     del .env al lograrlo). Sin internet, lo reintenta cada 5 minutos.
 */
export async function iniciarMaster(log: (m: string) => void) {
  if (process.env.VERCEL) return;

  const clave = (process.env.LICENCIA_CLAVE ?? "").trim();
  if (clave) {
    const intentar = async () => {
      const f = await filaLicencia();
      if (f.token) { guardarEnEnv({ LICENCIA_CLAVE: "" }); return; }
      try {
        const r = await activarLicencia(clave);
        guardarEnEnv({ LICENCIA_CLAVE: "" });
        log(`Licencia activada: ${r.datos?.cliente.nombre} (${r.datos?.sucursales} sucursales, vence ${r.datos?.vence})`);
      } catch (e) {
        log(`Licencia: no se pudo activar todavía (${(e as Error).message}); se reintenta en 5 minutos`);
        // Clave equivocada o ya usada en otra instalación: no se insiste
        if (!/no válida|otra instalación|suspendida/i.test((e as Error).message)) setTimeout(intentar, 5 * 60_000).unref();
      }
    };
    // Se espera un poco a que el túnel tenga dirección (así el portal la recibe al activar)
    setTimeout(intentar, tunelActivo() ? 20_000 : 2_000).unref();
  }

  if (tunelActivo()) {
    iniciarTunel(log, () => { reportarTunel(PORTAL_URL(), log).catch(() => {}); });
    setInterval(() => { if (estadoTunel().url) reportarTunel(PORTAL_URL(), log).catch(() => {}); }, 30 * 60_000).unref();
  }
}
