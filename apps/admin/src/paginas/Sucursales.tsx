import { useEffect, useState } from "react";
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
  const [alta, setAlta] = useState<false | true | SolicitudAlta>(false);
  const pend = useDatos<{ solicitudes: SolicitudAlta[]; codigos: CodigoInstalacion[] }>("/central/alta/pendientes");
  // Los servidores recién instalados aparecen solos
  useEffect(() => { const t = setInterval(() => pend.recargar(), 10_000); return () => clearInterval(t); }, [pend.recargar]); // eslint-disable-line react-hooks/exhaustive-deps
  const [codigos, setCodigos] = useState<Record<string, { codigo: string; expiraEn: string }>>({});
  const generarCodigo = async (sucursalId: string, nombre: string, silencioso = false) => {
    if (!silencioso && codigoDe(sucursalId) && !confirm(`${nombre} ya tiene un código de instalación sin usar. ¿Generar otro? (el anterior deja de servir)`)) return;
    try {
      const r = await api<{ codigo: string; expiraEn: string }>("/central/alta/codigo", { cuerpo: { sucursalId } });
      setCodigos((c) => ({ ...c, [sucursalId]: r }));
      pend.recargar();
      return r;
    } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
  };
  const codigoDe = (sucursalId: string) => codigos[sucursalId]
    ?? pend.datos?.codigos.find((c) => c.sucursalId === sucursalId && !c.usadoEn);
  const rechazar = async (codigo: string, equipo: string | null) => {
    if (!confirm(`¿Rechazar la solicitud de ${equipo ?? codigo}? Ese equipo no quedará conectado.`)) return;
    try { await api("/central/alta/descartar", { cuerpo: { codigo } }); pend.recargar(); } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
  };
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" } | null>(null);

  const crear = async () => {
    try {
      const { id } = await api<{ id: string }>("/central/sucursales", { cuerpo: { ...nueva, direccion: nueva.direccion || undefined, telefono: nueva.telefono || undefined } });
      const c = await generarCodigo(id, nueva.nombre, true);
      setMsg({ t: `Sucursal ${nueva.nombre} creada con su almacén y la Caja 1.${c ? ` Código de instalación de su servidor: ${c.codigo} (escríbalo al instalar el servidor; vale ${DIAS_CODIGO} días).` : ""} Recuerde asignarle secuencias e-NCF.`, tipo: "ok" });
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
        <button className="boton primario" onClick={() => { setAbrir(!abrir); setAlta(false); }}>Nueva sucursal</button>
        <button className="boton" onClick={() => { setAlta(alta ? false : true); setAbrir(false); }}>Escribir código de un servidor</button>
      </Encabezado>
      {!!pend.datos?.solicitudes.length && !alta && (
        <div className="panel esperando-alta">
          <div className="encabezado-sub" style={{ marginTop: 0 }}>
            <h3>Servidores esperando alta</h3>
            <span className="suave pequeno">Se instalaron y piden conectarse. Confirme a qué sucursal corresponde cada uno.</span>
          </div>
          {pend.datos.solicitudes.map((x) => (
            <div key={x.codigo} className="fila-solicitud">
              <div>
                <b>{x.equipo ?? "Equipo sin nombre"}</b> <span className="pastilla mono">{x.codigo}</span>
                <div className="suave pequeno">{x.ip ? `Desde ${x.ip} · ` : ""}{hace(x.creadoEn)}{x.version ? ` · versión ${x.version}` : ""}</div>
              </div>
              <span className="flex" />
              <button className="enlace" onClick={() => rechazar(x.codigo, x.equipo)}>Rechazar</button>
              <button className="boton primario chico" onClick={() => setAlta(x)}>Confirmar…</button>
            </div>
          ))}
        </div>
      )}
      {alta && (
        <AltaServidor
          key={alta === true ? "manual" : alta.codigo}
          inicial={alta === true ? undefined : alta}
          sucursales={datos ?? []}
          estados={sync.datos ?? []}
          onCerrar={() => setAlta(false)}
          onListo={(t) => { setMsg({ t, tipo: "ok" }); setAlta(false); recargar(); pend.recargar(); setTimeout(() => sync.recargar(), 20_000); }}
        />
      )}
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
              <button className="enlace" onClick={() => generarCodigo(s.id, s.nombre)}>Código de instalación</button>
              <button className="enlace" onClick={() => setVerId(verId === s.id ? null : s.id)}>Conectar a mano</button>
            </div>
            {codigoDe(s.id) && (
              <div className="codigo-instalacion">
                <div>
                  <span className="suave pequeno">Código de instalación del servidor de {s.nombre}</span>
                  <div className="mono codigo-grande">{codigoDe(s.id)!.codigo}</div>
                </div>
                <div className="suave pequeno">
                  Al instalar el servidor elija «Tengo un código de instalación» y escríbalo: queda dado de alta solo.
                  <br />Vale hasta el {new Date(codigoDe(s.id)!.expiraEn).toLocaleDateString("es-DO")} y sirve una sola vez.
                  {" "}<button className="enlace" onClick={() => navigator.clipboard?.writeText(codigoDe(s.id)!.codigo)}>Copiar</button>
                  {" · "}<button className="enlace" onClick={async () => {
                    await api("/central/alta/descartar", { cuerpo: { codigo: codigoDe(s.id)!.codigo } }).catch(() => {});
                    setCodigos((c) => { const n = { ...c }; delete n[s.id]; return n; }); pend.recargar();
                  }}>Anular</button>
                </div>
              </div>
            )}
            {verId === s.id && <Conexion sucursalId={s.id} />}
            <div className="suave pequeno">
              Almacenes: {s.almacenes.map((a) => a.nombre + (a.principal ? " (principal)" : "")).join(", ")}
              {" · "}<button className="enlace" onClick={async () => {
                const nombre = window.prompt(`Nombre del nuevo almacén de ${s.nombre} (ej. Depósito, Almacén trasero)`)?.trim();
                if (!nombre) return;
                await accion(`/central/sucursales/${s.id}/almacenes`, { nombre });
                setMsg({ t: `Almacén «${nombre}» creado en ${s.nombre}. Ya se puede elegir en Compras y Ajustes (recargue la página).`, tipo: "ok" });
              }}>+ Agregar almacén</button>
            </div>
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

/**
 * Alta de un servidor con el código que muestra al instalarse (ej. K7PD-4QX9):
 * se elige la sucursal existente o se crea una nueva, y el servidor recibe solo
 * su identificador, su clave de conexión y el PIN_SECRETO.
 */
const DIAS_CODIGO = 7;
interface CodigoInstalacion { codigo: string; sucursalId: string; expiraEn: string; usadoEn: string | null; equipo: string | null }
const hace = (f: string) => {
  const m = Math.round((Date.now() - new Date(f).getTime()) / 60_000);
  return m < 1 ? "hace un momento" : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : new Date(f).toLocaleString("es-DO");
};
interface SolicitudAlta { codigo: string; equipo: string | null; version: string | null; ip: string | null; creadoEn: string; expiraEn: string; vencido?: boolean; aprobadoEn?: string | null; sucursal?: string | null; rnc?: string | null }
function AltaServidor({ inicial, sucursales, estados, onCerrar, onListo }: {
  inicial?: SolicitudAlta; sucursales: Sucursal[]; estados: EstadoSync[]; onCerrar: () => void; onListo: (texto: string) => void;
}) {
  const [codigo, setCodigo] = useState(inicial?.codigo ?? "");
  const [sol, setSol] = useState<SolicitudAlta | null>(inicial ?? null);
  const [destino, setDestino] = useState<string>("nueva");
  const [nueva, setNueva] = useState({ codigo: "", nombre: "", direccion: "", telefono: "" });
  const [error, setError] = useState("");
  const [trabajando, setTrabajando] = useState(false);
  const limpio = codigo.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const formato = limpio.length > 4 ? `${limpio.slice(0, 4)}-${limpio.slice(4, 8)}` : limpio;
  const activas = sucursales.filter((s) => s.activo);
  const conServidor = (id: string) => estados.find((e) => e.sucursalId === id && (e.ultimaSubida || e.ultimaBajada));
  useEffect(() => {
    if (inicial) setDestino(activas.find((s) => !conServidor(s.id))?.id ?? "nueva");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const buscar = async () => {
    setError(""); setSol(null);
    try {
      const r = await api<SolicitudAlta>(`/central/alta/${formato}`);
      if (r.aprobadoEn) return setError(`Ese código ya se usó${r.sucursal ? ` (sucursal ${r.sucursal})` : ""}.`);
      if (r.vencido) return setError("Ese código venció. El servidor genera uno nuevo solo: vea su pantalla o http://<servidor>:3000/alta");
      setSol(r);
      const libre = activas.find((s) => !conServidor(s.id));
      setDestino(libre?.id ?? "nueva");
    } catch (e) { setError((e as Error).message); }
  };

  const darDeAlta = async () => {
    if (!sol) return;
    const elegida = activas.find((s) => s.id === destino);
    if (elegida && conServidor(elegida.id) &&
        !confirm(`${elegida.nombre} ya tiene un servidor conectado (${conServidor(elegida.id)?.equipo ?? "otro equipo"}). El nuevo lo reemplaza y el anterior deja de sincronizar. ¿Continuar?`)) return;
    setTrabajando(true); setError("");
    try {
      let sucursalId = destino;
      if (destino === "nueva") {
        sucursalId = (await api<{ id: string }>("/central/sucursales", {
          cuerpo: { ...nueva, direccion: nueva.direccion || undefined, telefono: nueva.telefono || undefined },
        })).id;
      }
      const r = await api<{ sucursal: string; equipo: string | null }>("/central/alta/aprobar", { cuerpo: { codigo: sol.codigo, sucursalId } });
      onListo(`Listo: el servidor ${r.equipo ?? sol.codigo} quedó como la sucursal ${r.sucursal}. En unos segundos recibe sus datos y empieza a sincronizar.${destino === "nueva" ? " Recuerde asignarle secuencias e-NCF (Fiscal) y activar el certificado." : ""}`);
    } catch (e) { setError((e as Error).message); }
    finally { setTrabajando(false); }
  };

  const nuevaOk = nueva.codigo.trim() && nueva.nombre.trim().length >= 2;
  return (
    <div className="panel alta-servidor">
      <div className="encabezado-sub" style={{ marginTop: 0 }}>
        <h3>{inicial ? `Confirmar el servidor ${inicial.equipo ?? inicial.codigo}` : "Dar de alta un servidor con su código"}</h3>
        <button className="enlace" onClick={onCerrar}>Cerrar</button>
      </div>
      {!inicial && (<>
      <p className="suave">
        Al instalarse, el servidor de la tienda muestra un código de 8 letras y números. También se ve abriendo en esa
        computadora <span className="mono">http://localhost:3000/alta</span>.
      </p>
      <div className="en-linea">
        <input className="codigo-alta mono" value={formato} maxLength={9} autoFocus placeholder="K7PD-4QX9"
          onChange={(e) => { setCodigo(e.target.value); setSol(null); }} onKeyDown={(e) => e.key === "Enter" && limpio.length === 8 && buscar()} />
        <button className="boton" disabled={limpio.length !== 8} onClick={buscar}>Buscar servidor</button>
      </div>

      </>)}
      {sol && (
        <>
          <div className="aviso-linea info" style={{ marginTop: 12 }}>
            Servidor encontrado: <b>{sol.equipo ?? "equipo sin nombre"}</b>
            {sol.ip ? <span className="suave"> · desde {sol.ip}</span> : null}
            <span className="suave"> · pidió el código {new Date(sol.creadoEn).toLocaleString("es-DO")}</span>
          </div>
          <label className="campo" style={{ marginTop: 12 }}><span>¿Qué sucursal es este servidor?</span>
            <select value={destino} onChange={(e) => setDestino(e.target.value)}>
              <option value="nueva">+ Una sucursal nueva…</option>
              {activas.map((s) => (
                <option key={s.id} value={s.id}>{s.nombre} ({s.codigo}){conServidor(s.id) ? " · ya tiene servidor: se reemplaza" : ""}</option>
              ))}
            </select>
          </label>
          {destino === "nueva" && (
            <div className="cuatro-col">
              <label className="campo"><span>Código</span><input value={nueva.codigo} onChange={(e) => setNueva({ ...nueva, codigo: e.target.value })} placeholder="S03" /></label>
              <label className="campo"><span>Nombre</span><input value={nueva.nombre} onChange={(e) => setNueva({ ...nueva, nombre: e.target.value })} placeholder="Colmado Los Prados" /></label>
              <label className="campo"><span>Dirección</span><input value={nueva.direccion} onChange={(e) => setNueva({ ...nueva, direccion: e.target.value })} /></label>
              <label className="campo"><span>Teléfono</span><input value={nueva.telefono} onChange={(e) => setNueva({ ...nueva, telefono: e.target.value })} /></label>
            </div>
          )}
          <div className="fila-acciones">
            <span className="flex" />
            <button className="boton primario" disabled={trabajando || (destino === "nueva" && !nuevaOk)} onClick={darDeAlta}>
              {trabajando ? "Dando de alta…" : destino === "nueva" ? "Crear sucursal y dar de alta" : "Dar de alta"}
            </button>
          </div>
        </>
      )}
      {error && <Aviso texto={error} />}
    </div>
  );
}

/** Datos para conectar el servidor de una sucursal a mano (sin código). La clave se muestra una sola vez. */
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
      <div>Lo normal es <b>Dar de alta un servidor</b> con su código. Si prefiere hacerlo a mano, ponga estos datos en <span className="mono">C:\FactPOS\.env</span> del servidor (además del PIN_SECRETO):</div>
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
