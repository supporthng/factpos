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
  .logo { max-width:min(260px,60vw); max-height:120px; margin-bottom:20px; object-fit:contain; }
  .barra { position:fixed; left:0; right:0; bottom:0; display:flex; justify-content:center; padding:14px; background:rgba(0,0,0,.25); }
  .barra input { width:min(420px,90vw); font-size:20px; padding:12px 16px; border-radius:12px; border:0; text-align:center; }
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
  .sin-conexion { position:fixed; top:12px; right:16px; background:#c0362c; color:#fff; padding:6px 14px; border-radius:999px; font-weight:700; display:none; }
</style>
</head>
<body>
  <div id="vista" class="espera">Pase el producto por el lector<br>para ver su precio</div>
  <div class="sin-conexion" id="sinconexion">Sin conexión con el servidor</div>
  <div class="barra"><input id="codigo" autocomplete="off" inputmode="numeric" autofocus placeholder="Escanee o escriba el código"></div>
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
  let ofertas = [];
  let inactivo;
  function espera() {
    clearTimeout(inactivo);
    vista.className = "espera";
    const cab = (logo ? '<img class="logo" src="' + logo + '" alt=""><br>' : "");
    if (!ofertas.length) { vista.innerHTML = cab + '<div class="ofertas-titulo">Consulta de precios</div><div class="ofertas-sub">Pase el producto por el lector para ver su precio</div>'; return; }
    vista.innerHTML = cab + '<div class="ofertas-titulo">Consulta de precios</div><div class="ofertas-sub">Pase el producto por el lector para ver su precio</div>' +
      '<div class="ofertas-sub" style="color:#fff;font-weight:700;margin-top:6px">Ofertas de hoy · toque una para ver sus productos</div>' +
      '<div class="rejilla">' + ofertas.map((o, i) => '<button class="oferta-card" data-oferta="' + i + '"><b>' + esc(o.nombre) + '</b><span class="t">' + esc(o.texto) + '</span>' +
        '<small>' + o.productos.length + (o.productos.length === 1 ? " producto" : " productos") + ' · hasta el ' + new Date(o.hasta).toLocaleDateString("es-DO", { day: "numeric", month: "short" }) + '</small></button>').join("") + '</div>';
  }
  function detalleOferta(i) {
    const o = ofertas[i]; if (!o) return;
    clearTimeout(temporizador); clearTimeout(inactivo);
    vista.className = "";
    vista.innerHTML = '<div class="tarjeta"><h1>' + esc(o.nombre) + '</h1><div class="oferta">' + esc(o.texto) + '</div><div class="lista">' +
      o.productos.map((p) => '<div class="prod">' + (p.imagen ? '<img src="' + esc(p.imagen) + '" alt="">' : "") + '<div class="n">' + esc(p.nombre) + '</div><div class="p">' +
        (p.precioOferta ? '<s>' + rd(p.precio) + '</s>' + rd(p.precioOferta) : (p.precio ? rd(p.precio) : "")) + '</div></div>').join("") +
      '</div><button class="volver" data-volver="1">Volver a las ofertas</button></div>';
    inactivo = setTimeout(espera, 45000); // si nadie lo toca, vuelve solo
  }
  vista.addEventListener("click", (e) => {
    const t = e.target.closest("[data-oferta],[data-volver]");
    if (!t) return;
    if (t.dataset.volver) espera(); else detalleOferta(Number(t.dataset.oferta));
  });
  async function cargarOfertas() {
    if (!sucursal) return;
    try {
      const r = await fetch("/verificador/ofertas?sucursal=" + encodeURIComponent(sucursal));
      if (r.ok) { ofertas = await r.json(); if (vista.className === "espera") espera(); }
    } catch {}
  }
  setInterval(cargarOfertas, 5 * 60 * 1000);
  // Sin ?sucursal=: el servidor dice cuál es (un servidor de sucursal atiende una sola) y entrega la marca de la empresa
  async function cargarConfig() {
    try {
      const r = await fetch("/verificador/config" + (sucursal ? "?sucursal=" + encodeURIComponent(sucursal) : ""));
      if (!r.ok) return;
      const c = await r.json();
      sucursal = sucursal || c.sucursalId;
      logo = c.logo || null;
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
  function enfocar() { input.focus(); }
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
