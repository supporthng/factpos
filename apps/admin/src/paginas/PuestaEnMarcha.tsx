import { useState } from "react";
import { puede } from "../api";
import { useDatos } from "../ui";

interface Paso { id: string; titulo: string; detalle: string; ir: string; listo: boolean; opcional?: boolean; estado?: string }
interface Datos { pasos: Paso[]; hechos: number; necesarios: number }

const CLAVE_OCULTA = "factpos.puesta.oculta";
const leerOculta = () => { try { return localStorage.getItem(CLAVE_OCULTA) === "1"; } catch { return false; } };
const guardarOculta = (v: boolean) => { try { v ? localStorage.setItem(CLAVE_OCULTA, "1") : localStorage.removeItem(CLAVE_OCULTA); } catch { /* sin almacenamiento: no se recuerda */ } };
const ir = (seccion: string) => { location.hash = seccion; };

/** Puesta en marcha: lo necesario para empezar a vender y lo recomendado, paso a paso. */
export function PuestaEnMarcha() {
  const { datos, error } = useDatos<Datos>("/central/puesta-en-marcha");
  const [oculta, setOculta] = useState(leerOculta);
  if (error) return <p className="error">{error}</p>;
  if (!datos) return <p className="suave">Cargando…</p>;
  const { pasos, hechos, necesarios } = datos;
  const pct = necesarios ? Math.round((hechos / necesarios) * 100) : 100;
  const siguiente = pasos.find((p) => !p.listo && !p.opcional) ?? pasos.find((p) => !p.listo);
  const completo = hechos === necesarios;
  return (
    <div className="puesta">
      <section className="puesta-cabecera">
        <div className="puesta-anillo" role="img" aria-label={`${pct}% listo`}>
          <svg viewBox="0 0 36 36" aria-hidden="true">
            <circle cx="18" cy="18" r="15.5" className="pa-fondo" />
            <circle cx="18" cy="18" r="15.5" className="pa-avance" strokeDasharray={`${(pct / 100) * 97.4} 97.4`} />
          </svg>
          <b>{pct}%</b>
        </div>
        <div className="puesta-texto">
          <h2>Puesta en marcha</h2>
          <p>{completo
            ? "Lo necesario está listo: ya puede vender con FactPOS. Los pasos recomendados lo dejan completo."
            : `${hechos} de ${necesarios} pasos necesarios listos. Siga en orden: cada uno toma pocos minutos.`}</p>
        </div>
        {siguiente && puede("admin.config") && <button className="puesta-seguir" onClick={() => ir(siguiente.ir)}>Seguir: {siguiente.titulo} →</button>}
      </section>
      <ol className="puesta-lista">
        {pasos.map((p, i) => (
          <li key={p.id}>
            <span className={"puesta-num" + (p.listo ? " listo" : "")} aria-hidden="true">{p.listo ? "✓" : i + 1}</span>
            <div className="puesta-paso">
              <p className="puesta-titulo">{p.titulo}{p.opcional && <span className="puesta-chip">Recomendado</span>}</p>
              <p className="suave">{p.detalle}</p>
              {p.estado && <p className={"puesta-estado" + (p.listo ? " ok" : "")}>{p.estado}</p>}
            </div>
            <button className={p.listo ? "boton" : "boton primario"} onClick={() => ir(p.ir)}>{p.listo ? "Revisar" : "Hacer ahora"}</button>
          </li>
        ))}
      </ol>
      <p className="suave puesta-pie">
        {oculta ? "El aviso de puesta en marcha está oculto en el inicio de este equipo." : "Mientras falten pasos necesarios, el inicio muestra un aviso para seguir aquí."}{" "}
        <button className="enlace" onClick={() => { guardarOculta(!oculta); setOculta(!oculta); }}>{oculta ? "Volver a mostrarlo" : "Ya no mostrar en el inicio"}</button>
      </p>
    </div>
  );
}

/** Franja del inicio con el avance; solo mientras falten pasos necesarios. */
export function BarraPuesta() {
  const permitido = puede("admin.config");
  const { datos } = useDatos<Datos>(permitido ? "/central/puesta-en-marcha" : null);
  if (!permitido || !datos || leerOculta()) return null;
  const sigue = datos.pasos.find((p) => !p.listo && !p.opcional);
  if (!sigue) return null;
  const pct = Math.round((datos.hechos / datos.necesarios) * 100);
  return (
    <button className="barra-puesta" onClick={() => ir("puesta")}>
      <b>Puesta en marcha · {datos.hechos} de {datos.necesarios}</b>
      <span className="barra-puesta-riel" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>
      <span className="suave">Sigue: {sigue.titulo.toLowerCase()}</span>
      <span className="barra-puesta-ir">Continuar →</span>
    </button>
  );
}
