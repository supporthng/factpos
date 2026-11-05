"""FactPOS Admin para Windows: la administración de FactPOS en una ventana propia, para usarla fuera de la oficina.

Abre https://factpos.app/<empresa>/ (el portal localiza el servidor de la empresa por su túnel) o la dirección
completa que se le indique. La empresa se guarda en %APPDATA%\\FactPOSAdmin\\config.json y la sesión de la web
(usuario y clave) en la carpeta WebView2 de la app.
"""
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

import webview

VERSION = "1.0.0"
PORTAL = "https://factpos.app/"
CARPETA = os.path.join(os.environ.get("APPDATA", os.path.expanduser("~")), "FactPOSAdmin")
CONFIG = os.path.join(CARPETA, "config.json")
WEBVIEW = os.path.join(CARPETA, "webview")

PAGINA_EMPRESA = """<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#0E1B26;font-family:system-ui,"Segoe UI",sans-serif;display:flex;align-items:center;justify-content:center;padding:20px}
form{background:#fff;border-radius:18px;width:min(520px,100%);padding:30px;color:#10202e}
h1{margin:0 0 6px;font-size:26px}p{color:#5d6d7e;margin:4px 0 16px}
input{width:100%;font-size:20px;padding:12px 14px;border:2px solid #cfd8e0;border-radius:12px}
input:focus{outline:none;border-color:#c0362c}
button{margin-top:18px;width:100%;font-size:20px;font-weight:700;padding:13px;border:0;border-radius:999px;background:#c0362c;color:#fff;cursor:pointer}
#e{color:#c0362c;font-weight:700;min-height:1.2em;margin-top:10px}
</style></head><body><form id="f">
<h1>FactPOS Admin</h1>
<p>Escribe el <b>código de conexión</b> de tu empresa (por ejemplo <b>FP-K7M4QX</b>). Lo encuentras en Sistema › Acceso remoto. También sirve el nombre corto (factpos.app/<b>nombre</b>) o la dirección completa.</p>
<input id="v" placeholder="FP-XXXXXX" autofocus value="__VALOR__">
<div id="e"></div><button type="submit" id="b">Conectar</button></form>
<script>
document.getElementById("f").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const v = document.getElementById("v").value.trim().toLowerCase().replace(/\\s+/g, "");
  if (!v) { document.getElementById("e").textContent = "Escribe el nombre de la empresa."; return; }
  const b = document.getElementById("b"), e = document.getElementById("e");
  b.disabled = true; b.textContent = "Conectando…"; e.textContent = "";
  const volver = (t) => { e.textContent = t; b.disabled = false; b.textContent = "Conectar"; };
  // Si el puente con la app no responde, se abre la dirección directamente (no se guarda para la próxima vez)
  const directo = () => {
    const c = v.toUpperCase().replace(/-/g, "").match(/^FP([2-9A-HJKMNP-Z]{6})$/);
    location.href = c ? "https://factpos.app/c/FP-" + c[1] : /^https?:/.test(v) ? v : v.includes(".") ? "https://" + v : "https://factpos.app/" + v + "/";
  };
  try {
    if (!(window.pywebview && window.pywebview.api && window.pywebview.api.guardar)) { directo(); return; }
    const r = await window.pywebview.api.guardar(v);
    if (r && r.error) volver(r.error);
  } catch (x) { volver("No se pudo conectar: " + x); }
});
</script></body></html>"""


def leer_empresa():
    try:
        with open(CONFIG, encoding="utf-8") as f:
            return str(json.load(f).get("empresa", "")).strip()
    except Exception:
        return ""


def codigo_de(texto):
    """Código de conexión corto (FP-K7M4QX), con o sin guion y en mayúsculas o minúsculas; None si no lo es."""
    m = re.fullmatch(r"FP-?([2-9A-HJKMNP-Z]{6})", re.sub(r"\s", "", str(texto)).upper())
    return "FP-" + m.group(1) if m else None


def direccion(empresa):
    if not empresa:
        return None
    codigo = codigo_de(empresa)
    if codigo:
        return PORTAL + "c/" + codigo
    if empresa.startswith(("http://", "https://")):
        return empresa
    if "." in empresa:
        return "https://" + empresa
    return PORTAL + empresa + "/"


class _SinRedireccion(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def resolver_codigo(codigo, portal=None):
    """Pregunta al portal a qué administración corresponde el código: devuelve su dirección, o None si no existe.
    Si el portal no responde lanza la excepción (para decirle al usuario qué pasó en vez de quedarse callado)."""
    base = portal or PORTAL
    abrir = urllib.request.build_opener(_SinRedireccion).open
    try:
        abrir(urllib.request.Request(base + "c/" + codigo, headers={"User-Agent": "FactPOSAdmin/" + VERSION}), timeout=15)
    except urllib.error.HTTPError as e:
        if e.code in (301, 302, 303, 307, 308) and e.headers.get("Location"):
            return urllib.parse.urljoin(base, e.headers["Location"])
        if e.code == 404:
            return None
        raise
    return None


class Api:
    ventana = None

    def guardar(self, empresa):
        try:
            destino = direccion(empresa)
            codigo = codigo_de(empresa)
            if codigo:
                destino = resolver_codigo(codigo)
                if not destino:
                    return {"error": "No encontramos una empresa con el código " + codigo + ". Revisa que esté bien escrito."}
            os.makedirs(CARPETA, exist_ok=True)
            with open(CONFIG, "w", encoding="utf-8") as f:
                json.dump({"empresa": empresa}, f)
            self.ventana.load_url(destino)
            return {"ok": True}
        except Exception as e:  # sin internet, portal caído, etc.
            return {"error": "No se pudo conectar (" + str(e) + "). Revisa tu internet e inténtalo de nuevo."}


api = Api()


def pedir_empresa():
    html = PAGINA_EMPRESA.replace("__VALOR__", leer_empresa().replace('"', ""))
    api.ventana.load_html(html)


def recargar():
    api.ventana.load_url(direccion(leer_empresa()) or PORTAL)


def salir():
    api.ventana.destroy()


def empresa_del_enlace():
    """factpos-admin://conectar/<empresa> (enlace «Abrir y conectar» de la página de instalación)."""
    for a in sys.argv[1:]:
        if a.lower().startswith("factpos-admin:"):
            e = a.rstrip("/").split("/")[-1].strip().lower()
            if re.fullmatch(r"[a-z0-9.-]{2,60}", e) or codigo_de(e):
                return e
    return ""


def main():
    os.makedirs(WEBVIEW, exist_ok=True)
    nueva = empresa_del_enlace()
    if nueva:
        os.makedirs(CARPETA, exist_ok=True)
        with open(CONFIG, "w", encoding="utf-8") as f:
            json.dump({"empresa": nueva}, f)
    empresa = leer_empresa()
    url = direccion(empresa)
    ventana = webview.create_window(
        "FactPOS Admin", url=url, html=None if url else PAGINA_EMPRESA.replace("__VALOR__", ""),
        js_api=api, width=1280, height=820, min_size=(900, 600), background_color="#0E1B26", confirm_close=False)
    api.ventana = ventana
    webview.settings["ALLOW_DOWNLOADS"] = True
    menu = [webview.menu.Menu("Archivo", [
        webview.menu.MenuAction("Recargar", recargar),
        webview.menu.MenuAction("Cambiar de empresa", pedir_empresa),
        webview.menu.MenuSeparator(),
        webview.menu.MenuAction("Salir", salir),
    ])]
    webview.start(gui="edgechromium", menu=menu, private_mode=False, storage_path=WEBVIEW, debug=False)


if __name__ == "__main__":
    main()
