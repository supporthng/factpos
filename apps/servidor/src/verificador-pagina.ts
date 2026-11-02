/**
 * Página del verificador de precios para tablet o kiosco.
 * Se abre en el navegador: http://<servidor-local>:3000/verificador?sucursal=<id>
 * El lector de código de barras escribe en el campo y "presiona Enter" solo.
 */
export const PAGINA_VERIFICADOR = /* html */ `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Verificador de precios</title>
<link rel="manifest" href="/verificador/manifest.webmanifest">
<meta name="theme-color" content="#10202e">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<style>
  :root { --fondo:#10202e; --tarjeta:#ffffff; --texto:#10202e; --suave:#5d6d7e; --acento:#c0362c; --oferta:#e8833a; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; background:var(--fondo); font-family: system-ui, "Segoe UI", Roboto, sans-serif;
         display:flex; flex-direction:column; align-items:center; justify-content:center; padding:24px; color:var(--texto); }
  .tarjeta { background:var(--tarjeta); border-radius:20px; width:min(720px,100%); padding:40px; text-align:center;
             box-shadow:0 20px 50px rgba(0,0,0,.35); }
  h1 { margin:0 0 8px; font-size:clamp(22px,4vw,34px); }
  .precio { font-size:clamp(56px,12vw,104px); font-weight:800; color:var(--acento); margin:12px 0; letter-spacing:-1px; }
  .tachado { text-decoration:line-through; color:var(--suave); font-size:clamp(26px,5vw,40px); font-weight:600; }
  .oferta { display:inline-block; background:var(--oferta); color:#fff; border-radius:999px; padding:8px 20px;
            font-weight:700; font-size:clamp(18px,3vw,24px); margin-top:8px; }
  .detalle { color:var(--suave); font-size:18px; margin-top:16px; }
  .niveles { display:flex; gap:12px; justify-content:center; flex-wrap:wrap; margin-top:20px; }
  .nivel { background:#eef1f4; border-radius:12px; padding:10px 16px; font-size:16px; }
  .espera { color:#cfd8e0; font-size:clamp(22px,4vw,32px); text-align:center; }
  .error { color:var(--acento); font-size:24px; font-weight:700; }
  #actualiza { position:fixed; inset:0; z-index:50; display:none; align-items:center; justify-content:center; background:rgba(8,16,24,.92); padding:20px; }
  #actualiza .caja { background:#fff; color:#10202e; border-radius:18px; padding:28px 30px; max-width:520px; width:100%; text-align:center; box-shadow:0 10px 40px rgba(0,0,0,.5); }
  #actualiza h2 { margin:0 0 8px; font-size:24px; }
  #actualiza p { margin:6px 0 14px; font-size:18px; }
  #actualiza small { color:#5b6b7a; font-size:14px; }
  .barra-act { height:12px; background:#e3e8ec; border-radius:999px; overflow:hidden; margin:6px 0 14px; }
  .barra-act b { display:block; height:100%; width:30%; background:var(--acento,#c0362c); border-radius:999px; transition:width .6s; }
  .barra-act.ind b { animation:ind 1.4s ease-in-out infinite alternate; }
  @keyframes ind { from { margin-left:0 } to { margin-left:70% } }
  .qrmovil { position:fixed; left:50%; bottom:12px; transform:translateX(-50%); display:flex; align-items:center; gap:10px; background:#fff; color:#10202e; border-radius:14px; padding:8px 14px 8px 8px; font:700 14px system-ui,sans-serif; box-shadow:0 4px 16px rgba(0,0,0,.35); z-index:5; }
  .qrmovil img { width:84px; height:84px; display:block; }
  @media (max-height:560px) { .qrmovil { display:none; } }
  .logo { max-width:min(260px,60vw); max-height:120px; margin-bottom:20px; object-fit:contain; }
  /* El campo del lector sigue activo (recibe lo que escribe el escáner), pero no se ve ni abre el teclado */
  .barra { position:fixed; left:0; bottom:0; width:1px; height:1px; overflow:hidden; opacity:0; pointer-events:none; }
  .barra input { width:1px; height:1px; border:0; padding:0; background:transparent; color:transparent; caret-color:transparent; }
  .ofertas-titulo { color:#fff; font-size:clamp(22px,4vw,34px); font-weight:800; margin-bottom:6px; }
  .ofertas-sub { color:#cfd8e0; margin-bottom:18px; font-size:clamp(14px,2.4vw,20px); }
  .rejilla { display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:14px; width:min(1100px,100%); }
  .oferta-card { background:#fff; color:var(--texto); border:0; border-radius:18px; padding:20px; text-align:left; cursor:pointer; box-shadow:0 8px 24px rgba(0,0,0,.3); }
  .oferta-card:active { transform:scale(.98); }
  .oferta-card b { display:block; font-size:20px; margin-bottom:6px; }
  .oferta-card .t { display:inline-block; background:var(--oferta); color:#fff; border-radius:999px; padding:4px 12px; font-weight:700; font-size:16px; }
  .oferta-card small { display:block; color:var(--suave); margin-top:8px; }
  .lista { text-align:left; margin-top:16px; display:grid; gap:10px; max-height:52vh; overflow:auto; }
  .prod { display:flex; align-items:center; gap:14px; background:#eef1f4; border-radius:14px; padding:10px 14px; }
  .prod img { width:56px; height:56px; object-fit:cover; border-radius:10px; background:#fff; }
  .prod .n { flex:1; font-size:18px; font-weight:600; }
  .prod .p { font-weight:800; font-size:20px; color:var(--acento); text-align:right; }
  .prod .p s { display:block; color:var(--suave); font-weight:600; font-size:14px; }
  .volver { margin-top:18px; font-size:20px; padding:12px 28px; border:0; border-radius:999px; background:var(--fondo); color:#fff; cursor:pointer; }
  .etiqueta { display:flex; align-items:flex-start; justify-content:center; gap:.08em; color:var(--acento); font-weight:800; line-height:1; margin:14px 0 6px; white-space:nowrap; transform-origin:center; }
  .etiqueta .mon { font-size:clamp(22px,4vw,40px); margin-top:.25em; }
  .etiqueta .ent { font-size:clamp(80px,17vw,170px); letter-spacing:-2px; }
  .etiqueta .cts { font-size:clamp(30px,6.5vw,66px); margin-top:.1em; }
  .etiqueta .un { font-size:clamp(16px,3vw,28px); align-self:flex-end; color:var(--suave); font-weight:600; margin-left:.4em; }
  .cuenta { position:absolute; left:0; right:0; top:0; height:8px; background:#e3e8ee; border-radius:20px 20px 0 0; overflow:hidden; }
  .cuenta span { display:block; height:100%; background:var(--acento); transform-origin:left; animation:vaciar var(--seg,10s) linear forwards; }
  @keyframes vaciar { from { transform:scaleX(1); } to { transform:scaleX(0); } }
  .tarjeta { position:relative; overflow:hidden; }
  .codigo-leido { color:var(--suave); font-size:16px; margin-top:6px; }
  .carrusel { position:relative; width:min(1000px,100%); margin:18px auto 8px; touch-action:pan-y; user-select:none; }
  .slide { display:none; background:#fff; color:var(--texto); border-radius:24px; padding:26px; gap:24px; align-items:center; text-align:left; box-shadow:0 14px 40px rgba(0,0,0,.35); cursor:pointer; }
  .slide.on { display:flex; animation:entra .5s ease; }
  @keyframes entra { from { opacity:0; transform:translateX(34px); } to { opacity:1; transform:none; } }
  .fotos { display:flex; gap:10px; }
  .fotos img { width:clamp(80px,16vw,170px); height:clamp(80px,16vw,170px); object-fit:cover; border-radius:16px; background:#eef1f4; }
  .slide .info { flex:1; min-width:0; }
  .s-nombre { font-size:clamp(26px,5vw,48px); font-weight:800; line-height:1.1; margin-bottom:10px; }
  .slide .t { display:inline-block; background:var(--oferta); color:#fff; border-radius:999px; padding:6px 18px; font-weight:700; font-size:clamp(16px,2.8vw,26px); }
  .ahorra { color:var(--acento); font-weight:800; font-size:clamp(20px,3.6vw,34px); margin-top:10px; }
  .s-prods { color:var(--suave); margin-top:8px; font-size:clamp(14px,2.2vw,20px); }
  .s-fin { color:var(--suave); margin-top:10px; font-weight:600; font-size:clamp(14px,2vw,18px); }
  .puntos { display:flex; gap:10px; justify-content:center; margin-top:14px; }
  .punto { width:14px; height:14px; border-radius:50%; border:0; background:rgba(255,255,255,.4); cursor:pointer; padding:0; transition:transform .2s; }
  .punto.on { background:#fff; transform:scale(1.3); }
  .flecha { position:absolute; top:50%; transform:translateY(-50%); width:52px; height:52px; border-radius:50%; border:0; background:rgba(16,32,46,.75); color:#fff; font-size:28px; cursor:pointer; z-index:2; }
  .flecha.ant { left:-10px; } .flecha.sig { right:-10px; }
  .pulso { animation:pulso 2.2s ease-in-out infinite; }
  @keyframes pulso { 0%,100% { opacity:1; } 50% { opacity:.55; } }
  .prod .ah { display:block; color:#2e8b57; font-size:14px; font-weight:700; }
  .sin-conexion { position:fixed; top:12px; right:16px; background:#c0362c; color:#fff; padding:6px 14px; border-radius:999px; font-weight:700; display:none; }
</style>
</head>
<body>
  <div id="vista" class="espera">Pase el producto por el lector<br>para ver su precio</div>
  <div id="actualiza" role="alertdialog" aria-live="polite"><div class="caja"><h2 id="act-t">Actualizando FactPOS</h2><p id="act-p">Preparando…</p><div class="barra-act" id="act-barra"><b id="act-b"></b></div><small>No apague el equipo. Al terminar, la pantalla se abrirá sola.</small></div></div>
  <div class="sin-conexion" id="sinconexion">Sin conexión con el servidor</div>
  <div class="barra"><input id="codigo" autocomplete="off" inputmode="none" autofocus aria-label="Código de barras"></div>
<script>
  const params = new URLSearchParams(location.search);
  let sucursal = params.get("sucursal");
  let logo = null;
  const mostrarNiveles = params.get("niveles") === "1";
  const input = document.getElementById("codigo");
  const vista = document.getElementById("vista");
  let temporizador;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  const rd = (v) => "RD$" + Number(v).toLocaleString("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const SEGUNDOS = 10;
  // Precio como en la etiqueta de góndola: RD$ pequeño, enteros enormes y centavos arriba; siempre cabe a lo ancho
  function etiqueta(precio, porLibra) {
    const [ent, cts] = Number(precio).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).split(".");
    return '<div class="etiqueta"><span class="mon">RD$</span><span class="ent">' + ent + '</span><span class="cts">' + cts + '</span>' + (porLibra ? '<span class="un">/ lb</span>' : "") + '</div>';
  }
  function ajustarPrecio() {
    const e = vista.querySelector(".etiqueta"); if (!e) return;
    e.style.transform = "none";
    const caja = e.parentElement, disponible = caja.clientWidth - 2 * parseFloat(getComputedStyle(caja).paddingLeft);
    if (e.scrollWidth > disponible && disponible > 0) e.style.transform = "scale(" + Math.max(0.35, (disponible / e.scrollWidth) * 0.97) + ")";
  }
  // Si el logo trae fondo blanco, se vuelve transparente (solo el blanco conectado con los bordes: el blanco de adentro del dibujo se queda)
  function quitarFondo(src) {
    return new Promise((res) => {
      const im = new Image();
      im.onload = () => {
        try {
          const w = im.naturalWidth, h = im.naturalHeight;
          if (!w || !h || w * h > 4000000) return res(src);
          const c = document.createElement("canvas"); c.width = w; c.height = h;
          const x = c.getContext("2d"); x.drawImage(im, 0, 0);
          const d = x.getImageData(0, 0, w, h), p = d.data;
          const claro = (k) => p[k * 4 + 3] > 0 && p[k * 4] > 232 && p[k * 4 + 1] > 232 && p[k * 4 + 2] > 232;
          if (!claro(0)) return res(src);   // ya es transparente o no tiene fondo blanco
          const visto = new Uint8Array(w * h), pila = [];
          const meter = (px, py) => { if (px < 0 || py < 0 || px >= w || py >= h) return; const k = py * w + px; if (visto[k]) return; visto[k] = 1; if (claro(k)) pila.push(k); };
          for (let i = 0; i < w; i++) { meter(i, 0); meter(i, h - 1); }
          for (let j = 0; j < h; j++) { meter(0, j); meter(w - 1, j); }
          while (pila.length) { const k = pila.pop(); p[k * 4 + 3] = 0; const px = k % w, py = (k - px) / w; meter(px + 1, py); meter(px - 1, py); meter(px, py + 1); meter(px, py - 1); }
          x.putImageData(d, 0, 0);
          res(c.toDataURL("image/png"));
        } catch (e) { res(src); }
      };
      im.onerror = () => res(src);
      im.src = src;
    });
  }
  let ofertas = [];
  let inactivo, rot, idx = 0, ultimoDeslizar = 0;
  const ahorro = (o) => { let m = 0; o.productos.forEach((p) => { if (p.precio && p.precioOferta) m = Math.max(m, Number(p.precio) - Number(p.precioOferta)); }); return m; };
  const finDe = (o) => {
    const ms = new Date(o.hasta) - Date.now();
    if (ms <= 0) return "";
    const h = Math.floor(ms / 3600000);
    if (h < 24) return h < 1 ? "Termina en " + Math.max(1, Math.round(ms / 60000)) + " min" : "Termina en " + h + " h";
    return "Hasta el " + new Date(o.hasta).toLocaleDateString("es-DO", { day: "numeric", month: "short" });
  };
  function slide(o, i) {
    const imgs = o.productos.filter((p) => p.imagen).slice(0, 3);
    const a = ahorro(o);
    return '<div class="slide' + (i === idx ? " on" : "") + '" data-oferta="' + i + '">' +
      (imgs.length ? '<div class="fotos">' + imgs.map((p) => '<img src="' + esc(p.imagen) + '" alt="">').join("") + '</div>' : "") +
      '<div class="info"><div class="s-nombre">' + esc(o.nombre) + '</div><span class="t">' + esc(o.texto) + '</span>' +
      (a > 0 ? '<div class="ahorra">Ahorra hasta ' + rd(a) + '</div>' : "") +
      '<div class="s-prods">' + esc(o.productos.slice(0, 3).map((p) => p.nombre).join(" · ")) + (o.productos.length > 3 ? " y " + (o.productos.length - 3) + " más" : "") + '</div>' +
      '<div class="s-fin">' + esc(finDe(o)) + ' · toque para ver los productos</div></div></div>';
  }
  function mostrarSlide(n) {
    if (!ofertas.length) return;
    idx = (n + ofertas.length) % ofertas.length;
    document.querySelectorAll(".slide").forEach((el, i) => el.classList.toggle("on", i === idx));
    document.querySelectorAll(".punto").forEach((el, i) => el.classList.toggle("on", i === idx));
  }
  function girar() {
    clearTimeout(rot);
    if (ofertas.length > 1) rot = setTimeout(() => { if (vista.className === "espera") { mostrarSlide(idx + 1); girar(); } }, 7000);
  }
  // Cuadro con el avance cuando el servidor se está actualizando (el mismo estado que muestran la administración y la caja)
  let vioActualizar = false;
  async function estadoActualizacion() {
    let d = null;
    try { const r = await fetch("/actualizacion/estado", { cache: "no-store" }); if (r.ok) d = await r.json(); } catch {}
    const activa = d ? !!d.actualizando : vioActualizar;   // si dejó de responder tras verla, el servidor se está reiniciando
    if (d && d.actualizando) vioActualizar = true;
    if (!activa && vioActualizar && d) { location.reload(); return; }   // terminó: cargar la versión nueva ya
    const el = document.getElementById("actualiza");
    el.style.display = activa ? "flex" : "none";
    if (activa) {
      const destino = d && d.destino ? " a la versión " + String(d.destino).replace(/[.]0$/, "") : "";
      document.getElementById("act-t").textContent = "Actualizando FactPOS" + destino;
      document.getElementById("act-p").textContent = d ? (d.paso || "Preparando…") : "Reiniciando el servidor…";
      const pct = d && typeof d.porcentaje === "number" ? d.porcentaje : null;
      document.getElementById("act-barra").className = "barra-act" + (pct === null ? " ind" : "");
      document.getElementById("act-b").style.width = pct === null ? "" : Math.max(4, pct) + "%";
    }
    setTimeout(estadoActualizacion, activa ? 2500 : 6000);
  }
  estadoActualizacion();
  let arranque = null;   // identifica la versión del servidor: si cambia, la pantalla se recarga sola
  let qrActivo = true;   // lo decide el interruptor de Administración › Verificador
  function qrMovil() {
    if (!qrActivo) return "";
    return '<div class="qrmovil"><img src="/verificador/movil/qr.svg' + (sucursal ? "?sucursal=" + encodeURIComponent(sucursal) : "") + '" alt=""><span>Consulta el precio<br>desde tu celular<br><small style="font-weight:400">Escanea este código</small></span></div>';
  }
  function espera() {
    clearTimeout(inactivo);
    cargarOfertas();
    vista.className = "espera";
    const cab = (logo ? '<img class="logo" src="' + logo + '" alt=""><br>' : "");
    const titulo = cab + '<div class="ofertas-titulo">Consulta de precios</div><div class="ofertas-sub pulso">Pase el producto por el lector para ver su precio</div>';
    if (!ofertas.length) { clearTimeout(rot); vista.innerHTML = titulo + qrMovil(); return; }
    if (idx >= ofertas.length) idx = 0;
    vista.innerHTML = titulo +
      '<div class="ofertas-sub" style="color:#fff;font-weight:700;margin-top:6px">Ofertas de hoy · deslice o toque una para ver sus productos</div>' +
      '<div class="carrusel">' + ofertas.map(slide).join("") +
        (ofertas.length > 1 ? '<button class="flecha ant" data-paso="-1" aria-label="Anterior">&#8249;</button><button class="flecha sig" data-paso="1" aria-label="Siguiente">&#8250;</button>' : "") + '</div>' +
      (ofertas.length > 1 ? '<div class="puntos">' + ofertas.map((_, i) => '<button class="punto' + (i === idx ? " on" : "") + '" data-ir="' + i + '" aria-label="Oferta ' + (i + 1) + '"></button>').join("") + '</div>' : "") +
      (ofertas.length > 1 ? '<div class="ofertas-sub" style="margin-top:18px">Todas las ofertas</div><div class="rejilla">' + ofertas.map((o, i) => '<button class="oferta-card" data-oferta="' + i + '"><b>' + esc(o.nombre) + '</b><span class="t">' + esc(o.texto) + '</span>' +
        '<small>' + o.productos.length + (o.productos.length === 1 ? " producto" : " productos") + ' · ' + esc(finDe(o)) + '</small></button>').join("") + '</div>' : "") + qrMovil();
    girar();
  }
  function detalleOferta(i) {
    const o = ofertas[i]; if (!o) return;
    clearTimeout(temporizador); clearTimeout(inactivo); clearTimeout(rot);
    vista.className = "";
    vista.innerHTML = '<div class="tarjeta"><h1>' + esc(o.nombre) + '</h1><div class="oferta">' + esc(o.texto) + '</div><div class="lista">' +
      o.productos.map((p) => '<div class="prod">' + (p.imagen ? '<img src="' + esc(p.imagen) + '" alt="">' : "") + '<div class="n">' + esc(p.nombre) + '</div><div class="p">' +
        (p.precioOferta ? '<s>' + rd(p.precio) + '</s>' + rd(p.precioOferta) + '<span class="ah">Ahorra ' + rd(Number(p.precio) - Number(p.precioOferta)) + '</span>' : (p.precio ? rd(p.precio) : "")) + '</div></div>').join("") +
      '</div><button class="volver" data-volver="1">Volver a las ofertas</button></div>';
    inactivo = setTimeout(espera, 45000); // si nadie lo toca, vuelve solo
  }
  vista.addEventListener("click", (e) => {
    if (Date.now() - ultimoDeslizar < 400) return;   // fue un deslizamiento, no un toque
    const t = e.target.closest("[data-oferta],[data-volver],[data-ir],[data-paso]");
    if (!t) return;
    if (t.dataset.volver) espera();
    else if (t.dataset.ir !== undefined) { mostrarSlide(Number(t.dataset.ir)); girar(); }
    else if (t.dataset.paso !== undefined) { mostrarSlide(idx + Number(t.dataset.paso)); girar(); }
    else detalleOferta(Number(t.dataset.oferta));
  });
  // Deslizar el carrusel con el dedo (o el mouse)
  let x0 = null;
  vista.addEventListener("pointerdown", (e) => { x0 = e.target.closest(".carrusel") ? e.clientX : null; });
  vista.addEventListener("pointerup", (e) => {
    if (x0 === null) return;
    const dx = e.clientX - x0; x0 = null;
    if (Math.abs(dx) > 50) { ultimoDeslizar = Date.now(); mostrarSlide(idx + (dx < 0 ? 1 : -1)); girar(); }
  });
  async function cargarOfertas() {
    if (!sucursal) return;
    try {
      const r = await fetch("/verificador/ofertas?sucursal=" + encodeURIComponent(sucursal));
      if (r.ok) {
        const nuevas = await r.json();
        const cambio = JSON.stringify(nuevas) !== JSON.stringify(ofertas);
        ofertas = nuevas;
        if (cambio && vista.className === "espera") espera();   // solo se redibuja si cambió algo
      }
    } catch {}
  }
  setInterval(async function () {   // el interruptor del QR también se aplica sin reiniciar
    try {
      const r = await fetch("/verificador/config" + (sucursal ? "?sucursal=" + encodeURIComponent(sucursal) : ""));
      if (!r.ok) return;
      const c = await r.json();
      if (arranque && c.arranque && c.arranque !== arranque) { location.reload(); return; }
      const nuevo = c.mostrarQr !== false;
      if (nuevo !== qrActivo) { qrActivo = nuevo; if (vista.className === "espera") espera(); }
    } catch {}
  }, 30 * 1000);
  setInterval(cargarOfertas, 30 * 1000); // las ofertas nuevas aparecen en menos de 30 segundos
  // Sin ?sucursal=: el servidor dice cuál es (un servidor de sucursal atiende una sola) y entrega la marca de la empresa
  async function cargarConfig() {
    try {
      const r = await fetch("/verificador/config" + (sucursal ? "?sucursal=" + encodeURIComponent(sucursal) : ""));
      if (!r.ok) return;
      const c = await r.json();
      sucursal = sucursal || c.sucursalId;
      qrActivo = c.mostrarQr !== false;
      arranque = c.arranque;
      logo = c.logo ? await quitarFondo(c.logo) : null;
      if (c.secundario) document.documentElement.style.setProperty("--fondo", c.secundario);
      if (c.primario) document.documentElement.style.setProperty("--acento", c.primario);
      await cargarOfertas();
      espera();
      document.getElementById("sinconexion").style.display = "none";
    } catch { document.getElementById("sinconexion").style.display = "block"; setTimeout(cargarConfig, 5000); }
  }
  // Pantalla siempre encendida y completa (Android: instale la página en la pantalla de inicio; Windows: Edge en modo kiosco)
  async function mantenerActiva() { try { if ("wakeLock" in navigator) await navigator.wakeLock.request("screen"); } catch {} }
  mantenerActiva(); document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") mantenerActiva(); });
  document.addEventListener("pointerdown", () => { if (!document.fullscreenElement && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {}); }, { once: true });
  cargarConfig();
  function enfocar() { if (document.activeElement && document.activeElement.tagName === "INPUT" && document.activeElement !== input) return; input.focus(); }
  document.addEventListener("click", enfocar);
  setInterval(enfocar, 1000);


  input.addEventListener("keydown", async (e) => {
    if (e.key !== "Enter") return;
    const codigo = input.value.trim();
    input.value = "";
    if (!codigo) return;
    if (!sucursal) { await cargarConfig(); if (!sucursal) { vista.className = ""; vista.innerHTML = '<div class="tarjeta"><p class="error">Falta configurar la sucursal</p><p class="detalle">Abra esta página con ?sucursal=ID_DE_LA_SUCURSAL</p></div>'; return; } }
    clearTimeout(temporizador);
    try {
      const r = await fetch("/verificador/" + encodeURIComponent(sucursal) + "/" + encodeURIComponent(codigo));
      document.getElementById("sinconexion").style.display = "none";
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Producto no encontrado");
      let html = '<div class="tarjeta"><div class="cuenta"><span style="--seg:' + SEGUNDOS + 's"></span></div><h1>' + esc(d.descripcion) + '</h1><div class="codigo-leido">Código ' + esc(codigo) + '</div>';
      if (d.promocion && d.promocion.precioOferta) {
        html += '<div class="tachado">' + rd(d.precio) + '</div>';
        html += etiqueta(d.promocion.precioOferta, false);
      } else {
        html += etiqueta(d.precio, d.pesable);
      }
      if (d.promocion) html += '<div class="oferta">' + esc(d.promocion.nombre) + '</div>';
      if (d.peso !== null) html += '<div class="detalle">Peso: ' + d.peso.toFixed(3) + ' — Importe: ' + esc(d.importe) + '</div>';
      html += '<div class="detalle">' + (d.itbisIncluido ? 'ITBIS incluido' : 'Precio sin ITBIS') + '</div>';
      if (mostrarNiveles && d.niveles.length > 1) {
        html += '<div class="niveles">' + d.niveles.map((n) => '<div class="nivel"><b>' + esc(n.lista) + '</b><br>' + rd(n.precio) + '</div>').join("") + '</div>';
      }
      vista.className = "";
      vista.innerHTML = html + '</div>';
      ajustarPrecio();
    } catch (err) {
      vista.className = "";
      if (err instanceof TypeError) document.getElementById("sinconexion").style.display = "block";
      vista.innerHTML = '<div class="tarjeta"><p class="error">' + esc(err instanceof TypeError ? "Sin conexión con el servidor" : "No encontramos este producto") + '</p><p class="detalle">' + (err instanceof TypeError ? "Consulte con un empleado" : "Código " + esc(codigo) + ". Consulte el precio en caja.") + '</p></div>';
    }
    temporizador = setTimeout(espera, SEGUNDOS * 1000);
  });
</script>
</body>
</html>`;
