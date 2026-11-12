import { useMemo, useState } from "react";
import { api } from "../api";
import { Aviso, Encabezado, useDatos, versionCliente } from "../ui";

/**
 * PORTAL DEL PROVEEDOR · Envío de actualizaciones.
 * Una versión nueva NO llega sola a todos los clientes: tú eliges a cuáles se la habilitas.
 * El cliente ve el aviso «Hay una versión nueva» en su administración solo si se la habilitaste.
 */
interface Fila {
  licenciaId: string; cliente: string; plan: string | null; versionApp: string | null; ultimoContacto: string | null;
  versionAprobada: string | null; estado: string; habilitada: boolean; alDia: boolean;
}
interface Datos { ultima: { version: string; notas: string | null; publicada: string | null } | null; todas: boolean; clientes: Fila[] }
const fecha = (v: string | null) => (v ? new Date(v).toLocaleString("es-DO", { dateStyle: "medium", timeStyle: "short" }) : "—");

export function ActualizacionesPortal() {
  const [n, setN] = useState(0);
  const { datos, error, cargando } = useDatos<Datos>("/central/portal/versiones", [n]);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const pendientes = useMemo(() => (datos?.clientes ?? []).filter((c) => !c.habilitada && !c.alDia), [datos]);
  const alternar = (id: string) => setMarcados((s) => { const x = new Set(s); if (x.has(id)) x.delete(id); else x.add(id); return x; });

  const enviar = async (ids: string[], retirar = false) => {
    if (!ids.length) return;
    setOcupado(true); setMsg(null);
    try {
      const r = await api<{ version: string; licencias: number }>("/central/portal/versiones/habilitar", { metodo: "POST", cuerpo: { licenciaIds: ids, retirar } });
      setMsg({ t: retirar ? `Se retiró la versión a ${r.licencias} cliente(s).` : `La versión ${versionCliente(r.version)} quedó habilitada para ${r.licencias} cliente(s). Les aparecerá el aviso para instalarla.`, tipo: "ok" });
      setMarcados(new Set()); setN((x) => x + 1);
    } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
    finally { setOcupado(false); }
  };
  const automatico = async (todas: boolean) => {
    if (todas && !confirm("Cada versión nueva se enviará a TODOS los clientes sin pedirte permiso. ¿Activarlo?")) return;
    setOcupado(true); setMsg(null);
    try { await api("/central/portal/versiones/automatico", { metodo: "PUT", cuerpo: { todas } }); setN((x) => x + 1); }
    catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
    finally { setOcupado(false); }
  };

  const u = datos?.ultima;
  return (
    <>
      <Encabezado titulo="Envío de actualizaciones" descripcion="Elige a qué clientes les llega la versión publicada. Los demás siguen con la que tienen, sin avisos ni cambios.">
        <button className="boton" disabled={cargando} onClick={() => setN((x) => x + 1)}>{cargando ? "Actualizando…" : "Actualizar lista"}</button>
      </Encabezado>
      <Aviso texto={error} />
      {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}
      <div className="tarjeta" style={{ marginBottom: 12 }}>
        <b>Versión publicada: {u ? `v${versionCliente(u.version)}` : "ninguna"}</b>
        {u?.publicada && <span className="suave"> · {fecha(u.publicada)}</span>}
        {u?.notas && <pre className="suave pequeno" style={{ whiteSpace: "pre-wrap", margin: "6px 0 0" }}>{u.notas.slice(0, 600)}</pre>}
        <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
          <input type="checkbox" checked={!!datos?.todas} disabled={ocupado || !datos} onChange={(e) => void automatico(e.target.checked)} />
          <span>Enviar cada versión nueva a todos los clientes automáticamente <span className="suave">(apagado: solo a los que elijas)</span></span>
        </label>
        {datos?.todas && <p className="pequeno" style={{ color: "#b45309", margin: "6px 0 0" }}>Está encendido: ahora mismo todos los clientes reciben la versión publicada.</p>}
      </div>
      <div className="fila-acciones" style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "8px 0" }}>
        <button className="boton primario" disabled={ocupado || !marcados.size || !u} onClick={() => void enviar([...marcados])}>Enviar a los {marcados.size || ""} marcados</button>
        <button className="boton" disabled={ocupado || !pendientes.length} onClick={() => setMarcados(new Set(pendientes.map((c) => c.licenciaId)))}>Marcar los pendientes</button>
        <button className="boton" disabled={ocupado || !marcados.size} onClick={() => void enviar([...marcados], true)}>Retirar a los marcados</button>
      </div>
      <div className="tabla-contenedor">
        <table className="tabla apilada">
          <thead><tr><th></th><th>Cliente</th><th>Plan</th><th>Instalada</th><th>Último contacto</th><th>Estado</th></tr></thead>
          <tbody>
            {(datos?.clientes ?? []).map((c) => (
              <tr key={c.licenciaId}>
                <td><input type="checkbox" aria-label={`Marcar ${c.cliente}`} checked={marcados.has(c.licenciaId)} onChange={() => alternar(c.licenciaId)} /></td>
                <td data-et="Cliente"><b>{c.cliente}</b></td>
                <td data-et="Plan">{c.plan ?? "—"}</td>
                <td data-et="Instalada">{c.versionApp ? `v${versionCliente(c.versionApp)}` : "—"}</td>
                <td data-et="Último contacto">{fecha(c.ultimoContacto)}</td>
                <td data-et="Estado">
                  {c.alDia ? <span className="pastilla ok">Al día</span>
                    : c.habilitada ? <span className="pastilla ok">Enviada · pendiente de instalar</span>
                    : <span className="pastilla alerta">Sin enviar</span>}
                </td>
              </tr>
            ))}
            {datos && !datos.clientes.length && <tr><td colSpan={6} className="suave">Todavía no hay clientes con licencia.</td></tr>}
          </tbody>
        </table>
      </div>
      {!datos && !error && <p className="suave">Cargando…</p>}
      <p className="suave pequeno">Cada habilitación es para la versión publicada en ese momento: cuando publiques otra más nueva, hay que enviarla de nuevo. Las sucursales siguen a su servidor principal.</p>
    </>
  );
}
