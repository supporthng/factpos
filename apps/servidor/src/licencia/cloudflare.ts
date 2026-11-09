/**
 * Túneles FIJOS de Cloudflare para los servidores master de los clientes
 * (solo en el PORTAL). Con la API de Cloudflare se crea, para cada empresa:
 *   1. un túnel con nombre (factpos-<empresa>), configurado desde Cloudflare;
 *   2. su regla: <empresa>.factpos.app → http://localhost:<puerto del master>;
 *   3. el registro DNS <empresa> → <id del túnel>.cfargotunnel.com (con proxy).
 * El master recibe el token del túnel y corre `cloudflared tunnel run --token …`.
 *
 * Variables del portal (Vercel):
 *   CLOUDFLARE_API_TOKEN   permisos: Account › Cloudflare Tunnel › Edit y Zone › DNS › Edit
 *   CLOUDFLARE_ACCOUNT_ID  y  CLOUDFLARE_ZONE_ID (de factpos.app)
 *   FACTPOS_DOMINIO        factpos.app (predeterminado)
 */
const API = process.env.CLOUDFLARE_API_BASE || "https://api.cloudflare.com/client/v4"; // la base se cambia solo en pruebas

export const cloudflareListo = () => !!(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_ZONE_ID);
export const dominioClientes = () => (process.env.FACTPOS_DOMINIO || "factpos.app").toLowerCase();

/** El token se pega a veces dos veces o con saltos de línea: se usa solo la primera palabra */
const tokenCf = () => {
  // Se pega a veces con el nombre de la variable («CLOUDFLARE_API_TOKEN=…»), con comillas, con «Bearer » o dos veces:
  // el token es la primera cadena larga de letras, números, guiones y guiones bajos (los nombres de variable miden menos de 30)
  const crudo = process.env.CLOUDFLARE_API_TOKEN ?? "";
  return crudo.match(/[A-Za-z0-9_-]{30,}/)?.[0] ?? crudo.trim().split(/\s+/)[0] ?? "";
};
/** Para el mensaje de error: largo y forma del token, nunca el token (solo un prefijo tipo «cfat_» si lo tiene). */
const resumenToken = () => { const t = tokenCf(); return `${t.length} caracteres${/^[a-z]{3,5}_/.test(t) ? `, empieza con «${t.split("_")[0]}_»` : ""}`; };

async function cf<T>(metodo: string, ruta: string, cuerpo?: unknown): Promise<T> {
  const r = await fetch(`${API}${ruta}`, {
    method: metodo,
    headers: { authorization: `Bearer ${tokenCf()}`, "content-type": "application/json" },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(20_000),
  });
  const d = (await r.json().catch(() => ({}))) as { success?: boolean; result?: T; errors?: { message: string }[] };
  if (!r.ok || d.success === false) {
    const motivo = d.errors?.map((e) => `${e.message}${(e as { code?: number }).code ? ` [${(e as { code?: number }).code}]` : ""}`).join("; ") || `HTTP ${r.status}`;
    // Un token mal pegado, vencido o sin permisos se reconoce aquí (sin mostrar el token)
    const pista = r.status === 400 || r.status === 401 || r.status === 403 ? ` · revise CLOUDFLARE_API_TOKEN en Vercel (el token tiene ${resumenToken()}; pegue solo el valor del token, sin el nombre de la variable, sin «Bearer» ni comillas) y que tenga permisos de Cloudflare Tunnel: Edit y DNS: Edit` : "";
    throw new Error(`Cloudflare: ${motivo} (${metodo} ${ruta.replace(/[0-9a-f]{32}/g, "…")}, status ${r.status})${pista}`);
  }
  return d.result as T;
}

/** Crea (o reutiliza) el túnel fijo de una empresa y devuelve su token y dirección. */
export async function asegurarTunel(slug: string, tunelId: string | null, puerto: number) {
  const cuenta = process.env.CLOUDFLARE_ACCOUNT_ID!, zona = process.env.CLOUDFLARE_ZONE_ID!;
  const host = `${slug}.${dominioClientes()}`;
  let id = tunelId;
  if (id) {
    // ¿Sigue existiendo? (si lo borraron a mano, se crea otro)
    try { await cf("GET", `/accounts/${cuenta}/cfd_tunnel/${id}`); } catch { id = null; }
  }
  if (!id) {
    const existentes = await cf<{ id: string; name: string; deleted_at: string | null }[]>("GET", `/accounts/${cuenta}/cfd_tunnel?name=factpos-${slug}&is_deleted=false`);
    id = existentes[0]?.id ?? (await cf<{ id: string }>("POST", `/accounts/${cuenta}/cfd_tunnel`, { name: `factpos-${slug}`, config_src: "cloudflare" })).id;
  }
  await cf("PUT", `/accounts/${cuenta}/cfd_tunnel/${id}/configurations`, {
    config: { ingress: [{ hostname: host, service: `http://localhost:${puerto}` }, { service: "http_status:404" }] },
  });
  const destino = `${id}.cfargotunnel.com`;
  const dns = await cf<{ id: string; content: string }[]>("GET", `/zones/${zona}/dns_records?type=CNAME&name=${encodeURIComponent(host)}`);
  const registro = { type: "CNAME", name: host, content: destino, proxied: true, comment: `FactPOS · servidor principal de ${slug}` };
  if (!dns[0]) await cf("POST", `/zones/${zona}/dns_records`, registro);
  else if (dns[0].content !== destino) await cf("PUT", `/zones/${zona}/dns_records/${dns[0].id}`, registro);
  const token = await cf<string>("GET", `/accounts/${cuenta}/cfd_tunnel/${id}/token`);
  return { id, host, url: `https://${host}`, token };
}
