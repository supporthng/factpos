import { useCallback, useEffect, useState } from "react";
import { api, puede } from "./api";
import { versionCliente } from "./ui";
import { recargarAlTerminar } from "./paginas/Actualizaciones";

/**
 * Cuando hay una versión nueva de FactPOS, la administración pregunta «¿Actualizar ahora?» (una tarjeta abajo, sin tapar el trabajo).
 * «Después» la deja en silencio 4 horas para esa versión. La instalación es la misma de Sistema › Actualizaciones:
 * el servidor se reinicia (1 a 3 minutos), las cajas siguen vendiendo y esta pantalla se recarga sola al terminar.
 */
interface Estado {
  actual: string; disponible: string | null; notas: string | null; hayNueva: boolean; puedeInstalar: boolean;
  licenciaActiva?: boolean; pruebaActualiza?: boolean; proceso: { estado: string } | null;
  cajasEnUso?: { n: number; cajas: string[] }; programada?: { version: string } | null;
}
const CLAVE = "factpos.actualizar.despues";
const HORAS = 4;

const pospuesta = (version: string) => {
  try { const d = JSON.parse(localStorage.getItem(CLAVE) ?? "null") as { version: string; hasta: number } | null; return !!d && d.version === version && d.hasta > Date.now(); }
  catch { return false; }
};

export function AvisoActualizacion({ oculto = false }: { oculto?: boolean }) {
  const [d, setD] = useState<Estado | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" | "info" } | null>(null);
  const [, refrescar] = useState(0);
  const permitido = puede("*") || puede("admin.config");

  const cargar = useCallback(() => {
    if (!permitido) return;
    api<Estado>("/central/actualizacion").then(setD).catch(() => {});
  }, [permitido]);
  useEffect(() => {
    cargar();
    const t = setInterval(cargar, 30 * 60_000);
    const visible = () => { if (!document.hidden) cargar(); };
    document.addEventListener("visibilitychange", visible);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", visible); };
  }, [cargar]);

  if (!permitido || oculto || !d) return null;
  const puedeActualizar = d.puedeInstalar && (d.licenciaActiva !== false || !!d.pruebaActualiza);
  const hay = d.hayNueva && !!d.disponible && !d.proceso && puedeActualizar;
  if (!msg && (!hay || pospuesta(d.disponible!))) return null;

  const despues = () => {
    try { localStorage.setItem(CLAVE, JSON.stringify({ version: d.disponible, hasta: Date.now() + HORAS * 3600_000 })); } catch { /* sin almacenamiento */ }
    setMsg(null); refrescar((n) => n + 1);
  };
  const enUso = (d.cajasEnUso?.n ?? 0) > 0;
  const quienes = d.cajasEnUso?.cajas?.length ? `Turno abierto en ${d.cajasEnUso.cajas.join(", ")}` : "Hay ventas en curso";
  /** Con cajas en uso no se reinicia el servidor (detendría la caja de ese equipo): queda programada para el primer momento sin ventas. */
  const libre = async () => {
    setTrabajando(true); setMsg(null);
    try {
      await api("/central/actualizacion/instalar", { cuerpo: { cuando: "libre" } });
      setMsg({ t: "Listo: se instalará sola en cuanto no haya turnos de caja abiertos ni ventas.", tipo: "ok" });
    } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
    setTrabajando(false);
  };
  const ahora = async (forzar = false) => {
    if (forzar && !confirm(`${quienes}. Actualizar ahora detiene esa caja unos minutos y puede cortar una venta en curso. ¿Actualizar de todos modos?`)) return;
    setTrabajando(true); setMsg(null);
    try {
      const antes = d.actual;
      await api("/central/actualizacion/instalar", { cuerpo: { forzar } });
      setMsg({ t: "Instalando… el servidor se reinicia.", tipo: "info" });
      void recargarAlTerminar(antes, (t, tipo) => setMsg({ t, tipo })).finally(() => setTrabajando(false));
      return;
    } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
    setTrabajando(false);
  };

  return (
    <div className="aviso-actualizar" role="dialog" aria-label="Actualización disponible">
      <div className="aa-cab">
        <b>{msg ? "Actualizando FactPOS" : `¿Actualizar ahora a FactPOS ${versionCliente(d.disponible ?? "")}?`}</b>
        {!trabajando && <button className="aa-x" aria-label="Cerrar" onClick={despues}>×</button>}
      </div>
      {msg ? (
        <p className={"aa-msg" + (msg.tipo === "error" ? " error" : "")}>{msg.t}</p>
      ) : (
        <>
          {d.notas && <p className="aa-notas suave pequeno">{d.notas.slice(0, 160)}{d.notas.length > 160 ? "…" : ""}</p>}
          {enUso ? (
            <>
              <p className="aa-msg"><b>{quienes}.</b> Actualizar reinicia el servidor y detiene esa caja unos minutos.</p>
              <button className="aa-opcion" disabled={trabajando || !!d.programada} onClick={() => void libre()}>
                <span className="aa-num">1</span><span><b>{d.programada ? "Ya está programada" : "Cuando no haya ventas"}</b><small>Se instala sola en cuanto se cierren los turnos de caja; ninguna venta se corta.</small></span>
              </button>
              <button className="aa-opcion" disabled={trabajando} onClick={() => void ahora(true)}>
                <span className="aa-num">2</span><span><b>Actualizar ahora de todos modos</b><small>Detiene la caja de ese equipo unos minutos.</small></span>
              </button>
            </>
          ) : (
            <button className="aa-opcion" disabled={trabajando} onClick={() => void ahora()}>
              <span className="aa-num">1</span><span><b>Actualizar ahora</b><small>El servidor se reinicia (1 a 3 minutos); las cajas de otros equipos siguen vendiendo y esta pantalla se recarga sola.</small></span>
            </button>
          )}
          <button className="aa-opcion" disabled={trabajando} onClick={despues}>
            <span className="aa-num">{enUso ? 3 : 2}</span><span><b>Después</b><small>Le vuelvo a preguntar en {HORAS} horas; también puede hacerlo en Sistema › Actualizaciones.</small></span>
          </button>
        </>
      )}
    </div>
  );
}
