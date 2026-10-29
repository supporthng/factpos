import { useState } from "react";
import { api, sesionActual } from "../api";
import { Aviso, Encabezado, useDatos } from "../ui";

interface Terminal { id: string; numero: number; nombre: string; activo: boolean; almacen: string; turnoAbierto: boolean; ultimaVenta: string | null }
interface EstadoSync { sucursalId: string; ultimaSubida: string | null; ultimaBajada: string | null; pendientes: number | null; errores: number | null; ultimoError: string | null; enLinea: boolean | null; segundos: number | null; equipo: string | null }
interface Sucursal {
  id: string; codigo: string; nombre: string; direccion: string | null; telefono: string | null; activo: boolean; tipo: "TIENDA" | "ALMACEN";
  almacenes: { id: string; nombre: string; principal: boolean }[]; terminales: Terminal[];
}

/** Sucursales, sus almacenes y sus terminales de venta. */
export function Sucursales() {
  const { datos, recargar } = useDatos<Sucursal[]>("/central/organizacion");
  const sync = useDatos<EstadoSync[]>("/central/sync/estado");
  const [verId, setVerId] = useState<string | null>(null);
  const [nueva, setNueva] = useState({ codigo: "", nombre: "", direccion: "", telefono: "" });
  const [abrir, setAbrir] = useState(false);
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" } | null>(null);

  const crear = async () => {
    try {
      await api("/central/sucursales", { cuerpo: { ...nueva, direccion: nueva.direccion || undefined, telefono: nueva.telefono || undefined } });
      setMsg({ t: `Sucursal ${nueva.nombre} creada con su almacén y la Caja 1. Recuerde asignarle secuencias e-NCF y recargar la página.`, tipo: "ok" });
      setNueva({ codigo: "", nombre: "", direccion: "", telefono: "" });
      setAbrir(false);
      recargar();
    } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
  };
  const accion = async (ruta: string, cuerpo: unknown, metodo = "POST") => {
    try { await api(ruta, { metodo, cuerpo }); recargar(); } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
  };

  return (
    <>
      <Encabezado titulo="Sucursales y terminales" descripcion="Cada sucursal tiene su propio inventario y sus terminales de venta.">
        <button className="boton primario" onClick={() => setAbrir(!abrir)}>Nueva sucursal</button>
      </Encabezado>
      {abrir && (
        <div className="panel">
          <div className="cuatro-col">
            <label className="campo"><span>Código</span><input value={nueva.codigo} onChange={(e) => setNueva({ ...nueva, codigo: e.target.value })} placeholder="S03" /></label>
            <label className="campo"><span>Nombre</span><input value={nueva.nombre} onChange={(e) => setNueva({ ...nueva, nombre: e.target.value })} /></label>
            <label className="campo"><span>Dirección</span><input value={nueva.direccion} onChange={(e) => setNueva({ ...nueva, direccion: e.target.value })} /></label>
            <label className="campo"><span>Teléfono</span><input value={nueva.telefono} onChange={(e) => setNueva({ ...nueva, telefono: e.target.value })} /></label>
          </div>
          <button className="boton primario" disabled={!nueva.codigo || nueva.nombre.length < 2} onClick={crear}>Crear sucursal</button>
        </div>
      )}
      {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}

      <div className="lista-sucursales">
        {(datos ?? []).map((s) => (
          <div key={s.id} className={"panel" + (s.activo ? "" : " inactiva")}>
            <div className="encabezado-sub">
              <div>
                <h3>{s.nombre} <span className="pastilla">{s.codigo}</span></h3>
                <span className="suave pequeno">{[s.direccion, s.telefono].filter(Boolean).join(" · ") || "Sin dirección"}</span>
              </div>
              <label className="interruptor">
                <input type="checkbox" checked={s.activo} onChange={(e) => accion(`/central/sucursales/${s.id}`, { activo: e.target.checked }, "PATCH")} />
                <span>{s.activo ? "Activa" : "Inactiva"}</span>
              </label>
            </div>
            <div className="fila-acciones" style={{ marginTop: 4, flexWrap: "wrap" }}>
              <label className="campo" style={{ margin: 0 }}>
                <span>Tipo</span>
                <select value={s.tipo} onChange={(e) => accion(`/central/sucursales/${s.id}/tipo`, { tipo: e.target.value }, "PUT")}>
                  <option value="TIENDA">Tienda (vende)</option>
                  <option value="ALMACEN">Almacén (surte a las tiendas)</option>
                </select>
              </label>
              <span className="flex" />
              <EstadoServidor e={sync.datos?.find((x) => x.sucursalId === s.id)} />
              <button className="enlace" onClick={() => setVerId(verId === s.id ? null : s.id)}>Conectar su servidor</button>
            </div>
            {verId === s.id && <Conexion sucursalId={s.id} />}
            <div className="suave pequeno">Almacenes: {s.almacenes.map((a) => a.nombre + (a.principal ? " (principal)" : "")).join(", ")}</div>
            <h4>{s.tipo === "ALMACEN" ? "Terminales (un almacén normalmente no vende)" : "Terminales de venta"}</h4>
            <div className="terminales">
              {s.terminales.map((t) => (
                <div key={t.id} className={"terminal" + (t.activo ? "" : " apagada")}>
                  <div className="encabezado-sub" style={{ margin: 0 }}>
                    <b>{t.nombre}</b>
                    <span className={"punto" + (t.turnoAbierto ? " verde" : "")} title={t.turnoAbierto ? "Turno abierto" : "Sin turno"} />
                  </div>
                  <span className="suave pequeno">Descuenta de: {t.almacen}</span>
                  <span className="suave pequeno">{t.ultimaVenta ? `Última venta: ${new Date(t.ultimaVenta).toLocaleString("es-DO")}` : "Sin ventas"}</span>
                  <span className="suave pequeno mono" title="Identificador para configurar la terminal">{t.id.slice(0, 8)}…</span>
                  <button className="enlace" onClick={() => accion(`/central/terminales/${t.id}`, { activo: !t.activo }, "PATCH")}>{t.activo ? "Desactivar" : "Activar"}</button>
                </div>
              ))}
              <button className="terminal nueva" onClick={() => accion(`/central/sucursales/${s.id}/terminales`, {})}>+ Agregar terminal</button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/** Si el servidor de la sucursal se está comunicando con la nube. */
function EstadoServidor({ e }: { e?: EstadoSync }) {
  if (!e || (!e.ultimaSubida && !e.ultimaBajada)) return <span className="sync-estado suave"><span className="punto" />Servidor sin conectar</span>;
  const hace = (seg: number | null) => seg === null ? "" : seg < 90 ? "hace un momento" : seg < 3600 ? `hace ${Math.round(seg / 60)} min` : seg < 86400 ? `hace ${Math.round(seg / 3600)} h` : `hace ${Math.round(seg / 86400)} días`;
  return (
    <span className="sync-estado" title={e.ultimoError ?? (e.equipo ? `Equipo: ${e.equipo}` : "")}>
      <span className={"punto" + (e.enLinea ? " verde" : " rojo")} />
      {e.enLinea ? "En línea" : `Sin comunicación ${hace(e.segundos)}`}
      {e.pendientes ? <span className="suave"> · {e.pendientes} por subir</span> : null}
      {e.errores ? <span className="texto-alerta"> · {e.errores} con error</span> : null}
    </span>
  );
}

/** Datos para conectar el servidor de una sucursal. La clave se muestra una sola vez. */
function Conexion({ sucursalId }: { sucursalId: string }) {
  const [clave, setClave] = useState<string | null>(null);
  const [error, setError] = useState("");
  const generar = async () => {
    if (clave === null && !confirm("Se genera una clave nueva. Si este servidor ya estaba conectado con otra, deberá cambiarla allá. ¿Continuar?")) return;
    try { setClave((await api<{ clave: string }>(`/central/sucursales/${sucursalId}/clave-conexion`, { cuerpo: {} })).clave); }
    catch (e) { setError((e as Error).message); }
  };
  const central = sesionActual().servidor || location.origin;
  return (
    <div className="aviso-linea info" style={{ marginTop: 10 }}>
      <div>En el servidor de esta sucursal, instálelo con estos datos o póngalos en <span className="mono">C:\FactPOS\.env</span>:</div>
      <pre className="mono" style={{ margin: "8px 0", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{`CENTRAL_URL=${central}
SUCURSAL_ID=${sucursalId}
CENTRAL_CLAVE=${clave ?? "(pulse «Generar clave de conexión»)"}`}</pre>
      {clave
        ? <div><b>Copie la clave ahora:</b> por seguridad no se vuelve a mostrar. <button className="enlace" onClick={() => navigator.clipboard?.writeText(clave)}>Copiar clave</button></div>
        : <button className="boton primario chico" onClick={generar}>Generar clave de conexión</button>}
      <div className="pequeno" style={{ marginTop: 8 }}>
        Instalador: <span className="mono">instalar-servidor.ps1 -CentralUrl {central} -SucursalId {sucursalId} -CentralClave {clave ? "<la clave>" : "…"}</span>
      </div>
      {error && <Aviso texto={error} />}
    </div>
  );
}
