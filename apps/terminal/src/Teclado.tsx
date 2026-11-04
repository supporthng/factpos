import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Teclado en pantalla de la caja (el de Windows no aparece en el modo quiosco).
 * Es uno solo para toda la aplicación: se abre al TOCAR un campo de texto o de monto y escribe en el campo
 * activo, así que no hay que cablearlo pantalla por pantalla. Es flotante (se arrastra) y se aparta del campo.
 *
 *  · Numérico si el campo declara inputMode numeric / decimal / tel; alfanumérico en el resto.
 *  · Se abre al tocar o hacer clic en el campo, nunca con el lector de códigos ni por autoFocus (así no estorba al escanear).
 *    Ajuste «teclado.modo»: "siempre" (por defecto: también con mouse, salvo en los campos de escaneo) | "tactil" (solo dedo) | "nunca".
 *  · Los campos de PIN (type=password) no lo abren: ya traen su propio teclado.
 */

type Campo = HTMLInputElement | HTMLTextAreaElement;
type Modo = "num" | "dec" | "abc";

const SIN_TEXTO = new Set(["checkbox", "radio", "button", "submit", "range", "file", "color", "date", "time", "hidden", "image", "reset"]);

function modoAjuste(): "tactil" | "siempre" | "nunca" {
  try { const v = localStorage.getItem("factpos.teclado.modo"); if (v === "tactil" || v === "nunca") return v; } catch { /* sin almacenamiento */ }
  return "siempre";
}

function esCampoDeTexto(el: EventTarget | null): el is Campo {
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (!(el instanceof HTMLInputElement)) return false;
  if (el.readOnly || el.disabled || SIN_TEXTO.has(el.type) || el.type === "password") return false;
  return !el.closest("[data-sin-teclado]");
}

function modoDe(el: Campo): Modo {
  const im = el.inputMode;
  if (im === "decimal" || el.type === "number") return "dec";
  if (im === "numeric" || im === "tel") return "num";
  return "abc";
}

/** Escribe en el campo como si el usuario tecleara: dispara el evento «input» para que React actualice su estado. */
function escribir(el: Campo, texto: string, borrar = false) {
  const valor = el.value;
  let ini = el.selectionStart ?? valor.length, fin = el.selectionEnd ?? valor.length;
  let nuevo: string, pos: number;
  if (borrar) {
    if (ini === fin) { if (ini === 0) return; ini -= 1; }
    nuevo = valor.slice(0, ini) + valor.slice(fin); pos = ini;
  } else {
    if (el.maxLength > 0 && valor.length - (fin - ini) + texto.length > el.maxLength) return;
    nuevo = valor.slice(0, ini) + texto + valor.slice(fin); pos = ini + texto.length;
  }
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, nuevo);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  try { el.setSelectionRange(pos, pos); } catch { /* tipos sin selección (number) */ }
}

function limpiar(el: Campo) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, "");
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

const FILAS_ABC = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l", "ñ"],
  ["⇧", "z", "x", "c", "v", "b", "n", "m", "⌫"],
];
const FILAS_NUM = [["7", "8", "9", "⌫"], ["4", "5", "6", "C"], ["1", "2", "3", "."]];

export function TecladoPantalla() {
  const [campo, setCampo] = useState<Campo | null>(null);
  const [mayus, setMayus] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(() => {
    try { const p = JSON.parse(localStorage.getItem("factpos.teclado.pos") ?? "null"); if (p && typeof p.x === "number") return p; } catch { /* nada */ }
    return null;
  });
  const manual = useRef(false);
  const caja = useRef<HTMLDivElement>(null);
  const ultimoToque = useRef<{ t: number; tipo: string }>({ t: 0, tipo: "" });

  // Un toque (o clic, según el ajuste) sobre un campo abre el teclado; salir del campo lo cierra.
  useEffect(() => {
    const abajo = (e: PointerEvent) => {
      ultimoToque.current = { t: Date.now(), tipo: e.pointerType };
      const dentro = (e.target as HTMLElement | null)?.closest?.("[data-teclado-pantalla]");
      if (dentro) return;
      const m = modoAjuste();
      if (m === "nunca") { setCampo(null); return; }
      const el = (e.target as HTMLElement | null)?.closest?.("input,textarea") ?? null;
      // Los campos de escaneo (data-teclado="tactil") solo abren el teclado con el dedo: con mouse o lector no estorba.
      const soloTactil = (el as HTMLElement | null)?.dataset?.teclado === "tactil";
      if (esCampoDeTexto(el) && (e.pointerType !== "mouse" || (m === "siempre" && !soloTactil))) { manual.current = false; setCampo(el); }
      else if (!el) setCampo(null);
    };
    const adentro = (e: FocusEvent) => {
      // Enfocar por código (autoFocus, lector) cierra el teclado si estaba abierto sobre otro campo
      if (esCampoDeTexto(e.target)) {
        const reciente = Date.now() - ultimoToque.current.t < 600;
        if (!reciente) setCampo((c) => (c && c !== e.target ? null : c));
        else setCampo((c) => (c ? (e.target as Campo) : c));
      }
    };
    document.addEventListener("pointerdown", abajo, true);
    document.addEventListener("focusin", adentro, true);
    return () => { document.removeEventListener("pointerdown", abajo, true); document.removeEventListener("focusin", adentro, true); };
  }, []);

  // El campo desapareció (se cerró la ventana): se cierra también el teclado.
  useEffect(() => {
    if (!campo) return;
    const t = window.setInterval(() => { if (!campo.isConnected) setCampo(null); }, 400);
    return () => window.clearInterval(t);
  }, [campo]);

  // Se coloca del lado contrario al campo para no taparlo, salvo que el usuario ya lo haya movido.
  const colocar = useCallback(() => {
    const c = caja.current; if (!c || !campo) return;
    const r = campo.getBoundingClientRect(); const w = c.offsetWidth, h = c.offsetHeight;
    const margen = 10;
    if (manual.current && pos) { setPos({ x: Math.min(Math.max(0, pos.x), innerWidth - w), y: Math.min(Math.max(0, pos.y), innerHeight - h) }); return; }
    const abajo = r.top + r.height / 2 < innerHeight / 2;
    const x = Math.min(Math.max(margen, r.left + r.width / 2 - w / 2), innerWidth - w - margen);
    const y = abajo ? innerHeight - h - margen : margen;
    setPos({ x, y });
  }, [campo, pos]);
  useEffect(() => { if (campo) requestAnimationFrame(colocar); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [campo]);

  if (!campo) return null;
  const modo = modoDe(campo);
  const cerrar = () => { try { campo.blur(); } catch { /* nada */ } setCampo(null); };
  const enter = () => { campo.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true })); };
  const tecla = (t: string) => {
    if (t === "⌫") escribir(campo, "", true);
    else if (t === "C") limpiar(campo);
    else if (t === "⇧") setMayus((m) => !m);
    else if (modo !== "abc" && t === "00" && campo.value.includes(".")) return;
    else escribir(campo, modo === "abc" && mayus ? t.toUpperCase() : t);
    if (modo === "abc" && mayus && t !== "⇧") setMayus(false);
  };

  // Arrastre desde la barra superior
  const arrastrar = (e: React.PointerEvent) => {
    const c = caja.current; if (!c) return;
    const r = c.getBoundingClientRect(); const dx = e.clientX - r.left, dy = e.clientY - r.top;
    const mover = (ev: PointerEvent) => { manual.current = true; setPos({ x: Math.min(Math.max(0, ev.clientX - dx), innerWidth - r.width), y: Math.min(Math.max(0, ev.clientY - dy), innerHeight - r.height) }); };
    const fin = () => {
      document.removeEventListener("pointermove", mover); document.removeEventListener("pointerup", fin);
      try { const b = caja.current?.getBoundingClientRect(); if (b) localStorage.setItem("factpos.teclado.pos", JSON.stringify({ x: b.left, y: b.top })); } catch { /* nada */ }
    };
    document.addEventListener("pointermove", mover); document.addEventListener("pointerup", fin);
  };
  // Las teclas no deben robar el foco al campo
  const sinFoco = (e: React.MouseEvent) => e.preventDefault();

  return (
    <div ref={caja} data-teclado-pantalla className={"teclado-pantalla " + (modo === "abc" ? "abc" : "num")}
      style={pos ? { left: pos.x, top: pos.y } : { left: "50%", bottom: 10, transform: "translateX(-50%)" }}
      onMouseDown={sinFoco} role="group" aria-label="Teclado en pantalla">
      <div className="tp-barra" onPointerDown={arrastrar}>
        <span>⠿ Teclado · arrastre para mover</span>
        <button type="button" className="tp-cerrar" onClick={cerrar}>Cerrar</button>
      </div>
      {modo === "abc" ? (
        <div className="tp-filas">
          {FILAS_ABC.map((f, i) => (
            <div key={i} className="tp-fila">
              {f.map((t) => (
                <button key={t} type="button" className={"tp-tecla" + (t === "⇧" ? " tp-esp" : "") + (t === "⇧" && mayus ? " activa" : "") + (t === "⌫" ? " tp-esp" : "")} onClick={() => tecla(t)}>
                  {/^[a-zñ]$/.test(t) && mayus ? t.toUpperCase() : t}
                </button>
              ))}
            </div>
          ))}
          <div className="tp-fila">
            <button type="button" className="tp-tecla" onClick={() => tecla("-")}>-</button>
            <button type="button" className="tp-tecla" onClick={() => tecla(".")}>.</button>
            <button type="button" className="tp-tecla tp-espacio" onClick={() => tecla(" ")}>espacio</button>
            <button type="button" className="tp-tecla" onClick={() => tecla("@")}>@</button>
            <button type="button" className="tp-tecla" onClick={() => tecla("C")}>C</button>
            <button type="button" className="tp-tecla tp-listo" onClick={() => { enter(); }}>Enter</button>
          </div>
        </div>
      ) : (
        <div className="tp-filas">
          {FILAS_NUM.map((f, i) => (
            <div key={i} className="tp-fila">
              {f.map((t) => (
                <button key={t} type="button" className="tp-tecla" disabled={t === "." && modo === "num"} onClick={() => tecla(t)}>{t}</button>
              ))}
            </div>
          ))}
          <div className="tp-fila">
            <button type="button" className="tp-tecla tp-ancha" onClick={() => tecla("0")}>0</button>
            <button type="button" className="tp-tecla" disabled={modo === "num"} onClick={() => tecla("00")}>00</button>
            <button type="button" className="tp-tecla tp-listo" onClick={cerrar}>Listo</button>
          </div>
        </div>
      )}
    </div>
  );
}
