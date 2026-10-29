import { useEffect, useState } from "react";

/**
 * Aviso de licencia en la caja: el servidor de la sucursal dice si la licencia
 * está por vencer, en gracia o vencida. Vencida (pasada la gracia) el servidor
 * no deja cobrar; aquí se explica por qué.
 */
interface Estado { estado: string; permiteVender: boolean; mensaje: string | null }

export function AvisoLicencia({ servidor }: { servidor: string }) {
  const [e, setE] = useState<Estado | null>(null);
  const hoy = new Date().toISOString().slice(0, 10);
  const [cerrado, setCerrado] = useState(() => { try { return localStorage.getItem("factpos.licencia.cerrado") === hoy; } catch { return false; } });
  useEffect(() => {
    const cargar = () => fetch(`${servidor}/licencia/estado`, { signal: AbortSignal.timeout(5000) })
      .then((r) => (r.ok ? r.json() : null)).then((d) => d && setE(d)).catch(() => {});
    cargar();
    const t = setInterval(cargar, 30 * 60_000);
    return () => clearInterval(t);
  }, [servidor]);
  if (!e?.mensaje || e.estado === "VIGENTE") return null;
  const grave = !e.permiteVender;
  if (cerrado && !grave) return null;
  return (
    <div className={"aviso-licencia-caja" + (grave ? " grave" : "")} role="status">
      <span>{e.mensaje}</span>
      {!grave && (
        <button onClick={() => { setCerrado(true); try { localStorage.setItem("factpos.licencia.cerrado", hoy); } catch { /* sin almacenamiento */ } }}>
          Entendido
        </button>
      )}
    </div>
  );
}
