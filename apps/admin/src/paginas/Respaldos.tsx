import { useEffect, useState } from "react";
import { api, puede } from "../api";
import { Aviso, Encabezado, useDatos } from "../ui";

/**
 * Respaldos: copia automática en este equipo, copia extra (USB, OneDrive o Google Drive) y copia cifrada en la nube de FactPOS.
 * Desde aquí también se restaura un respaldo.
 */
interface Fila { id: string; archivo: string; tipo: "AUTO" | "MANUAL" | "SEGURIDAD"; tamano: number; filas: number | null; creado: string; borrado: boolean; extra: string; extraError: string | null; nube: string; nubeError: string | null }
interface Estado {
  config: { activo: boolean; hora: string; carpetaExtra: string | null; diasLocal: number; nubeActiva: boolean; nubeConClave: boolean };
  ultimo: string | null; atrasado: boolean; carpeta: string; onedrive: { nombre: string; ruta: string }[]; lista: Fila[];
}
interface EnNube { respaldos: { objeto: string; nombre: string; tamano: number; creado: string }[]; usadoMb: number; maxGb: number }

const mb = (n: number) => (n / 1048576 >= 10 ? Math.round(n / 1048576) : (n / 1048576).toFixed(1)) + " MB";
const cuando = (iso: string) => new Date(iso).toLocaleString("es-DO", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const TIPO = { AUTO: "Automático", MANUAL: "Manual", SEGURIDAD: "Antes de restaurar" } as const;
const ESTADO_EXTRA: Record<string, string> = { NO: "—", PENDIENTE: "Pendiente", COPIADO: "Copiado", ERROR: "Error" };
const ESTADO_NUBE: Record<string, string> = { NO: "—", PENDIENTE: "Pendiente", SUBIDO: "En la nube", ERROR: "Error" };

export function Respaldos() {
  const { datos, error, recargar } = useDatos<Estado>("/central/respaldos");
  const admin = puede("*");
  const [f, setF] = useState<Estado["config"] | null>(null);
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" } | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [clave, setClave] = useState<string | null>(null);
  const [nube, setNube] = useState<EnNube | null>(null);
  const [errNube, setErrNube] = useState("");
  const [restaurar, setRestaurar] = useState<{ id?: string; objeto?: string; nombre: string } | null>(null);
  const [texto, setTexto] = useState("");

  useEffect(() => { if (datos && !f) setF(datos.config); }, [datos, f]);
  // Mientras hay envíos pendientes se vuelve a consultar
  useEffect(() => {
    if (!datos?.lista.some((r) => r.extra === "PENDIENTE" || r.nube === "PENDIENTE")) return;
    const t = setTimeout(recargar, 15_000);
    return () => clearTimeout(t);
  }, [datos, recargar]);
  useEffect(() => {
    if (!datos?.config.nubeActiva) return;
    api<EnNube>("/central/respaldos/nube").then((r) => { setNube(r); setErrNube(""); }).catch((e) => setErrNube((e as Error).message));
  }, [datos?.config.nubeActiva, datos?.lista.length]);

  if (!datos || !f) return <><Encabezado titulo="Respaldos" /><Aviso texto={error} /></>;

  const guardar = async () => {
    setTrabajando(true); setMsg(null);
    try {
      const r = await api<Estado & { claveRecuperacion: string | null }>("/central/respaldos/config", { metodo: "PUT", cuerpo: { ...f, carpetaExtra: f.carpetaExtra?.trim() || null } });
      if (r.claveRecuperacion) setClave(r.claveRecuperacion);
      setMsg({ t: "Guardado", tipo: "ok" }); await recargar();
    } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
    finally { setTrabajando(false); }
  };
  const ahora = async () => {
    setTrabajando(true); setMsg(null);
    try { await api("/central/respaldos/ahora", { cuerpo: {} }); setMsg({ t: "Respaldo hecho", tipo: "ok" }); await recargar(); }
    catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
    finally { setTrabajando(false); }
  };
  const verClave = async () => {
    try { setClave((await api<{ clave: string }>("/central/restaurar-respaldo/clave")).clave); }
    catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
  };
  const restaurarYa = async () => {
    if (!restaurar) return;
    setTrabajando(true); setMsg(null);
    try {
      const r = await api<{ mensaje: string }>("/central/restaurar-respaldo", { cuerpo: { confirmar: "RESTAURAR", id: restaurar.id, objeto: restaurar.objeto } });
      setMsg({ t: r.mensaje, tipo: "ok" }); setRestaurar(null); setTexto("");
    } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
    finally { setTrabajando(false); }
  };
  const cambio = JSON.stringify(f) !== JSON.stringify(datos.config);

  return (
    <>
      <Encabezado titulo="Respaldos" descripcion="Copias de seguridad de todos los datos: en este equipo, en una carpeta extra y en la nube." />
      {msg && <p className={msg.tipo === "ok" ? "texto-ok" : "texto-alerta"}>{msg.t}</p>}

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>
          Estado{" "}
          <span className={"pastilla " + (datos.atrasado ? "alerta" : "ok")}>{datos.atrasado ? "Sin respaldo reciente" : "Al día"}</span>
        </h3>
        <p className="suave" style={{ margin: "0 0 10px" }}>
          {datos.ultimo ? <>Último respaldo: <b>{cuando(datos.ultimo)}</b>.</> : "Todavía no hay respaldos."} Carpeta en este equipo: <span className="mono">{datos.carpeta}</span>
        </p>
        <button className="boton primario" disabled={!admin || trabajando} onClick={ahora}>{trabajando ? "Trabajando…" : "Respaldar ahora"}</button>
      </div>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Copia automática</h3>
        <label className="en-linea"><input type="checkbox" checked={f.activo} disabled={!admin} onChange={(e) => setF({ ...f, activo: e.target.checked })} /> Hacer un respaldo todos los días</label>
        <div className="en-linea" style={{ marginTop: 8 }}>
          <label>A las <input type="time" value={f.hora} disabled={!admin || !f.activo} onChange={(e) => setF({ ...f, hora: e.target.value })} /></label>
          <label>Guardar en este equipo <input type="number" min={1} max={365} style={{ width: 70 }} value={f.diasLocal} disabled={!admin}
            onChange={(e) => setF({ ...f, diasLocal: Math.max(1, Math.min(365, Number(e.target.value) || 14)) })} /> días</label>
        </div>

        <h3>Copia extra (USB, OneDrive, Google Drive)</h3>
        <p className="suave pequeno" style={{ marginTop: 0 }}>
          Cada respaldo se copia también a esta carpeta. Si es una carpeta de OneDrive o de Google Drive, esa aplicación la sube a la nube de su cuenta.
          Para una memoria USB, déjela conectada.
        </p>
        <input className="mono" style={{ width: "100%" }} value={f.carpetaExtra ?? ""} placeholder="Ej.: E:\Respaldos  o  C:\Users\Dueño\OneDrive\FactPOS-Respaldos" disabled={!admin}
          onChange={(e) => setF({ ...f, carpetaExtra: e.target.value })} />
        {datos.onedrive.length > 0 && (
          <div className="en-linea" style={{ marginTop: 6, flexWrap: "wrap" }}>
            {datos.onedrive.map((o) => <button key={o.ruta} className="boton" disabled={!admin} onClick={() => setF({ ...f, carpetaExtra: o.ruta })}>Usar {o.nombre}</button>)}
          </div>
        )}

        <h3>Copia en la nube de FactPOS</h3>
        <p className="suave pequeno" style={{ marginTop: 0 }}>
          Va incluida en su plan. El respaldo sale <b>cifrado</b> de este equipo: ni FactPOS puede leerlo. Si se pierde el equipo, se recupera con la clave de recuperación.
        </p>
        <label className="en-linea"><input type="checkbox" checked={f.nubeActiva} disabled={!admin} onChange={(e) => setF({ ...f, nubeActiva: e.target.checked })} /> Guardar una copia cifrada en la nube</label>
        {datos.config.nubeConClave && <button className="boton" style={{ marginTop: 6 }} disabled={!admin} onClick={verClave}>Ver clave de recuperación</button>}

        {clave && (
          <div className="texto-aviso" style={{ marginTop: 10 }}>
            <p style={{ margin: 0 }}><b>Clave de recuperación — guárdela fuera de este equipo (papel o correo a sí mismo):</b></p>
            <p className="mono" style={{ fontSize: 15, margin: "6px 0", wordBreak: "break-all", userSelect: "all" }}>{clave}</p>
            <p className="pequeno" style={{ margin: 0 }}>Sin esta clave no se pueden abrir las copias de la nube.</p>
            <button className="boton" style={{ marginTop: 6 }} onClick={() => setClave(null)}>Ya la guardé</button>
          </div>
        )}
        <div style={{ marginTop: 12 }}>
          <button className="boton primario" disabled={!admin || trabajando || !cambio} onClick={guardar}>Guardar cambios</button>
          {!admin && <p className="suave pequeno">Solo el administrador principal puede cambiar los respaldos.</p>}
        </div>
      </div>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Respaldos en este equipo</h3>
        <div style={{ overflowX: "auto" }}>
          <table className="tabla">
            <thead><tr><th>Fecha</th><th>Tipo</th><th className="der">Tamaño</th><th>Copia extra</th><th>Nube</th><th /></tr></thead>
            <tbody>
              {datos.lista.length === 0 && <tr><td colSpan={6} className="suave">Sin respaldos todavía</td></tr>}
              {datos.lista.map((r) => (
                <tr key={r.id}>
                  <td>{cuando(r.creado)}</td><td>{TIPO[r.tipo]}</td><td className="der">{mb(r.tamano)}</td>
                  <td title={r.extraError ?? ""} className={r.extra === "ERROR" ? "texto-alerta" : ""}>{ESTADO_EXTRA[r.extra]}</td>
                  <td title={r.nubeError ?? ""} className={r.nube === "ERROR" ? "texto-alerta" : ""}>{ESTADO_NUBE[r.nube]}</td>
                  <td className="der">{r.borrado ? <span className="suave pequeno">Borrado por antigüedad</span>
                    : <button className="boton" disabled={!admin} onClick={() => setRestaurar({ id: r.id, nombre: cuando(r.creado) })}>Restaurar</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {datos.config.nubeActiva && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Respaldos en la nube de FactPOS</h3>
          {errNube && <p className="texto-alerta">{errNube}</p>}
          {nube && <p className="suave pequeno" style={{ marginTop: 0 }}>Usa {nube.usadoMb} MB de {nube.maxGb} GB. Se conservan los últimos 30 y uno por mes durante un año.</p>}
          {nube?.respaldos.length === 0 && <p className="suave">Todavía no hay copias en la nube.</p>}
          {nube?.respaldos.map((r) => (
            <div key={r.objeto} className="en-linea" style={{ justifyContent: "space-between", padding: "6px 0", borderTop: "1px solid var(--borde)" }}>
              <span>{cuando(r.creado)} · {mb(r.tamano)}</span>
              <button className="boton" disabled={!admin} onClick={() => setRestaurar({ objeto: r.objeto, nombre: cuando(r.creado) + " (nube)" })}>Restaurar</button>
            </div>
          ))}
        </div>
      )}

      {restaurar && (
        <div className="panel" style={{ borderColor: "var(--alerta)" }}>
          <h3 style={{ marginTop: 0 }}>Restaurar el respaldo del {restaurar.nombre}</h3>
          <p className="texto-alerta" style={{ marginTop: 0 }}>Esto reemplaza TODOS los datos actuales por los de ese respaldo. Las ventas y cambios hechos después se perderán.</p>
          <p className="suave pequeno">Antes se guarda una copia del estado actual (dura 30 días). El servidor se reinicia solo y no se puede vender durante unos minutos.</p>
          <div className="en-linea">
            <input value={texto} onChange={(e) => setTexto(e.target.value.toUpperCase())} placeholder="Escriba RESTAURAR para confirmar" />
            <button className="boton primario" disabled={trabajando || texto !== "RESTAURAR"} onClick={restaurarYa}>{trabajando ? "Preparando…" : "Restaurar ahora"}</button>
            <button className="boton" disabled={trabajando} onClick={() => { setRestaurar(null); setTexto(""); }}>Cancelar</button>
          </div>
        </div>
      )}
    </>
  );
}
