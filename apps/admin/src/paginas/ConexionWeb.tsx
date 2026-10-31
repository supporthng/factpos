import { useState } from "react";
import { api, puede } from "../api";
import { Aviso, Encabezado, useDatos } from "../ui";
import { type FuncionSeguridad } from "../seguridad";

/**
 * Conexión web: el enlace para entrar al sistema desde internet y el interruptor que lo activa o desactiva.
 * Cambiar el interruptor es solo de administradores; el servidor deja de aceptar visitas del túnel al desactivarlo.
 */
interface Estado {
  activada: boolean; local?: boolean; web?: string | null;
  tunel?: { activo: boolean; url: string | null; error: string | null; reportado: string | null } | null;
}
export function ConexionWeb() {
  const lic = useDatos<Estado>("/central/licencia");
  const seg = useDatos<{ funciones: FuncionSeguridad[] }>("/central/seguridad");
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" } | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const admin = puede("*");
  const f = seg.datos?.funciones.find((x) => x.clave === "acceso_web");
  const d = lic.datos;

  const cambiar = async (habilitada: boolean) => {
    if (!habilitada && !confirm("Al desactivar el acceso web nadie podrá entrar desde internet (ni usted) hasta que lo vuelva a activar desde un equipo de la red local. ¿Desactivar?")) return;
    setTrabajando(true); setMsg(null);
    try {
      await api("/central/seguridad/acceso_web", { metodo: "PUT", cuerpo: { habilitada } });
      await seg.recargar();
      setMsg({ t: habilitada ? "Acceso web activado." : "Acceso web desactivado.", tipo: "ok" });
    } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
    finally { setTrabajando(false); }
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

  return (
    <>
      <Encabezado titulo="Conexión web" descripcion="Entre a su sistema desde cualquier lugar, en el celular o la computadora, con un enlace seguro." />
      <Aviso texto={lic.error || seg.error} />
      {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}
      {d?.local && <Aviso tipo="info" texto="Este es el servidor de una sucursal. El acceso web se configura en la nube de la empresa." />}

      <div className="panel">
        <div className="seg-fila" style={{ paddingTop: 0 }}>
          <div>
            <b>Acceso web desde internet</b>
            <p className="suave pequeno" style={{ margin: "4px 0 0", maxWidth: "70ch" }}>{f?.descripcion}</p>
            {f?.cambiadaEn && <p className="suave pequeno" style={{ margin: "6px 0 0" }}>Último cambio: {new Date(f.cambiadaEn).toLocaleString("es-DO")}{f.cambiadaPor ? ` · ${f.cambiadaPor}` : ""}</p>}
          </div>
          <label className="interruptor" title={admin ? "" : "Solo un administrador"}>
            <input type="checkbox" role="switch" checked={!!f?.habilitada} disabled={!admin || !f || trabajando} onChange={(e) => cambiar(e.target.checked)} aria-label="Acceso web desde internet" />
            <i /><span>{f?.habilitada ? "Activado" : "Desactivado"}</span>
          </label>
        </div>
        {!admin && <p className="suave pequeno" style={{ marginBottom: 0 }}>Solo un administrador puede activar o desactivar el acceso web.</p>}
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
            {f && !f.habilitada ? " · el acceso web está desactivado" : ""}
          </p>
        </div>
      )}
    </>
  );
}
