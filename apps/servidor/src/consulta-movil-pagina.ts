/**
 * Consulta de precios desde el celular del cliente: http://<servidor-de-la-sucursal>:3000/verificador/movil
 * (se reparte con un QR pegado en la tienda). Solo funciona dentro de la red de la tienda porque el servidor es local.
 * La cámara necesita una conexión segura (HTTPS) o localhost; sin ella queda el campo para escribir el código.
 * Sin comillas invertidas ni "dolar-llave" dentro de esta plantilla.
 */
export const PAGINA_CONSULTA_MOVIL = /* html */ `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Consulta de precios</title>
<style>
:root{--m:#c0362c;--f:#10202e}
*{box-sizing:border-box}html,body{margin:0;min-height:100%}
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#eef1f4;color:#10202e;-webkit-tap-highlight-color:transparent}
header{display:flex;align-items:center;gap:12px;padding:14px 16px;background:var(--f);color:#fff}
header img{height:38px;max-width:90px;object-fit:contain}
header b{display:block;font-size:17px}header small{opacity:.75}
main{max-width:520px;margin:0 auto;padding:16px}
.visor{position:relative;background:#000;border-radius:16px;overflow:hidden;aspect-ratio:4/3;display:none}
.visor video{width:100%;height:100%;object-fit:cover}
.visor i{position:absolute;left:8%;right:8%;top:50%;height:2px;background:#ff4d4d;box-shadow:0 0 8px #f00}
.guia{text-align:center;color:#5b6b7a;margin:10px 0;min-height:20px;font-size:14px}
.boton{display:block;width:100%;border:0;border-radius:12px;padding:14px;font-size:16px;font-weight:700;background:var(--m);color:#fff;margin:10px 0}
.boton.claro{background:#fff;color:#10202e;border:1px solid #cfd6dd}
form{display:flex;gap:8px;margin-top:10px}
input{flex:1;min-width:0;border:1px solid #cfd6dd;border-radius:12px;padding:14px;font-size:17px}
form button{border:0;border-radius:12px;padding:0 20px;font-size:16px;font-weight:700;background:var(--f);color:#fff}
.et{background:#fff;border-radius:18px;padding:22px 20px 16px;margin-top:16px;box-shadow:0 6px 20px rgba(16,32,46,.12);text-align:center;position:relative;overflow:hidden}
.et h2{margin:0 0 6px;font-size:19px;line-height:1.25}
.precio{font-size:68px;font-weight:800;line-height:1.05;white-space:nowrap}
.precio sup{font-size:.4em;vertical-align:top;margin-right:3px}
.precio small{font-size:.45em}
.cod{color:#7a8794;font-size:13px;margin:6px 0 0}
.promo{display:inline-block;margin-top:10px;background:#fff1cf;color:#7a4b00;border-radius:999px;padding:6px 14px;font-weight:700;font-size:14px}
.nota{color:#5b6b7a;margin-top:10px;font-size:14px}
.err{color:#b3261e;font-weight:700}
.cuenta{height:4px;background:#e3e8ec;margin:14px -20px 0}.cuenta span{display:block;height:100%;background:var(--m);width:100%;animation:c linear forwards}
@keyframes c{to{width:0}}
</style></head><body>
<header><img id="logo" alt="" hidden><div><b id="empresa">Consulta de precios</b><small id="suc"></small></div></header>
<main>
  <div class="visor" id="visor"><video id="video" playsinline muted></video><i></i></div>
  <p class="guia" id="guia"></p>
  <button class="boton" id="bcam" hidden>Escanear con la cámara</button>
  <form id="form"><input id="codigo" inputmode="numeric" autocomplete="off" placeholder="Escribe el código de barras"><button>Ver</button></form>
  <div id="res"></div>
</main>
<script>
(function(){
  var sucursal = new URLSearchParams(location.search).get("sucursal");
  var $ = function(id){ return document.getElementById(id); };
  var flujo = null, detector = null, timer = null, volver = null;
  function esc(t){ return String(t == null ? "" : t).replace(/[&<>"]/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]; }); }
  function fmt(n){ return Number(n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}); }

  fetch("/verificador/config" + (sucursal ? "?sucursal=" + encodeURIComponent(sucursal) : "")).then(function(r){ return r.json(); }).then(function(c){
    if (c.error) { $("guia").innerHTML = '<span class="err">' + esc(c.error) + '</span>'; return; }
    sucursal = c.sucursalId;
    $("empresa").textContent = c.empresa; $("suc").textContent = c.nombre;
    document.documentElement.style.setProperty("--m", c.primario);
    if (c.secundario) document.documentElement.style.setProperty("--f", c.secundario);
    if (c.logo) { $("logo").src = c.logo; $("logo").hidden = false; }
  }).catch(function(){ $("guia").innerHTML = '<span class="err">No se pudo conectar con la tienda. Verifica que estés en su WiFi.</span>'; });

  var camaraOk = window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia && "BarcodeDetector" in window;
  if (camaraOk) $("bcam").hidden = false;
  else $("guia").textContent = "Escribe el número que aparece bajo el código de barras.";

  function parar(){ if (timer) clearInterval(timer); timer = null; if (flujo) flujo.getTracks().forEach(function(t){ t.stop(); }); flujo = null; $("visor").style.display = "none"; }
  async function camara(){
    clearTimeout(volver); $("res").innerHTML = "";
    try {
      if (!detector) {
        // Cada teléfono acepta unos formatos: se piden solo los que soporta (si uno no existe, el lector no se crea)
        var quiero = ["ean_13","ean_8","upc_a","upc_e","code_128","code_39","itf"], hay = quiero;
        try { var sop = await BarcodeDetector.getSupportedFormats(); hay = quiero.filter(function(f){ return sop.indexOf(f) >= 0; }); } catch(e0) {}
        detector = new BarcodeDetector(hay.length ? { formats: hay } : undefined);
      }
      flujo = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      var v = $("video"); v.srcObject = flujo; await v.play();
      $("visor").style.display = "block"; $("guia").textContent = "Apunta al código de barras";
      timer = setInterval(async function(){
        try { var r = await detector.detect(v); if (r.length) { parar(); if (navigator.vibrate) navigator.vibrate(60); consultar(r[0].rawValue, true); } } catch(e){}
      }, 250);
    } catch(e) {
      parar();
      var negada = e && (e.name === "NotAllowedError" || e.name === "SecurityError");
      $("guia").innerHTML = '<span class="err">' + (negada
        ? 'La cámara está bloqueada para esta página. Actívala en los ajustes del navegador (Permisos › Cámara) o escribe el código.'
        : 'No se pudo usar la cámara de este teléfono. Puedes escribir el código.') + '</span>';
    }
  }
  $("bcam").onclick = camara;

  async function consultar(cod, deCamara){
    cod = String(cod).trim(); if (!cod || !sucursal) return;
    $("guia").textContent = "Buscando…";
    var html, seg = 9;
    try {
      var r = await fetch("/verificador/" + encodeURIComponent(sucursal) + "/" + encodeURIComponent(cod) + "?canal=movil");
      var d = await r.json();
      if (r.ok) {
        var p = fmt(d.precio).split(".");
        html = '<section class="et"><h2>' + esc(d.descripcion) + '</h2><div class="precio"><sup>RD$</sup>' + p[0] + '<small>.' + p[1] + '</small></div>'
          + (d.promocion ? '<div class="promo">' + esc(d.promocion.nombre) + (d.promocion.precioOferta ? ' · RD$ ' + fmt(d.promocion.precioOferta) : '') + '</div>' : '')
          + '<p class="cod">Código ' + esc(d.codigo) + '</p><div class="cuenta"><span style="animation-duration:' + seg + 's"></span></div></section>';
      } else {
        seg = 5;
        html = '<section class="et"><h2>No encontramos este producto</h2><p class="cod">Código ' + esc(cod) + '</p><p class="nota">Pregunta el precio en caja.</p><div class="cuenta"><span style="animation-duration:' + seg + 's"></span></div></section>';
      }
    } catch(e) { html = '<section class="et"><p class="err">Sin conexión con la tienda. Revisa tu conexión e inténtalo de nuevo.</p></section>'; seg = 6; }
    $("guia").textContent = ""; $("res").innerHTML = html; $("codigo").value = "";
    clearTimeout(volver);
    volver = setTimeout(function(){ $("res").innerHTML = ""; if (deCamara && camaraOk) camara(); else $("guia").textContent = ""; }, seg * 1000);
  }
  $("form").onsubmit = function(e){ e.preventDefault(); parar(); consultar($("codigo").value, false); };
})();
</script></body></html>`;
