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
  :root { --fondo:#10202e; --hondo:#08121b; --acento:#c0362c; --destello:#ff8a7a; --tinta:#ffffff; --tinta-suave:rgba(255,255,255,.74);
          --vidrio:rgba(255,255,255,.10); --borde:rgba(255,255,255,.22); --brillo:rgba(192,54,44,.42); }
  * { box-sizing:border-box; }
  html, body { margin:0; min-height:100vh; }
  body { color:var(--tinta); font-family:"Segoe UI Variable Display","Segoe UI",system-ui,-apple-system,Roboto,"Helvetica Neue",sans-serif;
         background:radial-gradient(70% 60% at 85% -5%, var(--brillo), transparent 70%), linear-gradient(165deg, var(--fondo), var(--hondo)) fixed;
         overflow-x:hidden; -webkit-font-smoothing:antialiased; }
  #vista { min-height:100vh; display:flex; flex-direction:column; }
  button { font:inherit; color:inherit; }
  button:focus-visible { outline:3px solid var(--destello); outline-offset:3px; }

  /* Cabecera: marca de la tienda y hora */
  .cab { display:flex; align-items:center; gap:16px; padding:clamp(14px,2.6vh,28px) clamp(18px,3vw,44px) 0; }
  .logo { height:clamp(44px,8vh,76px); max-width:150px; object-fit:contain; }
  .marca { display:flex; flex-direction:column; line-height:1.2; min-width:0; }
  .marca b { font-size:clamp(16px,2.2vw,24px); font-weight:700; }
  .marca span { color:var(--tinta-suave); font-size:clamp(13px,1.6vw,18px); }
  .cab time { margin-left:auto; font-size:clamp(18px,2.4vw,28px); font-weight:300; color:var(--tinta-suave); font-variant-numeric:tabular-nums; }

  /* Espera: mensaje a un lado, ofertas al otro */
  .cuerpo { flex:1; display:grid; align-items:center; justify-items:center; gap:clamp(18px,4vw,64px); padding:clamp(10px,2vh,24px) clamp(18px,4vw,64px) clamp(110px,16vh,150px); }
  .cuerpo.con-ofertas { grid-template-columns:minmax(0,1fr) minmax(0,1.15fr); }
  @media (max-width:860px), (max-aspect-ratio:1/1) { .cuerpo.con-ofertas { grid-template-columns:1fr; } }
  .hero { text-align:center; max-width:640px; width:100%; }
  .hero h1 { margin:clamp(14px,3vh,34px) 0 8px; font-size:clamp(30px,4.6vw,68px); font-weight:700; line-height:1.05; letter-spacing:-.02em; }
  .hero p { margin:0; font-size:clamp(16px,2.2vw,28px); font-weight:300; color:var(--tinta-suave); }

  /* Ventana de lectura con el láser */
  .visor { position:relative; width:min(380px,62%); aspect-ratio:3/2; margin:0 auto; padding:9% 11%; display:flex; align-items:center; }
  .cuerpo.con-ofertas .visor { width:min(300px,56%); }
  .visor .codigo { width:100%; height:100%; opacity:.92; }
  .visor .codigo svg { width:100%; height:100%; display:block; fill:var(--tinta); }
  .visor i { position:absolute; width:12%; height:18%; border:0 solid var(--destello); }
  .visor i:nth-child(1) { left:0; top:0; border-width:4px 0 0 4px; border-radius:14px 0 0 0; }
  .visor i:nth-child(2) { right:0; top:0; border-width:4px 4px 0 0; border-radius:0 14px 0 0; }
  .visor i:nth-child(3) { left:0; bottom:0; border-width:0 0 4px 4px; border-radius:0 0 0 14px; }
  .visor i:nth-child(4) { right:0; bottom:0; border-width:0 4px 4px 0; border-radius:0 0 14px 0; }
  .laser { position:absolute; left:6%; right:6%; top:10%; height:3px; border-radius:3px; background:var(--destello);
           box-shadow:0 0 14px 3px var(--destello), 0 0 40px 8px var(--brillo); animation:barrido 2.6s ease-in-out infinite alternate; }
  @keyframes barrido { from { top:12%; } to { top:86%; } }

  /* Ofertas */
  .ofertas { width:100%; max-width:780px; min-width:0; text-align:center; }
  .ofertas h2 { margin:0 0 clamp(8px,1.6vh,16px); font-size:clamp(18px,2.4vw,30px); font-weight:600; }
  .carrusel { position:relative; touch-action:pan-y; user-select:none; }
  .slide { display:none; flex-direction:column; align-items:center; justify-content:center; gap:clamp(6px,1.2vh,12px); text-align:center; cursor:pointer;
           background:var(--vidrio); border:1px solid var(--borde); border-radius:28px; padding:clamp(18px,3.4vh,40px) clamp(48px,6vw,76px);
           -webkit-backdrop-filter:blur(14px); backdrop-filter:blur(14px); box-shadow:0 20px 60px rgba(0,0,0,.28); min-height:clamp(220px,40vh,420px); }
  .slide.on { display:flex; animation:entra .45s cubic-bezier(.2,.8,.2,1); }
  @keyframes entra { from { opacity:0; transform:translateX(28px); } to { opacity:1; transform:none; } }
  .fotos { display:flex; gap:10px; justify-content:center; }
  .fotos img { width:clamp(60px,11vw,130px); height:clamp(60px,11vw,130px); object-fit:cover; border-radius:20px; background:#fff; box-shadow:0 6px 18px rgba(0,0,0,.25); }
  .s-nombre { font-size:clamp(34px,6.4vw,84px); font-weight:800; line-height:1; letter-spacing:-.025em; }
  .slide .t { display:inline-block; background:var(--tinta); color:var(--hondo); border-radius:999px; padding:.3em 1em; font-weight:700; font-size:clamp(16px,2.4vw,30px); }
  .ahorra { color:var(--destello); font-weight:800; font-size:clamp(20px,3.2vw,40px); }
  .s-prods { color:var(--tinta-suave); font-size:clamp(14px,1.9vw,22px); max-width:34em; }
  .s-fin { font-weight:600; font-size:clamp(14px,1.8vw,20px); }
  .s-ver { color:var(--tinta-suave); font-size:clamp(12px,1.5vw,17px); }
  .flecha { position:absolute; top:50%; transform:translateY(-50%); width:48px; height:48px; border-radius:50%; border:1px solid var(--borde); background:rgba(0,0,0,.28); font-size:28px; line-height:1; cursor:pointer; z-index:2; padding:0 0 4px; }
  .flecha.ant { left:10px; } .flecha.sig { right:10px; }
  .tabs { display:flex; gap:8px; margin-top:14px; overflow-x:auto; scrollbar-width:none; justify-content:center; padding:2px; }
  .tabs::-webkit-scrollbar { display:none; }
  .punto { position:relative; flex:0 1 auto; min-width:76px; max-width:210px; min-height:44px; padding:8px 16px; border-radius:999px; border:1px solid var(--borde); background:transparent; color:var(--tinta-suave); cursor:pointer; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; font-size:clamp(13px,1.6vw,17px); font-weight:600; }
  .punto.on { background:var(--vidrio); color:var(--tinta); border-color:var(--tinta); }
  .punto i { position:absolute; left:0; bottom:0; height:3px; width:0; background:var(--destello); }
  .punto.on i { animation:llenar 7s linear forwards; }
  @keyframes llenar { from { width:0; } to { width:100%; } }

  /* QR para consultar desde el celular */
  .qrmovil { position:fixed; left:50%; bottom:clamp(10px,2vh,22px); transform:translateX(-50%); display:flex; align-items:center; gap:14px; background:#fff; color:#10202e;
             border-radius:20px; padding:10px 20px 10px 10px; box-shadow:0 10px 34px rgba(0,0,0,.4); z-index:5; max-width:calc(100vw - 150px); }
  .qrmovil img { width:clamp(64px,11vh,98px); height:clamp(64px,11vh,98px); display:block; flex:none; }
  .qrmovil b { display:block; font-size:clamp(14px,1.8vw,19px); font-weight:700; line-height:1.2; }
  .qrmovil small { display:block; margin-top:3px; color:#4d5d6c; font-size:clamp(11px,1.4vw,15px); line-height:1.25; }
  @media (max-height:520px) { .qrmovil { display:none; } .cuerpo { padding-bottom:20px; } }

  /* Resultado del precio */
  .res .centro { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; padding:clamp(64px,11vh,100px) clamp(18px,5vw,80px) clamp(24px,4vh,44px); }
  .res .centro.con-oferta h1 { font-size:clamp(24px,min(3.8vw,6.2vh),54px); }
  .res .centro.con-oferta .ent { font-size:clamp(84px,min(17vw,25vh),210px); }
  .res .centro.con-oferta .antes { font-size:clamp(18px,min(2.8vw,4.6vh),38px); }
  .res .centro.con-oferta .cts { font-size:clamp(30px,min(6.4vw,10vh),80px); }
  .res h1 { margin:0; max-width:18em; font-size:clamp(26px,4.4vw,62px); font-weight:600; line-height:1.1; letter-spacing:-.015em; }
  .res .cod { margin-top:8px; color:var(--tinta-suave); font-size:clamp(14px,1.8vw,22px); font-variant-numeric:tabular-nums; }
  .caja-precio { padding:0 clamp(10px,2vw,30px); margin:clamp(6px,2vh,22px) 0; max-width:100%; animation:aparece .5s cubic-bezier(.2,.9,.2,1) both; }
  @keyframes aparece { from { opacity:0; transform:translateY(18px) scale(.94); } to { opacity:1; transform:none; } }
  .etiqueta { display:flex; align-items:flex-start; justify-content:center; gap:.06em; font-weight:800; line-height:.95; white-space:nowrap; transform-origin:center; font-variant-numeric:lining-nums tabular-nums; text-shadow:0 8px 40px rgba(0,0,0,.25); }
  .etiqueta .mon { font-size:clamp(24px,4.6vw,64px); font-weight:600; margin-top:.28em; color:var(--tinta-suave); }
  .etiqueta .ent { font-size:clamp(96px,min(21vw,38vh),270px); letter-spacing:-.045em; }
  .etiqueta .cts { font-size:clamp(34px,min(7.4vw,13vh),96px); font-weight:300; margin-top:.2em; }
  .etiqueta .un { font-size:clamp(16px,3vw,34px); align-self:flex-end; color:var(--tinta-suave); font-weight:500; margin-left:.4em; }
  .antes { color:var(--tinta-suave); font-size:clamp(20px,3.4vw,44px); font-weight:500; text-decoration:line-through; text-decoration-thickness:2px; }
  .promo { display:inline-flex; flex-wrap:wrap; justify-content:center; align-items:center; gap:10px 16px; margin-top:8px; }
  .promo .chip { background:var(--tinta); color:var(--hondo); border-radius:999px; padding:.3em 1.1em; font-weight:700; font-size:clamp(16px,2.4vw,30px); }
  .promo .gana { color:var(--destello); font-weight:800; font-size:clamp(18px,2.8vw,36px); }
  .nota { margin-top:clamp(10px,2vh,22px); color:var(--tinta-suave); font-size:clamp(14px,1.9vw,24px); }
  .peso { margin-top:8px; font-size:clamp(16px,2.2vw,28px); }
  .niveles { display:flex; gap:12px; justify-content:center; flex-wrap:wrap; margin-top:20px; }
  .nivel { background:var(--vidrio); border:1px solid var(--borde); border-radius:16px; padding:10px 18px; font-size:clamp(14px,1.8vw,22px); }
  .sigue { margin-top:clamp(10px,2.4vh,26px); text-align:center; color:var(--tinta-suave); font-size:clamp(13px,1.6vw,19px); pointer-events:none; }
  .cuenta { position:fixed; left:0; right:0; bottom:0; height:6px; background:rgba(255,255,255,.12); }
  .cuenta span { display:block; height:100%; background:var(--destello); transform-origin:left; animation:vaciar var(--seg,10s) linear forwards; }
  @keyframes vaciar { from { transform:scaleX(1); } to { transform:scaleX(0); } }
  .aviso h1 { font-size:clamp(30px,5.4vw,76px); font-weight:700; }
  .aviso .nota { font-size:clamp(18px,2.6vw,34px); }

  /* Detalle de una oferta */
  .det .centro { flex:1; display:flex; flex-direction:column; align-items:center; padding:clamp(14px,3vh,30px) clamp(18px,4vw,64px) clamp(24px,4vh,44px); min-height:0; }
  .det h1 { margin:0; font-size:clamp(32px,5.6vw,76px); font-weight:800; letter-spacing:-.025em; text-align:center; line-height:1; }
  .det .chip { display:inline-block; margin-top:12px; background:var(--tinta); color:var(--hondo); border-radius:999px; padding:.3em 1em; font-weight:700; font-size:clamp(16px,2.4vw,30px); }
  .lista { width:min(860px,100%); margin-top:clamp(14px,2.6vh,28px); display:grid; gap:10px; overflow:auto; max-height:56vh; padding:2px; }
  .prod { display:flex; align-items:center; gap:16px; background:var(--vidrio); border:1px solid var(--borde); border-radius:20px; padding:10px 18px 10px 10px; text-align:left; }
  .prod img { width:clamp(52px,8vw,84px); height:clamp(52px,8vw,84px); object-fit:cover; border-radius:14px; background:#fff; flex:none; }
  .prod .n { flex:1; font-size:clamp(16px,2.2vw,26px); font-weight:600; }
  .prod .p { font-weight:800; font-size:clamp(20px,2.8vw,36px); text-align:right; font-variant-numeric:tabular-nums; }
  .prod .p s { display:block; color:var(--tinta-suave); font-weight:500; font-size:.55em; }
  .prod .ah { display:block; color:var(--destello); font-size:.5em; font-weight:700; }
  .volver { margin-top:clamp(14px,2.6vh,26px); min-height:52px; padding:12px 34px; border-radius:999px; border:1px solid var(--tinta); background:transparent; font-size:clamp(16px,2vw,22px); font-weight:600; cursor:pointer; }

  #actualiza { position:fixed; inset:0; z-index:50; display:none; align-items:center; justify-content:center; background:rgba(8,16,24,.92); padding:20px; }
  #actualiza .caja { background:#fff; color:#10202e; border-radius:18px; padding:28px 30px; max-width:520px; width:100%; text-align:center; box-shadow:0 10px 40px rgba(0,0,0,.5); }
  #actualiza h2 { margin:0 0 8px; font-size:24px; }
  #actualiza p { margin:6px 0 14px; font-size:18px; }
  #actualiza small { color:#5b6b7a; font-size:14px; }
  .barra-act { height:12px; background:#e3e8ec; border-radius:999px; overflow:hidden; margin:6px 0 14px; }
  .barra-act b { display:block; height:100%; width:30%; background:#c0362c; border-radius:999px; transition:width .6s; }
  .barra-act.ind b { animation:ind 1.4s ease-in-out infinite alternate; }
  @keyframes ind { from { margin-left:0 } to { margin-left:70% } }
  /* El campo del lector sigue activo (recibe lo que escribe el escáner), pero no se ve ni abre el teclado */
  .barra { position:fixed; left:0; bottom:0; width:1px; height:1px; overflow:hidden; opacity:0; pointer-events:none; }
  .barra input { width:1px; height:1px; border:0; padding:0; background:transparent; color:transparent; caret-color:transparent; }
  .sin-conexion { position:fixed; top:12px; right:16px; background:#c0362c; color:#fff; padding:6px 14px; border-radius:999px; font-weight:700; display:none; z-index:60; }
  @media (prefers-reduced-motion:reduce) { .laser, .slide.on, .caja-precio, .punto.on i { animation:none; } .punto.on i { width:100%; } }
</style>
</head>
<body>
  <div id="vista" class="espera"></div>
  <div id="actualiza" role="alertdialog" aria-live="polite"><div class="caja"><h2 id="act-t">Actualizando FactPOS</h2><p id="act-p">Preparando…</p><div class="barra-act" id="act-barra"><b id="act-b"></b></div><small>No apague el equipo. Al terminar, la pantalla se abrirá sola.</small></div></div>
  <div class="sin-conexion" id="sinconexion">Sin conexión con el servidor</div>
  <div class="barra"><input id="codigo" autocomplete="off" inputmode="none" autofocus aria-label="Código de barras"></div>
<script>
  const params = new URLSearchParams(location.search);
  let sucursal = params.get("sucursal");
  let logo = null, nombreEmpresa = "", nombreSucursal = "";
  const mostrarNiveles = params.get("niveles") === "1";
  const input = document.getElementById("codigo");
  const vista = document.getElementById("vista");
  let temporizador;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  const rd = (v) => "RD$" + Number(v).toLocaleString("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Colores de la marca: se calculan fondo profundo, color del texto según el contraste y brillos
  const rgb = (h) => { h = String(h || "").replace("#", ""); if (h.length === 3) h = h.split("").map((c) => c + c).join(""); const n = parseInt(h, 16); return h.length === 6 && !isNaN(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : null; };
  const hex = (a) => "#" + a.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
  const mezcla = (a, b, t) => [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t);
  const lum = (a) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(a[0]) + 0.7152 * f(a[1]) + 0.0722 * f(a[2]); };
  function aplicarMarca(fondoHex, acentoHex) {
    const f = rgb(fondoHex) || [16, 32, 46], a = rgb(acentoHex) || [192, 54, 44], r = document.documentElement.style;
    const claro = lum(f) > 0.45, tinta = claro ? [16, 32, 46] : [255, 255, 255];
    r.setProperty("--fondo", hex(f)); r.setProperty("--acento", hex(a));
    r.setProperty("--hondo", hex(mezcla(f, [0, 0, 0], claro ? 0.22 : 0.55)));
    r.setProperty("--tinta", hex(tinta)); r.setProperty("--tinta-suave", "rgba(" + tinta.join(",") + ",.74)");
    r.setProperty("--vidrio", "rgba(" + tinta.join(",") + ",.10)"); r.setProperty("--borde", "rgba(" + tinta.join(",") + ",.24)");
    r.setProperty("--destello", hex(claro ? mezcla(a, [0, 0, 0], 0.15) : mezcla(a, [255, 255, 255], 0.6)));
    r.setProperty("--brillo", "rgba(" + a.map(Math.round).join(",") + ",.42)");
  }
  const hora = () => new Date().toLocaleTimeString("es-DO", { hour: "numeric", minute: "2-digit" });
  setInterval(() => { const t = document.getElementById("reloj"); if (t) t.textContent = hora(); }, 15000);
  function cabecera(conHora) {
    return '<header class="cab">' + (logo ? '<img class="logo" src="' + logo + '" alt="">' : "") +
      '<div class="marca">' + (nombreEmpresa ? '<b>' + esc(nombreEmpresa) + '</b>' : "") + (nombreSucursal ? '<span>' + esc(nombreSucursal) + '</span>' : "") + '</div>' +
      (conHora ? '<time id="reloj">' + hora() + '</time>' : "") + '</header>';
  }
  // Código de barras decorativo de la ventana de lectura
  function barras() {
    const w = [3,1,2,1,4,1,1,3,2,1,3,1,2,2,1,4,1,2,1,3,2,1,1,3,1,2,4,1,2,1,3,1,2,2,1,3];
    let x = 0, r = "";
    w.forEach((v, i) => { if (i % 2 === 0) r += '<rect x="' + x + '" y="0" width="' + v + '" height="60"/>'; x += v; });
    return '<svg viewBox="0 0 ' + x + ' 60" preserveAspectRatio="none" aria-hidden="true">' + r + '</svg>';
  }
  const visor = () => '<div class="visor" aria-hidden="true"><i></i><i></i><i></i><i></i><div class="codigo">' + barras() + '</div><span class="laser"></span></div>';

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
      '<div class="s-nombre">' + esc(o.nombre) + '</div><span class="t">' + esc(o.texto) + '</span>' +
      (a > 0 ? '<div class="ahorra">Ahorra hasta ' + rd(a) + '</div>' : "") +
      '<div class="s-prods">' + esc(o.productos.slice(0, 3).map((p) => p.nombre).join(" · ")) + (o.productos.length > 3 ? " y " + (o.productos.length - 3) + " más" : "") + '</div>' +
      '<div class="s-fin">' + esc(finDe(o)) + '</div><div class="s-ver">Toca para ver los productos</div></div>';
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
  let wifiTienda = "";
  let qrActivo = true;   // lo decide el interruptor de Administración › Verificador
  function qrMovil() {
    if (!qrActivo) return "";
    return '<div class="qrmovil"><img src="/verificador/movil/qr.svg' + (sucursal ? "?sucursal=" + encodeURIComponent(sucursal) : "") + '" alt=""><div><b>Consulta desde tu celular</b><small>Conéctate al WiFi' + (wifiTienda ? ' «' + esc(wifiTienda) + '»' : ' de la tienda') + '<br>y escanea este código</small></div></div>';
  }
  function espera() {
    clearTimeout(inactivo); clearTimeout(temporizador);
    cargarOfertas();
    vista.className = "espera";
    const hero = '<section class="hero">' + visor() + '<h1>Pasa el producto por el lector</h1><p>Verás su precio al instante</p></section>';
    if (!ofertas.length) { clearTimeout(rot); vista.innerHTML = cabecera(true) + '<main class="cuerpo">' + hero + '</main>' + qrMovil(); return; }
    if (idx >= ofertas.length) idx = 0;
    vista.innerHTML = cabecera(true) + '<main class="cuerpo con-ofertas">' + hero +
      '<section class="ofertas"><h2>Ofertas de hoy</h2><div class="carrusel">' + ofertas.map(slide).join("") +
        (ofertas.length > 1 ? '<button class="flecha ant" data-paso="-1" aria-label="Anterior">&#8249;</button><button class="flecha sig" data-paso="1" aria-label="Siguiente">&#8250;</button>' : "") + '</div>' +
      (ofertas.length > 1 ? '<div class="tabs">' + ofertas.map((o, i) => '<button class="punto' + (i === idx ? " on" : "") + '" data-ir="' + i + '">' + esc(o.nombre) + '<i></i></button>').join("") + '</div>' : "") +
      '</section></main>' + qrMovil();
    girar();
  }
  function detalleOferta(i) {
    const o = ofertas[i]; if (!o) return;
    clearTimeout(temporizador); clearTimeout(inactivo); clearTimeout(rot);
    vista.className = "det";
    vista.innerHTML = cabecera(false) + '<main class="centro"><h1>' + esc(o.nombre) + '</h1><span class="chip">' + esc(o.texto) + '</span><div class="lista">' +
      o.productos.map((p) => '<div class="prod">' + (p.imagen ? '<img src="' + esc(p.imagen) + '" alt="">' : "") + '<div class="n">' + esc(p.nombre) + '</div><div class="p">' +
        (p.precioOferta ? '<s>' + rd(p.precio) + '</s>' + rd(p.precioOferta) + '<span class="ah">Ahorras ' + rd(Number(p.precio) - Number(p.precioOferta)) + '</span>' : (p.precio ? rd(p.precio) : "")) + '</div></div>').join("") +
      '</div><button class="volver" data-volver="1">Volver</button></main>';
    inactivo = setTimeout(espera, 45000); // si nadie lo toca, vuelve solo
  }
  vista.addEventListener("click", (e) => {
    if (Date.now() - ultimoDeslizar < 400) return;   // fue un deslizamiento, no un toque
    if (vista.className === "res") { espera(); return; }   // tocar el resultado vuelve a la pantalla de espera
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
      wifiTienda = c.wifi || "";
      logo = c.logo ? await quitarFondo(c.logo) : null;
      nombreEmpresa = c.empresa || ""; nombreSucursal = c.nombre || "";
      aplicarMarca(c.secundario, c.primario);
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
      const oferta = d.promocion && d.promocion.precioOferta ? d.promocion : null;
      let html = cabecera(false) + '<main class="centro' + (oferta ? ' con-oferta' : '') + '"><h1>' + esc(d.descripcion) + '</h1><div class="cod">Código ' + esc(codigo) + '</div><div class="caja-precio">';
      if (oferta) html += '<div class="antes">' + rd(d.precio) + '</div>' + etiqueta(oferta.precioOferta, false);
      else html += etiqueta(d.precio, d.pesable);
      html += '</div>';
      if (d.promocion) html += '<div class="promo"><span class="chip">' + esc(d.promocion.nombre) + '</span>' + (oferta && Number(d.precio) > Number(oferta.precioOferta) ? '<span class="gana">Ahorras ' + rd(Number(d.precio) - Number(oferta.precioOferta)) + '</span>' : "") + '</div>';
      if (d.peso !== null) html += '<div class="peso">Peso ' + d.peso.toFixed(3) + ' · Importe ' + esc(d.importe) + '</div>';
      html += '<div class="nota">' + (d.itbisIncluido ? 'ITBIS incluido' : 'Precio sin ITBIS') + '</div>';
      if (mostrarNiveles && d.niveles.length > 1) {
        html += '<div class="niveles">' + d.niveles.map((n) => '<div class="nivel"><b>' + esc(n.lista) + '</b><br>' + rd(n.precio) + '</div>').join("") + '</div>';
      }
      vista.className = "res";
      vista.innerHTML = html + '<div class="sigue">Pasa otro producto cuando quieras</div></main><div class="cuenta"><span style="--seg:' + SEGUNDOS + 's"></span></div>';
      ajustarPrecio();
    } catch (err) {
      const red = err instanceof TypeError;
      if (red) document.getElementById("sinconexion").style.display = "block";
      vista.className = "res aviso";
      vista.innerHTML = cabecera(false) + '<main class="centro"><h1>' + esc(red ? "Sin conexión con el servidor" : "No encontramos este producto") + '</h1><div class="nota">' + (red ? "Consulta con un empleado" : "Código " + esc(codigo) + ". Consulta el precio en caja.") + '</div></main><div class="cuenta"><span style="--seg:' + SEGUNDOS + 's"></span></div>';
    }
    temporizador = setTimeout(espera, SEGUNDOS * 1000);
  });
</script>
</body>
</html>`;
