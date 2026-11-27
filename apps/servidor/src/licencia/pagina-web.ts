/**
 * Página web pública de FactPOS (la que se ve en la raíz del portal): qué es, qué hace, el enlace a los planes y la compra en Onetech
 * (los contactos salen de /licencias/planes-web) y el botón «Iniciar sesión» que lleva al portal (/entrar).
 * Es una sola página con sus estilos y su script dentro; no usa nada externo.
 * Comparte estilos, menú y pie con las demás páginas del sitio (sitio-web.ts); el resto: /funciones y /facturacion-electronica.
 * OJO: es una plantilla de texto: sin comillas invertidas, sin «${» (salvo los tres de arriba) y sin barras invertidas en el HTML ni en el script.
 */
import { ESTILOS, cabecera, pie } from "./sitio-web.js";

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
${ESTILOS}</style>
</head>
<body>
${cabecera("inicio")}

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
    <div class="tarj"><div class="ic">⚡</div><h3>Caja rápida</h3><p>Escaneo instantáneo, pago mixto (efectivo, tarjeta y transferencia), ventas en pausa, descuentos con aprobación del supervisor y delivery con liquidación del repartidor.</p></div>
    <div class="tarj"><div class="ic">🧾</div><h3>Facturación electrónica</h3><p>Comprobantes e-CF firmados y enviados a la DGII (con su propio certificado o por medio de un proveedor autorizado), notas de crédito, anulación con PIN, reimpresión marcada como copia y una guía paso a paso para la certificación ante la DGII y un validador que le dice si ya puede facturar. <a href="/facturacion-electronica">Ver más →</a></p></div>
    <div class="tarj"><div class="ic">🏬</div><h3>Varias sucursales</h3><p>Una central y cada tienda con su inventario, sus precios y sus cajas. Se sincronizan solas, también después de un corte. Si tiene una sola tienda, la misma PC puede ser servidor principal y tienda a la vez.</p></div>
    <div class="tarj"><div class="ic">📦</div><h3>Inventario y compras</h3><p>Sepa cuánto tiene de cada producto en cada tienda y a qué costo lo compró. Traspasos entre sucursales, conteos de inventario, lotes con fecha de vencimiento y compras con la factura del proveedor.</p></div>
    <div class="tarj"><div class="ic">🏷️</div><h3>Ofertas y cupones</h3><p>Porcentaje, precio especial, 2x1, por volumen, por horario y con tope de unidades: al agotarse, la caja avisa y cobra el resto normal.</p></div>
    <div class="tarj"><div class="ic">📱</div><h3>Verificador de precios</h3><p>Pantallas en la tienda y consulta desde el celular del cliente con un QR, que solo responde estando dentro de la tienda.</p></div>
    <div class="tarj"><div class="ic">🔒</div><h3>Seguridad</h3><p>Permisos por usuario, PIN de supervisor, verificación en 2 pasos, equipos autorizados y respaldos cifrados.</p></div>
    <div class="tarj"><div class="ic">🧑‍💼</div><h3>Terminal de ventas para vendedores</h3><p>El vendedor arma la venta con los precios del cliente desde su PC o su teléfono Android y la envía a la caja. En caja se ve la factura completa y el cajero solo cobra. Los apps «FactPOS Vendedor» encuentran solos el servidor en la red.</p></div>
    <div class="tarj"><div class="ic">🖨️</div><h3>Varios formatos de impresión</h3><p>Ticket de 58 mm y 80 mm, y también factura en media carta y en carta (8½ × 11), con el logo y los datos de su negocio.</p></div>
    <div class="tarj"><div class="ic">🔄</div><h3>Actualizaciones sin complicarse</h3><p>Cuando hay una versión nueva, la administración pregunta «¿Actualizar ahora?». Las cajas y las sucursales siguen al servidor principal.</p></div>
    <div class="tarj"><div class="ic">📊</div><h3>Administración web</h3><p>Reportes, cierres de caja y configuración desde la computadora o el celular, desde cualquier lugar.</p></div>
  </div>
  <p style="margin-top:22px"><a class="btn p" href="/funciones">Ver todas las funciones</a></p>
</div></section>

<section id="ecf" style="padding-top:0"><div class="cont">
  <div class="tit"><small>Facturación electrónica</small><h2>Del set de pruebas a la primera factura, con guía</h2><p>La DGII pide un proceso de certificación. FactPOS lo ordena en etapas, envía los comprobantes de prueba por usted y revisa que todo esté listo antes de facturar de verdad.</p></div>
  <div class="rejilla">
    <div class="tarj"><div class="ic">🧭</div><h3>Certificación guiada</h3><p>Cinco etapas con las herramientas a mano: set de pruebas, simulación, aprobaciones comerciales, direcciones y declaración jurada.</p></div>
    <div class="tarj"><div class="ic">✅</div><h3>¿Puedo facturar?</h3><p>Revisa certificado, ambiente, conexión y registro en la DGII, direcciones públicas y secuencias, y le dice qué corregir.</p></div>
    <div class="tarj"><div class="ic">🔢</div><h3>Secuencias bajo control</h3><p>Los números de e-NCF repartidos por sucursal, editables y con aviso antes de que se agoten o venzan.</p></div>
    <div class="tarj"><div class="ic">📥</div><h3>Recibe a sus proveedores</h3><p>Bandeja de comprobantes recibidos, aprobación comercial y una dirección fija en internet para la DGII.</p></div>
  </div>
  <p style="margin-top:22px"><a class="btn o" href="/facturacion-electronica">Conocer la facturación electrónica</a></p>
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
  <div class="vent"><div class="bar"><i></i><i></i><i></i><span>factpos · Supermercado Ejemplo</span></div><div class="pan on" id="p-caja"><div><h3>Venta rápida y cobro sin complicarse</h3><p class="t">Caja</p><ul><li>Escaneo instantáneo y búsqueda por nombre</li><li>Pago mixto: efectivo, tarjeta y transferencia</li><li>Descuentos con aprobación del supervisor</li><li>Ventas en pausa y delivery</li></ul></div><div class="mini"><div class="fila"><b>Cerveza 650 ml × 2</b><span>RD$ 300.00</span></div><div class="fila"><b>Arroz selecto 1 lb</b><span>RD$ 40.00</span></div><div class="fila"><b>Ron añejo 700 ml</b><span>RD$ 750.00</span></div><div class="fila"><span>ITBIS 18 %</span><span>RD$ 165.76</span></div><div class="tot"><span>Total</span><span>RD$ 1,090.00</span></div></div></div><div class="pan" id="p-panel"><div><h3>Cómo va el negocio de un vistazo</h3><p class="t">Panel</p><ul><li>Ventas del día y de la semana</li><li>Productos más vendidos</li><li>Alertas de existencias bajas</li><li>Todas las sucursales juntas o por separado</li></ul></div><div class="mini"><div class="k"><div><span>Ventas de la semana</span><b>RD$ 383,300</b></div><div><span>Facturas</span><b>142</b></div></div><div class="gr"><i style="height:45%"></i><i style="height:40%"></i><i style="height:52%"></i><i style="height:62%"></i><i style="height:82%"></i><i style="height:100%"></i><i style="height:70%"></i></div></div></div><div class="pan" id="p-inventario"><div><h3>Existencias exactas en cada sucursal</h3><p class="t">Inventario</p><ul><li>Historial de cada producto con su costo</li><li>Traspasos entre sucursales</li><li>Conteos de inventario y ajustes por merma</li><li>Lotes y fechas de vencimiento</li></ul></div><div class="mini"><div class="fila"><b>Cerveza 650 ml</b><span class="bb"><i style="width:80%"></i></span><span class="pi">240</span></div><div class="fila"><b>Refresco cola 2 L</b><span class="bb"><i style="width:55%"></i></span><span class="pi">48</span></div><div class="fila"><b>Habichuelas 15 oz</b><span class="bb"><i style="width:14%"></i></span><span class="pi r">10 · reponer</span></div><div class="fila"><b>Leche entera 1 L</b><span class="bb"><i style="width:11%"></i></span><span class="pi r">8 · reponer</span></div></div></div><div class="pan" id="p-ecf"><div><h3>e-CF firmados y enviados a la DGII</h3><p class="t">Facturación electrónica</p><ul><li>Comprobantes e-CF de consumo y crédito fiscal</li><li>Notas de crédito y anulación con PIN</li><li>Control de rangos de numeración</li><li>Reimpresión marcada como copia</li></ul></div><div class="mini"><div class="fila"><b>E320000016 · Ferretería El Progreso</b><span><span class="pi">Aceptado</span></span></div><div class="fila"><b>E320000015 · Contado</b><span><span class="pi">Aceptado</span></span></div><div class="fila"><b>E310000074 · Colmado Don Pepe</b><span><span class="pi">Aceptado</span></span></div><div class="fila"><b>E320000017 · Contado</b><span><span class="pi a">En cola</span></span></div></div></div><div class="pan" id="p-clientes"><div><h3>Quién debe cuánto, siempre claro</h3><p class="t">Clientes y crédito</p><ul><li>Límite de crédito por cliente</li><li>Abonos y estado de cuenta</li><li>Precios de detalle, mayorista y distribuidor</li><li>Historial de compras</li></ul></div><div class="mini"><div class="fila"><b>Colmado Don Pepe</b><span>Debe RD$ 18,450</span></div><div class="fila"><b>Ferretería El Progreso</b><span>Debe RD$ 27,900</span></div><div class="fila"><b>Restaurante La Esquina</b><span><span class="pi">Al día</span></span></div><div class="fila"><b>Total por cobrar</b><span>RD$ 46,350</span></div></div></div><div class="pan" id="p-precios"><div><h3>Precios al instante para el cliente</h3><p class="t">Verificador</p><ul><li>Pantallas en la tienda</li><li>Consulta desde el celular con un QR</li><li>Solo funciona estando dentro de la tienda</li><li>Ofertas visibles al consultar</li></ul></div><div class="mini"><div style="text-align:center;padding:10px 0"><b>Ron añejo 700 ml</b><div style="font-size:38px;font-weight:800;color:var(--primario);letter-spacing:-1px">RD$ 750.00</div><span style="color:var(--suave)">ITBIS incluido</span></div></div></div></div>
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
    <details><summary>¿Qué impresoras puedo usar?</summary><p>Tickets en papel de 58 mm y de 80 mm, y facturas en hoja media carta o carta (8½ × 11). Pueden llevar el logo y los datos de su negocio.</p></details>
    <details><summary>¿Pueden vender mis vendedores desde su celular o su PC?</summary><p>Sí. Con FactPOS Vendedor (Windows y Android) cada vendedor arma la venta con los precios del cliente y la envía a la caja, donde el cajero cobra y se emite el comprobante.</p></details>
    <details><summary>¿Puedo pasar mis productos desde otro sistema?</summary><p>Sí. Puede importar su inventario desde un archivo de Excel o CSV: usted indica qué columna es cada dato y el sistema revisa antes de cargarlo.</p></details>
    <details><summary>¿Puedo tener varias sucursales?</summary><p>Sí. Cada sucursal tiene su inventario, sus precios y sus cajas, y desde la administración web ve todas juntas o por separado.</p></details>
    <details><summary>¿Mis datos están seguros?</summary><p>Cada usuario tiene sus permisos, las acciones delicadas piden el PIN de un supervisor, la administración permite verificación en 2 pasos y los respaldos van cifrados.</p></details>
    <details><summary>¿Cómo empiezo?</summary><p>Pruebe la demo en el navegador o solicite su activación abajo, en Contacto. Le entregamos la licencia, la dirección de la administración y el instalador.</p></details>
  </div>
</div></section>

<section id="planes"><div class="cont">
  <div class="tit"><small>Planes y precios</small><h2>Elige el plan de tu negocio</h2><p>Niveles Básico, Pro y Empresarial para cada edición, en pesos y por sucursal. Se compran en línea en Onetech, la empresa detrás de FactPOS.</p></div>
  <div class="planes"><div class="plan dest">
    <h3>Planes de FactPOS</h3>
    <p class="d">Mensual, anual o pago único. Pago en línea con PayPal y activación de tu licencia por correo.</p>
    <a class="btn p" href="https://www.onetechrd.com/factpos#precios" rel="noopener">Ver planes y comprar</a>
  </div></div>
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

${pie()}

<script>
(function(){
  var $ = function(id){ return document.getElementById(id); };
  function el(tag, cls, txt){ var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  var tb = document.querySelectorAll(".tabs button");
  Array.prototype.forEach.call(tb, function(b){ b.addEventListener("click", function(){
    Array.prototype.forEach.call(tb, function(x){ x.classList.toggle("on", x === b); });
    Array.prototype.forEach.call(document.querySelectorAll(".pan"), function(p){ p.classList.toggle("on", p.id === "p-" + b.getAttribute("data-t")); });
  }); });
  fetch("/licencias/planes-web").then(function(r){ if (!r.ok) throw new Error("x"); return r.json(); }).then(function(d){
    // Los planes y precios se publican y se venden en Onetech; de aquí solo se toma el contacto
    var k = d.contacto || {}, cont = $("contactos");
    if (k.whatsapp) {
      var fl = el("a", "wa", ""); fl.href = "https://wa.me/" + String(k.whatsapp).replace(/[^0-9]/g, "") + "?text=" + encodeURIComponent("Hola, quiero información de FactPOS"); fl.rel = "noopener"; fl.setAttribute("aria-label", "Escribir por WhatsApp");
      fl.innerHTML = "<b>💬</b><span>Escríbenos por WhatsApp</span>"; document.body.appendChild(fl);
    }
    if (k.whatsapp) { var w = el("a", "btn s", "WhatsApp"); w.href = "https://wa.me/" + String(k.whatsapp).replace(/[^0-9]/g, ""); w.rel = "noopener"; cont.appendChild(w); }
    if (k.correo) { var m = el("a", "btn s", k.correo); m.href = "mailto:" + k.correo; cont.appendChild(m); }
    if (k.telefono && !k.whatsapp) { var t = el("a", "btn s", k.telefono); t.href = "tel:" + String(k.telefono).replace(/[^0-9+]/g, ""); cont.appendChild(t); }
  }).catch(function(){});
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
