import { useState } from "react";
import { api } from "../api";
import { Aviso, Encabezado, iniciarDescarga, useDatos, versionCliente } from "../ui";

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
      iniciarDescarga(r.url, i.nombre);
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
      <div className="ins-grid">
        {(datos ?? []).map((i) => (
          <article key={i.id} className={"ins-tarj" + (i.publicado ? "" : " sin")}>
            <div className="ins-cab">
              <span className="ins-icono" aria-hidden="true">{i.plataforma.toLowerCase().includes("android") ? "A" : i.plataforma.toLowerCase().includes("mac") ? "M" : "W"}</span>
              <div>
                <b>{i.titulo}</b>
                <div className="suave pequeno">{i.plataforma}</div>
              </div>
              {i.publicado
                ? <span className="pastilla ok">{i.version ? `v${versionCliente(i.version)}` : i.compilacion ? `#${i.compilacion}` : "Publicado"}</span>
                : <span className="pastilla alerta">No publicado</span>}
            </div>
            <p className="suave ins-para">{i.para}</p>
            <div className="ins-meta suave pequeno">
              {i.publicado ? <>{fecha(i.fecha)}{i.tamano ? ` · ${mb(i.tamano)}` : ""}</> : "Todavía no está publicado"}
            </div>
            <button className="boton primario ancho" disabled={!i.publicado || trabajando !== null} onClick={() => descargar(i)}>{trabajando === i.id ? "Preparando…" : "Descargar"}</button>
          </article>
        ))}
        {!datos && !error && <p className="suave">Cargando…</p>}
      </div>
    </>
  );
}
