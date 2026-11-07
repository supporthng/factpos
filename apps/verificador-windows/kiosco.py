"""Verificador FactPOS para Windows: verificador de precios tipo quiosco.

- Abre el verificador del servidor de la sucursal (http://IP:3000/verificador) a pantalla completa,
  siempre encima, sin bordes. La primera vez busca (o pide) la dirección del servidor.
- Usa WebView2 (el motor de Microsoft Edge, ya incluido en Windows 10/11).
- Bloquea Alt+Tab, Alt+Esc, Ctrl+Esc, Ctrl+Shift+Esc, Alt+F4, Alt+Espacio y la tecla Windows.
- Oculta la barra de tareas mientras está abierta; vuelve a aparecer al cerrar la app.
- No se puede cerrar ni minimizar: se sale SOLO desde los botones de abajo (✕ / ⓘ) con el PIN de un supervisor o administrador de FactPOS.
- Una sola copia abierta a la vez.

Ctrl+Alt+Supr no se puede bloquear desde un programa (es una protección de Windows). Para un
bloqueo total, usar además "Acceso asignado" de Windows.
"""
import ctypes
import hashlib
import hmac
import json
import os
import platform
import http.server
import re
import socket
import urllib.error
import urllib.parse
import urllib.request
import subprocess
import sys
import threading
import time
import winreg
from ctypes import wintypes

import webview

# La compilación (GitHub Actions) reemplaza este valor.
VERSION = "1.0.0"
DATOS = os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "FactPOS Verificador")
CONFIG_JSON = os.path.join(DATOS, "config.json")
WEBVIEW = os.path.join(DATOS, "WebView")


def recurso(nombre):
    """Archivo incluido en la app (funciona tanto ejecutando el .py como ya empaquetada)."""
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, nombre)


user32 = ctypes.WinDLL("user32", use_last_error=True)
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)


# --------------------------------------------------------------------------- una sola copia
def ya_abierta():
    kernel32.CreateMutexW.restype = wintypes.HANDLE
    kernel32.CreateMutexW(None, False, "Local\\FactPOSVerificador")
    return ctypes.get_last_error() == 183   # ERROR_ALREADY_EXISTS


# --------------------------------------------------------------------------- bloqueo de teclas
WH_KEYBOARD_LL = 13
LLKHF_ALTDOWN = 0x20
VK_TAB, VK_ESCAPE, VK_SPACE, VK_F4 = 0x09, 0x1B, 0x20, 0x73
VK_LWIN, VK_RWIN, VK_APPS, VK_CONTROL, VK_SHIFT = 0x5B, 0x5C, 0x5D, 0x11, 0x10
WM_QUIT = 0x0012


class KBDLLHOOKSTRUCT(ctypes.Structure):
    _fields_ = [("vkCode", wintypes.DWORD), ("scanCode", wintypes.DWORD), ("flags", wintypes.DWORD),
                ("time", wintypes.DWORD), ("dwExtraInfo", ctypes.c_size_t)]


LRESULT = ctypes.c_ssize_t
HOOKPROC = ctypes.WINFUNCTYPE(LRESULT, ctypes.c_int, wintypes.WPARAM, wintypes.LPARAM)
user32.SetWindowsHookExW.argtypes = [ctypes.c_int, HOOKPROC, wintypes.HINSTANCE, wintypes.DWORD]
user32.SetWindowsHookExW.restype = wintypes.HHOOK
user32.CallNextHookEx.argtypes = [wintypes.HHOOK, ctypes.c_int, wintypes.WPARAM, wintypes.LPARAM]
user32.CallNextHookEx.restype = LRESULT
user32.UnhookWindowsHookEx.argtypes = [wintypes.HHOOK]
user32.GetMessageW.argtypes = [ctypes.POINTER(wintypes.MSG), wintypes.HWND, wintypes.UINT, wintypes.UINT]
user32.PostThreadMessageW.argtypes = [wintypes.DWORD, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
user32.GetAsyncKeyState.argtypes = [ctypes.c_int]
user32.GetAsyncKeyState.restype = ctypes.c_short
kernel32.GetModuleHandleW.argtypes = [wintypes.LPCWSTR]
kernel32.GetModuleHandleW.restype = wintypes.HMODULE


def tecla_bloqueada(vk, flags, ctrl_presionado, shift_presionado=False):
    """True si la combinación debe ignorarse (sacaría al cliente de la app)."""
    alt = bool(flags & LLKHF_ALTDOWN)
    if vk in (VK_LWIN, VK_RWIN, VK_APPS):
        return True
    if alt and vk in (VK_TAB, VK_ESCAPE, VK_F4, VK_SPACE):
        return True
    if ctrl_presionado and vk == VK_ESCAPE:   # Ctrl+Esc (Inicio) y Ctrl+Shift+Esc (Administrador de tareas)
        return True
    return False


class Teclado:
    def __init__(self):
        self._gancho = None
        self._hilo_id = None
        self._proc = HOOKPROC(self._filtro)   # se guarda: si se libera, Windows llamaría a basura

    def _filtro(self, codigo, wparam, lparam):
        if codigo == 0:
            datos = ctypes.cast(lparam, ctypes.POINTER(KBDLLHOOKSTRUCT)).contents
            ctrl = bool(user32.GetAsyncKeyState(VK_CONTROL) & 0x8000)
            shift = bool(user32.GetAsyncKeyState(VK_SHIFT) & 0x8000)
            if tecla_bloqueada(datos.vkCode, datos.flags, ctrl, shift):
                return 1
        return user32.CallNextHookEx(self._gancho, codigo, wparam, lparam)

    def _bucle(self):
        self._hilo_id = kernel32.GetCurrentThreadId()
        self._gancho = user32.SetWindowsHookExW(WH_KEYBOARD_LL, self._proc, kernel32.GetModuleHandleW(None), 0)
        mensaje = wintypes.MSG()
        while user32.GetMessageW(ctypes.byref(mensaje), None, 0, 0) > 0:
            pass
        if self._gancho:
            user32.UnhookWindowsHookEx(self._gancho)
            self._gancho = None

    def poner(self):
        threading.Thread(target=self._bucle, name="bloqueo-teclas", daemon=True).start()

    def quitar(self):
        if self._hilo_id:
            user32.PostThreadMessageW(self._hilo_id, WM_QUIT, 0, 0)


teclado = Teclado()


# --------------------------------------------------------------------------- barra de tareas
SW_HIDE, SW_SHOW = 0, 5
user32.FindWindowW.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR]
user32.FindWindowW.restype = wintypes.HWND
user32.FindWindowExW.argtypes = [wintypes.HWND, wintypes.HWND, wintypes.LPCWSTR, wintypes.LPCWSTR]
user32.FindWindowExW.restype = wintypes.HWND
user32.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
user32.IsWindowVisible.argtypes = [wintypes.HWND]
user32.IsWindowVisible.restype = wintypes.BOOL


def _barras_de_tareas():
    """La barra principal y las de otros monitores."""
    barras = []
    principal = user32.FindWindowW("Shell_TrayWnd", None)
    if principal:
        barras.append(principal)
    otra = None
    while True:
        otra = user32.FindWindowExW(None, otra, "Shell_SecondaryTrayWnd", None)
        if not otra:
            break
        barras.append(otra)
    return barras


class BarraDeTareas:
    """Oculta la barra de tareas (y el botón Inicio) mientras la app está abierta."""

    def __init__(self):
        self._oculta = False
        self._hilo = None

    def ocultar(self):
        self._oculta = True
        for b in _barras_de_tareas():
            user32.ShowWindow(b, SW_HIDE)
        if not self._hilo:
            # Si Windows la vuelve a mostrar (reinicio del Explorador, otro monitor), ocultarla otra vez.
            self._hilo = threading.Thread(target=self._vigilar, name="barra-tareas", daemon=True)
            self._hilo.start()

    def _vigilar(self):
        while self._oculta:
            time.sleep(2)
            if self._oculta:
                for b in _barras_de_tareas():
                    if user32.IsWindowVisible(b):
                        user32.ShowWindow(b, SW_HIDE)

    def mostrar(self):
        self._oculta = False
        for b in _barras_de_tareas():
            user32.ShowWindow(b, SW_SHOW)


barra = BarraDeTareas()


# --------------------------------------------------------------------------- escudo: nada se queda encima del verificador
HWND_TOPMOST = wintypes.HWND(-1)
SWP_NOSIZE, SWP_NOMOVE, SWP_NOACTIVATE = 0x0001, 0x0002, 0x0010
SW_RESTORE = 9
user32.GetForegroundWindow.restype = wintypes.HWND
user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
user32.GetWindowThreadProcessId.restype = wintypes.DWORD
user32.SetWindowPos.argtypes = [wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wintypes.UINT]
user32.SetForegroundWindow.argtypes = [wintypes.HWND]
user32.BringWindowToTop.argtypes = [wintypes.HWND]
user32.AttachThreadInput.argtypes = [wintypes.DWORD, wintypes.DWORD, wintypes.BOOL]
user32.IsIconic.argtypes = [wintypes.HWND]
kernel32.GetCurrentThreadId.restype = wintypes.DWORD
TITULO_VENTANA = "Verificador FactPOS"


class Escudo:
    """Mantiene la ventana del verificador al frente y con el foco: los avisos de Windows (reinicio por actualizaciones,
    notificaciones, otras apps) quedan debajo y no reciben toques. Solo actúa cuando el equipo ya tiene servidor
    configurado (en la pantalla de configuración hace falta poder usar el teclado de Windows)."""

    def __init__(self):
        self._activo = False

    def iniciar(self):
        if self._activo:
            return
        self._activo = True
        threading.Thread(target=self._vigilar, name="escudo", daemon=True).start()

    def detener(self):
        self._activo = False

    def _vigilar(self):
        while self._activo:
            time.sleep(0.4)
            try:
                if not leer_config().get("servidor"):
                    continue
                hwnd = user32.FindWindowW(None, TITULO_VENTANA)
                if not hwnd or not user32.IsWindowVisible(hwnd) and not user32.IsIconic(hwnd):
                    continue
                if user32.IsIconic(hwnd):
                    user32.ShowWindow(hwnd, SW_RESTORE)
                # Por encima de todo, también de otras ventanas «siempre visibles»
                user32.SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE)
                primero = user32.GetForegroundWindow()
                if primero != hwnd:
                    self._tomar_foco(hwnd, primero)
            except Exception:
                pass

    @staticmethod
    def _tomar_foco(hwnd, primero):
        actual = kernel32.GetCurrentThreadId()
        otro = user32.GetWindowThreadProcessId(primero, None) if primero else 0
        unido = bool(otro) and otro != actual
        if unido:
            user32.AttachThreadInput(actual, otro, True)
        try:
            user32.BringWindowToTop(hwnd)
            user32.SetForegroundWindow(hwnd)
        finally:
            if unido:
                user32.AttachThreadInput(actual, otro, False)


escudo = Escudo()

RUTA_AVISOS = r"Software\Microsoft\Windows\CurrentVersion\PushNotifications"


def silenciar_avisos():
    """Apaga las notificaciones emergentes del usuario mientras la app está abierta. Devuelve el valor anterior para restaurarlo."""
    try:
        with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, RUTA_AVISOS, 0, winreg.KEY_READ | winreg.KEY_WRITE) as k:
            try:
                previo = winreg.QueryValueEx(k, "ToastEnabled")[0]
            except FileNotFoundError:
                previo = None
            winreg.SetValueEx(k, "ToastEnabled", 0, winreg.REG_DWORD, 0)
        return previo
    except OSError:
        return None


def restaurar_avisos(previo):
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUTA_AVISOS, 0, winreg.KEY_WRITE) as k:
            if previo is None:
                winreg.DeleteValue(k, "ToastEnabled")
            else:
                winreg.SetValueEx(k, "ToastEnabled", 0, winreg.REG_DWORD, int(previo))
    except OSError:
        pass


# --------------------------------------------------------------------------- pantalla de configuración
_url_config = None


def url_config():
    """Sirve config.html en 127.0.0.1 (puerto libre). Un origen http local sí puede consultar la red de la tienda."""
    global _url_config
    if _url_config:
        return _url_config
    with open(recurso("config.html"), "rb") as f:
        contenido = f.read()

    class Pagina(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path.split("?")[0] == "/copia":
                # La pantalla del verificador guardada, para cuando el servidor no responde (consulta precios con la copia del catálogo)
                pagina = leer_copia("copia_pagina.html")
                if not pagina:
                    self.send_error(404)
                    return
                cuerpo = pagina.replace("<head>", "<head><script>window.__factposSinConexion=true;</script>", 1).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", str(len(cuerpo)))
                self.end_headers()
                self.wfile.write(cuerpo)
            elif self.path.split("?")[0] in ("/", "/config.html"):
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", str(len(contenido)))
                self.end_headers()
                self.wfile.write(contenido)
            else:
                self.send_error(404)

        def log_message(self, *args):
            pass

    servidor = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Pagina)
    threading.Thread(target=servidor.serve_forever, name="pantalla-config", daemon=True).start()
    _url_config = f"http://127.0.0.1:{servidor.server_port}/config.html"
    return _url_config


# --------------------------------------------------------------------------- configuración y clave
def leer_config():
    try:
        with open(CONFIG_JSON, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def guardar_config(cfg):
    os.makedirs(DATOS, exist_ok=True)
    with open(CONFIG_JSON, "w", encoding="utf-8") as f:
        json.dump(cfg, f)


def leer_copia(nombre):
    try:
        with open(os.path.join(DATOS, nombre), encoding="utf-8") as f:
            return f.read()
    except Exception:
        return ""


def escribir_copia(nombre, texto):
    os.makedirs(DATOS, exist_ok=True)
    ruta = os.path.join(DATOS, nombre)
    with open(ruta + ".tmp", "w", encoding="utf-8") as f:
        f.write(texto)
    os.replace(ruta + ".tmp", ruta)


def _servidor_responde(servidor):
    """Cualquier respuesta HTTP (aunque sea un error) significa que el servidor está vivo."""
    try:
        u = urllib.parse.urlparse(servidor)
        urllib.request.urlopen(f"{u.scheme}://{u.netloc}/verificador/config", timeout=3).close()
        return True
    except urllib.error.HTTPError:
        return True
    except Exception:
        return False


def _identidad(base):
    """Quién es el servidor de la tienda (empresa + sucursales, de /descubrir), o None si no responde o no es FactPOS."""
    try:
        with urllib.request.urlopen(base + "/descubrir", timeout=1.5) as r:
            d = json.loads(r.read(20000).decode("utf-8"))
        if d.get("producto") != "FactPOS":
            return None
        return json.dumps([d.get("empresa"), sorted(d.get("sucursales") or [])], ensure_ascii=False)
    except Exception:
        return None


def _buscar_servidor(api, sv, identidad):
    """El servidor de la dirección guardada no responde (cambió de IP, o la guardada era de otro equipo, p. ej. uno de
    prueba): lo busca como las cajas: primero por su nombre en la red (factpos.local) y luego recorriendo las redes de
    este equipo en el mismo puerto. Prefiere el de la huella de empresa ya conocida; si no está, acepta
    el único FactPOS que encuentre (si hay varios distintos no adivina). Devuelve la dirección nueva o None."""
    from concurrent.futures import ThreadPoolExecutor
    u = urllib.parse.urlparse(sv)
    puerto = u.port or (443 if u.scheme == "https" else 80)
    redes = set(json.loads(api.redes()))
    if u.hostname and u.hostname.count(".") == 3:
        redes.add(u.hostname.rsplit(".", 1)[0])
    bases = [f"{u.scheme}://factpos.local:{puerto}"] + [f"{u.scheme}://{red}.{k}:{puerto}" for red in redes for k in range(1, 255)]
    propia = f"{u.scheme}://{u.netloc}"
    hallados = []
    with ThreadPoolExecutor(max_workers=64) as ex:
        for base, ident in zip(bases, ex.map(_identidad, bases)):
            if ident and base != propia:
                hallados.append((base, ident))
    if identidad and any(h[1] == identidad for h in hallados):
        hallados = [h for h in hallados if h[1] == identidad]      # el mismo de antes, con otra IP
    # factpos.local y la IP del mismo servidor cuentan una sola vez
    distintos = {h[1] for h in hallados}
    if len(distintos) != 1:
        return None
    for base, _ in hallados:                  # se prefiere la IP: no depende de que el equipo resuelva factpos.local
        if "factpos.local" not in base:
            return base
    return hallados[0][0]


def _vigilar_servidor(api, empezar_en_copia=False):
    """Si el servidor deja de responder se abre la copia guardada de la pantalla (los precios se consultan con la copia
    del catálogo); apenas vuelve se regresa a la pantalla real. Si tarda en volver, lo busca en la red por si cambió
    de dirección."""
    en_copia = empezar_en_copia   # mostrando la copia guardada
    caido = empezar_en_copia      # el servidor dejó de responder (haya o no copia)
    fallos = 2 if empezar_en_copia else 0
    ultima_busqueda = 0.0
    while True:
        time.sleep(5)
        try:
            sv = leer_config().get("servidor") or ""
            if not sv or not api._ventana:
                continue
            vivo = _servidor_responde(sv)
            if vivo:
                if caido:
                    caido = en_copia = False
                    api._ventana.load_url(sv)       # incluye la página de error del navegador si no había copia
                fallos = 0
                c = leer_config()
                if not c.get("identidad"):
                    ident = _identidad("{0.scheme}://{0.netloc}".format(urllib.parse.urlparse(sv)))
                    if ident:
                        c["identidad"] = ident
                        guardar_config(c)
                continue
            fallos += 1
            if fallos >= 2:
                caido = True
                if not en_copia and leer_copia("copia_pagina.html") and leer_copia("copia_catalogo.json"):
                    en_copia = True
                    api._ventana.load_url(url_config().rsplit("/", 1)[0] + "/copia")
            ident = leer_config().get("identidad")
            if fallos >= 3 and time.time() - ultima_busqueda > 60:
                ultima_busqueda = time.time()
                nuevo = _buscar_servidor(api, sv, ident)
                if nuevo:
                    u = urllib.parse.urlparse(sv)
                    c = leer_config()
                    c["servidor"] = nuevo + (u.path or "") + (("?" + u.query) if u.query else "")
                    guardar_config(c)
                    # el siguiente ciclo lo ve vivo y recarga
        except Exception:
            pass


# --------------------------------------------------------------------------- puente con las páginas
class Kiosco:
    """Lo que las páginas (configuración y /verificador) pueden pedir (window.pywebview.api.*).
    Salir y cambiar de servidor exigen la clave de salida."""

    def __init__(self):
        self._ventana = None
        self._permitir_cierre = False

    def _direccion(self):
        return leer_config().get("servidor") or url_config()

    def esApp(self):
        return True

    def guardarCopia(self, pagina, catalogo):
        """La pantalla del verificador entrega una copia de sí misma y del catálogo de precios (solo se guardan si parecen completos)."""
        if not isinstance(pagina, str) or not isinstance(catalogo, str) or len(pagina) < 1000 or '"items"' not in catalogo:
            return False
        escribir_copia("copia_catalogo.json", catalogo)
        escribir_copia("copia_pagina.html", pagina)
        return True

    def leerCopia(self):
        return leer_copia("copia_catalogo.json")

    def plataforma(self):
        return "windows"

    def version(self):
        return VERSION

    def estado(self):
        c = leer_config()
        return json.dumps({"servidor": c.get("servidor", ""), "bloqueoTotal": False, "botonesBloqueados": True})

    def redes(self):
        """Redes /24 a las que está conectado este equipo (["192.168.1", …]), para buscar el servidor."""
        ips = set()
        try:
            ips.update(socket.gethostbyname_ex(socket.gethostname())[2])
        except Exception:
            pass
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("10.255.255.255", 1))     # no envía nada: solo elige la tarjeta de red activa
            ips.add(s.getsockname()[0])
            s.close()
        except Exception:
            pass
        return json.dumps(sorted({ip.rsplit(".", 1)[0] for ip in ips
                                  if ip.count(".") == 3 and not ip.startswith(("127.", "169.254."))}))

    # Sin conexión con el servidor no se puede validar el PIN allá: se acepta uno que ESTE equipo ya validó antes
    # con el servidor (se guarda solo su huella con sal, nunca el PIN). Si el servidor lo rechaza después, se olvida.
    @staticmethod
    def _huella(pin, sal):
        return hashlib.pbkdf2_hmac("sha256", pin.encode("utf-8"), sal, 100_000).hex()

    def _pin_recordado(self, pin):
        for e in leer_config().get("pines") or []:
            try:
                if hmac.compare_digest(self._huella(pin, bytes.fromhex(e["s"])), e["h"]):
                    return True
            except Exception:
                continue
        return False

    def _recordar_pin(self, pin):
        try:
            if self._pin_recordado(pin):
                return
            c = leer_config()
            sal = os.urandom(16)
            c["pines"] = ((c.get("pines") or []) + [{"s": sal.hex(), "h": self._huella(pin, sal)}])[-5:]
            guardar_config(c)
        except Exception:
            pass

    def _olvidar_pin(self, pin):
        try:
            c = leer_config()
            antes = c.get("pines") or []
            c["pines"] = [e for e in antes if not hmac.compare_digest(self._huella(pin, bytes.fromhex(e["s"])), e["h"])]
            if len(c["pines"]) != len(antes):
                guardar_config(c)
        except Exception:
            pass

    def _comprobar_pin(self, pin):
        """El PIN de un supervisor o administrador de FactPOS, validado por el servidor de la sucursal.
        Devuelve "ok", "incorrecta", "sin_conexion" o el texto que mande el servidor.
        Si no hay conexión, vale un PIN que este equipo ya validó antes con el servidor."""
        sv = leer_config().get("servidor") or ""
        if not isinstance(pin, str) or not re.match(r"^\d{4,8}$", pin):
            return "incorrecta"
        if not sv:
            return "ok" if self._pin_recordado(pin) else "incorrecta"
        try:
            u = urllib.parse.urlparse(sv)
            pedido = urllib.request.Request(f"{u.scheme}://{u.netloc}/verificador/autorizar-salida",
                                            data=json.dumps({"pin": pin}).encode("utf-8"),
                                            headers={"Content-Type": "application/json"}, method="POST")
            with urllib.request.urlopen(pedido, timeout=3) as r:
                if r.status == 200:
                    self._recordar_pin(pin)
                    return "ok"
                return "ok" if self._pin_recordado(pin) else "sin_conexion"
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                self._olvidar_pin(pin)
                return "incorrecta"
            if e.code == 429:
                return "Demasiados intentos: espere unos minutos."
            return "ok" if self._pin_recordado(pin) else "sin_conexion"
        except Exception:
            return "ok" if self._pin_recordado(pin) else "sin_conexion"

    def verificarClave(self, pin):
        return self._comprobar_pin(pin)

    def guardar(self, url):
        """Guarda la dirección del servidor. Solo mientras no haya uno (para cambiarlo: ⓘ › Cambiar de servidor, con PIN)."""
        v = (url or "").strip()
        if not re.match(r"^https?://[^\s/]+(/\S*)?$", v):
            return "Escriba una dirección válida, por ejemplo http://192.168.1.10:3000/verificador"
        if leer_config().get("servidor"):
            return "Este equipo ya tiene un servidor: para cambiarlo use ⓘ › Cambiar de servidor."
        c = leer_config()
        c["servidor"] = v
        guardar_config(c)
        if self._ventana:
            self._ventana.load_url(v)
        return ""

    def cambiarServidor(self, clave):
        if self._comprobar_pin(clave) != "ok":
            return False
        c = leer_config()
        c.pop("servidor", None)
        c.pop("pines", None)     # los PIN eran del servidor anterior
        guardar_config(c)
        for n in ("copia_pagina.html", "copia_catalogo.json"):
            try:
                os.remove(os.path.join(DATOS, n))
            except OSError:
                pass
        if self._ventana:
            self._ventana.load_url(url_config())
        return True

    def salir(self, clave):
        if self._comprobar_pin(clave) != "ok":
            return False
        self._cerrar()
        return True

    def _cerrar(self):
        self._permitir_cierre = True
        teclado.quitar()
        barra.mostrar()
        if self._ventana:
            self._ventana.destroy()


# --------------------------------------------------------------------------- actualización automática
INTERVALO_ACTUALIZAR = 60   # segundos entre consultas (livianas) al servidor de la sucursal


def _compilacion():
    """Número de compilación de esta app (lo escribe GitHub Actions en VERSION = «1.0.N»; 0 si no es una compilación oficial)."""
    try:
        return int(VERSION.rsplit(".", 1)[1])
    except Exception:
        return 0


def _buscar_actualizacion():
    """Pregunta al servidor de la sucursal cuál es la versión vigente; si hay una nueva, la descarga y la instala en silencio.
    Todo pasa por el servidor de la sucursal (no hay otra conexión). Sin servidor o sin internet no hace nada."""
    propia = _compilacion()
    sv = leer_config().get("servidor") or ""
    if not propia or not sv:
        return
    u = urllib.parse.urlparse(sv)
    base = f"{u.scheme}://{u.netloc}"
    equipo = platform.node()[:60]
    ident = re.sub(r"[^A-Za-z0-9._-]", "_", equipo)[:60] or "equipo"
    with urllib.request.urlopen(f"{base}/verificador/actualizacion/windows?build={propia}&id={ident}&equipo={urllib.parse.quote(equipo)}", timeout=15) as r:
        info = json.loads(r.read().decode("utf-8"))
    vigente, orden, auto = int(info.get("version") or 0), int(info.get("orden") or 0), info.get("auto", True) is not False
    cfg = leer_config()
    por_orden = orden > int(cfg.get("act_orden") or 0)      # botón «Actualizar verificadores ahora» de la administración
    if por_orden:
        cfg["act_orden"] = orden
        guardar_config(cfg)
    if vigente <= propia:
        return
    if not por_orden and not auto:
        return                      # actualización automática apagada: solo por orden
    if not por_orden and cfg.get("act_intento") == vigente and time.time() - float(cfg.get("act_hora") or 0) < 6 * 3600:
        return                      # ya se intentó esta versión hace poco: no insistir en bucle
    cfg["act_intento"], cfg["act_hora"] = vigente, time.time()
    guardar_config(cfg)
    os.makedirs(DATOS, exist_ok=True)
    destino = os.path.join(DATOS, "Actualizacion_Verificador_FactPOS.exe")
    with urllib.request.urlopen(f"{base}/verificador/descarga/windows", timeout=60) as r, open(destino, "wb") as f:
        while True:
            trozo = r.read(1 << 20)
            if not trozo:
                break
            f.write(trozo)
    if os.path.getsize(destino) < (1 << 20) or open(destino, "rb").read(2) != b"MZ":
        os.remove(destino)
        return                      # no es un instalador
    # El instalador cierra esta app, copia los archivos nuevos y la vuelve a abrir (instalación silenciosa, sin administrador)
    try:
        teclado.quitar()
        barra.mostrar()
    except Exception:
        pass
    subprocess.Popen([destino, "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/CLOSEAPPLICATIONS"],
                     creationflags=0x00000008 | 0x00000200, close_fds=True)   # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
    os._exit(0)


def _bucle_actualizar():
    time.sleep(20)                  # primero que arranque y cargue la pantalla
    while True:
        try:
            _buscar_actualizacion()
        except Exception:
            pass                    # sin red o sin servidor: se intenta de nuevo más tarde
        time.sleep(INTERVALO_ACTUALIZAR)


def main():
    if ya_abierta():
        sys.exit(0)
    os.makedirs(WEBVIEW, exist_ok=True)
    api = Kiosco()
    threading.Thread(target=_bucle_actualizar, name="actualizar", daemon=True).start()
    # Si el equipo arranca y el servidor no responde, se abre de una vez la copia guardada (si no, quedaba una pantalla
    # azul vacía y luego la página de error del navegador)
    inicio = api._direccion()
    en_copia = False
    sv = leer_config().get("servidor") or ""
    if sv and not _servidor_responde(sv) and leer_copia("copia_pagina.html") and leer_copia("copia_catalogo.json"):
        inicio = url_config().rsplit("/", 1)[0] + "/copia"
        en_copia = True
    threading.Thread(target=_vigilar_servidor, args=(api, en_copia), name="vigilar-servidor", daemon=True).start()
    ventana = webview.create_window(
        "Verificador FactPOS", inicio, js_api=api,
        fullscreen=True, frameless=True, on_top=True, easy_drag=False,
        background_color="#10202E", text_select=False, zoomable=False, confirm_close=False)
    api._ventana = ventana

    def al_cerrar():
        return api._permitir_cierre      # False = no se cierra (Alt+F4, etc.)

    def al_minimizar():
        time.sleep(0.2)
        try:
            ventana.restore()
        except Exception:
            pass

    def al_cargar():
        # Esquina ✕ / ⓘ (cerrar y opciones con la clave) en la pantalla del verificador, no en la de configuración
        try:
            url = ventana.get_current_url() or ""
            if url.startswith("http"):
                with open(recurso("boton-app.js"), encoding="utf-8") as f:
                    ventana.evaluate_js(f.read())
        except Exception:
            pass

    ventana.events.loaded += al_cargar
    ventana.events.closing += al_cerrar
    ventana.events.minimized += al_minimizar
    teclado.poner()
    barra.ocultar()
    avisos_previos = silenciar_avisos()
    escudo.iniciar()
    import atexit
    atexit.register(barra.mostrar)      # pase lo que pase, la barra de tareas vuelve al salir
    try:
        webview.start(gui="edgechromium", private_mode=False, storage_path=WEBVIEW, debug=False)
    finally:
        escudo.detener()
        restaurar_avisos(avisos_previos)
        teclado.quitar()
        barra.mostrar()


if __name__ == "__main__":
    main()
