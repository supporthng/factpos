// La app agrega esta esquina (✕ cerrar · ⓘ opciones) a la pantalla del verificador, sea cual sea la versión del servidor.
// Todo exige la clave de salida; el puente (FactPOSApp / pywebview.api) la comprueba por su cuenta.
(function () {
  if (window.__factposEsquina) return;
  var P = function () { return window.FactPOSApp || (window.pywebview && window.pywebview.api) || null; };
  if (!P()) { window.addEventListener("pywebviewready", function () { if (P()) window.__factposEsquina = 0, arrancar(); }); return; }
  arrancar();
  function arrancar() {
    if (window.__factposEsquina) return;
    window.__factposEsquina = 1;
    var llamar = function (n) { var a = [].slice.call(arguments, 1); return Promise.resolve(P()[n].apply(P(), a)); };
    var css = "position:fixed;z-index:2147483647;font-family:system-ui,sans-serif;";
    var el = function (t, estilo, txt) { var e = document.createElement(t); e.style.cssText = estilo; if (txt) e.textContent = txt; return e; };
    var raiz = el("div", css + "bottom:10px;left:10px;right:10px;display:flex;justify-content:space-between;pointer-events:none");
    var boton = function (txt, titulo) {
      var b = el("button", "width:52px;height:52px;border-radius:50%;border:2px solid rgba(255,255,255,.55);background:rgba(16,32,46,.75);color:#fff;font-size:24px;cursor:pointer;opacity:.7;pointer-events:auto", txt);
      b.type = "button"; b.title = titulo; b.setAttribute("aria-label", titulo); return b;
    };
    var cerrar = boton("✕", "Cerrar la app"), info = boton("ⓘ", "Opciones del equipo");
    raiz.appendChild(cerrar); raiz.appendChild(info);
    var velo = el("div", css + "inset:0;background:rgba(0,0,0,.75);display:none;align-items:center;justify-content:center");
    var caja = el("div", "background:#fff;color:#10202e;border-radius:18px;padding:26px;width:min(420px,92vw);text-align:center;font-size:18px");
    velo.appendChild(caja);
    // El diálogo se cierra solo si nadie escribe: 5 s para el PIN (se reinicia al teclear) y 30 s en el menú de opciones
    var tiempo = null;
    function cerrarVelo() { clearTimeout(tiempo); velo.style.display = "none"; }
    function armar(ms) { clearTimeout(tiempo); tiempo = setTimeout(cerrarVelo, ms); }
    function abrir(accion) {
      caja.innerHTML = "";
      armar(5000);
      caja.appendChild(el("h2", "margin:0 0 8px;font-size:24px", accion === "cerrar" ? "Cerrar la app" : "Opciones del equipo"));
      caja.appendChild(el("div", "color:#5d6d7e", "Escriba el PIN de un supervisor o administrador"));
      var inp = el("input", "width:100%;font-size:24px;padding:12px;border:2px solid #cfd8e0;border-radius:12px;text-align:center;margin:12px 0;box-sizing:border-box");
      inp.type = "password"; inp.autocomplete = "off"; inp.inputMode = "numeric"; inp.maxLength = 8;
      // Versiones viejas de la página devuelven el foco al lector cada segundo: aquí se recupera mientras se escribe la clave
      inp.onblur = function () { setTimeout(function () { if (velo.style.display === "flex" && caja.contains(inp)) inp.focus(); }, 0); };
      var err = el("div", "color:#c0362c;font-weight:700;min-height:1.3em");
      var btn = function (txt, fondo, color) { var b = el("button", "display:block;width:100%;font-size:20px;font-weight:700;padding:14px;margin-top:10px;border:0;border-radius:999px;cursor:pointer;background:" + fondo + ";color:" + color, txt); b.type = "button"; return b; };
      var ok = btn("Entrar", "#c0362c", "#fff"), no = btn("Cancelar", "#eef1f4", "#10202e");
      no.onclick = cerrarVelo;
      ok.onclick = function () {
        var c = inp.value;
        clearTimeout(tiempo);   // mientras se comprueba no se cierra
        err.textContent = "Comprobando…";
        llamar("verificarClave", c).then(function (v) {
          if (v !== "ok") { err.textContent = v === "incorrecta" ? "PIN incorrecto, o no es de un supervisor o administrador." : v === "sin_conexion" ? "No hay conexión con el servidor." : String(v); inp.value = ""; armar(5000); return; }
          if (accion === "cerrar") { llamar("salir", c); return; }
          caja.innerHTML = "";
          armar(30000); caja.onpointerdown = function () { armar(30000); };
          caja.appendChild(el("h2", "margin:0 0 4px;font-size:24px", "Opciones del equipo"));
          Promise.all([llamar("plataforma"), llamar("version")]).then(function (r) { caja.appendChild(el("div", "color:#5d6d7e;margin-bottom:6px", "Verificador FactPOS " + r[0] + " " + r[1])); });
          var cs = btn("Cambiar de servidor", "#10202e", "#fff"), sa = btn("Cerrar la app", "#c0362c", "#fff"), ca = btn("Volver", "#eef1f4", "#10202e");
          cs.onclick = function () { llamar("cambiarServidor", c); };
          sa.onclick = function () { llamar("salir", c); };
          ca.onclick = cerrarVelo;
          caja.appendChild(cs); caja.appendChild(sa); caja.appendChild(ca);
        });
      };
      inp.onkeydown = function (e) { e.stopPropagation(); armar(5000); if (e.key === "Enter") ok.click(); };
      inp.oninput = function () { armar(5000); };
      caja.onpointerdown = function () { armar(5000); };
      caja.appendChild(inp); caja.appendChild(err); caja.appendChild(ok); caja.appendChild(no);
      velo.style.display = "flex"; inp.focus();
    }
    cerrar.onclick = function (e) { e.stopPropagation(); abrir("cerrar"); };
    info.onclick = function (e) { e.stopPropagation(); abrir("opciones"); };
    document.body.appendChild(raiz); document.body.appendChild(velo);
  }
})();
