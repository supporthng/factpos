/**
 * Sitio web público de FactPOS: lo que comparten todas sus páginas (estilos, menú y pie).
 * Las páginas son plantillas de texto: sin comillas invertidas, sin «${» y sin barras invertidas en el HTML ni en el script.
 * El texto «__BASE__» se cambia, al servir la página, por el dominio con el que se entró.
 */
export const ESTILOS = `:root{--fondo:#f5f7fa;--panel:#fff;--borde:#e2e8ef;--texto:#101a24;--suave:#5d6d7e;--primario:#2563eb;--acento:#60a5fa;--oscuro:#0b1218;--sombra:0 12px 32px -12px rgba(16,26,36,.18)}
@media (prefers-color-scheme:dark){:root{--fondo:#0b1016;--panel:#121a23;--borde:#212d3a;--texto:#e7edf3;--suave:#93a4b6;--primario:#60a5fa;--acento:#60a5fa;--sombra:0 12px 32px -12px rgba(0,0,0,.6)}}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;font-family:"Segoe UI",system-ui,-apple-system,Roboto,sans-serif;background:var(--fondo);color:var(--texto);line-height:1.55;-webkit-font-smoothing:antialiased}
a{color:inherit}
.cont{width:min(1120px,100% - 40px);margin:0 auto}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:11px 20px;border-radius:10px;font-weight:600;font-size:15px;text-decoration:none;border:1px solid transparent;cursor:pointer;transition:transform .15s,box-shadow .15s}
.btn:hover{transform:translateY(-1px)}
.btn.p{background:var(--acento);color:#06182e;box-shadow:0 8px 24px -10px var(--acento)}
.btn.s{background:rgba(255,255,255,.06);color:#e6edf3;border-color:rgba(255,255,255,.22)}
.btn.o{background:var(--panel);border-color:var(--borde);color:var(--texto)}
header.nav{position:sticky;top:0;z-index:20;background:rgba(11,18,24,.82);backdrop-filter:blur(10px);border-bottom:1px solid rgba(255,255,255,.08)}
.nav .cont{display:flex;align-items:center;gap:22px;height:64px}
.logo{display:flex;align-items:center;gap:10px;font-weight:700;font-size:20px;color:#e6edf3;text-decoration:none;letter-spacing:-.01em}
.logo img{width:32px;height:32px;border-radius:8px}
.logo b{color:#60a5fa}
.nav nav{display:flex;gap:20px;margin-left:auto}
.nav nav a{color:#b6c5d4;text-decoration:none;font-size:14.5px}
.nav nav a:hover{color:#fff}
.nav .btn{padding:8px 16px;font-size:14px}
.hero{position:relative;overflow:hidden;color:#e6edf3;padding:84px 0 72px;
 background:radial-gradient(800px 460px at 10% -5%,rgba(96,165,250,.30),transparent 62%),radial-gradient(700px 460px at 100% 100%,rgba(59,130,246,.22),transparent 60%),
 linear-gradient(rgba(255,255,255,.045) 1px,transparent 1px) 0 0/38px 38px,linear-gradient(90deg,rgba(255,255,255,.045) 1px,transparent 1px) 0 0/38px 38px,var(--oscuro)}
.hero .cont{display:grid;grid-template-columns:1.1fr .9fr;gap:48px;align-items:center}
.etq{display:inline-flex;gap:8px;align-items:center;padding:5px 12px;border-radius:999px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.05);color:#bfdbfe;font-size:13px;margin-bottom:18px}
.etq i{width:8px;height:8px;border-radius:50%;background:#34d399;box-shadow:0 0 0 4px rgba(52,211,153,.2)}
h1{margin:0 0 16px;font-size:clamp(32px,4.6vw,54px);line-height:1.08;letter-spacing:-.03em}
h1 em{font-style:normal;color:#60a5fa}
.hero p.sub{margin:0 0 28px;color:#a9bacb;font-size:18px;max-width:560px}
.hero .acc{display:flex;gap:12px;flex-wrap:wrap}
.consola{border-radius:14px;border:1px solid rgba(255,255,255,.12);background:rgba(8,13,18,.78);box-shadow:0 30px 60px -20px rgba(0,0,0,.6);overflow:hidden}
.consola .barra{display:flex;gap:6px;padding:11px 14px;border-bottom:1px solid rgba(255,255,255,.08)}
.consola .barra i{width:10px;height:10px;border-radius:50%;background:#2a3846}
.consola pre{margin:0;padding:18px;font:13.5px/1.8 ui-monospace,"Cascadia Code","SF Mono",Menlo,Consolas,monospace;color:#cfe0ee;overflow:auto;white-space:pre}
.consola .k{color:#6b7f92}.consola .v{color:#34d399}.consola .a{color:#93c5fd}.consola .y{color:#fbbf24}
section{padding:76px 0}
.tit{max-width:640px;margin:0 0 36px}
.tit small{color:var(--primario);font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:12.5px}
.tit h2{margin:6px 0 10px;font-size:clamp(26px,3.2vw,38px);letter-spacing:-.02em;line-height:1.15}
.tit p{margin:0;color:var(--suave);font-size:17px}
.cifras{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:-34px;position:relative;z-index:2}
.cifra{background:var(--panel);border:1px solid var(--borde);border-radius:14px;padding:20px 22px;box-shadow:var(--sombra)}
.cifra b{display:block;font-size:28px;letter-spacing:-.02em;color:var(--primario)}
.cifra span{color:var(--suave);font-size:14.5px}
.rejilla{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px}
.tarj{background:var(--panel);border:1px solid var(--borde);border-radius:16px;padding:22px;transition:transform .15s,box-shadow .15s}
.tarj:hover{transform:translateY(-2px);box-shadow:var(--sombra)}
.tarj .ic{width:42px;height:42px;border-radius:11px;display:grid;place-items:center;background:color-mix(in srgb,var(--acento) 16%,transparent);color:var(--primario);font-size:20px;margin-bottom:12px}
.tarj h3{margin:0 0 6px;font-size:18px}
.tarj p{margin:0;color:var(--suave);font-size:15px}
.pasos{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;counter-reset:p}
.paso{background:var(--panel);border:1px solid var(--borde);border-radius:16px;padding:22px;position:relative}
.paso::before{counter-increment:p;content:"0" counter(p);font:700 13px ui-monospace,Menlo,Consolas,monospace;color:var(--primario);display:block;margin-bottom:8px}
.paso h3{margin:0 0 6px;font-size:18px}.paso p{margin:0;color:var(--suave);font-size:15px}
#planes{background:color-mix(in srgb,var(--panel) 60%,var(--fondo))}
.planes{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px;align-items:stretch}
.plan{background:var(--panel);border:1px solid var(--borde);border-radius:18px;padding:24px;display:flex;flex-direction:column;gap:12px;position:relative}
.plan.dest{border-color:var(--acento);box-shadow:0 0 0 1px var(--acento),var(--sombra)}
.plan .bd{position:absolute;top:-12px;left:20px;background:var(--acento);color:#06182e;font-weight:700;font-size:12px;padding:3px 10px;border-radius:999px}
.plan h3{margin:0;font-size:20px}
.plan .d{color:var(--suave);font-size:14.5px;margin:0}
.plan .pr{font-size:34px;font-weight:700;letter-spacing:-.02em}
.plan .pr small{font-size:14px;font-weight:500;color:var(--suave)}
.plan ul{margin:0;padding:0;list-style:none;display:grid;gap:8px;font-size:15px;flex:1}
.plan li::before{content:"✓";color:var(--primario);font-weight:700;margin-right:8px}
.nota{color:var(--suave);font-size:14px;margin-top:18px}
.cargando,.vacio{color:var(--suave)}
.cta{text-align:center;color:#e6edf3;border-radius:22px;padding:54px 24px;background:radial-gradient(600px 300px at 50% 0%,rgba(96,165,250,.28),transparent 70%),var(--oscuro)}
.sol{max-width:560px;margin:0 auto 30px;text-align:left;display:grid;gap:10px;grid-template-columns:1fr 1fr}
.sol h3{grid-column:1/-1;margin:0;text-align:center;font-size:20px}
.sol input,.sol textarea{width:100%;padding:11px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.07);color:#e6edf3;font:inherit}
.sol input::placeholder,.sol textarea::placeholder{color:#93a4b6}
.sol .ancho{grid-column:1/-1}
.sol button{grid-column:1/-1;cursor:pointer;font:inherit}
.sol .ok{grid-column:1/-1;text-align:center;color:#93c5fd;margin:0}
.sol .mal{grid-column:1/-1;text-align:center;color:#fca5a5;margin:0}
@media(max-width:560px){.sol{grid-template-columns:1fr}}
.cta h2{margin:0 0 10px;font-size:clamp(26px,3.4vw,40px);letter-spacing:-.02em}
.cta p{margin:0 auto 24px;color:#a9bacb;max-width:560px}
.cta .acc{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
footer{padding:36px 0;border-top:1px solid var(--borde);color:var(--suave);font-size:14px}
footer .cont{display:flex;gap:16px;flex-wrap:wrap;justify-content:space-between;align-items:center}
footer a{text-decoration:none;color:var(--primario)}

.vent{border-radius:16px;border:1px solid var(--borde);background:var(--panel);box-shadow:var(--sombra);overflow:hidden}
.vent .bar{display:flex;align-items:center;gap:6px;padding:10px 14px;border-bottom:1px solid var(--borde);background:var(--fondo)}
.vent .bar i{width:10px;height:10px;border-radius:50%;background:var(--borde)}
.vent .bar span{margin-left:10px;color:var(--suave);font-size:12.5px}
.tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}
.tabs button{padding:8px 15px;border-radius:999px;border:1px solid var(--borde);background:var(--panel);color:var(--texto);font:inherit;font-size:14.5px;font-weight:600;cursor:pointer}
.tabs button.on{background:var(--acento);border-color:var(--acento);color:#06182e}
.pan{display:none;padding:20px;gap:18px;grid-template-columns:1fr 1fr;align-items:start}
.pan.on{display:grid}
.pan h3{margin:0 0 6px;font-size:21px}
.pan p.t{margin:0 0 12px;color:var(--suave)}
.pan ul{margin:0;padding:0;list-style:none;display:grid;gap:7px;font-size:15px}
.pan li::before{content:"✓";color:var(--primario);font-weight:700;margin-right:8px}
.mini{border:1px solid var(--borde);border-radius:12px;padding:14px;background:var(--fondo);font-size:13.5px}
.mini .fila{display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid var(--borde)}
.mini .fila:last-child{border-bottom:0}
.mini .fila b{font-weight:600}
.mini .tot{font-size:20px;font-weight:700;padding-top:10px;display:flex;justify-content:space-between}
.mini .k{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px}
.mini .k div{background:var(--panel);border:1px solid var(--borde);border-radius:10px;padding:10px}
.mini .k span{display:block;color:var(--suave);font-size:12px}
.mini .k b{font-size:19px}
.mini .gr{display:flex;align-items:flex-end;gap:7px;height:92px}
.mini .gr i{flex:1;border-radius:5px 5px 0 0;background:linear-gradient(var(--acento),var(--primario))}
.mini .pi{display:inline-block;padding:1px 8px;border-radius:99px;font-size:11.5px;font-weight:700;background:#e4f6ea;color:#15803d}
.mini .pi.r{background:#fde8e8;color:#b91c1c}
.mini .pi.a{background:#fff1e0;color:#b45309}
.mini .bb{height:7px;border-radius:99px;background:var(--borde);overflow:hidden;width:90px}
.mini .bb i{display:block;height:100%;background:var(--acento)}
.faq{max-width:820px;display:grid;gap:10px}
.faq details{background:var(--panel);border:1px solid var(--borde);border-radius:14px;padding:0 18px}
.faq summary{cursor:pointer;list-style:none;padding:16px 0;font-weight:650;display:flex;justify-content:space-between;gap:12px;align-items:center}
.faq summary::-webkit-details-marker{display:none}
.faq summary::after{content:"+";font-size:22px;color:var(--primario);line-height:1}
.faq details[open] summary::after{content:"−"}
.faq details p{margin:0 0 16px;color:var(--suave)}
.rejilla.tres{grid-template-columns:repeat(3,1fr)}
@media(max-width:900px){.rejilla.tres{grid-template-columns:repeat(2,1fr)}}
@media(max-width:560px){.rejilla.tres{grid-template-columns:1fr}}
.wa{position:fixed;right:16px;bottom:16px;z-index:40;display:inline-flex;align-items:center;gap:8px;padding:12px 18px;border-radius:999px;background:#25d366;color:#06240f;font-weight:700;text-decoration:none;box-shadow:0 10px 28px -8px rgba(0,0,0,.45)}
.wa:hover{filter:brightness(1.05)}
@media(max-width:520px){.wa span{display:none}.wa{padding:14px}}
@media(max-width:860px){.pan.on{grid-template-columns:1fr}}
@media(max-width:860px){#descargar .cta{grid-template-columns:1fr!important}.hero .cont{grid-template-columns:1fr}.cifras,.pasos{grid-template-columns:1fr}.nav nav{display:none}.nav .btn{margin-left:auto}.hero{padding:56px 0 64px}}
@media(prefers-reduced-motion:reduce){*{transition:none!important;scroll-behavior:auto!important}}

.menu-mov{display:none;position:relative}
.menu-mov summary{list-style:none;cursor:pointer;color:#e6edf3;border:1px solid rgba(255,255,255,.22);border-radius:10px;padding:7px 13px;font-size:14px;font-weight:600}
.menu-mov summary::-webkit-details-marker{display:none}
.menu-mov div{position:absolute;right:0;top:46px;min-width:230px;background:var(--oscuro);border:1px solid rgba(255,255,255,.14);border-radius:12px;padding:8px;display:grid;box-shadow:0 20px 40px -12px rgba(0,0,0,.6)}
.menu-mov a{color:#d3deea;text-decoration:none;padding:10px 12px;border-radius:8px;font-size:15px}
.menu-mov a:hover,.menu-mov a.on{background:rgba(255,255,255,.08);color:#fff}
.nav nav a.on{color:#fff;font-weight:600}
.nav .btn{white-space:nowrap}
@media(max-width:860px){.menu-mov{display:block}.nav .btn{margin-left:auto}}
@media(max-width:420px){.nav .cont{gap:10px}.nav .btn{padding:8px 12px;font-size:13px}.logo{font-size:18px}}
.ph{color:#e6edf3;padding:64px 0 56px;background:radial-gradient(800px 420px at 8% -10%,rgba(96,165,250,.30),transparent 62%),linear-gradient(rgba(255,255,255,.045) 1px,transparent 1px) 0 0/38px 38px,linear-gradient(90deg,rgba(255,255,255,.045) 1px,transparent 1px) 0 0/38px 38px,var(--oscuro)}
.ph h1{font-size:clamp(30px,4.2vw,46px);max-width:820px}
.ph p{margin:0 0 22px;color:#a9bacb;font-size:18px;max-width:700px}
.ph .acc{display:flex;gap:12px;flex-wrap:wrap}
.indice{position:sticky;top:64px;z-index:15;background:color-mix(in srgb,var(--fondo) 92%,transparent);backdrop-filter:blur(10px);border-bottom:1px solid var(--borde)}
.indice .cont{display:flex;gap:8px;overflow-x:auto;padding:10px 0;scrollbar-width:thin}
.indice a{white-space:nowrap;text-decoration:none;font-size:14px;font-weight:600;padding:6px 13px;border-radius:999px;border:1px solid var(--borde);background:var(--panel);color:var(--texto)}
.indice a:hover{border-color:var(--acento);color:var(--primario)}
.area{padding:56px 0 8px;scroll-margin-top:120px}
.area .tit{margin-bottom:22px}
.tarj ul.mini-l{margin:10px 0 0;padding:0;list-style:none;display:grid;gap:5px;font-size:14px;color:var(--suave)}
.tarj ul.mini-l li::before{content:"•";color:var(--primario);margin-right:8px;font-weight:700}
.nuevo{display:inline-block;margin-left:8px;padding:1px 8px;border-radius:99px;font-size:11px;font-weight:700;letter-spacing:.04em;background:color-mix(in srgb,var(--acento) 22%,transparent);color:var(--primario);vertical-align:middle}
.flujo{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;counter-reset:f}
.flujo .paso::before{counter-increment:f;content:"0" counter(f)}
@media(max-width:900px){.flujo{grid-template-columns:repeat(2,1fr)}}
@media(max-width:560px){.flujo{grid-template-columns:1fr}}
.dos{display:grid;grid-template-columns:1fr 1fr;gap:18px;align-items:start}
@media(max-width:860px){.dos{grid-template-columns:1fr}}
.chk{margin:0;padding:0;list-style:none;display:grid;gap:9px;font-size:15.5px}
.chk li{display:flex;gap:10px;align-items:flex-start}
.chk li::before{content:"✓";flex:none;width:22px;height:22px;border-radius:50%;display:grid;place-items:center;background:color-mix(in srgb,var(--acento) 20%,transparent);color:var(--primario);font-weight:700;font-size:13px;margin-top:1px}
.chk li span{color:var(--suave)}
.chk li b{color:var(--texto)}
.tipos{width:100%;border-collapse:collapse;font-size:15px;background:var(--panel);border:1px solid var(--borde);border-radius:14px;overflow:hidden}
.tipos th,.tipos td{text-align:left;padding:11px 14px;border-bottom:1px solid var(--borde);vertical-align:top}
.tipos th{background:var(--fondo);font-size:13px;color:var(--suave);text-transform:uppercase;letter-spacing:.05em}
.tipos tr:last-child td{border-bottom:0}
.tipos td:first-child{font:700 14px ui-monospace,Menlo,Consolas,monospace;color:var(--primario);white-space:nowrap}
.aviso{border:1px solid var(--borde);border-left:4px solid var(--acento);background:var(--panel);border-radius:12px;padding:14px 16px;color:var(--suave);font-size:15px}
`;

const ENLACES: [string, string, string][] = [["/", "Inicio", "inicio"], ["/funciones", "Funciones", "funciones"], ["/facturacion-electronica", "Facturación electrónica", "ecf"], ["/demo", "Demo", "demo"], ["/#descargar", "Descargar", "d"], ["/#planes", "Planes", "p"], ["/#contacto", "Contacto", "c"]];

/** Menú superior (y desplegable en el celular). `activa` marca la página donde se está. */
export function cabecera(activa: string): string {
  const arriba = ENLACES.filter((e) => e[2] !== "inicio").map((e) => `<a href="${e[0]}"${e[2] === activa ? ' class="on"' : ""}>${e[1]}</a>`).join("");
  const movil = ENLACES.map((e) => `<a href="${e[0]}"${e[2] === activa ? ' class="on"' : ""}>${e[1]}</a>`).join("");
  return `<header class="nav"><div class="cont">
  <a class="logo" href="/"><img src="/iconos/factpos-192.png" alt="" width="32" height="32"><span>Fact<b>POS</b></span></a>
  <nav aria-label="Principal">${arriba}</nav>
  <a class="btn p" href="/entrar#inicio">Iniciar sesión</a>
  <details class="menu-mov"><summary>Menú</summary><div>${movil}</div></details>
</div></header>`;
}

export function pie(): string {
  return `<footer><div class="cont"><span>© FactPOS · Punto de venta y facturación electrónica</span><span style="display:flex;gap:18px;flex-wrap:wrap"><a href="/funciones">Funciones</a><a href="/facturacion-electronica">Facturación electrónica</a><a href="/demo">Demo</a><a href="/entrar#inicio">Iniciar sesión</a></span></div></footer>`;
}

/** Documento completo de una página del sitio. `ruta` es la dirección (por ejemplo «/funciones»). */
export function documento(o: { ruta: string; titulo: string; descripcion: string; activa: string; cuerpo: string; script?: string; extraHead?: string }): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${o.titulo}</title>
<meta name="description" content="${o.descripcion}">
<link rel="canonical" href="__BASE__${o.ruta}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="FactPOS">
<meta property="og:locale" content="es_DO">
<meta property="og:title" content="${o.titulo}">
<meta property="og:description" content="${o.descripcion}">
<meta property="og:url" content="__BASE__${o.ruta}">
<meta property="og:image" content="__BASE__/iconos/factpos-512.png">
<meta name="twitter:card" content="summary">
<meta name="theme-color" content="#0b1218">
<link rel="icon" href="/favicon.ico">
${o.extraHead ?? ""}<style>
${ESTILOS}</style>
</head>
<body>
${cabecera(o.activa)}
${o.cuerpo}
${pie()}
${o.script ? `<script>\n${o.script}\n</script>\n` : ""}</body>
</html>`;
}
