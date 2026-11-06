"""FactPOS Admin para Windows: la administración de FactPOS en una ventana propia, para usarla fuera de la oficina.

Abre https://factpos.app/<empresa>/ (el portal localiza el servidor de la empresa por su túnel) o la dirección
completa que se le indique. La empresa se guarda en %APPDATA%\\FactPOSAdmin\\config.json y la sesión de la web
(usuario y clave) en la carpeta WebView2 de la app.
"""
import json
import os
import re
import subprocess
import sys
import tempfile
import time
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


PAGINA_ABRIENDO = """<!doctype html><meta charset="utf-8"><body style="margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#0E1B26;color:#fff;font:600 22px Segoe UI,sans-serif">
<div style="width:36px;height:36px;border:4px solid rgba(255,255,255,.25);border-top-color:#fff;border-radius:50%;animation:g 1s linear infinite;margin-bottom:18px"></div>
FactPOS Admin<div style="font:400 14px Segoe UI,sans-serif;opacity:.75;margin-top:6px">Abriendo…</div><style>@keyframes g{to{transform:rotate(360deg)}}</style>"""


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


def compilacion_actual():
    """Número de compilación de ESTA app: el CI escribe VERSION = «1.0.<compilación>»; en desarrollo es 0."""
    try:
        return int(str(VERSION).split(".")[-1])
    except ValueError:
        return 0


def hay_version_nueva(actual, publicada):
    return actual > 0 and publicada > actual


def compilacion_publicada():
    r = urllib.request.urlopen(urllib.request.Request(PORTAL + "licencias/version-verificador/admin-windows", headers={"User-Agent": "FactPOSAdmin/" + VERSION}), timeout=15)
    return int(json.load(r)["version"])


def descargar_instalador(destino):
    """Baja el instalador vigente (el portal redirige a una dirección firmada de GitHub) y comprueba que parezca un .exe."""
    pedido = urllib.request.Request(PORTAL + "licencias/descargar-verificador/admin-windows", headers={"User-Agent": "FactPOSAdmin/" + VERSION})
    with urllib.request.urlopen(pedido, timeout=60) as r, open(destino, "wb") as f:
        while True:
            trozo = r.read(1 << 20)
            if not trozo:
                break
            f.write(trozo)
    if os.path.getsize(destino) < 1_000_000:
        raise RuntimeError("El instalador descargado está incompleto")
    with open(destino, "rb") as f:
        if f.read(2) != b"MZ":
            raise RuntimeError("El archivo descargado no es un instalador")


def buscar_actualizacion():
    """Al abrir: si el portal tiene una compilación más nueva de esta app, ofrece actualizar (descarga el instalador y lo
    ejecuta en silencio; él cierra esta app, se instala y la vuelve a abrir). Nunca interrumpe si algo falla."""
    try:
        time.sleep(6)  # que la ventana ya esté lista
        actual = compilacion_actual()
        publicada = compilacion_publicada()
        if not hay_version_nueva(actual, publicada):
            return
        if not api.ventana.create_confirmation_dialog(
                "FactPOS Admin",
                "Hay una versión nueva de FactPOS Admin (compilación %d; esta es la %d).\n\n¿Actualizar ahora? La app se cerrará y se abrirá sola en unos segundos." % (publicada, actual)):
            return
        ruta = os.path.join(tempfile.gettempdir(), "Instalador_Admin_FactPOS_nuevo.exe")
        descargar_instalador(ruta)
        subprocess.Popen([ruta, "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/CLOSEAPPLICATIONS"], close_fds=True)
        os._exit(0)
    except Exception:
        pass


RESERVADAS = {"api", "licencias", "central", "admin", "terminal", "c", "assets", "favicon.ico"}


def recordar_destino():
    """Si la empresa se abrió sin pasar por «guardar» (el plan B de la pantalla de código, cuando el puente con la app no responde),
    se recuerda la dirección abierta: así no pide el código otra vez al abrir o después de actualizar."""
    try:
        if leer_empresa():
            return
        u = urllib.parse.urlparse(api.ventana.get_current_url() or "")
        if u.scheme != "https" or u.netloc != urllib.parse.urlparse(PORTAL).netloc:
            return
        partes = [x for x in u.path.split("/") if x]
        if len(partes) >= 2 and partes[0] == "c" and codigo_de(partes[1]):
            destino = codigo_de(partes[1])
        elif partes and partes[0].lower() not in RESERVADAS and re.fullmatch(r"[a-z0-9.-]{2,60}", partes[0].lower()):
            destino = partes[0].lower()
        else:
            return
        os.makedirs(CARPETA, exist_ok=True)
        with open(CONFIG, "w", encoding="utf-8") as f:
            json.dump({"empresa": destino}, f)
    except Exception:
        pass


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
    # Con empresa: se abre ya una pantalla de «Abriendo…» y la dirección se carga enseguida (antes se veía un fondo vacío hasta que cargaba la nube)
    ventana = webview.create_window(
        "FactPOS Admin", html=PAGINA_ABRIENDO if url else PAGINA_EMPRESA.replace("__VALOR__", ""),
        js_api=api, width=1280, height=820, min_size=(900, 600), background_color="#0E1B26", confirm_close=False)
    api.ventana = ventana
    ventana.events.loaded += recordar_destino
    webview.settings["ALLOW_DOWNLOADS"] = True
    menu = [webview.menu.Menu("Archivo", [
        webview.menu.MenuAction("Recargar", recargar),
        webview.menu.MenuAction("Cambiar de empresa", pedir_empresa),
        webview.menu.MenuSeparator(),
        webview.menu.MenuAction("Salir", salir),
    ])]
    def arrancar():
        if url:
            try:
                ventana.load_url(url)
            except Exception:
                pass
        buscar_actualizacion()

    webview.start(arrancar, gui="edgechromium", menu=menu, private_mode=False, storage_path=WEBVIEW, debug=False)


if __name__ == "__main__":
    main()
