"""Verificador FactPOS para Windows: verificador de precios tipo quiosco.

- Abre el verificador del servidor de la sucursal (http://IP:3000/verificador) a pantalla completa,
  siempre encima, sin bordes. La primera vez pide la dirección del servidor y una clave de salida.
- Usa WebView2 (el motor de Microsoft Edge, ya incluido en Windows 10/11).
- Bloquea Alt+Tab, Alt+Esc, Ctrl+Esc, Ctrl+Shift+Esc, Alt+F4, Alt+Espacio y la tecla Windows.
- Oculta la barra de tareas mientras está abierta; vuelve a aparecer al cerrar la app.
- No se puede cerrar ni minimizar: se sale SOLO desde la esquina de la pantalla (ⓘ) con la clave de salida.
- Una sola copia abierta a la vez.

Ctrl+Alt+Supr no se puede bloquear desde un programa (es una protección de Windows). Para un
bloqueo total, usar además "Acceso asignado" de Windows.
"""
import ctypes
import hashlib
import json
import os
import re
import secrets
import sys
import threading
import time
from ctypes import wintypes

import webview

# La compilación (GitHub Actions) reemplaza este valor.
VERSION = "1.0.0"
VUELTAS = 20000
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


def huella(sal, clave):
    h = (sal + ":" + clave).encode("utf-8")
    for _ in range(VUELTAS):
        h = hashlib.sha256(h).digest()
    return h.hex()


# --------------------------------------------------------------------------- puente con las páginas
class Kiosco:
    """Lo que las páginas (configuración y /verificador) pueden pedir (window.pywebview.api.*).
    Salir y cambiar de servidor exigen la clave de salida."""

    def __init__(self):
        self._ventana = None
        self._permitir_cierre = False

    def _direccion(self):
        return leer_config().get("servidor") or recurso("config.html")

    def esApp(self):
        return True

    def plataforma(self):
        return "windows"

    def version(self):
        return VERSION

    def estado(self):
        c = leer_config()
        return json.dumps({"servidor": c.get("servidor", ""), "tieneClave": bool(c.get("hash")),
                           "bloqueoTotal": False, "botonesBloqueados": True})

    def verificarClave(self, clave):
        c = leer_config()
        return bool(c.get("hash")) and isinstance(clave, str) and huella(c.get("sal", ""), clave) == c["hash"]

    def guardar(self, url, clave, claveActual):
        v = (url or "").strip()
        if not re.match(r"^https?://[^\s/]+(/\S*)?$", v):
            return "Escriba una dirección válida, por ejemplo http://192.168.1.10:3000/verificador"
        if leer_config().get("hash") and not self.verificarClave(claveActual):
            return "La clave de salida actual no es correcta."
        if not isinstance(clave, str) or len(clave) < 4:
            return "La clave de salida debe tener al menos 4 caracteres."
        sal = secrets.token_hex(12)
        guardar_config({"servidor": v, "sal": sal, "hash": huella(sal, clave)})
        if self._ventana:
            self._ventana.load_url(v)
        return ""

    def cambiarServidor(self, clave):
        if not self.verificarClave(clave):
            return False
        c = leer_config()
        c.pop("servidor", None)
        guardar_config(c)
        if self._ventana:
            self._ventana.load_url(recurso("config.html"))
        return True

    def salir(self, clave):
        if not self.verificarClave(clave):
            return False
        self._cerrar()
        return True

    def _cerrar(self):
        self._permitir_cierre = True
        teclado.quitar()
        barra.mostrar()
        if self._ventana:
            self._ventana.destroy()


def main():
    if ya_abierta():
        sys.exit(0)
    os.makedirs(WEBVIEW, exist_ok=True)
    api = Kiosco()
    ventana = webview.create_window(
        "Verificador FactPOS", api._direccion(), js_api=api,
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

    ventana.events.closing += al_cerrar
    ventana.events.minimized += al_minimizar
    teclado.poner()
    barra.ocultar()
    import atexit
    atexit.register(barra.mostrar)      # pase lo que pase, la barra de tareas vuelve al salir
    try:
        webview.start(gui="edgechromium", private_mode=False, storage_path=WEBVIEW, debug=False)
    finally:
        teclado.quitar()
        barra.mostrar()


if __name__ == "__main__":
    main()
