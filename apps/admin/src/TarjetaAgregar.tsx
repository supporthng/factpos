import { useEffect, useState } from "react";

/**
 * Tarjeta del inicio para el celular: «Agrega FactPOS a tu inicio» con un botón «Agregar».
 * En Android con instalación directa abre el aviso del sistema; si no (iPhone, u otro navegador) muestra los pasos.
 * No sale en el computador ni cuando la app ya está puesta en la pantalla de inicio. «Ahora no» la oculta 14 días.
 */
interface EventoInstalar extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }>; }

const CLAVE = "factpos.agregar-inicio.hasta";
const hastaCuando = () => { try { return Number(localStorage.getItem(CLAVE) ?? 0); } catch { return 0; } };
const posponer = () => { try { localStorage.setItem(CLAVE, String(Date.now() + 14 * 86400e3)); } catch { /* sin almacenamiento: vuelve a salir */ } };

export function TarjetaAgregar() {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const esIphone = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && typeof navigator !== "undefined" && navigator.maxTouchPoints > 1);
  const esAndroid = /Android/i.test(ua);
  const yaInstalada = typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true);
  const [oculta, setOculta] = useState(() => hastaCuando() > Date.now());
  const [pasos, setPasos] = useState(false);
  const [evento, setEvento] = useState<EventoInstalar | null>(null);
  useEffect(() => {
    const f = (e: Event) => { e.preventDefault(); setEvento(e as EventoInstalar); };
    window.addEventListener("beforeinstallprompt", f);
    return () => window.removeEventListener("beforeinstallprompt", f);
  }, []);
  if (yaInstalada || !(esIphone || esAndroid) || oculta) return null;

  const agregar = async () => {
    if (evento) {
      try { await evento.prompt(); await evento.userChoice; } catch { /* cancelado */ }
      setEvento(null);
      return;
    }
    setPasos((v) => !v);
  };
  return (
    <section className="tarjeta-agregar" role="note" aria-label="Agregar FactPOS a la pantalla de inicio">
      <div className="tarjeta-agregar-fila">
        <img src="./iconos/factpos-192.png" alt="" width={48} height={48} />
        <div className="tarjeta-agregar-texto">
          <b>Agrega FactPOS a tu inicio</b>
          <span>Ábrelo como una app, a pantalla completa y sin escribir la dirección.</span>
        </div>
        <div className="tarjeta-agregar-botones">
          <button type="button" className="boton primario" onClick={agregar}>Agregar</button>
          <button type="button" className="enlace pequeno" onClick={() => { posponer(); setOculta(true); }}>Ahora no</button>
        </div>
      </div>
      {pasos && (esIphone ? (
        <ol className="tarjeta-agregar-pasos">
          <li>Abre esta página en <b>Safari</b>.</li>
          <li>Toca <b>Compartir</b> (el cuadro con la flecha hacia arriba).</li>
          <li>Baja y toca <b>«Añadir a pantalla de inicio»</b>, luego <b>Añadir</b>.</li>
        </ol>
      ) : (
        <ol className="tarjeta-agregar-pasos">
          <li>En <b>Chrome</b>, toca los <b>tres puntos</b> (⋮) arriba a la derecha.</li>
          <li>Toca <b>«Instalar aplicación»</b> o <b>«Añadir a la pantalla de inicio»</b>.</li>
          <li>Confirma con <b>Instalar</b>.</li>
        </ol>
      ))}
    </section>
  );
}
