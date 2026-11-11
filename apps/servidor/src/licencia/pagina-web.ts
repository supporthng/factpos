/**
 * Página web pública de FactPOS (la que se ve en la raíz del portal): qué es, qué hace, planes y precios (en vivo desde
 * /licencias/planes-web) y el botón «Iniciar sesión» que lleva al portal (/entrar).
 * Es una sola página con sus estilos y su script dentro; no usa nada externo.
 * OJO: es una plantilla de texto: sin comillas invertidas, sin «${» y sin barras invertidas en el HTML ni en el script.
 */
export const PAGINA_WEB = /* html */ `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>FactPOS · Punto de venta y facturación electrónica</title>
<link rel="canonical" href="__BASE__/">
<meta property="og:type" content="website">
<meta property="og:site_name" content="FactPOS">
<meta property="og:locale" content="es_DO">
<meta property="og:title" content="FactPOS · Punto de venta y facturación electrónica e-CF">
<meta property="og:description" content="Caja rápida, e-CF de la DGII, inventario y varias sucursales. Para tiendas, restaurantes, bares y discotecas. Sigue vendiendo aunque se caiga el internet.">
<meta property="og:url" content="__BASE__/">
<meta property="og:image" content="__BASE__/iconos/factpos-512.png">
<meta name="twitter:card" content="summary">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"SoftwareApplication","name":"FactPOS","applicationCategory":"BusinessApplication","operatingSystem":"Windows, Android, Web","inLanguage":"es-DO","description":"Punto de venta con facturación electrónica e-CF de la DGII, inventario y varias sucursales para tiendas, restaurantes, bares y discotecas en República Dominicana.","url":"__BASE__/"}</script>
<meta name="description" content="FactPOS: caja rápida, facturación electrónica e-CF de la DGII, inventario y varias sucursales en un solo panel. Funciona también sin internet.">
<meta name="theme-color" content="#0b1218">
<link rel="icon" href="/favicon.ico">
<style>
:root{--fondo:#f5f7fa;--panel:#fff;--borde:#e2e8ef;--texto:#101a24;--suave:#5d6d7e;--primario:#2563eb;--acento:#60a5fa;--oscuro:#0b1218;--sombra:0 12px 32px -12px rgba(16,26,36,.18)}
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
</style>
</head>
<body>
<header class="nav"><div class="cont">
  <a class="logo" href="/"><img src="/iconos/factpos-192.png" alt="" width="32" height="32"><span>Fact<b>POS</b></span></a>
  <nav><a href="/demo">Demo</a><a href="#funciones">Funciones</a><a href="#negocios">Bares y restaurantes</a><a href="#pantallas">Pantallas</a><a href="#descargar">Descargar</a><a href="#como">Cómo funciona</a><a href="#planes">Planes</a><a href="#contacto">Contacto</a></nav>
  <a class="btn p" href="/entrar#inicio">Iniciar sesión</a>
</div></header>

<div class="hero"><div class="cont">
  <div>
    <span class="etq"><i></i>Facturación electrónica e-CF · DGII</span>
    <h1>Tu tienda, tus cajas y tu inventario <em>en un solo panel</em>.</h1>
    <p class="sub">Caja rápida, comprobantes fiscales electrónicos, varias sucursales y precios al instante. Cada tienda sigue vendiendo aunque se caiga el internet.</p>
    <div class="acc"><a class="btn p" href="/entrar#inicio">Iniciar sesión</a><a class="btn s" href="/licencias/descargar-instalador">Descargar</a><a class="btn s" href="/demo">Probar la demo</a></div>
  </div>
  <div class="consola" aria-hidden="true">
    <div class="barra"><i></i><i></i><i></i></div>
<pre><span class="k">$</span> factpos estado
<span class="v">✔</span> caja 1 · vendiendo
<span class="v">✔</span> e-CF firmado y enviado a la DGII
<span class="v">✔</span> sucursal Santiago · sincronizada
<span class="y">!</span> sin internet · la tienda sigue vendiendo
<span class="v">✔</span> respaldo cifrado del día
<span class="k">›</span> <span class="a">todo en orden</span></pre>
  </div>
</div></div>

<div class="cont"><div class="cifras">
  <div class="cifra"><b>e-CF</b><span>comprobantes electrónicos listos para la DGII</span></div>
  <div class="cifra"><b>Caja ágil</b><span>escaneo al instante, sin esperar al servidor</span></div>
  <div class="cifra"><b>Sin internet</b><span>cada sucursal trabaja sola y sincroniza al volver</span></div>
</div></div>

<section id="funciones"><div class="cont">
  <div class="tit"><small>Funciones</small><h2>Todo lo que una tienda necesita, sin vueltas</h2><p>Pensado para el día a día de comercios dominicanos: rápido en caja, claro en la administración.</p></div>
  <div class="rejilla">
    <div class="tarj"><div class="ic">⚡</div><h3>Caja rápida</h3><p>Escaneo instantáneo, pago mixto, ventas en pausa, descuentos con aprobación del supervisor y delivery con liquidación del repartidor.</p></div>
    <div class="tarj"><div class="ic">🧾</div><h3>Facturación electrónica</h3><p>Comprobantes e-CF firmados y enviados a la DGII, notas de crédito, anulación con PIN y reimpresión marcada como copia.</p></div>
    <div class="tarj"><div class="ic">🏬</div><h3>Varias sucursales</h3><p>Una central y cada tienda con su inventario, sus precios y sus cajas. Se sincronizan solas, también después de un corte.</p></div>
    <div class="tarj"><div class="ic">📦</div><h3>Inventario y compras</h3><p>Sepa cuánto tiene de cada producto en cada tienda y a qué costo lo compró. Traspasos entre sucursales, conteos de inventario, lotes con fecha de vencimiento y compras con la factura del proveedor.</p></div>
    <div class="tarj"><div class="ic">🏷️</div><h3>Ofertas y cupones</h3><p>Porcentaje, precio especial, 2x1, por volumen, por horario y con tope de unidades: al agotarse, la caja avisa y cobra el resto normal.</p></div>
    <div class="tarj"><div class="ic">📱</div><h3>Verificador de precios</h3><p>Pantallas en la tienda y consulta desde el celular del cliente con un QR, que solo responde estando dentro de la tienda.</p></div>
    <div class="tarj"><div class="ic">🔒</div><h3>Seguridad</h3><p>Permisos por usuario, PIN de supervisor, verificación en 2 pasos, equipos autorizados y respaldos cifrados.</p></div>
    <div class="tarj"><div class="ic">📊</div><h3>Administración web</h3><p>Reportes, cierres de caja y configuración desde la computadora o el celular, desde cualquier lugar.</p></div>
  </div>
</div></section>

<section id="negocios" style="padding-top:0"><div class="cont">
  <div class="tit"><small>Restaurantes, bares y discotecas</small><h2>También para negocios de mesas y barras</h2><p>Todo lo de la tienda, más lo que se necesita cuando se atiende por mesa, por barra o en una noche de mucha gente. Se activa solo para los negocios que lo usan.</p></div>
  <div class="rejilla tres">
    <div class="tarj"><div class="ic">🍽️</div><h3>Cuentas abiertas y dividir la cuenta</h3><p>Una cuenta por mesa o por cliente. Se divide antes de pedir (cada persona con lo suyo) o después: en partes iguales, por montos o por producto, y cada quien paga con su tarjeta.</p></div>
    <div class="tarj"><div class="ic">🍸</div><h3>Comandas a la barra y a la cocina</h3><p>Al enviar el pedido, cada estación recibe solo lo suyo: en una pantalla con la cola de pedidos o impreso. El bartender marca «Listo» y no se pierde nada.</p></div>
    <div class="tarj"><div class="ic">🧾</div><h3>Propina legal del 10 %</h3><p>Se calcula sobre el consumo sin ITBIS y se cobra aparte del comprobante, con su detalle en el ticket y en el cierre de caja.</p></div>
    <div class="tarj"><div class="ic">🥃</div><h3>Botellas y tragos del mismo inventario</h3><p>Venda la botella cerrada o por tragos y dobles; el inventario se descuenta solo, sin llevar dos conteos.</p></div>
    <div class="tarj"><div class="ic">🎟️</div><h3>Entradas, aforo y vales</h3><p>Cobre la entrada, sepa cuánta gente hay adentro y entregue vales de consumo incluido que se canjean en la barra.</p></div>
    <div class="tarj"><div class="ic">🛡️</div><h3>Control de cortesías y anulaciones</h3><p>Las cortesías y lo anulado después de enviarlo a la barra piden PIN de supervisor y motivo, y quedan en un reporte por noche.</p></div>
  </div>
</div></section>

<section id="pantallas" style="padding-top:0"><div class="cont">
  <div class="tit"><small>El sistema por dentro</small><h2>Sus pantallas principales</h2><p>Así se ven los módulos que usará cada día. Con datos de ejemplo.</p></div>
  <div class="tabs" role="tablist"><button type="button" class=on data-t="caja">Caja</button><button type="button" data-t="panel">Panel</button><button type="button" data-t="inventario">Inventario</button><button type="button" data-t="ecf">Facturación electrónica</button><button type="button" data-t="clientes">Clientes y crédito</button><button type="button" data-t="precios">Verificador</button></div>
  <div class="vent"><div class="bar"><i></i><i></i><i></i><span>factpos · Supermercado Ejemplo</span></div><div class="pan on" id="p-caja"><div><h3>Venta rápida y cobro sin complicarse</h3><p class="t">Caja</p><ul><li>Escaneo instantáneo y búsqueda por nombre</li><li>Pago mixto: efectivo, tarjeta y crédito</li><li>Descuentos con aprobación del supervisor</li><li>Ventas en pausa y delivery</li></ul></div><div class="mini"><div class="fila"><b>Cerveza 650 ml × 2</b><span>RD$ 300.00</span></div><div class="fila"><b>Arroz selecto 1 lb</b><span>RD$ 40.00</span></div><div class="fila"><b>Ron añejo 700 ml</b><span>RD$ 750.00</span></div><div class="fila"><span>ITBIS 18 %</span><span>RD$ 165.76</span></div><div class="tot"><span>Total</span><span>RD$ 1,090.00</span></div></div></div><div class="pan" id="p-panel"><div><h3>Cómo va el negocio de un vistazo</h3><p class="t">Panel</p><ul><li>Ventas del día y de la semana</li><li>Productos más vendidos</li><li>Alertas de existencias bajas</li><li>Todas las sucursales juntas o por separado</li></ul></div><div class="mini"><div class="k"><div><span>Ventas de la semana</span><b>RD$ 383,300</b></div><div><span>Facturas</span><b>142</b></div></div><div class="gr"><i style="height:45%"></i><i style="height:40%"></i><i style="height:52%"></i><i style="height:62%"></i><i style="height:82%"></i><i style="height:100%"></i><i style="height:70%"></i></div></div></div><div class="pan" id="p-inventario"><div><h3>Existencias exactas en cada sucursal</h3><p class="t">Inventario</p><ul><li>Historial de cada producto con su costo</li><li>Traspasos entre sucursales</li><li>Conteos de inventario y ajustes por merma</li><li>Lotes y fechas de vencimiento</li></ul></div><div class="mini"><div class="fila"><b>Cerveza 650 ml</b><span class="bb"><i style="width:80%"></i></span><span class="pi">240</span></div><div class="fila"><b>Refresco cola 2 L</b><span class="bb"><i style="width:55%"></i></span><span class="pi">48</span></div><div class="fila"><b>Habichuelas 15 oz</b><span class="bb"><i style="width:14%"></i></span><span class="pi r">10 · reponer</span></div><div class="fila"><b>Leche entera 1 L</b><span class="bb"><i style="width:11%"></i></span><span class="pi r">8 · reponer</span></div></div></div><div class="pan" id="p-ecf"><div><h3>e-CF firmados y enviados a la DGII</h3><p class="t">Facturación electrónica</p><ul><li>Comprobantes e-CF de consumo y crédito fiscal</li><li>Notas de crédito y anulación con PIN</li><li>Control de rangos de numeración</li><li>Reimpresión marcada como copia</li></ul></div><div class="mini"><div class="fila"><b>E320000016 · Ferretería El Progreso</b><span><span class="pi">Aceptado</span></span></div><div class="fila"><b>E320000015 · Contado</b><span><span class="pi">Aceptado</span></span></div><div class="fila"><b>E310000074 · Colmado Don Pepe</b><span><span class="pi">Aceptado</span></span></div><div class="fila"><b>E320000017 · Contado</b><span><span class="pi a">En cola</span></span></div></div></div><div class="pan" id="p-clientes"><div><h3>Quién debe cuánto, siempre claro</h3><p class="t">Clientes y crédito</p><ul><li>Límite de crédito por cliente</li><li>Abonos y estado de cuenta</li><li>Precios de detalle, mayorista y distribuidor</li><li>Historial de compras</li></ul></div><div class="mini"><div class="fila"><b>Colmado Don Pepe</b><span>Debe RD$ 18,450</span></div><div class="fila"><b>Ferretería El Progreso</b><span>Debe RD$ 27,900</span></div><div class="fila"><b>Restaurante La Esquina</b><span><span class="pi">Al día</span></span></div><div class="fila"><b>Total por cobrar</b><span>RD$ 46,350</span></div></div></div><div class="pan" id="p-precios"><div><h3>Precios al instante para el cliente</h3><p class="t">Verificador</p><ul><li>Pantallas en la tienda</li><li>Consulta desde el celular con un QR</li><li>Solo funciona estando dentro de la tienda</li><li>Ofertas visibles al consultar</li></ul></div><div class="mini"><div style="text-align:center;padding:10px 0"><b>Ron añejo 700 ml</b><div style="font-size:38px;font-weight:800;color:var(--primario);letter-spacing:-1px">RD$ 750.00</div><span style="color:var(--suave)">ITBIS incluido</span></div></div></div></div>
  <p style="margin-top:18px"><a class="btn p" href="/demo">Probar la demo completa</a></p>
</div></section>

<section id="como" style="padding-top:0"><div class="cont">
  <div class="tit"><small>Cómo funciona</small><h2>Tres pasos para empezar</h2></div>
  <div class="pasos">
    <div class="paso"><h3>Activa tu empresa</h3><p>Pide tu activación y recibe tu licencia, tu dirección de administración y tu instalador.</p></div>
    <div class="paso"><h3>Instala el servidor y las cajas</h3><p>Un instalador para el servidor de la tienda y otro para cada caja. Se encuentran solos en la red.</p></div>
    <div class="paso"><h3>Vende y administra</h3><p>Factura en caja y controla ventas, inventario y comprobantes desde el panel web.</p></div>
  </div>
</div></section>

<section id="descargar" style="padding-top:0"><div class="cont">
  <div class="cta" style="text-align:left;display:grid;grid-template-columns:1.2fr .8fr;gap:28px;align-items:center">
    <div>
      <span class="etq"><i></i>Disfrute su demo por 15 días</span>
      <h2 style="margin-bottom:8px">Descargue FactPOS para Windows</h2>
      <p style="margin:0 0 20px">Descargue el instalador completo (servidor, caja y administración) y disfrute su demo por 15 días, sin pagar y sin tarjeta. Cuando quiera seguir, activamos su licencia.</p>
      <div class="acc" style="justify-content:flex-start"><a class="btn p" href="/licencias/descargar-instalador">Descargar y disfrutar 15 días de demo</a><a class="btn s" href="/demo">Probar la demo en el navegador</a></div>
    </div>
    <ol style="margin:0;padding-left:20px;color:#a9bacb;display:grid;gap:8px;font-size:15px">
      <li>Descargue y abra el instalador.</li>
      <li>Siga los pasos: se instala solo.</li>
      <li>Entre a la administración y empiece a vender.</li>
    </ol>
  </div>
</div></section>

<section id="preguntas" style="padding-top:0"><div class="cont">
  <div class="tit"><small>Preguntas frecuentes</small><h2>Lo que casi todos preguntan antes de empezar</h2></div>
  <div class="faq">
    <details><summary>¿Funciona si se cae el internet?</summary><p>Sí. Cada tienda trabaja con su propio servidor, así que las cajas siguen vendiendo sin internet. Cuando vuelve la conexión, las ventas y los comprobantes se sincronizan solos.</p></details>
    <details><summary>¿Qué necesito para facturar electrónicamente (e-CF)?</summary><p>Estar habilitado como emisor electrónico ante la DGII y tener el certificado digital (archivo .p12) de una entidad certificadora autorizada. Dentro de la administración hay una guía paso a paso de la certificación, y FactPOS firma y envía los comprobantes por usted.</p></details>
    <details><summary>¿Sirve para un restaurante, un bar o una discoteca?</summary><p>Sí. Además de lo de la tienda, tiene cuentas por mesa con división de cuenta, comandas a la barra y la cocina, propina legal, botellas y tragos, entradas con aforo y control de cortesías. Se activa solo para los negocios que lo necesitan, sin cambiar la caja de una tienda.</p></details>
    <details><summary>¿Qué impresoras puedo usar?</summary><p>Tickets en papel de 58 mm y de 80 mm. El ticket puede llevar el logo y los datos de su negocio.</p></details>
    <details><summary>¿Puedo pasar mis productos desde otro sistema?</summary><p>Sí. Puede importar su inventario desde un archivo de Excel o CSV: usted indica qué columna es cada dato y el sistema revisa antes de cargarlo.</p></details>
    <details><summary>¿Puedo tener varias sucursales?</summary><p>Sí. Cada sucursal tiene su inventario, sus precios y sus cajas, y desde la administración web ve todas juntas o por separado.</p></details>
    <details><summary>¿Mis datos están seguros?</summary><p>Cada usuario tiene sus permisos, las acciones delicadas piden el PIN de un supervisor, la administración permite verificación en 2 pasos y los respaldos van cifrados.</p></details>
    <details><summary>¿Cómo empiezo?</summary><p>Pruebe la demo en el navegador o solicite su activación abajo, en Contacto. Le entregamos la licencia, la dirección de la administración y el instalador.</p></details>
  </div>
</div></section>

<section id="planes"><div class="cont">
  <div class="tit"><small>Planes y precios</small><h2>Elige el plan de tu negocio</h2><p id="planes-sub">Precios por mes, sin letra pequeña.</p></div>
  <div id="planes-lista" class="planes"><p class="cargando">Cargando planes…</p></div>
  <p class="nota" id="planes-nota"></p>
</div></section>

<section id="contacto"><div class="cont">
  <div class="cta">
    <form class="sol" id="sol" novalidate>
      <h3>Solicita tu demo de 15 días</h3>
      <input id="s-nombre" placeholder="Tu nombre" maxlength="80" autocomplete="name" required>
      <input id="s-negocio" placeholder="Nombre del negocio" maxlength="100" required>
      <input id="s-tel" type="tel" placeholder="Teléfono / WhatsApp" maxlength="30" autocomplete="tel" required>
      <input id="s-correo" type="email" placeholder="Correo (opcional)" maxlength="120" autocomplete="email">
      <textarea class="ancho" id="s-msg" rows="2" maxlength="400" placeholder="¿Cuántas sucursales tienes y qué necesitas? (opcional)"></textarea>
      <button class="btn p" id="s-btn" type="submit">Solicitar demo y descargar</button>
      <p class="ok" id="s-ok" hidden></p><p class="mal" id="s-mal" hidden></p>
    </form>
    <h2>¿Ya eres cliente?</h2>
    <p>Entra al portal con tu usuario y tu contraseña. Si todavía no tienes cuenta, escríbenos y te ayudamos a empezar.</p>
    <div class="acc"><a class="btn p" href="/entrar#inicio">Iniciar sesión</a><span id="contactos" style="display:inline-flex;gap:12px;flex-wrap:wrap"></span></div>
  </div>
</div></section>

<footer><div class="cont"><span>© FactPOS · Punto de venta y facturación electrónica</span><span><a href="/entrar#inicio">Iniciar sesión</a></span></div></footer>

<script>
(function(){
  var $ = function(id){ return document.getElementById(id); };
  function el(tag, cls, txt){ var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function rd(n){ return "RD$ " + Number(n).toLocaleString("es-DO", { maximumFractionDigits: 0 }); }
  var tb = document.querySelectorAll(".tabs button");
  Array.prototype.forEach.call(tb, function(b){ b.addEventListener("click", function(){
    Array.prototype.forEach.call(tb, function(x){ x.classList.toggle("on", x === b); });
    Array.prototype.forEach.call(document.querySelectorAll(".pan"), function(p){ p.classList.toggle("on", p.id === "p-" + b.getAttribute("data-t")); });
  }); });
  fetch("/licencias/planes-web").then(function(r){ if (!r.ok) throw new Error("x"); return r.json(); }).then(function(d){
    var lista = $("planes-lista"); lista.textContent = "";
    var planes = (d.planes || []);
    if (!planes.length) { lista.appendChild(el("p", "vacio", "Escríbenos y te preparamos una propuesta a tu medida.")); }
    planes.forEach(function(p){
      var c = el("div", "plan" + (p.destacado ? " dest" : ""));
      if (p.etiqueta) c.appendChild(el("span", "bd", p.etiqueta));
      c.appendChild(el("h3", "", p.nombre));
      if (p.descripcion) c.appendChild(el("p", "d", p.descripcion));
      var pr = el("div", "pr");
      if (p.pagoUnico) { pr.textContent = rd(p.pagoUnico); pr.appendChild(el("small", "", " pago único")); }
      else if (p.mensual) { pr.textContent = rd(p.mensual); pr.appendChild(el("small", "", " / mes")); }
      else { pr.textContent = "Consultar"; }
      c.appendChild(pr);
      c.appendChild(el("p", "d", p.sucursales + (p.sucursales === 1 ? " sucursal incluida" : " sucursales incluidas")));
      var ul = el("ul"); (p.funciones || []).forEach(function(f){ ul.appendChild(el("li", "", f)); }); c.appendChild(ul);
      var a = el("a", "btn " + (p.destacado ? "p" : "o"), "Quiero este plan"); a.href = "#contacto"; c.appendChild(a);
      lista.appendChild(c);
    });
    if (d.descuentoAnual) $("planes-nota").textContent = "Pagando el año completo tienes " + d.descuentoAnual + " % de descuento.";
    var k = d.contacto || {}, cont = $("contactos");
    if (k.whatsapp) {
      var fl = el("a", "wa", ""); fl.href = "https://wa.me/" + String(k.whatsapp).replace(/[^0-9]/g, "") + "?text=" + encodeURIComponent("Hola, quiero información de FactPOS"); fl.rel = "noopener"; fl.setAttribute("aria-label", "Escribir por WhatsApp");
      fl.innerHTML = "<b>💬</b><span>Escríbenos por WhatsApp</span>"; document.body.appendChild(fl);
    }
    if (k.whatsapp) { var w = el("a", "btn s", "WhatsApp"); w.href = "https://wa.me/" + String(k.whatsapp).replace(/[^0-9]/g, ""); w.rel = "noopener"; cont.appendChild(w); }
    if (k.correo) { var m = el("a", "btn s", k.correo); m.href = "mailto:" + k.correo; cont.appendChild(m); }
    if (k.telefono && !k.whatsapp) { var t = el("a", "btn s", k.telefono); t.href = "tel:" + String(k.telefono).replace(/[^0-9+]/g, ""); cont.appendChild(t); }
  }).catch(function(){
    var lista = $("planes-lista"); lista.textContent = ""; lista.appendChild(el("p", "vacio", "No pudimos cargar los planes ahora. Escríbenos y te los enviamos."));
  });
  var sol = $("sol");
  if (sol) sol.addEventListener("submit", function(ev){
    ev.preventDefault();
    var ok = $("s-ok"), mal = $("s-mal"), btn = $("s-btn");
    ok.hidden = true; mal.hidden = true;
    var nombre = $("s-nombre").value.trim(), negocio = $("s-negocio").value.trim(), tel = $("s-tel").value.trim(), correo = $("s-correo").value.trim();
    if (nombre.length < 2 || negocio.length < 2 || tel.length < 7) { mal.textContent = "Escribe tu nombre, el negocio y un teléfono."; mal.hidden = false; return; }
    btn.disabled = true;
    var cuerpo = { nombre: nombre, negocio: negocio, telefono: tel, correo: correo, mensaje: $("s-msg").value.trim() };
    fetch("/licencias/prospecto", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) })
      .then(function(r){ return r.json().then(function(j){ if (!r.ok) throw new Error(j && j.error ? j.error : "No se pudo enviar"); return j; }); })
      .then(function(j){
        ok.textContent = j.url ? "¡Listo! Te contactaremos pronto. Tu descarga empieza ahora." : "¡Listo! Te contactaremos pronto con tu demo.";
        ok.hidden = false; sol.reset();
        if (j.url) window.location.href = j.url;
      })
      .catch(function(e){ mal.textContent = (e && e.message) || "No se pudo enviar. Intenta de nuevo."; mal.hidden = false; })
      .then(function(){ btn.disabled = false; });
  });
})();
</script>
</body>
</html>`;
