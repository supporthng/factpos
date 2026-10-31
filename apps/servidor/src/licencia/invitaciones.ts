import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { uuidv7 } from "@factpos/compartido";
import { pool, ErrorNegocio } from "../db.js";
import { ultimaVersion, urlDescarga } from "./portal.js";

/**
 * Invitaciones del portal: el proveedor manda por WhatsApp un mensaje para conocer FactPOS.
 * El enlace de cada invitación abre una página pública (recorrido interactivo + descarga)
 * y deja registrado si la persona la abrió y si descargó el instalador.
 */
const uuid = z.string().uuid();
const BOT = /whatsapp|facebookexternalhit|telegram|twitterbot|slackbot|bot\b|crawler|preview/i;

const PLANTILLA = `Hola {nombre} 👋
Le saluda {contacto} de FactPOS. Lo invito a conocer FactPOS, el sistema de punto de venta e inventario para su negocio:
• Ventas rápidas en caja, con ITBIS y facturación electrónica
• Inventario por sucursal, con kardex y alertas de reposición
• 3 niveles de precio y control de ganancia
• Varias sucursales conectadas; la caja sigue vendiendo aunque falle el internet
• Reportes y acceso a su administración desde cualquier lugar

▶ Vea el recorrido interactivo y descargue la prueba gratis de 15 días:
{link}

Cualquier duda me escribe por aquí.`;

const telefono = (t: string) => {
  const d = t.replace(/\D/g, "");
  return d.length === 10 ? `1${d}` : d; // 10 dígitos = número dominicano (1 + 809/829/849)
};
const baseUrl = (h: Record<string, unknown>) => {
  const host = String(h["x-forwarded-host"] ?? h.host ?? "").split(",")[0];
  return `${host.includes("localhost") ? "http" : "https"}://${host}`;
};

export async function rutasInvitaciones(app: FastifyInstance) {
  const usuarioDe = (req: { headers: Record<string, unknown> }) => uuid.parse(req.headers["x-usuario-id"]);

  // ---------------------------------------------------------------- Administración (proveedor)
  app.get("/central/portal/invitaciones", async (req) => {
    const c = (await pool.query<{ nombre: string | null }>("SELECT contacto_nombre AS nombre FROM portal_config WHERE id = 1")).rows[0];
    const lista = (await pool.query(
      `SELECT id, nombre, telefono, nota, creada_en AS "creadaEn", enviada_en AS "enviadaEn", visitas, primera_visita AS "primeraVisita",
              ultima_visita AS "ultimaVisita", descargas, ultima_descarga AS "ultimaDescarga", mensaje
         FROM portal_invitaciones ORDER BY creada_en DESC LIMIT 200`)).rows;
    return { plantilla: PLANTILLA.replace("{contacto}", c?.nombre || "nuestro equipo"), base: baseUrl(req.headers), lista };
  });

  /** Crea la invitación (su enlace propio) y devuelve el mensaje listo y el enlace de WhatsApp. */
  app.post("/central/portal/invitaciones", async (req) => {
    const b = z.object({
      nombre: z.string().trim().min(2, "Escriba el nombre").max(120),
      telefono: z.string().trim().min(7, "Escriba el número de WhatsApp").max(20),
      nota: z.string().trim().max(300).nullable().optional(),
      mensaje: z.string().trim().min(10).max(2000),
    }).parse(req.body);
    const tel = telefono(b.telefono);
    if (tel.length < 10 || tel.length > 15) throw new ErrorNegocio("Número de WhatsApp inválido: escríbalo con código de país (ej. 18095551234)", 400);
    const id = uuidv7();
    const link = `${baseUrl(req.headers)}/invitacion?i=${id}`;
    const mensaje = b.mensaje.replaceAll("{nombre}", b.nombre).replaceAll("{link}", link) + (b.mensaje.includes("{link}") ? "" : `\n\n${link}`);
    await pool.query("INSERT INTO portal_invitaciones (id, nombre, telefono, nota, mensaje, creada_por) VALUES ($1,$2,$3,$4,$5,$6)",
      [id, b.nombre, tel, b.nota ?? null, mensaje, usuarioDe(req)]);
    return { id, link, mensaje, whatsapp: `https://wa.me/${tel}?text=${encodeURIComponent(mensaje)}` };
  });

  app.post("/central/portal/invitaciones/:id/enviada", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const r = await pool.query("UPDATE portal_invitaciones SET enviada_en = now() WHERE id = $1 RETURNING id", [id]);
    if (!r.rows[0]) throw new ErrorNegocio("Invitación no encontrada", 404);
    return { ok: true };
  });

  app.delete("/central/portal/invitaciones/:id", async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    await pool.query("DELETE FROM portal_invitaciones WHERE id = $1", [id]);
    return { ok: true };
  });

  // ---------------------------------------------------------------- Públicas
  app.get("/invitacion", async (req, rep) => {
    const q = z.object({ i: uuid.optional() }).safeParse(req.query);
    const id = q.success ? q.data.i : undefined;
    if (id && !BOT.test(String(req.headers["user-agent"] ?? ""))) {
      await pool.query("UPDATE portal_invitaciones SET visitas = visitas + 1, primera_visita = COALESCE(primera_visita, now()), ultima_visita = now() WHERE id = $1", [id]).catch(() => {});
    }
    const c = (await pool.query<{ w: string | null; n: string | null }>("SELECT contacto_whatsapp AS w, contacto_nombre AS n FROM portal_config WHERE id = 1").catch(() => ({ rows: [] }))).rows[0];
    const v = await ultimaVersion().catch(() => null);
    return rep.type("text/html; charset=utf-8").header("cache-control", "no-store")
      .send(paginaInvitacion({ id, whatsapp: c?.w ?? null, version: v?.version ?? null, hayInstalador: !!v?.setup }));
  });

  app.get("/descargar", async (req, rep) => {
    const q = z.object({ i: uuid.optional() }).safeParse(req.query);
    const v = await ultimaVersion();
    if (!v?.setup) return rep.code(404).type("text/plain; charset=utf-8").send("El instalador todavía no está publicado. Escríbanos y se lo enviamos.");
    if (q.success && q.data.i) {
      await pool.query("UPDATE portal_invitaciones SET descargas = descargas + 1, ultima_descarga = now() WHERE id = $1", [q.data.i]).catch(() => {});
    }
    return rep.redirect(await urlDescarga(v.setup));
  });
}

// ===================================================================================== Página
function paginaInvitacion(o: { id?: string; whatsapp: string | null; version: string | null; hayInstalador: boolean }) {
  const dl = `/descargar${o.id ? `?i=${o.id}` : ""}`;
  const wa = o.whatsapp ? `https://wa.me/${o.whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent("Hola, quiero más información de FactPOS")}` : null;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Conozca FactPOS · punto de venta e inventario</title>
<meta name="description" content="Recorrido interactivo de FactPOS y descarga de la prueba gratis de 15 días.">
<meta property="og:title" content="Conozca FactPOS"><meta property="og:description" content="Punto de venta e inventario para su negocio. Vea el recorrido y pruébelo 15 días gratis.">
<style>
:root{--p:#0f766e;--p2:#0b5a54;--t:#14202b;--s:#5b6b7a;--b:#dfe6ec;--bg:#f4f7f9;--w:#fff;--ok:#16a34a;--al:#d97706}
@media(prefers-color-scheme:dark){:root{--t:#e8eef3;--s:#9db0c0;--b:#2a3946;--bg:#0f1820;--w:#16232e}}
*{box-sizing:border-box}body{margin:0;font:16px/1.55 system-ui,-apple-system,Segoe UI,sans-serif;background:var(--bg);color:var(--t)}
header{padding:18px 20px;display:flex;align-items:center;gap:10px;max-width:1040px;margin:0 auto}
.logo{width:34px;height:34px;border-radius:9px;background:var(--p);color:#fff;display:grid;place-items:center;font-weight:800}
header b{font-size:18px}header b span{color:var(--p)}
.hero{max-width:1040px;margin:0 auto;padding:12px 20px 8px}
h1{font-size:clamp(26px,5vw,40px);line-height:1.15;margin:8px 0 10px;max-width:20ch}
.hero p{color:var(--s);max-width:60ch;margin:0 0 18px;font-size:17px}
.btn{display:inline-flex;align-items:center;gap:8px;background:var(--p);color:#fff;text-decoration:none;font-weight:700;padding:13px 20px;border-radius:11px;border:0;font-size:16px;cursor:pointer}
.btn:hover{background:var(--p2)}.btn.sec{background:transparent;color:var(--p);border:1.5px solid var(--p)}
.acciones{display:flex;gap:10px;flex-wrap:wrap}.peq{font-size:13px;color:var(--s);margin-top:10px}
main{max-width:1040px;margin:0 auto;padding:10px 20px 40px}
.tour{background:var(--w);border:1px solid var(--b);border-radius:18px;overflow:hidden;box-shadow:0 8px 30px rgba(15,40,60,.08);margin-top:18px}
.tour-cab{display:flex;gap:6px;overflow-x:auto;padding:10px;border-bottom:1px solid var(--b);scrollbar-width:thin}
.chip{flex:none;border:1px solid var(--b);background:transparent;color:var(--s);border-radius:999px;padding:7px 13px;font:600 13px inherit;cursor:pointer;white-space:nowrap}
.chip.on{background:var(--p);border-color:var(--p);color:#fff}
.cuerpo{display:grid;grid-template-columns:1fr 1.25fr;gap:0}
.texto{padding:26px 26px;display:flex;flex-direction:column;justify-content:center}
.texto h2{margin:0 0 8px;font-size:24px}.texto p{margin:0;color:var(--s)}
.texto ul{margin:14px 0 0;padding:0;list-style:none;display:grid;gap:7px}.texto li:before{content:"✓ ";color:var(--ok);font-weight:800}
.pantalla{background:#e9f0f4;padding:22px;min-height:340px;display:grid;place-items:center;position:relative}
@media(prefers-color-scheme:dark){.pantalla{background:#0c141b}}
.ventana{width:100%;max-width:440px;background:var(--w);border:1px solid var(--b);border-radius:12px;box-shadow:0 6px 20px rgba(0,0,0,.12);overflow:hidden;font-size:13px}
.vbar{background:var(--p);color:#fff;padding:8px 12px;font-weight:700;display:flex;justify-content:space-between}
.vcont{padding:12px;display:grid;gap:7px}
.fila{display:flex;justify-content:space-between;gap:8px;padding:7px 9px;border:1px solid var(--b);border-radius:8px;opacity:0;transform:translateY(8px)}
.esc.on .fila{animation:ent .45s forwards}.esc.on .fila:nth-child(2){animation-delay:.5s}.esc.on .fila:nth-child(3){animation-delay:1s}.esc.on .fila:nth-child(4){animation-delay:1.5s}.esc.on .fila:nth-child(5){animation-delay:2s}.esc.on .fila:nth-child(6){animation-delay:2.5s}
@keyframes ent{to{opacity:1;transform:none}}
.total{display:flex;justify-content:space-between;font-size:18px;font-weight:800;padding:6px 2px}
.cobrar{background:var(--ok);color:#fff;text-align:center;border-radius:9px;padding:10px;font-weight:800;opacity:0}.esc.on .cobrar{animation:ent .4s 3s forwards}
.bajo{border-color:var(--al);color:var(--al)}.bar{height:14px;border-radius:5px;background:var(--p);width:0}
.esc.on .bar{animation:crece 1s .3s forwards}@keyframes crece{to{width:var(--w)}}
.barras{display:flex;align-items:flex-end;gap:10px;height:150px;padding:6px 4px}.barras i{flex:1;background:var(--p);border-radius:6px 6px 0 0;height:0;opacity:.85}
.esc.on .barras i{animation:sube 1s forwards}.barras i:nth-child(2){animation-delay:.15s!important}.barras i:nth-child(3){animation-delay:.3s!important}.barras i:nth-child(4){animation-delay:.45s!important}.barras i:nth-child(5){animation-delay:.6s!important}.barras i:nth-child(6){animation-delay:.75s!important}
@keyframes sube{to{height:var(--h)}}
.nodos{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;text-align:center}.nodo{border:1px solid var(--b);border-radius:10px;padding:10px 4px}
.nodo b{display:block}.pulso{display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--ok);margin-right:5px}.esc.on .pulso{animation:p 1.4s infinite}
@keyframes p{50%{opacity:.25}}.nube{grid-column:1/-1;background:var(--p);color:#fff;border-radius:10px;padding:9px;font-weight:700}
.qr{width:74px;height:74px;background:conic-gradient(var(--t) 0 25%,transparent 0 50%,var(--t) 0 75%,transparent 0) 0 0/14px 14px;border:5px solid var(--w);outline:1px solid var(--b)}
.pie-tour{display:flex;align-items:center;gap:10px;padding:10px 14px;border-top:1px solid var(--b)}
.prog{flex:1;height:5px;background:var(--b);border-radius:3px;overflow:hidden}.prog i{display:block;height:100%;width:0;background:var(--p)}
.ctl{border:1px solid var(--b);background:transparent;color:var(--t);border-radius:8px;padding:6px 11px;cursor:pointer;font:600 13px inherit}
.esc{display:none;width:100%;max-width:440px}.esc.on{display:block}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-top:26px}
.card{background:var(--w);border:1px solid var(--b);border-radius:14px;padding:16px}.card b{display:block;margin-bottom:4px}.card span{color:var(--s);font-size:14px}
.final{margin-top:28px;background:var(--p);color:#fff;border-radius:18px;padding:28px;text-align:center}
.final h2{margin:0 0 6px}.final p{margin:0 0 16px;opacity:.9}.final .btn{background:#fff;color:var(--p)}.final .btn.sec{background:transparent;color:#fff;border-color:#fff}
@media(max-width:760px){.cuerpo{grid-template-columns:1fr}.texto{padding:20px}.pantalla{min-height:300px;padding:14px}}
@media(prefers-reduced-motion:reduce){*{animation-duration:.01s!important;animation-delay:0s!important}}
</style></head><body>
<header><div class="logo">F</div><b>Fact<span>POS</span></b></header>
<section class="hero">
  <h1>Venda más rápido y tenga su inventario bajo control</h1>
  <p>FactPOS es el punto de venta e inventario para su negocio. Mire el recorrido de 1 minuto y pruébelo gratis durante 15 días.</p>
  <div class="acciones">
    ${o.hayInstalador ? `<a class="btn" href="${dl}">⬇ Descargar para Windows</a>` : ""}
    <button class="btn sec" onclick="irTour()">▶ Ver recorrido</button>
    ${wa ? `<a class="btn sec" href="${wa}">💬 Escribirnos por WhatsApp</a>` : ""}
  </div>
  <p class="peq">${o.version ? `Versión ${o.version} · ` : ""}Windows 10 u 11 · Sin tarjeta · Sus datos se quedan en su equipo</p>
</section>
<main>
<div class="tour" id="tour">
  <div class="tour-cab" id="chips"></div>
  <div class="cuerpo">
    <div class="texto" id="texto"></div>
    <div class="pantalla">
      <div class="esc" data-i="0"><div class="ventana"><div class="vbar"><span>Caja 1</span><span>Factura</span></div><div class="vcont">
        <div class="fila"><span>Arroz selecto 5 lb</span><b>RD$ 285.00</b></div><div class="fila"><span>Aceite 1 L</span><b>RD$ 210.00</b></div>
        <div class="fila"><span>Leche entera</span><b>RD$ 95.00</b></div><div class="fila"><span>Café molido</span><b>RD$ 320.00</b></div>
        <div class="total"><span>Total</span><span>RD$ 910.00</span></div><div class="cobrar">COBRAR</div></div></div></div>
      <div class="esc" data-i="1"><div class="ventana"><div class="vbar"><span>Existencias</span><span>Sucursal Centro</span></div><div class="vcont">
        <div class="fila"><span>Arroz selecto 5 lb</span><b>124</b></div><div class="fila"><span>Aceite 1 L</span><b>58</b></div>
        <div class="fila bajo"><span>Leche entera</span><b>3 · bajo el mínimo</b></div><div class="fila"><span>Café molido</span><b>41</b></div>
        <div class="fila"><span>Azúcar 2 lb</span><b>77</b></div><div class="fila bajo"><span>Detergente</span><b>2 · bajo el mínimo</b></div></div></div></div>
      <div class="esc" data-i="2"><div class="ventana"><div class="vbar"><span>Precios</span><span>Aceite 1 L · costo RD$ 150</span></div><div class="vcont">
        <div class="fila"><span>Detalle</span><b>RD$ 210 · 40 %</b></div><div class="fila"><span>Mayor</span><b>RD$ 190 · 27 %</b></div><div class="fila"><span>Especial</span><b>RD$ 175 · 17 %</b></div>
        <div class="fila"><span>Ganancia al mayor</span><div style="flex:1;margin:4px 0 0 10px"><div class="bar" style="--w:70%"></div></div></div></div></div></div>
      <div class="esc" data-i="3"><div class="ventana"><div class="vbar"><span>Sucursales</span><span>En línea</span></div><div class="vcont"><div class="nodos">
        <div class="nube">☁ Su nube · administración desde cualquier lugar</div>
        <div class="nodo"><b>Centro</b><span class="pulso"></span>2 cajas</div><div class="nodo"><b>Norte</b><span class="pulso"></span>1 caja</div><div class="nodo"><b>Sur</b><span class="pulso"></span>3 cajas</div></div>
        <p style="margin:6px 0 0;color:var(--s)">Si se cae el internet, la caja sigue vendiendo y sincroniza al volver.</p></div></div></div>
      <div class="esc" data-i="4"><div class="ventana"><div class="vbar"><span>Comprobante electrónico</span><span>Emitido ✓</span></div><div class="vcont" style="grid-template-columns:1fr auto;align-items:center">
        <div><div class="fila"><span>e-CF</span><b>E320000000125</b></div><div class="fila" style="margin-top:7px"><span>ITBIS 18 %</span><b>RD$ 138.81</b></div><div class="fila" style="margin-top:7px"><span>Total</span><b>RD$ 910.00</b></div></div><div class="qr"></div></div></div></div>
      <div class="esc" data-i="5"><div class="ventana"><div class="vbar"><span>Reportes</span><span>Ventas por día</span></div><div class="vcont">
        <div class="barras"><i style="--h:55%"></i><i style="--h:80%"></i><i style="--h:45%"></i><i style="--h:95%"></i><i style="--h:70%"></i><i style="--h:100%"></i></div>
        <div class="fila" style="opacity:1;transform:none"><span>Venta de la semana</span><b>RD$ 184,520.00</b></div></div></div></div>
    </div>
  </div>
  <div class="pie-tour"><button class="ctl" id="ant">◀</button><button class="ctl" id="pp">⏸ Pausa</button><button class="ctl" id="sig">▶</button><div class="prog"><i id="prog"></i></div></div>
</div>

<div class="grid">
  <div class="card"><b>Pruébelo sin riesgo</b><span>15 días gratis con todo incluido. Si le gusta, solicita su licencia desde el mismo sistema.</span></div>
  <div class="card"><b>Sus datos son suyos</b><span>Su información vive en su propio equipo o nube, no en la nuestra.</span></div>
  <div class="card"><b>Soporte cercano</b><span>Le ayudamos a instalarlo y a cargar su inventario desde Excel.</span></div>
  <div class="card"><b>Se actualiza solo</b><span>Nuevas versiones sin perder lo que ya tiene cargado.</span></div>
</div>

<div class="final">
  <h2>¿Listo para probarlo?</h2><p>Descárguelo, instálelo y empiece a vender hoy mismo.</p>
  <div class="acciones" style="justify-content:center">${o.hayInstalador ? `<a class="btn" href="${dl}">⬇ Descargar FactPOS</a>` : ""}${wa ? `<a class="btn sec" href="${wa}">💬 Hablar con nosotros</a>` : ""}</div>
</div>
</main>
<script>
const P=[
 ["Venda en segundos","Escanee, cobre y entregue. La caja está pensada para el mostrador de un negocio real.",["Códigos de barra y búsqueda rápida","Efectivo, tarjeta y crédito","ITBIS calculado solo"]],
 ["Inventario siempre al día","Cada venta, compra y traspaso mueve la existencia, y todo queda en el kardex.",["Alertas de existencia mínima","Conteos físicos y ajustes","Importe su inventario desde Excel"]],
 ["Precios y ganancia claros","Hasta 3 niveles de precio por producto, con el margen a la vista antes de guardar.",["Detalle, mayor y especial","Ofertas y cupones","Avisa si vende bajo el costo"]],
 ["Varias sucursales, un solo control","Administre todas sus tiendas desde un lugar y consulte desde cualquier dispositivo.",["Traspasos entre sucursales","Funciona sin internet","Usuarios y permisos por rol"]],
 ["Facturación electrónica","Emita comprobantes fiscales con su código QR y mantenga su RNC y clientes al día.",["Padrón de RNC integrado","Comprobantes por correo","Cuentas por cobrar"]],
 ["Sepa cómo va su negocio","Ventas, ganancias y existencias en reportes que se entienden de un vistazo.",["Ventas por día y sucursal","Productos más vendidos","Retiros y gastos de caja"]]];
const T=6500;let k=0,pausa=false,t0=Date.now(),acum=0;
const $=s=>document.querySelector(s),esc=[...document.querySelectorAll('.esc')];
$('#chips').innerHTML=P.map((p,i)=>'<button class="chip" data-i="'+i+'">'+p[0]+'</button>').join('');
function ver(i){k=(i+P.length)%P.length;acum=0;t0=Date.now();
 esc.forEach(e=>{e.classList.remove('on')});void document.body.offsetWidth;esc[k].classList.add('on');
 document.querySelectorAll('.chip').forEach((c,j)=>{c.classList.toggle('on',j==k);if(j==k)c.scrollIntoView({block:'nearest',inline:'center'})});
 $('#texto').innerHTML='<h2>'+P[k][0]+'</h2><p>'+P[k][1]+'</p><ul>'+P[k][2].map(x=>'<li>'+x+'</li>').join('')+'</ul>'}
document.querySelectorAll('.chip').forEach(c=>c.onclick=()=>ver(+c.dataset.i));
$('#ant').onclick=()=>ver(k-1);$('#sig').onclick=()=>ver(k+1);
$('#pp').onclick=()=>{pausa=!pausa;if(pausa)acum+=Date.now()-t0;else t0=Date.now();$('#pp').textContent=pausa?'▶ Seguir':'⏸ Pausa'};
setInterval(()=>{if(pausa)return;const e=acum+Date.now()-t0;$('#prog').style.width=Math.min(100,e/T*100)+'%';if(e>=T)ver(k+1)},80);
function irTour(){$('#tour').scrollIntoView({behavior:'smooth'})}
ver(0);
</script></body></html>`;
}
