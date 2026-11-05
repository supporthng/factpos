import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { api, CONFIG, puede } from "../api";
import { Aviso, Encabezado, Tabla, useDatos } from "../ui";
import { type FuncionSeguridad } from "../seguridad";

/**
 * ACCESO REMOTO: todo lo que decide cómo se entra al sistema desde internet, en un solo lugar:
 * 1) solicitudes de equipos esperando respuesta, 2) las dos reglas (acceso web y dispositivo autorizado),
 * 3) los equipos conocidos, 4) los enlaces y la instalación de la app.
 */
interface Dispositivo {
  id: string; nombre: string; plataforma: string; estado: "PENDIENTE" | "AUTORIZADO" | "DENEGADO" | "REVOCADO";
  ip: string | null; solicitadoEn: string; resueltoEn: string | null; ultimoUso: string | null; resueltoPor: string | null;
}
interface Estado {
  activada: boolean; local?: boolean; web?: string | null;
  tunel?: { activo: boolean; url: string | null; error: string | null; reportado: string | null } | null;
}
const fecha = (v: string | null) => (v ? new Date(v).toLocaleString("es-DO", { dateStyle: "short", timeStyle: "short" }) : "—");
const ETIQUETA: Record<Dispositivo["estado"], string> = { PENDIENTE: "Pendiente", AUTORIZADO: "Autorizado", DENEGADO: "Denegado", REVOCADO: "Revocado" };

/** Enlace y QR de instalación: descarga la app y la abre ya configurada con esta empresa. */
function EnlaceInstalacion() {
  const url = CONFIG.modo === "cliente" && CONFIG.slug ? `${location.origin}/${CONFIG.slug}/#instalar` : "";
  const [img, setImg] = useState("");
  const [copiado, setCopiado] = useState(false);
  useEffect(() => {
    let vivo = true;
    if (url) QRCode.toDataURL(url, { margin: 2, width: 360, errorCorrectionLevel: "M" }).then((d) => { if (vivo) setImg(d); }).catch(() => {});
    return () => { vivo = false; };
  }, [url]);
  if (!url) return null;
  return (
    <div className="panel">
      <h3 style={{ marginTop: 0 }}>Instalar la app en un celular o PC</h3>
      {CONFIG.codigo && (
        <p style={{ margin: "0 0 12px" }}>Código de conexión de tu empresa: <b className="mono" style={{ fontSize: 22, letterSpacing: 2 }}>{CONFIG.codigo}</b>
          <span className="suave pequeno"> · escríbelo en FactPOS Admin (Windows o Android) en lugar del nombre de la página.</span></p>
      )}
      <p className="suave pequeno">Envía este enlace (o muestra el QR) a quien vaya a usar la app. Descarga la app y la deja conectada a tu empresa, sin escribir nada.</p>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
        {img && <img src={img} alt="QR de instalación" width={150} height={150} />}
        <div>
          <a className="mono" href={url} target="_blank" rel="noreferrer">{url}</a>
          <div style={{ marginTop: 8 }}>
            <button className="boton" onClick={async () => { try { await navigator.clipboard.writeText(url); setCopiado(true); setTimeout(() => setCopiado(false), 2000); } catch { /* sin portapapeles */ } }}>{copiado ? "Copiado" : "Copiar enlace"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}


export function AccesoRemoto() {
  const disp = useDatos<Dispositivo[]>("/central/dispositivos");
  const lic = useDatos<Estado>("/central/licencia");
  const seg = useDatos<{ funciones: FuncionSeguridad[] }>("/central/seguridad");
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" } | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState<string | null>(null);
  const admin = puede("*");
  const d = lic.datos;
  const regla = (clave: string) => seg.datos?.funciones.find((x) => x.clave === clave);
  const web = regla("acceso_web"), exigir = regla("exigir_dispositivo");
  const recargarEquipos = disp.recargar;
  useEffect(() => {
    // La campana (o otro administrador) puede resolver solicitudes: se refresca sola
    const t = setInterval(() => { if (!document.hidden) recargarEquipos(); }, 20_000);
    window.addEventListener("factpos:acceso-remoto-resuelto", recargarEquipos);
    return () => { clearInterval(t); window.removeEventListener("factpos:acceso-remoto-resuelto", recargarEquipos); };
  }, [recargarEquipos]);
  const lista = disp.datos ?? [];
  const pendientes = lista.filter((x) => x.estado === "PENDIENTE");

  const resolver = async (x: Dispositivo, estado: "AUTORIZADO" | "DENEGADO" | "REVOCADO") => {
    setMsg(null);
    try { await api(`/central/dispositivos/${x.id}`, { metodo: "PUT", cuerpo: { estado } }); await disp.recargar(); window.dispatchEvent(new Event("factpos:acceso-remoto")); }
    catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
  };
  const quitar = async (x: Dispositivo) => {
    if (!confirm(`¿Quitar «${x.nombre}» de la lista? Si vuelve a pedir acceso, tendrá que autorizarse otra vez.`)) return;
    try { await api(`/central/dispositivos/${x.id}`, { metodo: "DELETE" }); await disp.recargar(); window.dispatchEvent(new Event("factpos:acceso-remoto")); }
    catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
  };
  const cambiarRegla = async (clave: "acceso_web" | "exigir_dispositivo", habilitada: boolean) => {
    if (clave === "acceso_web" && !habilitada && !confirm("Al desactivar el acceso web nadie podrá entrar desde internet (ni usted) hasta que lo vuelva a activar desde un equipo de la red local. ¿Desactivar?")) return;
    if (clave === "exigir_dispositivo" && habilitada && !confirm("Con esto activado, desde internet solo entran los equipos autorizados aquí (incluido este navegador si está en internet). Autoriza primero los equipos que ya usas. En la red local no se pide. ¿Activar?")) return;
    setTrabajando(clave); setMsg(null);
    try {
      await api(`/central/seguridad/${clave}`, { metodo: "PUT", cuerpo: { habilitada } });
      await seg.recargar();
      setMsg({ t: clave === "acceso_web" ? (habilitada ? "Acceso web activado." : "Acceso web desactivado.") : (habilitada ? "Ahora se exige dispositivo autorizado." : "Ya no se exige dispositivo autorizado."), tipo: "ok" });
    } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
    finally { setTrabajando(null); }
  };
  const copiar = async (texto: string, clave: string) => {
    try { await navigator.clipboard.writeText(texto); setCopiado(clave); setTimeout(() => setCopiado(null), 2000); } catch { /* sin portapapeles */ }
  };
  const enlace = (clave: string, titulo: string, url: string, nota: string) => (
    <div className="web-enlace">
      <div><b>{titulo}</b><p className="suave pequeno" style={{ margin: "2px 0 8px" }}>{nota}</p>
        <a className="mono" href={url} target="_blank" rel="noreferrer">{url}</a></div>
      <span className="en-linea">
        <button className="boton" onClick={() => copiar(url, clave)}>{copiado === clave ? "Copiado" : "Copiar"}</button>
        <a className="boton primario" href={url} target="_blank" rel="noreferrer">Abrir</a>
      </span>
    </div>
  );
  const interruptor = (clave: "acceso_web" | "exigir_dispositivo", f: FuncionSeguridad | undefined, titulo: string, texto: string) => (
    <div className="seg-fila">
      <div>
        <b>{titulo}</b>
        <p className="suave pequeno" style={{ margin: "4px 0 0", maxWidth: "70ch" }}>{texto}</p>
        {f?.cambiadaEn && <p className="suave pequeno" style={{ margin: "6px 0 0" }}>Último cambio: {new Date(f.cambiadaEn).toLocaleString("es-DO")}{f.cambiadaPor ? ` · ${f.cambiadaPor}` : ""}</p>}
      </div>
      <label className="interruptor" title={admin ? "" : "Solo un administrador"}>
        <input type="checkbox" role="switch" checked={!!f?.habilitada} disabled={!admin || !f || trabajando === clave} onChange={(e) => cambiarRegla(clave, e.target.checked)} aria-label={titulo} />
        <i /><span>{f?.habilitada ? "Activado" : "Desactivado"}</span>
      </label>
    </div>
  );

  return (
    <>
      <Encabezado titulo="Acceso remoto" descripcion="Todo lo que decide quién entra a su sistema desde internet: reglas, equipos autorizados, enlaces e instalación de la app." />
      <Aviso texto={disp.error || lic.error || seg.error} />
      {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}
      {d?.local && <Aviso tipo="info" texto="Este es el servidor de una sucursal. El acceso web se configura en la nube de la empresa." />}

      {pendientes.length > 0 && (
        <div className="panel solicitudes-acceso">
          <h3 style={{ marginTop: 0 }}>{pendientes.length === 1 ? "1 solicitud espera su respuesta" : `${pendientes.length} solicitudes esperan su respuesta`}</h3>
          {pendientes.map((x) => (
            <div key={x.id} className="solicitud-fila">
              <div><b>{x.nombre}</b><div className="suave pequeno">{x.plataforma || "Equipo"} · {fecha(x.solicitadoEn)}{x.ip ? ` · ${x.ip}` : ""}</div></div>
              <span className="en-linea">
                <button className="boton primario" onClick={() => resolver(x, "AUTORIZADO")}>Autorizar</button>
                <button className="boton" onClick={() => resolver(x, "DENEGADO")}>Negar</button>
              </span>
            </div>
          ))}
          <p className="suave pequeno" style={{ marginBottom: 0 }}>Autorice solo equipos que reconozca: quien lo pidió está esperando en esa pantalla.</p>
        </div>
      )}

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Reglas de acceso</h3>
        {interruptor("acceso_web", web, "Acceso web desde internet", web?.descripcion ?? "")}
        {interruptor("exigir_dispositivo", exigir, "Exigir dispositivo autorizado", exigir?.descripcion ?? "")}
        {!admin && <p className="suave pequeno" style={{ marginBottom: 0 }}>Solo un administrador puede cambiar estas reglas.</p>}
      </div>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Equipos</h3>
        <Tabla
          filas={lista} clave={(x) => x.id} tarjetas vacio="Ningún equipo ha pedido acceso todavía."
          columnas={[
            { titulo: "Equipo", valor: (x) => <><b>{x.nombre}</b><div className="suave pequeno">{x.plataforma}</div></> },
            { titulo: "Estado", valor: (x) => <b className={x.estado === "AUTORIZADO" ? "texto-ok" : undefined}>{ETIQUETA[x.estado]}</b> },
            { titulo: "Pidió acceso", valor: (x) => <>{fecha(x.solicitadoEn)}<div className="suave pequeno">{x.ip ?? ""}</div></> },
            { titulo: "Último uso", valor: (x) => fecha(x.ultimoUso), ocultoMovil: true },
            { titulo: "Resuelto por", valor: (x) => x.resueltoPor ?? "—", ocultoMovil: true },
            { titulo: "", valor: (x) => (
              <span className="en-linea">
                {x.estado !== "AUTORIZADO" && <button className="boton primario" onClick={() => resolver(x, "AUTORIZADO")}>Autorizar</button>}
                {x.estado === "PENDIENTE" && <button className="boton" onClick={() => resolver(x, "DENEGADO")}>Negar</button>}
                {x.estado === "AUTORIZADO" && <button className="boton" onClick={() => resolver(x, "REVOCADO")}>Revocar</button>}
                {x.estado !== "PENDIENTE" && <button className="boton" onClick={() => quitar(x)}>Quitar</button>}
              </span>
            ) },
          ]}
        />
      </div>

      {d && !d.local && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Enlaces de acceso</h3>
          {!d.activada && <Aviso tipo="info" texto="La dirección web queda lista al activar la licencia." />}
          {d.web && enlace("web", "Dirección web del sistema", d.web, "Compártala solo con su personal autorizado. Cada persona entra con su usuario y clave.")}
          {d.tunel?.url && enlace("tunel", "Dirección directa", d.tunel.url, d.tunel.url.includes("trycloudflare") ? "Dirección temporal: cambia si se reinicia el servidor. Use la de arriba." : "Conexión directa a su servidor.")}
          {!d.web && !d.tunel?.url && <p className="suave">Todavía no hay una dirección de acceso disponible.</p>}
          <p className="suave pequeno" style={{ marginBottom: 0 }}>
            Estado del túnel: {d.tunel?.activo ? <b className="texto-ok">abierto</b> : <b>cerrado</b>}{d.tunel?.error ? ` · ${d.tunel.error}` : ""}
            {web && !web.habilitada ? " · el acceso web está desactivado" : ""}
          </p>
        </div>
      )}

      <EnlaceInstalacion />
    </>
  );
}
