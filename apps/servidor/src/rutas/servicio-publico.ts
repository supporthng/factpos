import type { FastifyInstance } from "fastify";
import { pool, enTransaccion, ErrorNegocio } from "../db.js";
import { ipCliente } from "../tunel.js";
import { aplicarDecision, huellaEnlace } from "./central-servicio.js";

/**
 * Página pública (sin iniciar sesión) para que el cliente apruebe o rechace la cotización de su reparación desde el celular.
 * El enlace trae un código largo al azar (solo se guarda su huella), vale 7 días y se anula al responder o al cotizar de nuevo.
 *   GET  /aprobar/:codigo   muestra la cotización
 *   POST /aprobar/:codigo   registra la respuesta (nombre de quien responde + aprobar o rechazar)
 * No muestra precios de otras órdenes ni datos del cliente más allá de su propio equipo. Con freno por dirección contra intentos.
 */
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const dinero = (v: string | number) => new Intl.NumberFormat("es-DO", { style: "currency", currency: "DOP" }).format(Number(v));
const fecha = (iso: string) => new Date(iso).toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", day: "2-digit", month: "long", year: "numeric", hour: "numeric", minute: "2-digit" });
const CODIGO = /^[A-Za-z0-9_-]{20,64}$/;

const intentos = new Map<string, { n: number; desde: number }>();
function frenar(ip: string) {
  const ahora = Date.now(), x = intentos.get(ip);
  if (!x || ahora - x.desde > 10 * 60_000) { intentos.set(ip, { n: 1, desde: ahora }); return; }
  if (++x.n > 40) throw new ErrorNegocio("Demasiados intentos. Espere unos minutos e intente de nuevo.", 429);
}

const pagina = (titulo: string, cuerpo: string) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${esc(titulo)}</title><style>
*{box-sizing:border-box}body{margin:0;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f3f5f8;color:#0e1b26}
main{max-width:520px;margin:0 auto;padding:20px 16px 40px}.tarjeta{background:#fff;border-radius:16px;padding:20px;box-shadow:0 2px 12px rgba(14,27,38,.08);margin-bottom:14px}
h1{font-size:20px;margin:0 0 4px}.suave{color:#5b6b7a;font-size:14px}table{width:100%;border-collapse:collapse;margin:8px 0}td{padding:6px 0}td:last-child{text-align:right}
.total td{border-top:2px solid #0e1b26;font-weight:700;font-size:18px;padding-top:10px}label{display:block;font-weight:600;margin:14px 0 6px}
input[type=text]{width:100%;padding:12px;border:1px solid #c7d0da;border-radius:10px;font:inherit}
.botones{display:grid;gap:10px;margin-top:16px}button{padding:14px;border:0;border-radius:12px;font:600 17px system-ui;cursor:pointer}
.ok{background:#16803c;color:#fff}.no{background:#fff;color:#a12626;border:1px solid #d9a4a4}.aviso{background:#fff7e6;border:1px solid #f1d28a;border-radius:10px;padding:10px 12px;font-size:14px;margin-top:12px}
.estado{font-weight:700}</style></head><body><main>${cuerpo}</main></body></html>`;

export async function rutasServicioPublico(app: FastifyInstance) {
  await app.register(async (i) => {
    // El formulario llega como application/x-www-form-urlencoded
    i.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string", bodyLimit: 4096 }, (_req, cuerpo, hecho) => {
      try { hecho(null, Object.fromEntries(new URLSearchParams(String(cuerpo)))); } catch (e) { hecho(e as Error); }
    });
    i.addHook("onSend", async (_req, rep) => {
      rep.header("Cache-Control", "no-store").header("Referrer-Policy", "no-referrer").header("X-Robots-Tag", "noindex")
        .header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
    });
    const html = (rep: { code: (n: number) => { type: (t: string) => { send: (b: string) => unknown } } }, n: number, titulo: string, cuerpo: string) => rep.code(n).type("text/html; charset=utf-8").send(pagina(titulo, cuerpo));

    const cargar = async (codigo: string) => (await pool.query<{
      id: string; estado: string; aprobacion: string | null; descripcion: string; marca: string | null; modelo: string | null; falla: string; diagnostico: string | null;
      mano: string | null; piezas: string | null; nota: string | null; cotiz_en: string | null; aprobacion_en: string | null; aprobacion_por: string | null;
      vigente: boolean; cliente: string | null; empresa: string | null; codigo: string; telefono: string | null; revision: string | null; cobrar: boolean | null;
    }>(
      `SELECT t.id, t.estado, t.aprobacion, t.descripcion, t.marca, t.modelo, t.falla, t.diagnostico, t.cotiz_mano_obra::text AS mano, t.cotiz_piezas::text AS piezas,
              t.cotiz_nota AS nota, t.cotiz_en AS cotiz_en, t.aprobacion_en, t.aprobacion_por, (t.enlace_vence IS NOT NULL AND t.enlace_vence > now()) AS vigente,
              cl.nombre AS cliente, e.nombre_comercial AS empresa, 'SRV-' || s.codigo || '-' || lpad(t.numero::text, 6, '0') AS codigo, s.telefono,
              sc.monto_revision::text AS revision, sc.cobrar_revision AS cobrar
         FROM servicios_tecnicos t JOIN sucursales s ON s.id = t.sucursal_id JOIN empresas e ON e.id = s.empresa_id
         LEFT JOIN clientes cl ON cl.id = t.cliente_id LEFT JOIN servicio_config sc ON sc.empresa_id = e.id
        WHERE t.enlace_hash = $1`, [huellaEnlace(codigo)])).rows[0];

    const nodisponible = (rep: Parameters<typeof html>[0]) => html(rep, 404, "Enlace no disponible",
      `<div class="tarjeta"><h1>Enlace no disponible</h1><p>Este enlace no existe, ya se usó o venció. Comuníquese con la tienda para que le envíen uno nuevo.</p></div>`);

    i.get("/aprobar/:codigo", async (req, rep) => {
      frenar(ipCliente(req));
      const { codigo } = req.params as { codigo: string };
      if (!CODIGO.test(codigo)) return nodisponible(rep);
      const o = await cargar(codigo);
      if (!o || !o.vigente || o.aprobacion !== "PENDIENTE" || o.estado !== "COTIZADO") return nodisponible(rep);
      const total = Number(o.mano ?? 0) + Number(o.piezas ?? 0);
      const revision = o.cobrar && Number(o.revision) > 0 ? Number(o.revision) : 0;
      return html(rep, 200, `Cotización ${o.codigo}`, `
        <div class="tarjeta"><div class="suave">${esc(o.empresa ?? "")}</div><h1>Cotización de reparación</h1><div class="suave">Orden ${esc(o.codigo)} · ${esc(fecha(o.cotiz_en ?? new Date().toISOString()))}</div></div>
        <div class="tarjeta"><b>${esc(o.descripcion)}</b>${o.marca || o.modelo ? `<div class="suave">${esc([o.marca, o.modelo].filter(Boolean).join(" "))}</div>` : ""}
          <p style="margin:10px 0 0"><span class="suave">Falla reportada:</span><br>${esc(o.falla)}</p>
          ${o.diagnostico ? `<p style="margin:10px 0 0"><span class="suave">Diagnóstico del técnico:</span><br>${esc(o.diagnostico)}</p>` : ""}</div>
        <div class="tarjeta"><table><tr><td>Mano de obra</td><td>${dinero(o.mano ?? 0)}</td></tr><tr><td>Piezas</td><td>${dinero(o.piezas ?? 0)}</td></tr>
          <tr class="total"><td>Total</td><td>${dinero(total)}</td></tr></table>${o.nota ? `<p class="suave" style="margin:6px 0 0">${esc(o.nota)}</p>` : ""}</div>
        <form class="tarjeta" method="post" action="/aprobar/${esc(codigo)}">
          <label for="por">Su nombre (quien responde)</label><input id="por" name="por" type="text" required minlength="2" maxlength="80" value="${esc(o.cliente ?? "")}" autocomplete="name">
          <div class="botones"><button class="ok" name="decision" value="APROBADA" type="submit">Aprobar la reparación</button>
            <button class="no" name="decision" value="RECHAZADA" type="submit">No deseo la reparación</button></div>
          ${revision > 0 ? `<div class="aviso">Si no desea la reparación, se cobrará ${esc(dinero(revision))} por la revisión del equipo.</div>` : ""}
        </form>
        <p class="suave" style="text-align:center">Al responder, la tienda recibe su decisión de inmediato.</p>`);
    });

    i.post("/aprobar/:codigo", async (req, rep) => {
      frenar(ipCliente(req));
      const { codigo } = req.params as { codigo: string };
      if (!CODIGO.test(codigo)) return nodisponible(rep);
      const b = (req.body ?? {}) as { por?: string; decision?: string };
      const por = String(b.por ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
      if (b.decision !== "APROBADA" && b.decision !== "RECHAZADA") return nodisponible(rep);
      if (por.length < 2) return html(rep, 400, "Falta su nombre", `<div class="tarjeta"><h1>Falta su nombre</h1><p>Escriba su nombre para poder registrar su respuesta. Regrese e inténtelo de nuevo.</p></div>`);
      const o = await cargar(codigo);
      if (!o || !o.vigente) return nodisponible(rep);
      try {
        const empresaId = (await pool.query<{ empresa_id: string }>("SELECT s.empresa_id FROM servicios_tecnicos t JOIN sucursales s ON s.id = t.sucursal_id WHERE t.id = $1", [o.id])).rows[0].empresa_id;
        const r = await enTransaccion((c) => aplicarDecision(c, { id: o.id, empresaId, resultado: b.decision as "APROBADA" | "RECHAZADA", por, medio: "ENLACE", usuarioId: null, ip: ipCliente(req) }));
        return html(rep, 200, "Respuesta registrada", b.decision === "APROBADA"
          ? `<div class="tarjeta"><h1>¡Listo, ${esc(por.split(" ")[0])}!</h1><p>Aprobó la reparación de su <b>${esc(o.descripcion)}</b>. La tienda empieza a trabajar en ella y le avisará cuando esté lista.</p><p class="suave">Orden ${esc(o.codigo)}</p></div>`
          : `<div class="tarjeta"><h1>Respuesta registrada</h1><p>Anotamos que no desea la reparación de su <b>${esc(o.descripcion)}</b>.${r.revision > 0 ? ` Se cobrará ${esc(dinero(r.revision))} por la revisión.` : ""} Puede pasar a recoger su equipo.</p><p class="suave">Orden ${esc(o.codigo)}</p></div>`);
      } catch (e) {
        if (e instanceof ErrorNegocio && e.estado === 409) return nodisponible(rep);
        throw e;
      }
    });
  });
}
