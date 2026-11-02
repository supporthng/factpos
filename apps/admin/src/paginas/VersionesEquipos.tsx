import { Aviso, Encabezado, Tabla, useDatos } from "../ui";

/** Versión del sistema en cada equipo: servidores de las sucursales y apps del verificador; marca los desactualizados. */
type Estado = "AL_DIA" | "DESACTUALIZADO" | "SIN_DATO";
interface Datos {
  principal: string;
  servidores: { sucursalId: string; nombre: string; tipo: string; equipo: string | null; version: string | null; ultimoContacto: string | null; enLinea: boolean; estado: Estado }[];
  verificadores: { id: string; so: string; equipo: string; sucursal: string; version: string; vigente: string | null; ultimoContacto: string; enLinea: boolean; estado: Estado }[];
}
const vcorta = (v: string | null) => (v ?? "").replace(/\.0$/, "");
const fecha = (v: string | null) => (v ? new Date(v).toLocaleString("es-DO", { dateStyle: "short", timeStyle: "short" }) : "—");
const etiqueta = (e: Estado) => e === "AL_DIA" ? <b className="texto-ok">Al día</b> : e === "DESACTUALIZADO" ? <b style={{ color: "#c0362c" }}>Desactualizado</b> : <span className="suave">Sin dato</span>;
const linea = (en: boolean) => en ? <b className="texto-ok">En línea</b> : <span className="suave">Sin conexión</span>;

export function VersionesEquipos() {
  const { datos, error } = useDatos<Datos>("/central/versiones");
  const viejos = (datos?.servidores.filter((s) => s.estado === "DESACTUALIZADO").length ?? 0) + (datos?.verificadores.filter((v) => v.estado === "DESACTUALIZADO").length ?? 0);
  return (
    <>
      <Encabezado titulo="Versiones de los equipos" descripcion="Qué versión tiene cada equipo y cuáles están desactualizados." />
      <Aviso texto={error} />
      {datos && (viejos > 0
        ? <Aviso tipo="info" texto={`${viejos} equipo${viejos === 1 ? "" : "s"} desactualizado${viejos === 1 ? "" : "s"}. Los servidores se actualizan en Administración › Actualizaciones y los verificadores con «Actualizar verificadores ahora» (Verificador de precios).`} />
        : <Aviso tipo="ok" texto="Todos los equipos que reportaron están al día." />)}
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Servidores {datos ? <span className="suave pequeno">· versión del servidor principal: {vcorta(datos.principal)}</span> : null}</h3>
        <Tabla filas={datos?.servidores ?? []} clave={(s) => s.sucursalId} tarjetas vacio="Sin sucursales."
          columnas={[
            { titulo: "Sucursal", valor: (s) => <><b>{s.nombre}</b><div className="suave pequeno">{s.equipo ?? ""}</div></> },
            { titulo: "Versión", valor: (s) => s.version ? vcorta(s.version) : "—" },
            { titulo: "Estado", valor: (s) => etiqueta(s.estado) },
            { titulo: "Conexión", valor: (s) => linea(s.enLinea), ocultoMovil: true },
            { titulo: "Último contacto", valor: (s) => fecha(s.ultimoContacto), ocultoMovil: true },
          ]} />
        <p className="suave pequeno" style={{ marginBottom: 0 }}>Las cajas y las pantallas web usan la versión de su servidor: se actualizan solas al recargar.</p>
      </div>
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Verificadores de precios</h3>
        <Tabla filas={datos?.verificadores ?? []} clave={(v) => v.id} tarjetas vacio="Ningún verificador ha reportado su versión todavía. Aparecen cuando la app (versión nueva) consulta al servidor."
          columnas={[
            { titulo: "Equipo", valor: (v) => <><b>{v.equipo || v.id}</b><div className="suave pequeno">{v.so === "android" ? "Android" : "Windows"} · {v.sucursal}</div></> },
            { titulo: "Versión", valor: (v) => <>{v.version}{v.vigente && v.estado === "DESACTUALIZADO" ? <span className="suave pequeno"> (vigente {v.vigente})</span> : null}</> },
            { titulo: "Estado", valor: (v) => etiqueta(v.estado) },
            { titulo: "Conexión", valor: (v) => linea(v.enLinea), ocultoMovil: true },
            { titulo: "Último contacto", valor: (v) => fecha(v.ultimoContacto), ocultoMovil: true },
          ]} />
        <p className="suave pequeno" style={{ marginBottom: 0 }}>Un verificador solo aparece si su app es de la versión que ya reporta; los más viejos hay que reinstalarlos una vez.</p>
      </div>
    </>
  );
}
