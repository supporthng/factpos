import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

/**
 * Campana de avisos del administrador: cuando un equipo pide acceso remoto aparece aquí (con un contador),
 * en el título de la pestaña y se puede autorizar o negar sin salir de la pantalla en que se esté.
 * Se consulta cada 20 s, al volver a la pestaña y cuando la pantalla de Acceso remoto resuelve algo.
 */
interface Solicitud { id: string; nombre: string; plataforma: string; ip: string | null; solicitadoEn: string }
const hace = (v: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(v).getTime()) / 60000));
  return m < 1 ? "ahora" : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} d`;
};

export function AvisoAcceso({ irAAcceso }: { irAAcceso: () => void }) {
  const [lista, setLista] = useState<Solicitud[]>([]);
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState("");
  const titulo = useRef(document.title.replace(/^\(\d+\) /, ""));

  const cargar = useCallback(() => {
    api<{ pendientes: number; solicitudes: Solicitud[] }>("/central/dispositivos/pendientes").then((r) => setLista(r.solicitudes)).catch(() => {});
  }, []);
  useEffect(() => {
    cargar();
    const t = setInterval(cargar, 20_000);
    const visible = () => { if (!document.hidden) cargar(); };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("factpos:acceso-remoto", cargar);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", visible); window.removeEventListener("factpos:acceso-remoto", cargar); };
  }, [cargar]);
  useEffect(() => {
    const base = titulo.current;
    document.title = lista.length ? `(${lista.length}) ${base}` : base;
    return () => { document.title = base; };
  }, [lista.length]);

  const resolver = async (s: Solicitud, estado: "AUTORIZADO" | "DENEGADO") => {
    setError("");
    try { await api(`/central/dispositivos/${s.id}`, { metodo: "PUT", cuerpo: { estado } }); cargar(); window.dispatchEvent(new Event("factpos:acceso-remoto-resuelto")); }
    catch (e) { setError((e as Error).message); }
  };

  return (
    <div className="menu-usuario aviso-acceso">
      <button className={"boton-icono" + (lista.length ? " con-aviso" : "")} title={lista.length ? `${lista.length} solicitud(es) de acceso remoto` : "Sin solicitudes de acceso remoto"}
        aria-label="Solicitudes de acceso remoto" aria-haspopup="menu" aria-expanded={abierto} onClick={() => setAbierto((v) => !v)}>
        <svg className="icono" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <path d="M6 9a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9Z" /><path d="M10 20a2 2 0 0 0 4 0" />
        </svg>
        {lista.length > 0 && <span className="contador-aviso">{lista.length > 9 ? "9+" : lista.length}</span>}
      </button>
      {abierto && (
        <>
          <div className="menu-usuario-fondo" onClick={() => setAbierto(false)} />
          <div className="menu-usuario-lista aviso-acceso-lista" role="menu">
            <div className="menu-usuario-nombre"><b>Solicitudes de acceso remoto</b></div>
            {error && <span className="texto-alerta pequeno" style={{ padding: "0 10px" }}>{error}</span>}
            {lista.length === 0 && <span className="suave pequeno" style={{ padding: "8px 10px" }}>No hay solicitudes pendientes.</span>}
            {lista.map((s) => (
              <div key={s.id} className="aviso-acceso-fila">
                <div><b>{s.nombre}</b><div className="suave pequeno">{s.plataforma || "Equipo"} · {hace(s.solicitadoEn)}{s.ip ? ` · ${s.ip}` : ""}</div></div>
                <span className="en-linea">
                  <button className="boton primario" onClick={() => resolver(s, "AUTORIZADO")}>Autorizar</button>
                  <button className="boton" onClick={() => resolver(s, "DENEGADO")}>Negar</button>
                </span>
              </div>
            ))}
            <button role="menuitem" onClick={() => { setAbierto(false); irAAcceso(); }}>Abrir Acceso remoto</button>
          </div>
        </>
      )}
    </div>
  );
}
