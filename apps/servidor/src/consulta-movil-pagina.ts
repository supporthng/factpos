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
.visor .linterna{position:absolute;right:10px;top:10px;border:0;border-radius:999px;padding:8px 12px;font-size:14px;font-weight:700;background:rgba(0,0,0,.55);color:#fff}.visor .linterna.encendida{background:#ffd54a;color:#10202e}
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
.bien{background:var(--f);color:#fff;border-radius:18px;padding:18px 18px 16px;margin-top:16px;text-align:center}
.bien h2{margin:0 0 6px;font-size:21px}.bien p{margin:0;opacity:.85;font-size:15px;line-height:1.4}
.ofs{margin-top:14px}.ofs h3{margin:0 0 8px;font-size:16px;color:var(--f)}
.of{background:#fff;border-radius:14px;padding:14px 16px;margin-bottom:10px;box-shadow:0 2px 10px rgba(16,32,46,.1);border-left:6px solid var(--m)}
.of b{display:block;font-size:17px}.of .tx{display:inline-block;margin:6px 0;background:#fff1cf;color:#7a4b00;border-radius:999px;padding:4px 12px;font-weight:700;font-size:14px}
.of .hasta{color:#7a8794;font-size:12px;margin-left:6px}
.of ul{list-style:none;margin:6px 0 0;padding:0;font-size:14px;color:#3a4a58}
.of li{display:flex;justify-content:space-between;gap:10px;padding:3px 0;border-top:1px solid #eef1f4}
.of li s{color:#8a96a3;margin-right:6px;white-space:nowrap}.of li strong{color:#b3261e;white-space:nowrap}.of li span:last-child{white-space:nowrap;text-align:right}
.et.aviso{background:#fff1f0;border:3px solid #d93025;padding:26px 18px 18px;animation:sacude .5s}
.et.aviso .ico{font-size:54px;line-height:1}
.et.aviso h2{color:#b3261e;font-size:26px;margin:8px 0 6px}
.et.aviso .grande{font-size:44px;font-weight:800;color:#b3261e;line-height:1.1;margin:6px 0}
.et.aviso p{color:#3b1512;font-size:17px;margin:6px 0}
.et.aviso .cuenta span{background:#d93025}
@keyframes sacude{0%,100%{transform:translateX(0)}20%{transform:translateX(-8px)}40%{transform:translateX(8px)}60%{transform:translateX(-5px)}80%{transform:translateX(5px)}}
.cuenta{height:4px;background:#e3e8ec;margin:14px -20px 0}.cuenta span{display:block;height:100%;background:var(--m);width:100%;animation:c linear forwards}
@keyframes c{to{width:0}}
</style></head><body>
<header><img id="logo" alt="" hidden><div><b id="empresa">Consulta de precios</b><small id="suc"></small></div></header>
<main>
  <div class="visor" id="visor"><video id="video" playsinline muted></video><i></i></div>
  <p class="guia" id="guia"></p>
  <button class="boton" id="bcam" hidden>Escanear con la cámara</button>
  <button class="boton claro" id="bfoto">Tomar foto del código</button>
  <input type="file" id="archivo" accept="image/*" capture="environment" hidden>
  <div id="permiso"></div>
  <form id="form"><input id="codigo" inputmode="numeric" autocomplete="off" placeholder="Escribe el código de barras"><button>Ver</button></form>
  <div id="res"></div>
  <div id="bienvenida"></div>
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
    if (c.exigeUbicacion && !c.ubicacionLista) {   // la tienda aún no guardó su ubicación: no se abre el lector
      $("bcam").style.display = "none"; $("bfoto").style.display = "none"; $("guia").textContent = "";
      $("form").style.display = "none";
      $("permiso").innerHTML = '<section class="et aviso"><div class="ico">&#9888;</div><h2>Ubicación de la tienda no configurada</h2>'
        + '<p>Esta tienda todavía no activó la consulta de precios desde el celular.</p><p>Pregunta el precio en caja.</p></section>';
      return;
    }
    setTimeout(arranque, 200);   // al entrar se pide la ubicación y se abre la cámara, sin pulsar nada
    bienvenida(c);
  }).catch(function(){ $("guia").innerHTML = '<span class="err">No se pudo conectar con la tienda. Verifica que estés en su WiFi.</span>'; });

  // La cámara se ofrece si el navegador la permite (en HTTPS). Si el teléfono no trae lector de códigos propio
  // (por ejemplo algunos iPhone), se usa uno de respaldo que se descarga la primera vez que se pulsa el botón.
  var camaraOk = window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
  if (camaraOk) $("bcam").hidden = false;
  else $("guia").textContent = "Escribe el número que aparece bajo el código de barras.";

  // Lector de códigos de barras (el mismo que ya funciona en Prezio): el del navegador (Chrome de Android) o, si no hay,
  // ZXing-C++ de la librería barcode-detector (versión fija). Solo se aceptan lecturas seguras: dígito verificador correcto,
  // código sobre la línea roja y el mismo código en 3 imágenes seguidas.
  var LECTOR_URL = "https://cdn.jsdelivr.net/npm/barcode-detector@3.1.3/dist/iife/ponyfill.js";
  var FORMATOS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39"];
  var CONFIRMACIONES = 3, ESPERA_INICIAL = 1000;
  var detectorListo = null, lector = null;
  function cargarScript(src){
    return new Promise(function(ok, mal){
      var sc = document.createElement("script");
      sc.src = src; sc.async = true; sc.crossOrigin = "anonymous";
      sc.onload = function(){ ok(); }; sc.onerror = function(){ mal(new Error("lector")); };
      document.head.appendChild(sc);
    });
  }
  async function obtenerDetector(){
    if (window.BarcodeDetector) {
      try {
        var sop = (await window.BarcodeDetector.getSupportedFormats()) || [];
        var f = FORMATOS.filter(function(x){ return sop.indexOf(x) >= 0; });
        if (f.length) return new window.BarcodeDetector({ formats: f });
      } catch(e) { /* se usa la versión compatible */ }
    }
    if (!(window.BarcodeDetectionAPI && window.BarcodeDetectionAPI.BarcodeDetector)) await cargarScript(LECTOR_URL);
    if (!(window.BarcodeDetectionAPI && window.BarcodeDetectionAPI.BarcodeDetector)) throw new Error("lector");
    return new window.BarcodeDetectionAPI.BarcodeDetector({ formats: FORMATOS });
  }
  function pedirDetector(){
    if (!detectorListo) detectorListo = obtenerDetector().catch(function(e){ detectorListo = null; throw e; });
    return detectorListo;
  }
  /** Dígito verificador de EAN-13, EAN-8 y UPC-A (descarta lecturas equivocadas). */
  function digitoValido(valor, formato){
    if (["ean_13", "ean_8", "upc_a"].indexOf(formato || "") < 0) return true;
    if (!/^[0-9]+$/.test(valor) || [8, 12, 13].indexOf(valor.length) < 0) return false;
    var d = valor.split("").map(Number), control = d.pop(), suma = 0;
    d.reverse().forEach(function(x, k){ suma += x * (k % 2 === 0 ? 3 : 1); });
    return (10 - (suma % 10)) % 10 === control;
  }
  /** Los UPC-E a veces llegan expandidos: se devuelven como están impresos (8 dígitos). */
  function upceImpreso(valor, formato){
    if (formato !== "upc_e" || !/^[0-9]+$/.test(valor) || valor.length === 8) return valor;
    var a = valor;
    if (a.length === 13 && a[0] === "0") a = a.slice(1);
    if (a.length !== 12 || "01".indexOf(a[0]) < 0) return valor;
    var ns = a[0], f = a.slice(1, 6), p = a.slice(6, 11), c = a[11], d = null;
    if ("012".indexOf(f[2]) >= 0 && f.slice(3) === "00" && p.slice(0, 2) === "00") d = f.slice(0, 2) + p.slice(2, 5) + f[2];
    else if (f.slice(3) === "00" && p.slice(0, 3) === "000") d = f.slice(0, 3) + p.slice(3, 5) + "3";
    else if (f[4] === "0" && p.slice(0, 4) === "0000") d = f.slice(0, 4) + p[4] + "4";
    else if (p.slice(0, 4) === "0000" && "56789".indexOf(p[4]) >= 0) d = f + p[4];
    return d ? ns + d + c : valor;
  }

  // Pitido de lector (un audio corto: suena también con el iPhone en silencio, después de un primer toque en la pantalla)
  function crearWav(segundos, conTono){
    var sr = 22050, n = Math.floor(sr * segundos), buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    function txt(o, t){ for (var k = 0; k < t.length; k++) v.setUint8(o + k, t.charCodeAt(k)); }
    txt(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); txt(8, "WAVE"); txt(12, "fmt ");
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    txt(36, "data"); v.setUint32(40, n * 2, true);
    for (var k = 0; conTono && k < n; k++) {
      var env = Math.min(1, k / 150, (n - k) / 300);
      var onda = Math.sin((2 * Math.PI * 2700 * k) / sr) >= 0 ? 1 : -1;
      v.setInt16(44 + k * 2, Math.round(onda * env * 0.55 * 32767), true);
    }
    return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
  }
  var sonido = null;
  function activarAudio(){
    try {
      if (!sonido) { var tono = crearWav(0.12, true); sonido = { bip: new Audio(tono), tono: tono, silencio: crearWav(0.05, false), listo: false }; }
      if (sonido.listo) return;
      var s = sonido;
      s.bip.src = s.silencio;
      s.bip.play().then(function(){ s.listo = true; s.bip.pause(); s.bip.src = s.tono; s.bip.load(); }).catch(function(){ s.bip.src = s.tono; });
    } catch(e) {}
  }
  function pitido(){
    if (!sonido) return;
    try { sonido.bip.currentTime = 0; } catch(e) {}
    try { sonido.bip.play().catch(function(){}); } catch(e) {}
  }

  function parar(){
    if (lector) { lector.detener(); lector = null; }
    $("visor").style.display = "none";
  }
  function leido(texto){ parar(); if (navigator.vibrate) navigator.vibrate(60); consultar(texto, true); }

  /** Abre la cámara en el visor y llama alLeer(código) con una lectura segura. avisar recibe las guías. */
  async function abrirLector(caja, video, alLeer, avisar){
    var stream = null, abierto = 0, activo = true, candidato = null, guia = "", guiaT = 0, lienzo = document.createElement("canvas");
    var GUIA = ["Pon el código sobre la línea roja", "Acerca un poco el teléfono", "Aleja un poco el teléfono", "Mantén el teléfono quieto un momento"];
    var guias = setInterval(function(){
      if (!abierto) return;
      var seg = (Date.now() - abierto) / 1000, reciente = Date.now() - guiaT < 700;
      if (reciente && guia === "enfocando") avisar("Enfocando… mantén el teléfono quieto");
      else if (reciente && guia === "acercar") avisar("Acerca el código: se ve muy pequeño");
      else if (reciente && guia === "centrar") avisar("Pon el código sobre la línea roja");
      else avisar(seg < 2.5 ? "Distancia ideal: 15 a 20 cm del código" : GUIA[Math.floor((seg - 2.5) / 2.2) % GUIA.length]);
    }, 500);
    function detener(){
      activo = false; clearInterval(guias);
      if (stream) stream.getTracks().forEach(function(t){ t.stop(); });
      video.srcObject = null;
      var b = caja.querySelectorAll(".linterna"); for (var k = 0; k < b.length; k++) b[k].remove();
    }
    try {
      avisar("Abriendo la cámara…");
      var detectorPedido = pedirDetector();
      detectorPedido.catch(function(){});
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } });
      video.setAttribute("playsinline", ""); video.muted = true; video.autoplay = true; video.srcObject = stream;
      await video.play().catch(function(){});
      var pista = stream.getVideoTracks()[0];
      try {
        var cap = (pista.getCapabilities ? pista.getCapabilities() : {}) || {};
        if (cap.focusMode && cap.focusMode.indexOf("continuous") >= 0) await pista.applyConstraints({ advanced: [{ focusMode: "continuous" }] });
        if (cap.torch) {
          var encendida = false, bl = document.createElement("button");
          bl.type = "button"; bl.className = "linterna"; bl.textContent = "Luz"; bl.setAttribute("aria-label", "Encender linterna");
          bl.addEventListener("click", async function(ev){
            ev.stopPropagation();
            try { encendida = !encendida; await pista.applyConstraints({ advanced: [{ torch: encendida }] }); bl.classList.toggle("encendida", encendida); }
            catch(e) { bl.remove(); }
          });
          caja.appendChild(bl);
        }
      } catch(e) { /* sin enfoque ni linterna: igual lee */ }
      var detector = await detectorPedido;
      abierto = Date.now();
      var ciclo = async function(){
        if (!activo) return;
        try {
          if (video.readyState >= 2 && video.videoWidth) {
            var escala = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
            var w = (lienzo.width = Math.round(video.videoWidth * escala)), h = (lienzo.height = Math.round(video.videoHeight * escala));
            lienzo.getContext("2d", { willReadFrequently: true }).drawImage(video, 0, 0, w, h);
            var r = (await detector.detect(lienzo)) || [];
            if (!activo) return;
            var ahora = Date.now(), elegido = null, motivo = null;
            for (var q = 0; q < r.length; q++) {
              var c = r[q], valor = upceImpreso(String(c.rawValue == null ? "" : c.rawValue).trim(), c.format);
              if (!valor || !digitoValido(valor, c.format)) continue;
              var b = c.boundingBox, pos = "ok";
              if (b && b.width) {
                var cy = h / 2, cx = b.x + b.width / 2;
                if (Math.max(b.width, b.height) < 0.12 * Math.min(w, h)) pos = "acercar";
                else if (!(b.y <= cy + 0.12 * h && b.y + b.height >= cy - 0.12 * h) || cx < 0.15 * w || cx > 0.85 * w) pos = "centrar";
              }
              if (pos === "ok") { elegido = valor; break; }
              if (!motivo) motivo = pos;
            }
            if (elegido && ahora - abierto >= ESPERA_INICIAL) {
              if (candidato && candidato.valor === elegido && ahora - candidato.t < 800) { candidato.veces++; candidato.t = ahora; }
              else candidato = { valor: elegido, veces: 1, t: ahora };
              if (candidato.veces >= CONFIRMACIONES) { pitido(); detener(); alLeer(elegido); return; }
              guia = "enfocando"; guiaT = ahora;
            } else if (motivo) { guia = motivo; guiaT = ahora; }
            if (candidato && ahora - candidato.t > 800) candidato = null;
          }
        } catch(e) { /* una imagen mala no detiene el lector */ }
        setTimeout(ciclo, 110);
      };
      ciclo();
    } catch(e) { detener(); throw e; }
    return { detener: detener };
  }
  async function camara(){
    activarAudio();
    clearTimeout(volver); $("res").innerHTML = ""; parar();
    $("visor").style.display = "block"; $("guia").textContent = "Abriendo la cámara…";
    try {
      lector = await abrirLector($("visor"), $("video"), function(cod){ lector = null; leido(cod); }, function(t){ $("guia").textContent = t; });
      ubicacion();   // el permiso de ubicación se pide desde ya, no al leer el primer código
    } catch(e) {
      parar();
      var negada = e && (e.name === "NotAllowedError" || e.name === "SecurityError");
      var sinLector = e && e.message === "lector";
      $("guia").innerHTML = '<span class="err">' + (negada
        ? 'La cámara está bloqueada para esta página. Actívala en los ajustes del navegador (Permisos › Cámara) o escribe el código.'
        : sinLector ? 'No se pudo cargar el lector de códigos. Revisa tu conexión o escribe el código.'
        : 'No se pudo usar la cámara de este teléfono. Puedes escribir el código.') + '</span>';
    }
  }
  $("bcam").onclick = camara;

  // Foto con la cámara normal del teléfono (enfoca y tiene más resolución): se lee el código de la foto con el mismo lector
  function cargarImagen(url){
    return new Promise(function(ok, mal){ var i = new Image(); i.onload = function(){ ok(i); }; i.onerror = function(){ mal(new Error("imagen")); }; i.src = url; });
  }
  $("bfoto").onclick = function(){ activarAudio(); $("archivo").value = ""; $("archivo").click(); };
  $("archivo").onchange = async function(){
    var f = this.files && this.files[0]; if (!f) return;
    parar(); clearTimeout(volver); $("res").innerHTML = ""; $("guia").textContent = "Leyendo la foto…";
    var url = null;
    try {
      var det = await pedirDetector();
      url = URL.createObjectURL(f);
      var img = await cargarImagen(url), texto = null, lados = [1800, 1200, 800];
      for (var k = 0; k < lados.length && !texto; k++) {
        var esc = Math.min(1, lados[k] / Math.max(img.naturalWidth, img.naturalHeight));
        var cv = document.createElement("canvas"); cv.width = Math.max(1, Math.round(img.naturalWidth * esc)); cv.height = Math.max(1, Math.round(img.naturalHeight * esc));
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
        var rs = (await det.detect(cv)) || [];
        for (var q = 0; q < rs.length && !texto; q++) {
          var v = upceImpreso(String(rs[q].rawValue == null ? "" : rs[q].rawValue).trim(), rs[q].format);
          if (v && digitoValido(v, rs[q].format)) texto = v;
        }
      }
      if (texto) { pitido(); if (navigator.vibrate) navigator.vibrate(60); $("guia").textContent = ""; consultar(texto, false); }
      else $("guia").innerHTML = '<span class="err">No se pudo leer el código en la foto. Tómala con el código de frente, enfocado y sin reflejo, o escríbelo.</span>';
    } catch(e) {
      $("guia").innerHTML = '<span class="err">No se pudo leer la foto. Revisa tu conexión o escribe el código.</span>';
    } finally { if (url) URL.revokeObjectURL(url); }
  };

  // Bienvenida y ofertas vigentes de la sucursal (si el dueño las tiene encendidas en Verificador)
  function bienvenida(c){
    $("bienvenida").innerHTML = '<section class="bien"><h2>¡Bienvenido a ' + esc(c.empresa) + '!</h2><p>' + esc(c.nombre) + '<br>Escanea el código de barras de un producto y mira su precio al instante.</p></section><div class="ofs" id="ofs"></div>';
    fetch("/verificador/ofertas?sucursal=" + encodeURIComponent(sucursal)).then(function(r){ return r.ok ? r.json() : []; }).then(function(of){
      if (!of || !of.length) return;
      var h = '<h3>Ofertas vigentes</h3>';
      of.slice(0, 6).forEach(function(o){
        var hasta = ""; try { hasta = new Date(o.hasta).toLocaleDateString("es-DO", { day: "numeric", month: "short" }); } catch(e) {}
        h += '<div class="of"><b>' + esc(o.nombre) + '</b><span class="tx">' + esc(o.texto) + '</span>' + (hasta ? '<span class="hasta">hasta ' + esc(hasta) + '</span>' : '');
        var pr = (o.productos || []).slice(0, 3);
        if (pr.length) {
          h += '<ul>';
          pr.forEach(function(x){
            var tiene = x.precioOferta != null && x.precio != null;
            h += '<li><span>' + esc(x.nombre) + '</span><span>' + (tiene ? '<s>RD$ ' + fmt(x.precio) + '</s><strong>RD$ ' + fmt(x.precioOferta) + '</strong>' : (x.precio != null ? '<strong>RD$ ' + fmt(x.precio) + '</strong>' : '')) + '</span></li>';
          });
          h += '</ul>';
        }
        h += '</div>';
      });
      $("ofs").innerHTML = h;
    }).catch(function(){});
  }

  // Ubicación del teléfono: por internet el servidor solo responde a quien está en la tienda (en el WiFi de la tienda no hace falta)
  var ubicNegada = false;
  function ubicacion(){
    return new Promise(function(ok){
      if (!window.isSecureContext || !navigator.geolocation) return ok(null);
      navigator.geolocation.getCurrentPosition(
        function(p){ ubicNegada = false; ok({ lat: p.coords.latitude, lng: p.coords.longitude, pre: p.coords.accuracy }); },
        function(er){ if (er && er.code === 1) ubicNegada = true; ok(null); },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
    });
  }
  var PASOS_UBICACION = 'Toca «aA» o el candado junto a la dirección › Ajustes del sitio web › Ubicación › <b>Permitir</b>, y vuelve a intentar.';
  // Si el teléfono tiene la ubicación bloqueada para esta página, se avisa desde el primer momento (no al leer el primer código)
  function avisoPermiso(){
    $("permiso").innerHTML = '<section class="et aviso"><div class="ico">&#128205;</div><h2>Activa tu ubicación</h2>'
      + '<p>Para ver precios hay que <b>permitir la ubicación</b> de este teléfono: los precios solo se consultan dentro de la tienda.</p><p>' + PASOS_UBICACION + '</p>'
      + '<button class="boton" id="breint">Ya la activé, reintentar</button></section>';
    $("breint").onclick = function(){ ubicacion().then(function(u){ if (u) $("permiso").innerHTML = ""; else if (!ubicNegada) $("permiso").innerHTML = ""; }); };
  }
  // Tarjeta roja de error de la consulta (fuera de la tienda, sin ubicación, no disponible); con seg lleva la cuenta regresiva
  function tarjetaError(d, seg){
    var dist = function(m){ return m >= 1000 ? (m / 1000).toFixed(1) + " km" : Math.round(m) + " m"; };
    var cuenta = seg ? '<div class="cuenta"><span style="animation-duration:' + seg + 's"></span></div>' : '';
    if (d.codigo === "FUERA_DE_TIENDA") {
      return '<section class="et aviso"><div class="ico">&#9888;</div><h2>Estás fuera de la tienda</h2><div class="grande">a ' + dist(d.distanciaM || 0) + '</div>'
        + '<p>Los precios solo se consultan <b>dentro de la tienda</b>.</p>' + cuenta + '</section>';
    }
    if (d.codigo === "UBICACION_REQUERIDA") {
      return '<section class="et aviso"><div class="ico">&#128205;</div><h2>Activa tu ubicación</h2>'
        + '<p>Para ver precios hay que <b>permitir la ubicación</b> de este teléfono.</p><p>' + PASOS_UBICACION + '</p>' + cuenta + '</section>';
    }
    return '<section class="et aviso"><div class="ico">&#9888;</div><h2>No disponible</h2><p>' + esc(d.error || "No se pudo consultar") + '</p>' + cuenta + '</section>';
  }
  // Al entrar: primero se pide la ubicación (el teléfono pregunta solo) y enseguida se abre la cámara
  function controles(ver){
    var d = ver ? "" : "none";
    $("bcam").style.display = d; $("bfoto").style.display = d; $("form").style.display = d; $("bienvenida").style.display = d;
  }
  // Al abrir la pantalla se comprueba la distancia a la tienda: si está fuera, se avisa y NO se abre el lector
  function comprobar(){
    return ubicacion().then(function(u){
      if (!u) { if (ubicNegada) avisoPermiso(); return true; }
      return fetch("/verificador/ubicacion?sucursal=" + encodeURIComponent(sucursal) + "&lat=" + u.lat + "&lng=" + u.lng + "&pre=" + Math.round(u.pre))
        .then(function(r){ return r.ok ? { ok: true } : r.json().then(function(d){ return { ok: false, d: d }; }); })
        .catch(function(){ return { ok: true }; })
        .then(function(x){
          if (x.ok) { $("permiso").innerHTML = ""; controles(true); return true; }
          if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
          controles(false); $("guia").textContent = "";
          $("permiso").innerHTML = tarjetaError(x.d, 0) + '<button class="boton" id="brev">Volver a comprobar</button>';
          $("brev").onclick = function(){ $("permiso").innerHTML = ""; comprobar().then(function(ok){ if (ok) arranque(); }); };
          return false;
        });
    });
  }
  function arranque(){
    comprobar().then(function(dentro){
      if (dentro && window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) camara();
    });
  }
  async function consultar(cod, deCamara){
    cod = String(cod).trim(); if (!cod || !sucursal) return;
    $("guia").textContent = "Buscando…";
    var u = await ubicacion();
    var html, seg = 9;
    try {
      var r = await fetch("/verificador/" + encodeURIComponent(sucursal) + "/" + encodeURIComponent(cod) + "?canal=movil" + (u ? "&lat=" + u.lat + "&lng=" + u.lng + "&pre=" + Math.round(u.pre) : ""));
      var d = await r.json();
      if (r.ok) {
        var p = fmt(d.precio).split(".");
        html = '<section class="et"><h2>' + esc(d.descripcion) + '</h2><div class="precio"><sup>RD$</sup>' + p[0] + '<small>.' + p[1] + '</small></div>'
          + (d.promocion ? '<div class="promo">' + esc(d.promocion.nombre) + (d.promocion.precioOferta ? ' · RD$ ' + fmt(d.promocion.precioOferta) : '') + '</div>' : '')
          + '<p class="cod">Código ' + esc(d.codigo) + '</p><div class="cuenta"><span style="animation-duration:' + seg + 's"></span></div></section>';
      } else if (r.status === 403 || r.status === 429) {
        seg = 12;
        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
        html = tarjetaError(d, seg);
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
