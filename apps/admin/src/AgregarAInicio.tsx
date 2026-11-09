import { useEffect, useState } from "react";

/**
 * En el celular (navegador, no la app ya instalada): explica cómo poner FactPOS en la pantalla de inicio,
 * con los pasos de iPhone o de Android según el equipo. Los pasos se ven siempre (sin tener que abrirlos) y el aviso
 * vuelve a salir cada vez hasta que la app esté puesta en la pantalla de inicio; «Cerrar» solo lo quita de esta visita.
 */

interface EventoInstalar extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }>; }

export function AgregarAInicio({ siempre = false }: { siempre?: boolean }) {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const esIphone = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && typeof navigator !== "undefined" && navigator.maxTouchPoints > 1);
  const esAndroid = /Android/i.test(ua);
  const yaInstalada = typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true);
  const [oculto, setOculto] = useState(false);
  const [evento, setEvento] = useState<EventoInstalar | null>(null);
  useEffect(() => {
    const f = (e: Event) => { e.preventDefault(); setEvento(e as EventoInstalar); };
    window.addEventListener("beforeinstallprompt", f);
    return () => window.removeEventListener("beforeinstallprompt", f);
  }, []);
  if (yaInstalada || !(esIphone || esAndroid) || (oculto && !siempre)) return null;

  const cerrar = () => setOculto(true);
  const caja: React.CSSProperties = { background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: 12, padding: "10px 14px", margin: "10px 0", fontSize: 14, color: "#064e3b" };
  return (
    <div style={caja} role="note">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
        <b>Ponga FactPOS en la pantalla de inicio</b>
        <button type="button" className="enlace pequeno" onClick={cerrar} aria-label="Cerrar">Cerrar</button>
      </div>
      {esIphone ? (
        <ol style={{ margin: "8px 0 0", paddingLeft: 20 }}>
          <li>Abra esta página en <b>Safari</b> (si está en otro navegador, copie el enlace y ábralo en Safari).</li>
          <li>Toque el botón <b>Compartir</b> (el cuadro con una flecha hacia arriba, abajo en la pantalla).</li>
          <li>Baje y toque <b>«Añadir a pantalla de inicio»</b>.</li>
          <li>Toque <b>Añadir</b>. Ya tiene el icono de FactPOS junto a sus otras apps.</li>
        </ol>
      ) : (
        <div style={{ marginTop: 8 }}>
          {evento && (
            <button type="button" className="boton primario" onClick={async () => { try { await evento.prompt(); await evento.userChoice; } catch { /* cancelado */ } setEvento(null); }}>Instalar la app</button>
          )}
          <ol style={{ margin: "8px 0 0", paddingLeft: 20 }}>
            <li>En <b>Chrome</b>, toque los <b>tres puntos</b> (⋮) arriba a la derecha.</li>
            <li>Toque <b>«Instalar aplicación»</b> o <b>«Añadir a la pantalla de inicio»</b>.</li>
            <li>Confirme con <b>Instalar</b> o <b>Añadir</b>. El icono de FactPOS aparece en su pantalla de inicio.</li>
          </ol>
        </div>
      )}
    </div>
  );
}
