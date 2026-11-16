"""FactPOS Vendedor para Windows: la terminal de ventas (pantalla «Vender») del servidor de la tienda, en una ventana propia.

Busca solo el servidor de FactPOS en la red de la tienda (aviso por UDP, «factpos.local» y, si hace falta, un barrido de la
red local) y abre http://<servidor>:3000/admin/#vender. La dirección encontrada se recuerda en
%APPDATA%\\FactPOSVendedor\\config.json; si el servidor cambia de dirección se vuelve a buscar. Todo funciona sin internet.
"""
import concurrent.futures
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request

import webview

VERSION = "1.0.0"
PORTAL = "https://factpos.app/"
PUERTO = 3000
PUERTO_AVISO = 41234
CARPETA = os.path.join(os.environ.get("APPDATA", os.path.expanduser("~")), "FactPOSVendedor")
CONFIG = os.path.join(CARPETA, "config.json")
WEBVIEW = os.path.join(CARPETA, "webview")

ESTILO = """<style>*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#0E1B26;color:#fff;font-family:system-ui,"Segoe UI",sans-serif;display:flex;align-items:center;justify-content:center;padding:20px}
.c{background:#fff;color:#10202e;border-radius:18px;width:min(520px,100%);padding:30px}h1{margin:0 0 6px;font-size:26px}p{color:#5d6d7e;margin:4px 0 16px}
input{width:100%;font-size:20px;padding:12px 14px;border:2px solid #cfd8e0;border-radius:12px}input:focus{outline:none;border-color:#c0362c}
button{margin-top:14px;width:100%;font-size:19px;font-weight:700;padding:13px;border:0;border-radius:999px;background:#c0362c;color:#fff;cursor:pointer}
button.s{background:#e8edf1;color:#10202e}#e{color:#c0362c;font-weight:700;min-height:1.2em;margin-top:10px}</style>"""

PAGINA_BUSCANDO = """<!doctype html><meta charset="utf-8">""" + ESTILO + """<body style="flex-direction:column;font-weight:600;font-size:22px;text-align:center">
<div style="width:36px;height:36px;border:4px solid rgba(255,255,255,.25);border-top-color:#fff;border-radius:50%;animation:g 1s linear infinite;margin-bottom:18px"></div>
FactPOS Vendedor<div style="font-weight:400;font-size:14px;opacity:.75;margin-top:6px">Buscando el servidor de la tienda…</div><style>@keyframes g{to{transform:rotate(360deg)}}</style>"""

PAGINA_MANUAL = """<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">""" + ESTILO + """</head><body><form class="c" id="f">
<h1>FactPOS Vendedor</h1>
<p>No encontramos el servidor de la tienda en esta red. Revisa que la computadora esté conectada al mismo Wi-Fi o cable que el servidor y que este encendido. Si lo conoces, escribe su dirección (por ejemplo <b>192.168.1.10</b>).</p>
<input id="v" placeholder="192.168.1.10" value="__VALOR__">
<div id="e">__ERROR__</div>
<button type="submit" id="b">Conectar</button><button type="button" class="s" id="r">Buscar otra vez</button></form>
<script>
const api = () => window.pywebview && window.pywebview.api;
document.getElementById("f").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const v = document.getElementById("v").value.trim();
  if (!v) { document.getElementById("e").textContent = "Escribe la dirección del servidor."; return; }
  document.getElementById("b").disabled = true;
  const r = await api().manual(v);
  if (r && r.error) { document.getElementById("e").textContent = r.error; document.getElementById("b").disabled = false; }
});
document.getElementById("r").addEventListener("click", () => api().buscar());
</script></body></html>"""


def leer_config():
    try:
        with open(CONFIG, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def guardar_config(base):
    try:
        os.makedirs(CARPETA, exist_ok=True)
        with open(CONFIG, "w", encoding="utf-8") as f:
            json.dump({"servidor": base}, f)
    except Exception:
        pass


def normalizar(texto):
    """«192.168.1.10», «192.168.1.10:3000» o «http://caja-1.local:3000/admin» → «http://192.168.1.10:3000» (sin barra final)."""
    t = str(texto).strip()
    if not t:
        return None
    if not t.startswith(("http://", "https://")):
        t = "http://" + t
    u = urllib.parse.urlparse(t)
    if not u.hostname:
        return None
    return "%s://%s:%d" % (u.scheme, u.hostname, u.port or PUERTO)


def es_factpos(base, espera=1.5):
    """True si en esa dirección responde un servidor FactPOS (/descubrir)."""
    try:
        with urllib.request.urlopen(base + "/descubrir", timeout=espera) as r:
            return json.load(r).get("producto") == "FactPOS"
    except Exception:
        return False


def por_aviso(espera=2.0):
    """Pregunta por UDP («FACTPOS?») a toda la red: el servidor contesta con sus direcciones."""
    hallados = []
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        s.settimeout(0.4)
        s.sendto(b"FACTPOS?", ("255.255.255.255", PUERTO_AVISO))
        fin = time.time() + espera
        while time.time() < fin:
            try:
                datos, quien = s.recvfrom(8192)
            except socket.timeout:
                continue
            try:
                d = json.loads(datos.decode("utf-8"))
            except Exception:
                continue
            if d.get("producto") != "FactPOS":
                continue
            hallados.extend(d.get("direcciones") or ["http://%s:%s" % (quien[0], d.get("puerto", PUERTO))])
    except Exception:
        pass
    finally:
        s.close()
    return hallados


def ip_local():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except Exception:
        return None
    finally:
        s.close()


def barrido():
    """Último recurso: prueba el puerto 3000 de las 254 direcciones de la red local."""
    ip = ip_local()
    if not ip or ip.startswith("127."):
        return None
    prefijo = ip.rsplit(".", 1)[0]
    candidatas = ["http://%s.%d:%d" % (prefijo, n, PUERTO) for n in range(1, 255)]
    with concurrent.futures.ThreadPoolExecutor(max_workers=64) as ex:
        for base, ok in zip(candidatas, ex.map(lambda b: es_factpos(b, 0.8), candidatas)):
            if ok:
                return base
    return None


def encontrar_servidor():
    """Orden: la última dirección que funcionó → aviso por UDP → factpos.local → barrido de la red."""
    guardada = leer_config().get("servidor")
    if guardada and es_factpos(guardada):
        return guardada
    for d in por_aviso():
        b = normalizar(d)
        if b and es_factpos(b):
            return b
    b = "http://factpos.local:%d" % PUERTO
    if es_factpos(b, 2.5):
        return b
    return barrido()


def direccion_venta(base):
    return base + "/admin/#vender"


class Api:
    ventana = None

    def manual(self, texto):
        b = normalizar(texto)
        if not b or not es_factpos(b, 3):
            return {"error": "No hay un servidor FactPOS en esa dirección. Revísala e inténtalo de nuevo."}
        guardar_config(b)
        self.ventana.load_url(direccion_venta(b))
        return {"ok": True}

    def buscar(self):
        threading_buscar()
        return {"ok": True}


api = Api()


def threading_buscar():
    import threading
    threading.Thread(target=conectar, daemon=True).start()


def conectar(error=""):
    """Busca el servidor y abre la pantalla de ventas; si no lo encuentra pide la dirección."""
    api.ventana.load_html(PAGINA_BUSCANDO)
    base = encontrar_servidor()
    if base:
        guardar_config(base)
        api.ventana.load_url(direccion_venta(base))
    else:
        valor = (leer_config().get("servidor") or "").replace("http://", "").replace('"', "")
        api.ventana.load_html(PAGINA_MANUAL.replace("__VALOR__", valor).replace("__ERROR__", error))


def compilacion_actual():
    try:
        return int(str(VERSION).split(".")[-1])
    except ValueError:
        return 0


def hay_version_nueva(actual, publicada):
    return actual > 0 and publicada > actual


def compilacion_publicada():
    r = urllib.request.urlopen(urllib.request.Request(PORTAL + "licencias/version-verificador/vendedor-windows", headers={"User-Agent": "FactPOSVendedor/" + VERSION}), timeout=15)
    return int(json.load(r)["version"])


def descargar_instalador(destino):
    pedido = urllib.request.Request(PORTAL + "licencias/descargar-verificador/vendedor-windows", headers={"User-Agent": "FactPOSVendedor/" + VERSION})
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
    """Si hay internet y el portal tiene una compilación más nueva, ofrece actualizar. Sin internet o ante cualquier fallo no molesta."""
    try:
        time.sleep(10)
        actual = compilacion_actual()
        publicada = compilacion_publicada()
        if not hay_version_nueva(actual, publicada):
            return
        if not api.ventana.create_confirmation_dialog(
                "FactPOS Vendedor",
                "Hay una versión nueva de FactPOS Vendedor (compilación %d; esta es la %d).\n\n¿Actualizar ahora? La app se cerrará y se abrirá sola en unos segundos." % (publicada, actual)):
            return
        ruta = os.path.join(tempfile.gettempdir(), "Instalador_Vendedor_FactPOS_nuevo.exe")
        descargar_instalador(ruta)
        subprocess.Popen([ruta, "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/CLOSEAPPLICATIONS"], close_fds=True)
        os._exit(0)
    except Exception:
        pass


def salir():
    api.ventana.destroy()


def main():
    os.makedirs(WEBVIEW, exist_ok=True)
    ventana = webview.create_window(
        "FactPOS Vendedor", html=PAGINA_BUSCANDO, js_api=api, width=1280, height=820, min_size=(900, 600),
        background_color="#0E1B26", confirm_close=False)
    api.ventana = ventana
    webview.settings["ALLOW_DOWNLOADS"] = True
    menu = [webview.menu.Menu("Archivo", [
        webview.menu.MenuAction("Recargar", lambda: ventana.evaluate_js("location.reload()")),
        webview.menu.MenuAction("Buscar el servidor otra vez", threading_buscar),
        webview.menu.MenuSeparator(),
        webview.menu.MenuAction("Salir", salir),
    ])]

    def arrancar():
        conectar()
        buscar_actualizacion()

    webview.start(arrancar, gui="edgechromium", menu=menu, private_mode=False, storage_path=WEBVIEW, debug=False)


if __name__ == "__main__":
    main()
