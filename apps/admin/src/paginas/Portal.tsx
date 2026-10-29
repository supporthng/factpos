import { Fragment, useState } from "react";
import { api } from "../api";
import { Aviso, Encabezado, useDatos } from "../ui";

/**
 * PORTAL DEL PROVEEDOR · Clientes y licencias.
 * Cada cliente tiene su propia nube; aquí solo se maneja su licencia y la
 * dirección de su administración web (portal/<nombre-corto>/).
 */
interface Cliente {
  id: string; slug: string; nombre: string; rnc: string | null; contacto: string | null; correo: string | null; telefono: string | null;
  apiUrl: string | null; notas: string | null; activo: boolean; creadoEn: string;
  licenciaId: string | null; sucursales: number | null; vence: string | null; estadoLicencia: "ACTIVA" | "SUSPENDIDA" | null;
  clavePista: string | null; activada: boolean; activadaEn: string | null; ultimoContacto: string | null; versionApp: string | null;
  sucursalesEnUso: number | null; estado: "VIGENTE" | "POR_VENCER" | "GRACIA" | "VENCIDA" | null;
}
const ESTADOS: Record<string, { t: string; c: string }> = {
  VIGENTE: { t: "Vigente", c: "ok" }, POR_VENCER: { t: "Por vencer", c: "aviso" }, GRACIA: { t: "En gracia", c: "alerta" }, VENCIDA: { t: "Vencida", c: "alerta" },
};
const masUnAno = (desde?: string | null) => {
  const base = desde && new Date(desde) > new Date() ? new Date(`${desde}T12:00:00`) : new Date();
  base.setFullYear(base.getFullYear() + 1);
  return base.toISOString().slice(0, 10);
};
const aSlug = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "").slice(0, 40);
const fecha = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("es-DO", { day: "numeric", month: "short", year: "numeric" });
const hace = (iso: string | null) => {
  if (!iso) return "nunca";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  return m < 60 ? `hace ${Math.max(m, 1)} min` : m < 2880 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} días`;
};

export function Portal() {
  const { datos, recargar, error } = useDatos<Cliente[]>("/central/portal/clientes");
  const [nuevo, setNuevo] = useState(false);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [clave, setClave] = useState<{ cliente: string; clave: string } | null>(null);
  const [buscar, setBuscar] = useState("");
  const lista = (datos ?? []).filter((c) => !buscar || `${c.nombre} ${c.slug} ${c.rnc ?? ""}`.toLowerCase().includes(buscar.toLowerCase()));
  const porVencer = (datos ?? []).filter((c) => c.estado && c.estado !== "VIGENTE").length;

  return (
    <>
      <Encabezado titulo="Clientes y licencias"
        descripcion="Cada cliente instala su propio FactPOS con su propia nube. Aquí solo se manejan sus licencias; sus datos nunca pasan por el portal.">
        <button className="boton primario" onClick={() => setNuevo(!nuevo)}>Nuevo cliente</button>
      </Encabezado>
      <Aviso texto={error} />
      {clave && <ClaveMostrada {...clave} onCerrar={() => setClave(null)} />}
      {nuevo && <NuevoCliente onCerrar={() => setNuevo(false)} onCreado={(c) => { setNuevo(false); setClave(c); recargar(); }} />}

      <div className="fila-acciones" style={{ marginBottom: 10 }}>
        <input placeholder="Buscar cliente…" value={buscar} onChange={(e) => setBuscar(e.target.value)} style={{ maxWidth: 280 }} />
        <span className="flex" />
        <span className="suave pequeno">{datos?.length ?? 0} cliente(s){porVencer ? ` · ${porVencer} requieren atención` : ""}</span>
      </div>

      <div className="tabla-contenedor">
        <table className="tabla">
          <thead><tr><th>Cliente</th><th>Administración web</th><th>Licencia</th><th className="der">Sucursales</th><th>Instalación</th><th></th></tr></thead>
          <tbody>
            {lista.map((c) => (
              <Fragment key={c.id}>
                <tr className={c.activo ? "" : "inactiva"}>
                  <td><b>{c.nombre}</b><div className="suave pequeno">{[c.rnc && `RNC ${c.rnc}`, c.contacto, c.telefono].filter(Boolean).join(" · ")}</div></td>
                  <td>
                    <a href={`/${c.slug}/`} target="_blank" rel="noreferrer" className="mono">/{c.slug}/</a>
                    {!c.apiUrl && <div className="texto-alerta pequeno">Falta la dirección de su nube</div>}
                  </td>
                  <td>
                    {c.estadoLicencia === "SUSPENDIDA" ? <span className="pastilla alerta">Suspendida</span>
                      : c.estado ? <span className={`pastilla ${ESTADOS[c.estado].c}`}>{ESTADOS[c.estado].t}</span> : "—"}
                    {c.vence && <div className="suave pequeno">Vence {fecha(c.vence)}</div>}
                  </td>
                  <td className="der">{c.sucursalesEnUso ?? "—"} / {c.sucursales ?? "—"}</td>
                  <td>
                    {c.activada ? <>Activada<div className="suave pequeno">Último contacto {hace(c.ultimoContacto)}{c.versionApp ? ` · v${c.versionApp}` : ""}</div></>
                      : <span className="suave">Sin activar{c.clavePista ? ` (clave …${c.clavePista})` : ""}</span>}
                  </td>
                  <td className="der"><button className="enlace" onClick={() => setAbierto(abierto === c.id ? null : c.id)}>{abierto === c.id ? "Cerrar" : "Administrar"}</button></td>
                </tr>
                {abierto === c.id && (
                  <tr><td colSpan={6} className="detalle-cliente"><DetalleCliente c={c} onCambio={recargar} onClave={(k) => setClave({ cliente: c.nombre, clave: k })} /></td></tr>
                )}
              </Fragment>
            ))}
            {!lista.length && <tr><td colSpan={6} className="suave">{datos ? "Todavía no hay clientes. Cree el primero con «Nuevo cliente»." : "Cargando…"}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ClaveMostrada({ cliente, clave, onCerrar }: { cliente: string; clave: string; onCerrar: () => void }) {
  return (
    <div className="panel clave-activacion">
      <div className="encabezado-sub"><h3>Clave de activación de {cliente}</h3><button className="enlace" onClick={onCerrar}>Ya la copié</button></div>
      <div className="mono codigo-grande">{clave}</div>
      <p className="suave pequeno">
        Entréguela al cliente: la escribe en su administración › Licencia › Activar. <b>Cópiela ahora: por seguridad no se vuelve a mostrar</b>
        {" "}(si se pierde, genere otra). <button className="enlace" onClick={() => navigator.clipboard?.writeText(clave)}>Copiar</button>
      </p>
    </div>
  );
}

function NuevoCliente({ onCerrar, onCreado }: { onCerrar: () => void; onCreado: (c: { cliente: string; clave: string }) => void }) {
  const [c, setC] = useState({ nombre: "", slug: "", rnc: "", contacto: "", correo: "", telefono: "", apiUrl: "" });
  const [slugTocado, setSlugTocado] = useState(false);
  const [l, setL] = useState({ sucursales: 1, vence: masUnAno() });
  const [msg, setMsg] = useState("");
  const set = (k: keyof typeof c, v: string) => setC((x) => ({ ...x, [k]: v, ...(k === "nombre" && !slugTocado ? { slug: aSlug(v) } : {}) }));
  const crear = async () => {
    setMsg("");
    try {
      const r = await api<{ clave: string }>("/central/portal/clientes", {
        cuerpo: { cliente: { ...c, rnc: c.rnc || null, apiUrl: c.apiUrl || null, contacto: c.contacto || null, correo: c.correo || null, telefono: c.telefono || null },
          licencia: { sucursales: l.sucursales, vence: l.vence } },
      });
      onCreado({ cliente: c.nombre, clave: r.clave });
    } catch (e) { setMsg((e as Error).message); }
  };
  return (
    <div className="panel">
      <div className="encabezado-sub"><h3>Nuevo cliente</h3><button className="enlace" onClick={onCerrar}>Cancelar</button></div>
      <div className="tres-col">
        <label className="campo"><span>Nombre de la empresa</span><input autoFocus value={c.nombre} onChange={(e) => set("nombre", e.target.value)} placeholder="Royal Liquor Store" /></label>
        <label className="campo"><span>Nombre corto (su dirección)</span>
          <input className="mono" value={c.slug} onChange={(e) => { setSlugTocado(true); set("slug", aSlug(e.target.value)); }} placeholder="royalliquorstore" />
        </label>
        <label className="campo"><span>RNC</span><input value={c.rnc} inputMode="numeric" onChange={(e) => set("rnc", e.target.value.replace(/\D/g, ""))} /></label>
        <label className="campo"><span>Persona de contacto</span><input value={c.contacto} onChange={(e) => set("contacto", e.target.value)} /></label>
        <label className="campo"><span>Correo</span><input value={c.correo} onChange={(e) => set("correo", e.target.value)} /></label>
        <label className="campo"><span>Teléfono</span><input value={c.telefono} onChange={(e) => set("telefono", e.target.value)} /></label>
      </div>
      <p className="suave pequeno">Su administración web quedará en <b className="mono">{location.origin}/{c.slug || "nombrecorto"}/</b></p>
      <label className="campo"><span>Dirección de la API de su nube (se puede poner después)</span>
        <input value={c.apiUrl} onChange={(e) => set("apiUrl", e.target.value.trim())} placeholder="https://royalliquorstore-api.vercel.app" />
      </label>
      <h4>Licencia</h4>
      <div className="tres-col">
        <label className="campo"><span>Sucursales permitidas</span><input type="number" min={1} max={999} value={l.sucursales} onChange={(e) => setL({ ...l, sucursales: Math.max(1, Number(e.target.value) || 1) })} /></label>
        <label className="campo"><span>Vence</span><input type="date" value={l.vence} onChange={(e) => setL({ ...l, vence: e.target.value })} /></label>
      </div>
      <div className="fila-acciones"><span className="flex" />
        <button className="boton primario" disabled={c.nombre.trim().length < 2 || c.slug.length < 3 || !l.vence} onClick={crear}>Crear cliente y su licencia</button>
      </div>
      <Aviso texto={msg} />
    </div>
  );
}

function DetalleCliente({ c, onCambio, onClave }: { c: Cliente; onCambio: () => void; onClave: (k: string) => void }) {
  const [l, setL] = useState({ sucursales: c.sucursales ?? 1, vence: c.vence ?? masUnAno(), estado: c.estadoLicencia ?? "ACTIVA" });
  const [api_, setApi] = useState(c.apiUrl ?? "");
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" } | null>(null);
  const eventos = useDatos<{ tipo: string; detalle: unknown; creadoEn: string; usuario: string | null }[]>(`/central/portal/clientes/${c.id}/eventos`);
  const hacer = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try { await fn(); setMsg({ t: ok, tipo: "ok" }); onCambio(); eventos.recargar(); } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
  };
  return (
    <div className="detalle-grid">
      <div>
        <h4>Licencia</h4>
        <div className="tres-col">
          <label className="campo"><span>Sucursales</span><input type="number" min={1} value={l.sucursales} onChange={(e) => setL({ ...l, sucursales: Math.max(1, Number(e.target.value) || 1) })} /></label>
          <label className="campo"><span>Vence</span><input type="date" value={l.vence} onChange={(e) => setL({ ...l, vence: e.target.value })} /></label>
          <label className="campo"><span>Estado</span>
            <select value={l.estado} onChange={(e) => setL({ ...l, estado: e.target.value as "ACTIVA" | "SUSPENDIDA" })}>
              <option value="ACTIVA">Activa</option><option value="SUSPENDIDA">Suspendida</option>
            </select>
          </label>
        </div>
        <div className="fila-acciones" style={{ flexWrap: "wrap" }}>
          <button className="boton" onClick={() => setL({ ...l, vence: masUnAno(l.vence) })}>+1 año</button>
          <span className="flex" />
          <button className="boton primario" onClick={() => hacer(() => api(`/central/portal/clientes/${c.id}/licencia`, { metodo: "PUT", cuerpo: l }), "Licencia guardada. El cliente la recibe sola en su próxima actualización (máx. 12 h) o al pulsar «Actualizar ahora».")}>Guardar licencia</button>
        </div>
        <h4>Su nube</h4>
        <div className="en-linea">
          <input value={api_} onChange={(e) => setApi(e.target.value.trim())} placeholder="https://cliente-api.vercel.app" />
          <button className="boton" onClick={() => hacer(() => api(`/central/portal/clientes/${c.id}`, { metodo: "PUT", cuerpo: { apiUrl: api_ || null } }), "Dirección guardada")}>Guardar</button>
        </div>
        <div className="fila-acciones" style={{ flexWrap: "wrap", marginTop: 12 }}>
          <button className="enlace" onClick={async () => {
            if (!confirm(`¿Generar una clave de activación nueva para ${c.nombre}? La anterior deja de servir.`)) return;
            await hacer(async () => onClave((await api<{ clave: string }>(`/central/portal/clientes/${c.id}/clave`, { cuerpo: {} })).clave), "Clave nueva generada");
          }}>Clave de activación nueva</button>
          {c.activada && <button className="enlace" onClick={() => confirm(`¿Liberar la licencia de ${c.nombre}? Su nube actual deja de recibir renovaciones hasta que se active de nuevo.`)
            && hacer(() => api(`/central/portal/clientes/${c.id}/liberar`, { cuerpo: {} }), "Licencia liberada: se puede activar en otra nube")}>Liberar instalación</button>}
          <button className="enlace" onClick={() => hacer(() => api(`/central/portal/clientes/${c.id}`, { metodo: "PUT", cuerpo: { activo: !c.activo } }), c.activo ? "Cliente desactivado" : "Cliente activado")}>
            {c.activo ? "Desactivar cliente" : "Activar cliente"}
          </button>
        </div>
        {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}
      </div>
      <div>
        <h4>Historial</h4>
        <ul className="historial-licencia">
          {(eventos.datos ?? []).map((e, i) => (
            <li key={i}><b>{e.tipo.replace(/_/g, " ").toLowerCase()}</b> <span className="suave pequeno">{new Date(e.creadoEn).toLocaleString("es-DO")}{e.usuario ? ` · ${e.usuario}` : ""}</span></li>
          ))}
          {eventos.datos && !eventos.datos.length && <li className="suave">Sin movimientos</li>}
        </ul>
      </div>
    </div>
  );
}
