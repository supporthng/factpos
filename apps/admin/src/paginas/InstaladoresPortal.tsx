import { useState } from "react";
import { api } from "../api";
import { Aviso, Encabezado, useDatos, versionCliente } from "../ui";

/** PORTAL DEL PROVEEDOR · todos los instaladores de FactPOS, con lo último publicado de cada uno. */
interface Instalador {
  id: string; titulo: string; para: string; plataforma: string; publicado: boolean; nombre: string | null;
  version: string | null; compilacion: number | null; fecha: string | null; tamano: number | null;
}
const fecha = (v: string | null) => (v ? new Date(v).toLocaleString("es-DO", { dateStyle: "medium", timeStyle: "short" }) : "—");
const mb = (b: number | null) => (b ? `${(b / 1048576).toFixed(1)} MB` : "");

export function InstaladoresPortal() {
  const [n, setN] = useState(0);
  const { datos, error, cargando } = useDatos<Instalador[]>("/central/portal/instaladores", [n]);
  const [trabajando, setTrabajando] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" } | null>(null);
  const [enlace, setEnlace] = useState<string | null>(null);

  const descargar = async (i: Instalador) => {
    setMsg(null); setEnlace(null); setTrabajando(i.id);
    try {
      const r = await api<{ url: string }>(`/central/portal/instaladores/${i.id}/enlace`);
      // Con clic de enlace (no cambiando de página): funciona igual en el navegador y en la app de escritorio
      const a = document.createElement("a");
      a.href = r.url; a.rel = "noopener"; a.style.display = "none";
      document.body.appendChild(a); a.click(); a.remove();
      setEnlace(r.url);
      setMsg({ t: `Descargando ${i.nombre ?? i.titulo}…`, tipo: "ok" });
    } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
    finally { setTrabajando(null); }
  };

  return (
    <>
      <Encabezado titulo="Instaladores" descripcion="Todos los instaladores de FactPOS con la versión más reciente publicada. Son los que entregas a tus clientes.">
        <button className="boton" disabled={cargando} onClick={() => setN((x) => x + 1)}>{cargando ? "Actualizando…" : "Actualizar lista"}</button>
      </Encabezado>
      <Aviso texto={error} />
      {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}
      {enlace && <p className="pequeno">¿No empezó la descarga? <a href={enlace} target="_blank" rel="noreferrer">Haz clic aquí</a> (el enlace dura unos minutos).</p>}
      <div className="panel">
        {(datos ?? []).map((i) => (
          <div key={i.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "10px 0", borderTop: "1px solid var(--borde, #e3e8ee)" }}>
            <div>
              <b>{i.titulo}</b>
              <div className="suave pequeno">{i.para} · {i.plataforma}</div>
              <div className="suave pequeno">
                {i.publicado
                  ? <>{i.version ? `Versión ${versionCliente(i.version)}` : i.compilacion ? `Compilación ${i.compilacion}` : "Publicado"} · {fecha(i.fecha)}{i.tamano ? ` · ${mb(i.tamano)}` : ""}{i.nombre ? ` · ${i.nombre}` : ""}</>
                  : <b className="texto-alerta">Todavía no está publicado</b>}
              </div>
            </div>
            <button className="boton primario" disabled={!i.publicado || trabajando !== null} onClick={() => descargar(i)}>{trabajando === i.id ? "Preparando…" : "Descargar"}</button>
          </div>
        ))}
        {!datos && !error && <p className="suave">Cargando…</p>}
      </div>
    </>
  );
}
