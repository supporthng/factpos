import { useEffect, useRef, useState } from "react";
import { versionCliente } from "./version";

/**
 * Mientras el servidor se actualiza, tapa la pantalla con el avance. Cuando termina y la versión cambió,
 * cierra la sesión y recarga: el sistema vuelve a abrir pidiendo usuario y contraseña.
 * Consulta /actualizacion/estado (pública) del servidor al que está conectada la pantalla.
 */
interface Estado {
  version: string; actualizando: boolean; destino: string | null; paso: string | null; porcentaje: number | null;
  resultado: { estado: "OK" | "ERROR"; version: string; mensaje: string | null; en: string } | null;
}
const vcorta = versionCliente;
const CLAVE_VERSION = "factpos.version-vista";
const leer = () => { try { return localStorage.getItem(CLAVE_VERSION); } catch { return null; } };
const guardar = (v: string) => { try { localStorage.setItem(CLAVE_VERSION, v); } catch { /* sin almacenamiento */ } };

export function PantallaActualizacion({ servidor, alCambiarVersion }: { servidor: () => string; alCambiarVersion: () => void }) {
  const [e, setE] = useState<Estado | null>(null);
  const [sinConexion, setSinConexion] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [desde, setDesde] = useState<number | null>(null);
  const [ocultar, setOcultar] = useState(false);
  /** Versión nueva ya instalada en el servidor: la caja NO se reinicia sola; avisa y espera la confirmación (o el próximo inicio) */
  const [pendiente, setPendiente] = useState<string | null>(null);
  const [masTarde, setMasTarde] = useState(false);
  const visto = useRef(false);
  const inicial = useRef<string | null>(null);

  useEffect(() => {
    let vivo = true;
    let t: ReturnType<typeof setTimeout>;
    const consultar = async () => {
      let proximo = visto.current ? 2500 : 15_000;
      try {
        const r = await fetch(`${servidor().replace(/\/$/, "")}/actualizacion/estado`, { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        const d = (await r.json()) as Estado;
        if (!vivo) return;
        setSinConexion(false); setE(d);
        inicial.current ??= d.version;
        const guardada = leer();
        if (d.actualizando) { if (!visto.current) { visto.current = true; setDesde(Date.now()); setOcultar(false); } proximo = 2500; }
        else if (visto.current) {
          visto.current = false; setDesde(null);
          if (d.version !== inicial.current || (guardada && guardada !== d.version)) setPendiente(d.version);
          if (d.resultado?.estado === "ERROR") setAviso(d.resultado.mensaje ?? "No se pudo actualizar; se conservó la versión anterior.");
        } else if (guardada && guardada !== d.version) {
          // Se actualizó mientras esta pantalla estaba en uso: se avisa, sin interrumpir la venta
          setPendiente(d.version);
        } else if (!guardada) guardar(d.version);
      } catch {
        if (vivo && visto.current) { setSinConexion(true); proximo = 2500; }
      }
      if (vivo) t = setTimeout(consultar, proximo);
    };
    consultar();
    return () => { vivo = false; clearTimeout(t); };
  }, [servidor, alCambiarVersion]);

  const aplicarAhora = () => { if (!pendiente) return; guardar(pendiente); alCambiarVersion(); location.reload(); };
  const activa = (e?.actualizando || (visto.current && sinConexion)) && !ocultar;
  const pasados = desde ? Math.floor((Date.now() - desde) / 60_000) : 0;
  const avisoVersion = pendiente && !masTarde && !activa ? (
    <div className="aviso-version" role="alertdialog">
      <b>Hay una versión nueva de FactPOS{pendiente ? ` (${vcorta(pendiente)})` : ""}</b>
      <span>Al actualizar se cierra la sesión y se recarga la caja: termine antes la venta en curso. Las ventas en pausa se conservan. Si prefiere, se actualiza sola la próxima vez que abra la caja.</span>
      <div>
        <button className="boton primario" onClick={aplicarAhora}>Actualizar ahora</button>
        <button className="boton" onClick={() => setMasTarde(true)}>Más tarde</button>
      </div>
    </div>
  ) : null;
  if (!activa && !aviso) return avisoVersion;
  if (!activa && aviso) {
    return (
      <div className="actualizando-fondo" role="alertdialog">
        <div className="actualizando-caja">
          <h2>No se pudo actualizar</h2>
          <p>{aviso}</p>
          <p className="suave">El sistema sigue en la versión anterior y no se perdió nada.</p>
          <button className="boton primario" onClick={() => setAviso(null)}>Continuar</button>
        </div>
      </div>
    );
  }
  const pct = e?.porcentaje ?? null;
  return (
    <div className="actualizando-fondo" role="alertdialog" aria-live="polite">
      <div className="actualizando-caja">
        <h2>Actualizando FactPOS{e?.destino ? ` a la versión ${vcorta(e.destino)}` : ""}</h2>
        <p>{sinConexion ? "Reiniciando el servidor…" : e?.paso ?? "Preparando…"}</p>
        <div className={"actualizando-barra" + (pct == null || sinConexion ? " indeterminada" : "")}><b style={{ width: pct != null && !sinConexion ? `${Math.max(4, pct)}%` : undefined }} /></div>
        <p className="suave pequeno">No apague el equipo. Al terminar, el sistema se abrirá solo y le pedirá su usuario y contraseña.</p>
        {pasados >= 10 && <button className="enlace" onClick={() => setOcultar(true)}>Está tardando demasiado: cerrar este aviso</button>}
      </div>
    </div>
  );
}

/**
 * Antes de mostrar nada (usuario y contraseña, ventas…), comprueba si el servidor tiene una versión nueva que esta
 * pantalla aún no conocía. Si es así, cierra la sesión y recarga una sola vez; así, tras actualizar, el sistema aparece
 * ya listo para escribir y no se recarga por debajo mientras la persona teclea. Sin respuesta en 2,5 s, abre igual.
 */
export function usePreparado(servidor: () => string, alCambiarVersion: () => void) {
  const [listo, setListo] = useState(false);
  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const base = servidor().replace(/\/$/, "");
        if (base) {
          const r = await fetch(`${base}/actualizacion/estado`, { cache: "no-store", signal: AbortSignal.timeout(1200) });
          const d = r.ok ? ((await r.json()) as Estado) : null;
          if (d && !d.actualizando) {
            const guardada = leer();
            if (guardada && guardada !== d.version) { guardar(d.version); alCambiarVersion(); location.reload(); return; }
            if (!guardada) guardar(d.version);
          }
        }
      } catch { /* sin servidor: se abre igual */ }
      if (vivo) setListo(true);
    })();
    return () => { vivo = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return listo;
}
