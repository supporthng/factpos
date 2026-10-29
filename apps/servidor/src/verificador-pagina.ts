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
  input { position:fixed; opacity:0; pointer-events:none; }
</style>
</head>
<body>
  <input id="codigo" autocomplete="off" autofocus>
  <div id="vista" class="espera">Pase el producto por el lector<br>para ver su precio</div>
<script>
  const params = new URLSearchParams(location.search);
  const sucursal = params.get("sucursal");
  const mostrarNiveles = params.get("niveles") === "1";
  const input = document.getElementById("codigo");
  const vista = document.getElementById("vista");
  let temporizador;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  const rd = (v) => "RD$" + Number(v).toLocaleString("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function espera() {
    vista.className = "espera";
    vista.innerHTML = "Pase el producto por el lector<br>para ver su precio";
  }
  function enfocar() { input.focus(); }
  document.addEventListener("click", enfocar);
  setInterval(enfocar, 1000);

  if (!sucursal) {
    vista.innerHTML = '<div class="tarjeta"><p class="error">Falta configurar la sucursal</p><p class="detalle">Abra esta página con ?sucursal=ID_DE_LA_SUCURSAL</p></div>';
  }

  input.addEventListener("keydown", async (e) => {
    if (e.key !== "Enter") return;
    const codigo = input.value.trim();
    input.value = "";
    if (!codigo || !sucursal) return;
    clearTimeout(temporizador);
    try {
      const r = await fetch("/verificador/" + encodeURIComponent(sucursal) + "/" + encodeURIComponent(codigo));
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Producto no encontrado");
      let html = '<div class="tarjeta"><h1>' + esc(d.descripcion) + '</h1>';
      if (d.promocion && d.promocion.precioOferta) {
        html += '<div class="tachado">' + rd(d.precio) + '</div>';
        html += '<div class="precio">' + rd(d.promocion.precioOferta) + '</div>';
      } else {
        html += '<div class="precio">' + rd(d.precio) + (d.pesable ? '<span style="font-size:.35em"> / lb</span>' : '') + '</div>';
      }
      if (d.promocion) html += '<div class="oferta">' + esc(d.promocion.nombre) + '</div>';
      if (d.peso !== null) html += '<div class="detalle">Peso: ' + d.peso.toFixed(3) + ' — Importe: ' + esc(d.importe) + '</div>';
      html += '<div class="detalle">' + (d.itbisIncluido ? 'ITBIS incluido' : 'Precio sin ITBIS') + '</div>';
      if (mostrarNiveles && d.niveles.length > 1) {
        html += '<div class="niveles">' + d.niveles.map((n) => '<div class="nivel"><b>' + esc(n.lista) + '</b><br>' + rd(n.precio) + '</div>').join("") + '</div>';
      }
      vista.className = "";
      vista.innerHTML = html + '</div>';
    } catch (err) {
      vista.className = "";
      vista.innerHTML = '<div class="tarjeta"><p class="error">' + esc(err.message) + '</p><p class="detalle">Consulte con un empleado</p></div>';
    }
    temporizador = setTimeout(espera, 8000);
  });
</script>
</body>
</html>`;
