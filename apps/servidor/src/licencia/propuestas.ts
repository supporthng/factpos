import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { uuidv7 } from "@factpos/compartido";
import { pool, ErrorNegocio } from "../db.js";
import { documento } from "./sitio-web.js";
import { BASE_COMUN, PASOS, PROPUESTAS, propuestaPorId, propuestaPorSlug, type PropuestaTipo, type TarjetaProp } from "./propuestas-contenido.js";

/**
 * Propuestas del portal: el proveedor elige el tipo de sistema (FactPOS estándar o una edición), escribe a quién va dirigida
 * y manda por WhatsApp un enlace propio a una página con sus características y funciones. Queda registrado si la abrió
 * y si pidió hablar con ventas.
 */
const uuid = z.string().uuid();
const BOT = /whatsapp|facebookexternalhit|telegram|twitterbot|slackbot|bot\b|crawler|preview/i;

const telefono = (t: string) => {
  const d = t.replace(/\D/g, "");
  return d.length === 10 ? `1${d}` : d; // 10 dígitos = número dominicano
};
const baseUrl = (h: Record<string, unknown>) => {
  const host = String(h["x-forwarded-host"] ?? h.host ?? "").split(",")[0];
  return `${host.includes("localhost") ? "http" : "https"}://${host}`;
};
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const plantilla = (p: PropuestaTipo) => `Hola {nombre} 👋
Le saluda {contacto} de FactPOS. Le preparé una propuesta de ${p.nombre} ${p.para.charAt(0).toLowerCase()}${p.para.slice(1)}:
${p.viñetas.map((v) => `• ${v}`).join("\n")}

▶ Vea la propuesta completa, con todas sus funciones:
{link}

Si quiere, se la explico y le armo una prueba gratis de 15 días.`;

export async function rutasPropuestas(app: FastifyInstance) {
  const usuarioDe = (req: { headers: Record<string, unknown> }) => uuid.parse(req.headers["x-usuario-id"]);

  // ---------------------------------------------------------------- Administración (proveedor)
  app.get("/central/portal/propuestas", async (req) => {
    const c = (await pool.query<{ nombre: string | null }>("SELECT contacto_nombre AS nombre FROM portal_config WHERE id = 1")).rows[0];
    const lista = (await pool.query(
      `SELECT id, edicion, nombre, telefono, correo, nota, creada_en AS "creadaEn", enviada_en AS "enviadaEn", visitas,
              primera_visita AS "primeraVisita", ultima_visita AS "ultimaVisita", contactos, ultimo_contacto AS "ultimoContacto", mensaje
         FROM portal_propuestas ORDER BY creada_en DESC LIMIT 200`)).rows;
    const contacto = c?.nombre || "nuestro equipo";
    return {
      base: baseUrl(req.headers),
      tipos: PROPUESTAS.map((p) => ({ id: p.id, slug: p.slug, nombre: p.nombre, para: p.para, titulo: p.titulo, plantilla: plantilla(p).replace("{contacto}", contacto) })),
      lista,
    };
  });

  /** Crea la propuesta (su enlace propio) y devuelve el mensaje listo y el enlace de WhatsApp si hay número. */
  app.post("/central/portal/propuestas", async (req) => {
    const b = z.object({
      edicion: z.string().max(30),
      nombre: z.string().trim().min(2, "Escriba el nombre o el negocio").max(120),
      telefono: z.string().trim().max(20).nullable().optional(),
      correo: z.string().trim().email("Correo inválido").max(120).nullable().optional().or(z.literal("")),
      nota: z.string().trim().max(300).nullable().optional(),
      mensaje: z.string().trim().min(10).max(2000),
    }).parse(req.body);
    if (!propuestaPorId(b.edicion)) throw new ErrorNegocio("Tipo de propuesta no válido", 400);
    const tel = b.telefono ? telefono(b.telefono) : null;
    if (tel && (tel.length < 10 || tel.length > 15)) throw new ErrorNegocio("Número de WhatsApp inválido: escríbalo con código de país (ej. 18095551234)", 400);
    const id = uuidv7();
    const link = `${baseUrl(req.headers)}/propuesta?i=${id}`;
    const mensaje = b.mensaje.replaceAll("{nombre}", b.nombre).replaceAll("{link}", link) + (b.mensaje.includes("{link}") ? "" : `\n\n${link}`);
    await pool.query(
      "INSERT INTO portal_propuestas (id, edicion, nombre, telefono, correo, nota, mensaje, creada_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [id, b.edicion, b.nombre, tel, b.correo || null, b.nota ?? null, mensaje, usuarioDe(req)]);
    return { id, link, mensaje, whatsapp: tel ? `https://wa.me/${tel}?text=${encodeURIComponent(mensaje)}` : null };
  });

  app.post("/central/portal/propuestas/:id/enviada", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const r = await pool.query("UPDATE portal_propuestas SET enviada_en = now() WHERE id = $1 RETURNING id", [id]);
    if (!r.rows[0]) throw new ErrorNegocio("Propuesta no encontrada", 404);
    return { ok: true };
  });

  app.delete("/central/portal/propuestas/:id", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    await pool.query("DELETE FROM portal_propuestas WHERE id = $1", [id]);
    return { ok: true };
  });

  // ---------------------------------------------------------------- Públicas
  /** /propuesta?i=<enlace> (la del prospecto), /propuesta?e=<tipo> (vista previa, sin registrar) o /propuesta (índice de tipos). */
  app.get("/propuesta", async (req, rep) => {
    const q = z.object({ i: uuid.optional(), e: z.string().max(30).optional() }).safeParse(req.query);
    const i = q.success ? q.data.i : undefined;
    const e = q.success ? q.data.e : undefined;
    const c = (await pool.query<{ w: string | null }>("SELECT contacto_whatsapp AS w FROM portal_config WHERE id = 1").catch(() => ({ rows: [] }))).rows[0];
    let tipo: PropuestaTipo | undefined;
    let para: string | null = null;
    if (i) {
      const f = (await pool.query<{ edicion: string; nombre: string }>("SELECT edicion, nombre FROM portal_propuestas WHERE id = $1", [i])).rows[0];
      if (f) {
        tipo = propuestaPorId(f.edicion);
        para = f.nombre;
        if (!BOT.test(String(req.headers["user-agent"] ?? ""))) {
          await pool.query("UPDATE portal_propuestas SET visitas = visitas + 1, primera_visita = COALESCE(primera_visita, now()), ultima_visita = now() WHERE id = $1", [i]).catch(() => {});
        }
      }
    } else if (e) tipo = propuestaPorSlug(e);
    const base = baseUrl(req.headers);
    const html = tipo ? paginaPropuesta(tipo, para, i ?? null, !!c?.w) : paginaIndice();
    return rep.type("text/html; charset=utf-8").header("cache-control", "no-store").send(html.replaceAll("__BASE__", base));
  });

  /** «Hablar con nosotros»: cuenta el interés del prospecto y lo lleva al WhatsApp del proveedor. */
  app.get("/propuesta/contactar", async (req, rep) => {
    const q = z.object({ i: uuid.optional(), e: z.string().max(30).optional() }).safeParse(req.query);
    const i = q.success ? q.data.i : undefined;
    let nombrePropuesta = "FactPOS";
    if (i) {
      const f = (await pool.query<{ edicion: string; nombre: string }>(
        "UPDATE portal_propuestas SET contactos = contactos + 1, ultimo_contacto = now() WHERE id = $1 RETURNING edicion, nombre", [i]).catch(() => ({ rows: [] as { edicion: string; nombre: string }[] }))).rows[0];
      if (f) nombrePropuesta = propuestaPorId(f.edicion)?.nombre ?? nombrePropuesta;
      if (f) nombrePropuesta += ` (soy de ${f.nombre})`;
    } else if (q.success && q.data.e) nombrePropuesta = propuestaPorSlug(q.data.e)?.nombre ?? nombrePropuesta;
    const w = (await pool.query<{ w: string | null }>("SELECT contacto_whatsapp AS w FROM portal_config WHERE id = 1").catch(() => ({ rows: [] }))).rows[0]?.w;
    if (!w) return rep.code(404).type("text/plain; charset=utf-8").send("Escríbanos para más información.");
    return rep.redirect(`https://wa.me/${w.replace(/\D/g, "")}?text=${encodeURIComponent(`Hola, vi la propuesta de ${nombrePropuesta} y quiero más información`)}`);
  });
}

// ===================================================================================== Páginas
const tarjeta = (t: TarjetaProp) =>
  `<div class="tarj"><div class="ic">${t.i}</div><h3>${esc(t.t)}</h3><p>${esc(t.d)}</p>${t.l ? `<ul class="mini-l">${t.l.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}</div>`;

function paginaPropuesta(p: PropuestaTipo, para: string | null, id: string | null, hayWhatsapp: boolean): string {
  const q = id ? `?i=${id}` : `?e=${p.slug}`;
  const contactar = hayWhatsapp ? `<a class="btn p" href="/propuesta/contactar${q}">Hablar con nosotros</a>` : "";
  const areas = p.areas.map((a, n) =>
    `<section class="area" id="a${n}"><div class="cont"><div class="tit"><small>${esc(a.nombre)}</small><h2>${esc(a.titulo)}</h2><p>${esc(a.intro)}</p></div><div class="rejilla">${a.tarjetas.map(tarjeta).join("")}</div></div></section>`).join("\n");
  const cuerpo = `
<div class="ph"><div class="cont">
  <span class="etq"><i></i>${para ? `Propuesta para ${esc(para)}` : `Propuesta · ${esc(p.nombre)}`}</span>
  <h1>${esc(p.titulo)}</h1>
  <p>${esc(p.resumen)}</p>
  <p style="font-size:15px;margin-bottom:22px"><b>${esc(p.nombre)}</b> · ${esc(p.para)}</p>
  <div class="acc">${contactar}<a class="btn s" href="#incluye">Qué incluye</a><a class="btn s" href="#empezar">Cómo empezamos</a></div>
</div></div>
<section><div class="cont"><div class="tit"><small>Para su negocio</small><h2>Problemas del día a día que resuelve</h2></div>
  <div class="rejilla">${p.retos.map((r) => `<div class="tarj"><h3>${esc(r.t)}</h3><p>${esc(r.d)}</p></div>`).join("")}</div></div></section>
<div class="indice"><div class="cont">${p.areas.map((a, n) => `<a href="#a${n}">${esc(a.nombre)}</a>`).join("")}<a href="#incluye">Incluido en todo FactPOS</a></div></div>
${areas}
<section class="area" id="incluye"><div class="cont"><div class="tit"><small>Incluido en todo FactPOS</small><h2>Lo que trae cualquier edición</h2><p>La base común del sistema, sin costo aparte.</p></div>
  <div class="rejilla">${BASE_COMUN.map(tarjeta).join("")}</div></div></section>
<section id="empezar"><div class="cont"><div class="tit"><small>Cómo empezamos</small><h2>De la propuesta a vender en su negocio</h2></div>
  <div class="pasos" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr))">${PASOS.map((x) => `<div class="paso"><h3>${esc(x.t)}</h3><p>${esc(x.d)}</p></div>`).join("")}</div></div></section>
<section><div class="cont"><div class="cta">
  <h2>¿Lo vemos funcionando en su negocio?</h2>
  <p>Pruébelo 15 días gratis, sin pagar y sin tarjeta. Si le gusta, activamos su licencia y sigue con todo ya cargado.</p>
  <div class="acc">${contactar}<a class="btn s" href="/#descargar">Descargar y probar 15 días</a><a class="btn s" href="/demo">Ver la demo</a></div>
</div></div></section>`;
  return documento({
    ruta: "/propuesta", activa: "", titulo: `${p.nombre} · Propuesta`, descripcion: esc(p.resumen), cuerpo,
    extraHead: '<meta name="robots" content="noindex,nofollow">\n',
  });
}

function paginaIndice(): string {
  const cuerpo = `
<div class="ph"><div class="cont">
  <span class="etq"><i></i>Propuestas FactPOS</span>
  <h1>Un FactPOS para cada tipo de negocio</h1>
  <p>Elija el que se parece al suyo para ver sus características y funciones.</p>
</div></div>
<section><div class="cont"><div class="rejilla">${PROPUESTAS.map((p) =>
    `<a class="tarj" href="/propuesta?e=${p.slug}" style="text-decoration:none;color:inherit"><h3>${esc(p.nombre)}</h3><p>${esc(p.para)}</p><p style="margin-top:8px">${esc(p.resumen)}</p></a>`).join("")}</div></div></section>`;
  return documento({
    ruta: "/propuesta", activa: "", titulo: "Propuestas · FactPOS", descripcion: "Propuestas de FactPOS por tipo de negocio.", cuerpo,
    extraHead: '<meta name="robots" content="noindex,nofollow">\n',
  });
}
