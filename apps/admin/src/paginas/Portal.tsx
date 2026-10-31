import { Fragment, useState } from "react";
import { api } from "../api";
import { Aviso, Encabezado, Kpi, useDatos } from "../ui";

/**
 * PORTAL DEL PROVEEDOR · Clientes y licencias.
 * Cada cliente tiene su propia nube; aquí solo se maneja su licencia y la
 * dirección de su administración web (portal/<nombre-corto>/).
 */
interface Cliente {
  id: string; slug: string; nombre: string; rnc: string | null; contacto: string | null; correo: string | null; telefono: string | null;
  apiUrl: string | null; notas: string | null; activo: boolean; creadoEn: string; tunelHost: string | null;
  licenciaId: string | null; sucursales: number | null; vence: string | null; estadoLicencia: "ACTIVA" | "SUSPENDIDA" | null;
  clavePista: string | null; activada: boolean; activadaEn: string | null; ultimoContacto: string | null; versionApp: string | null;
  sucursalesEnUso: number | null; estado: "VIGENTE" | "POR_VENCER" | "GRACIA" | "VENCIDA" | null;
  planId: string | null; plan: string | null; precioEspecial: string | null; periodo: "MENSUAL" | "ANUAL" | null; precioSucursal: number | null;
}
interface Plan {
  id: string; codigo: string; nombre: string; descripcion: string | null; precioSucursal: number; periodo: "MENSUAL" | "ANUAL";
  sucursalesIncluidas: number; modulos: string[]; permiteActualizaciones: boolean; activo: boolean; orden: number; clientes: number;
}
interface Reglas { pruebaActualiza: boolean; contactoNombre: string | null; contactoTelefono: string | null; contactoWhatsapp: string | null; contactoCorreo: string | null }
const rd = (n: number) => `RD$ ${n.toLocaleString("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** Fecha de vencimiento tras sumar meses (desde hoy o desde el vencimiento si aún no pasa). */
const masMeses = (meses: number, desde?: string | null) => {
  const base = desde && new Date(`${desde}T12:00:00`) > new Date() ? new Date(`${desde}T12:00:00`) : new Date();
  base.setMonth(base.getMonth() + meses);
  return base.toISOString().slice(0, 10);
};
const mesesDe = (p: "MENSUAL" | "ANUAL" | null | undefined) => (p === "MENSUAL" ? 1 : 12);
const ESTADOS: Record<string, { t: string; c: string }> = {
  VIGENTE: { t: "Vigente", c: "ok" }, POR_VENCER: { t: "Por vencer", c: "aviso" }, GRACIA: { t: "En gracia", c: "alerta" }, VENCIDA: { t: "Vencida", c: "alerta" },
};
const masUnAno = (desde?: string | null) => masMeses(12, desde);
const aSlug = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "").slice(0, 40);
const fecha = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("es-DO", { day: "numeric", month: "short", year: "numeric" });
const hace = (iso: string | null) => {
  if (!iso) return "nunca";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  return m < 60 ? `hace ${Math.max(m, 1)} min` : m < 2880 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} días`;
};

type Vista = "clientes" | "planes" | "reglas";
type Filtro = "todos" | "atencion" | "vigentes" | "sin_activar" | "suspendidos";

export function Portal() {
  const [vista, setVista] = useState<Vista>("clientes");
  const planes = useDatos<Plan[]>("/central/portal/planes");
  return (
    <>
      <Encabezado titulo="Clientes y licencias"
        descripcion="Cada cliente instala su propio FactPOS con su propia nube. Aquí se manejan sus planes, licencias y cobros; sus datos nunca pasan por el portal." />
      <div className="pestanas">
        {([["clientes", "Clientes"], ["planes", "Planes y precios"], ["reglas", "Reglas y contacto"]] as const).map(([v, t]) => (
          <button key={v} className={vista === v ? "activa" : ""} onClick={() => setVista(v)}>{t}</button>
        ))}
      </div>
      {vista === "clientes" && <Clientes planes={planes.datos ?? []} />}
      {vista === "planes" && <Planes planes={planes.datos ?? []} recargar={planes.recargar} />}
      {vista === "reglas" && <ReglasPortal />}
    </>
  );
}

/** Estado "de negocio" de un cliente, para los filtros y las cifras. */
const situacion = (c: Cliente): Exclude<Filtro, "todos" | "atencion"> | "vencidos" | "por_vencer" => {
  if (!c.activo || c.estadoLicencia === "SUSPENDIDA") return "suspendidos";
  if (!c.activada) return "sin_activar";
  if (c.estado === "VENCIDA" || c.estado === "GRACIA") return "vencidos";
  if (c.estado === "POR_VENCER") return "por_vencer";
  return "vigentes";
};
const sinContacto = (c: Cliente) => c.activada && (!c.ultimoContacto || Date.now() - new Date(c.ultimoContacto).getTime() > 3 * 86_400_000);

function Clientes({ planes }: { planes: Plan[] }) {
  const { datos, recargar, error } = useDatos<Cliente[]>("/central/portal/clientes");
  const [nuevo, setNuevo] = useState(false);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [clave, setClave] = useState<{ cliente: string; clave: string } | null>(null);
  const [buscar, setBuscar] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const todos = datos ?? [];
  const cuenta = (f: (c: Cliente) => boolean) => todos.filter(f).length;
  const atencion = (c: Cliente) => ["vencidos", "por_vencer", "sin_activar"].includes(situacion(c)) || sinContacto(c);
  const ingresoMensual = todos.filter((c) => situacion(c) !== "suspendidos" && c.precioSucursal && c.sucursales)
    .reduce((t, c) => t + (c.precioSucursal! * c.sucursales!) / mesesDe(c.periodo), 0);
  const lista = todos
    .filter((c) => !buscar || `${c.nombre} ${c.slug} ${c.rnc ?? ""}`.toLowerCase().includes(buscar.toLowerCase()))
    .filter((c) => filtro === "todos" ? true : filtro === "atencion" ? atencion(c) : filtro === "vigentes" ? situacion(c) === "vigentes" : situacion(c) === filtro);

  return (
    <>
      <div className="fila-acciones" style={{ marginBottom: 12 }}>
        <input placeholder="Buscar cliente…" value={buscar} onChange={(e) => setBuscar(e.target.value)} style={{ maxWidth: 280 }} />
        <span className="flex" />
        <button className="boton primario" onClick={() => setNuevo(!nuevo)}>Nuevo cliente</button>
      </div>
      <Aviso texto={error} />
      {clave && <ClaveMostrada {...clave} onCerrar={() => setClave(null)} />}
      {nuevo && <NuevoCliente planes={planes} onCerrar={() => setNuevo(false)} onCreado={(c) => { setNuevo(false); setClave(c); recargar(); }} />}

      <div className="kpis" style={{ marginBottom: 14 }}>
        <Kpi titulo="Clientes" valor={String(todos.length)} detalle={`${cuenta((c) => situacion(c) === "vigentes")} con licencia vigente`} icono="clientes" />
        <Kpi titulo="Requieren atención" valor={String(cuenta(atencion))} tono={cuenta(atencion) ? "alerta" : "ok"} detalle="Por vencer, vencidos, sin activar o sin contacto" icono="incidentes" />
        <Kpi titulo="Ingreso estimado / mes" valor={rd(ingresoMensual)} detalle="Precio × sucursales de las licencias activas" icono="caja" />
      </div>

      <div className="chips-filtro">
        {([["todos", "Todos", todos.length], ["atencion", "Atención", cuenta(atencion)], ["vigentes", "Vigentes", cuenta((c) => situacion(c) === "vigentes")],
          ["sin_activar", "Sin activar", cuenta((c) => situacion(c) === "sin_activar")], ["suspendidos", "Suspendidos", cuenta((c) => situacion(c) === "suspendidos")]] as const).map(([f, t, n]) => (
          <button key={f} className={filtro === f ? "activo" : ""} onClick={() => setFiltro(f)}>{t} <span>{n}</span></button>
        ))}
      </div>

      <div className="tabla-contenedor">
        <table className="tabla">
          <thead><tr><th>Cliente</th><th>Plan</th><th>Licencia</th><th>Sucursales</th><th>Instalación</th><th></th></tr></thead>
          <tbody>
            {lista.map((c) => (
              <Fragment key={c.id}>
                <tr className={c.activo ? "" : "inactiva"}>
                  <td>
                    <b>{c.nombre}</b>
                    <div className="suave pequeno">{[c.rnc && `RNC ${c.rnc}`, c.contacto, c.telefono].filter(Boolean).join(" · ")}</div>
                    <a href={`/${c.slug}/`} target="_blank" rel="noreferrer" className="mono pequeno">/{c.slug}/</a>
                    {!c.apiUrl && <div className="texto-alerta pequeno">Su servidor principal todavía no se conectó</div>}
                  </td>
                  <td>{c.plan ?? <span className="suave">Sin plan</span>}
                    {c.precioSucursal != null && c.sucursales ? <div className="suave pequeno">{rd(c.precioSucursal * c.sucursales)} / {c.periodo === "MENSUAL" ? "mes" : "año"}{c.precioEspecial != null ? " · precio especial" : ""}</div> : null}</td>
                  <td>
                    {c.estadoLicencia === "SUSPENDIDA" ? <span className="pastilla alerta">Suspendida</span>
                      : c.estado ? <span className={`pastilla ${ESTADOS[c.estado].c}`}>{ESTADOS[c.estado].t}</span> : "—"}
                    {c.vence && <div className="suave pequeno">Vence {fecha(c.vence)}</div>}
                  </td>
                  <td><Uso en={c.sucursalesEnUso} max={c.sucursales} /></td>
                  <td>
                    {c.activada
                      ? <>Activada<div className={"pequeno " + (sinContacto(c) ? "texto-alerta" : "suave")}>Contacto {hace(c.ultimoContacto)}{c.versionApp ? ` · v${c.versionApp}` : ""}</div></>
                      : <span className="suave">Sin activar{c.clavePista ? ` (clave …${c.clavePista})` : ""}</span>}
                  </td>
                  <td className="der"><button className="enlace" onClick={() => setAbierto(abierto === c.id ? null : c.id)}>{abierto === c.id ? "Cerrar" : "Administrar"}</button></td>
                </tr>
                {abierto === c.id && (
                  <tr><td colSpan={6} className="detalle-cliente"><DetalleCliente key={`${c.vence}${c.sucursales}${c.planId}${c.estadoLicencia}`} c={c} planes={planes} onCambio={recargar} onClave={(k) => setClave({ cliente: c.nombre, clave: k })} /></td></tr>
                )}
              </Fragment>
            ))}
            {!lista.length && <tr><td colSpan={6} className="suave">{datos ? (todos.length ? "Ningún cliente coincide con el filtro." : "Todavía no hay clientes. Cree el primero con «Nuevo cliente».") : "Cargando…"}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Uso({ en, max }: { en: number | null; max: number | null }) {
  if (max == null) return <>—</>;
  const pct = Math.min(100, Math.round(((en ?? 0) / max) * 100));
  return (
    <div className="uso-barra" title={`${en ?? 0} de ${max} sucursales en uso`}>
      <span>{en ?? "—"} / {max}</span>
      <i><b className={(en ?? 0) > max ? "excedido" : ""} style={{ width: `${pct}%` }} /></i>
    </div>
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

function NuevoCliente({ planes, onCerrar, onCreado }: { planes: Plan[]; onCerrar: () => void; onCreado: (c: { cliente: string; clave: string }) => void }) {
  const activos = planes.filter((p) => p.activo);
  const [c, setC] = useState({ nombre: "", slug: "", rnc: "", contacto: "", correo: "", telefono: "", apiUrl: "" });
  const [slugTocado, setSlugTocado] = useState(false);
  const [planId, setPlanId] = useState(activos[0]?.id ?? "");
  const plan = activos.find((p) => p.id === planId);
  const [l, setL] = useState({ sucursales: activos[0]?.sucursalesIncluidas ?? 1, vence: masMeses(mesesDe(activos[0]?.periodo)) });
  const [msg, setMsg] = useState("");
  const set = (k: keyof typeof c, v: string) => setC((x) => ({ ...x, [k]: v, ...(k === "nombre" && !slugTocado ? { slug: aSlug(v) } : {}) }));
  const elegirPlan = (id: string) => {
    setPlanId(id);
    const p = activos.find((x) => x.id === id);
    if (p) setL({ sucursales: p.sucursalesIncluidas, vence: masMeses(mesesDe(p.periodo)) });
  };
  const crear = async () => {
    setMsg("");
    try {
      const r = await api<{ clave: string }>("/central/portal/clientes", {
        cuerpo: { cliente: { ...c, rnc: c.rnc || null, apiUrl: c.apiUrl || null, contacto: c.contacto || null, correo: c.correo || null, telefono: c.telefono || null },
          licencia: { sucursales: l.sucursales, vence: l.vence, planId: planId || null, modulos: plan?.modulos ?? [] } },
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
      <label className="campo"><span>Dirección de su servidor (déjela vacía: el servidor principal la informa solo)</span>
        <input value={c.apiUrl} onChange={(e) => set("apiUrl", e.target.value.trim())} placeholder="https://royalliquorstore-api.vercel.app" />
      </label>
      <h4>Plan y licencia</h4>
      <div className="tres-col">
        <label className="campo"><span>Plan</span>
          <select value={planId} onChange={(e) => elegirPlan(e.target.value)}>
            <option value="">Sin plan (a medida)</option>
            {activos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select></label>
        <label className="campo"><span>Sucursales permitidas</span><input type="number" min={1} max={999} value={l.sucursales} onChange={(e) => setL({ ...l, sucursales: Math.max(1, Number(e.target.value) || 1) })} /></label>
        <label className="campo"><span>Vence</span><input type="date" value={l.vence} onChange={(e) => setL({ ...l, vence: e.target.value })} /></label>
      </div>
      {plan && plan.precioSucursal > 0 && (
        <p className="suave pequeno">Cobro: {l.sucursales} × {rd(plan.precioSucursal)} = <b>{rd(l.sucursales * plan.precioSucursal)}</b> por {plan.periodo === "MENSUAL" ? "mes" : "año"}.</p>
      )}
      <div className="fila-acciones"><span className="flex" />
        <button className="boton primario" disabled={c.nombre.trim().length < 2 || c.slug.length < 3 || !l.vence} onClick={crear}>Crear cliente y su licencia</button>
      </div>
      <Aviso texto={msg} />
    </div>
  );
}

const EVENTOS: Record<string, string> = {
  CREADA: "Licencia creada", RENOVADA: "Renovada", ACTIVADA: "Activada por el cliente", LIBERADA: "Instalación liberada", SUSPENDIDA: "Suspendida",
  CLAVE_NUEVA: "Clave de activación nueva", CONTACTO_RECHAZADO: "Contacto rechazado", TUNEL_FIJO: "Dirección fija creada", PRUEBA_DESCARGA: "Descarga en prueba", REGLAS: "Reglas cambiadas",
};

function DetalleCliente({ c, planes, onCambio, onClave }: { c: Cliente; planes: Plan[]; onCambio: () => void; onClave: (k: string) => void }) {
  const [l, setL] = useState({ sucursales: c.sucursales ?? 1, vence: c.vence ?? masUnAno(), estado: c.estadoLicencia ?? "ACTIVA", planId: c.planId ?? "", precio: c.precioEspecial ?? "" });
  const plan = planes.find((p) => p.id === l.planId);
  const precio = l.precio !== "" ? Number(l.precio) : plan?.precioSucursal ?? 0;
  const periodo = plan?.periodo ?? c.periodo ?? "ANUAL";
  const [ren, setRen] = useState({ meses: mesesDe(periodo), monto: "", referencia: "" });
  const montoSugerido = precio * l.sucursales * (ren.meses / mesesDe(periodo));
  const [api_, setApi] = useState(c.apiUrl ?? "");
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" } | null>(null);
  const eventos = useDatos<{ tipo: string; detalle: Record<string, unknown> | null; creadoEn: string; usuario: string | null }[]>(`/central/portal/clientes/${c.id}/eventos`);
  const hacer = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try { await fn(); setMsg({ t: ok, tipo: "ok" }); onCambio(); eventos.recargar(); } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
  };
  const elegirPlan = (id: string) => {
    const p = planes.find((x) => x.id === id);
    setL({ ...l, planId: id, ...(p && !c.planId ? { sucursales: Math.max(l.sucursales, p.sucursalesIncluidas) } : {}) });
  };
  return (
    <div className="detalle-grid">
      <div>
        <h4>Renovar</h4>
        <div className="panel renovar">
          <div className="tres-col">
            <label className="campo"><span>Período</span>
              <select value={ren.meses} onChange={(e) => setRen({ ...ren, meses: Number(e.target.value) })}>
                {[1, 3, 6, 12, 24].map((m) => <option key={m} value={m}>{m === 12 ? "1 año" : m === 24 ? "2 años" : `${m} mes${m > 1 ? "es" : ""}`}</option>)}
              </select></label>
            <label className="campo"><span>Monto cobrado (RD$)</span>
              <input className="numero" inputMode="decimal" value={ren.monto} placeholder={montoSugerido ? montoSugerido.toFixed(2) : "0.00"} onChange={(e) => setRen({ ...ren, monto: e.target.value.replace(/[^\d.]/g, "") })} /></label>
            <label className="campo"><span>Referencia (factura, transferencia…)</span><input value={ren.referencia} onChange={(e) => setRen({ ...ren, referencia: e.target.value })} /></label>
          </div>
          <div className="fila-acciones">
            <span className="suave pequeno">Nuevo vencimiento: <b>{fecha(masMeses(ren.meses, c.vence))}</b></span><span className="flex" />
            <button className="boton primario" onClick={() => hacer(() => api(`/central/portal/clientes/${c.id}/renovar`, {
              cuerpo: { meses: ren.meses, monto: ren.monto !== "" ? Number(ren.monto) : montoSugerido || null, referencia: ren.referencia || null } }), "Renovada. El cliente recibe la licencia nueva sola (máx. 12 h) o al pulsar «Actualizar ahora».")}>Registrar renovación</button>
          </div>
        </div>

        <h4>Plan y licencia</h4>
        <div className="tres-col">
          <label className="campo"><span>Plan</span>
            <select value={l.planId} onChange={(e) => elegirPlan(e.target.value)}>
              <option value="">Sin plan (a medida)</option>
              {planes.filter((p) => p.activo || p.id === l.planId).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select></label>
          <label className="campo"><span>Sucursales</span><input type="number" min={1} value={l.sucursales} onChange={(e) => setL({ ...l, sucursales: Math.max(1, Number(e.target.value) || 1) })} /></label>
          <label className="campo"><span>Precio por sucursal (RD$)</span>
            <input className="numero" inputMode="decimal" value={l.precio} placeholder={plan ? `${plan.precioSucursal.toFixed(2)} (del plan)` : "0.00"} onChange={(e) => setL({ ...l, precio: e.target.value.replace(/[^\d.]/g, "") })} /></label>
          <label className="campo"><span>Vence</span><input type="date" value={l.vence} onChange={(e) => setL({ ...l, vence: e.target.value })} /></label>
          <label className="campo"><span>Estado</span>
            <select value={l.estado} onChange={(e) => setL({ ...l, estado: e.target.value as "ACTIVA" | "SUSPENDIDA" })}>
              <option value="ACTIVA">Activa</option><option value="SUSPENDIDA">Suspendida (deja de renovar y de descargar)</option>
            </select></label>
        </div>
        {precio > 0 && <p className="suave pequeno">Cobro: {l.sucursales} × {rd(precio)} = <b>{rd(precio * l.sucursales)}</b> por {periodo === "MENSUAL" ? "mes" : "año"}.</p>}
        <div className="fila-acciones" style={{ flexWrap: "wrap" }}>
          <span className="flex" />
          <button className="boton" onClick={() => hacer(() => api(`/central/portal/clientes/${c.id}/licencia`, { metodo: "PUT", cuerpo: {
            sucursales: l.sucursales, vence: l.vence, estado: l.estado, modulos: plan?.modulos ?? [], planId: l.planId || null, precioSucursal: l.precio !== "" ? Number(l.precio) : null } }),
            "Licencia guardada. El cliente la recibe sola en su próxima actualización (máx. 12 h) o al pulsar «Actualizar ahora».")}>Guardar cambios</button>
        </div>
        <h4>Su servidor (dirección)</h4>
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
            <li key={i}>
              <b>{EVENTOS[e.tipo] ?? e.tipo.replace(/_/g, " ").toLowerCase()}</b>
              {e.tipo === "RENOVADA" && e.detalle?.meses ? <span> · {String(e.detalle.meses)} mes(es){e.detalle.monto ? ` · ${rd(Number(e.detalle.monto))}` : ""}{e.detalle.referencia ? ` · ${String(e.detalle.referencia)}` : ""}</span> : null}
              {" "}<span className="suave pequeno">{new Date(e.creadoEn).toLocaleString("es-DO")}{e.usuario ? ` · ${e.usuario}` : ""}</span>
            </li>
          ))}
          {eventos.datos && !eventos.datos.length && <li className="suave">Sin movimientos</li>}
        </ul>
      </div>
    </div>
  );
}

/* ---------------- Planes ---------------- */
const planVacio = { id: "", codigo: "", nombre: "", descripcion: "", precioSucursal: 0, periodo: "ANUAL" as const, sucursalesIncluidas: 1, modulos: [] as string[], permiteActualizaciones: true, activo: true, orden: 0 };

function Planes({ planes, recargar }: { planes: Plan[]; recargar: () => void }) {
  const [edit, setEdit] = useState<(Omit<Plan, "id" | "clientes" | "descripcion"> & { id: string; descripcion: string | null }) | null>(null);
  const [msg, setMsg] = useState("");
  const guardar = async () => {
    if (!edit) return;
    setMsg("");
    try {
      const { id, ...cuerpo } = edit;
      await api(id ? `/central/portal/planes/${id}` : "/central/portal/planes", { metodo: id ? "PUT" : "POST", cuerpo });
      setEdit(null); recargar();
    } catch (e) { setMsg((e as Error).message); }
  };
  return (
    <>
      <div className="fila-acciones" style={{ marginBottom: 12 }}>
        <span className="suave pequeno" style={{ maxWidth: 640 }}>
          El plan define el precio por sucursal, cuántas sucursales incluye y si trae actualizaciones. Se cobra <b>precio × sucursales</b> por el período del plan;
          a un cliente se le puede poner un precio especial desde su ficha.
        </span>
        <span className="flex" />
        <button className="boton primario" onClick={() => setEdit({ ...planVacio, orden: planes.length + 1 })}>Nuevo plan</button>
      </div>
      {edit && (
        <div className="panel">
          <div className="encabezado-sub"><h3>{edit.id ? "Editar plan" : "Nuevo plan"}</h3><button className="enlace" onClick={() => setEdit(null)}>Cancelar</button></div>
          <div className="tres-col">
            <label className="campo"><span>Nombre</span><input autoFocus value={edit.nombre} onChange={(e) => setEdit({ ...edit, nombre: e.target.value, ...(!edit.id ? { codigo: aSlug(e.target.value).slice(0, 30) } : {}) })} /></label>
            <label className="campo"><span>Código</span><input className="mono" value={edit.codigo} onChange={(e) => setEdit({ ...edit, codigo: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })} /></label>
            <label className="campo"><span>Orden</span><input type="number" min={0} value={edit.orden} onChange={(e) => setEdit({ ...edit, orden: Number(e.target.value) || 0 })} /></label>
            <label className="campo"><span>Precio por sucursal (RD$)</span><input className="numero" inputMode="decimal" value={edit.precioSucursal || ""} placeholder="0.00" onChange={(e) => setEdit({ ...edit, precioSucursal: Number(e.target.value.replace(/[^\d.]/g, "")) || 0 })} /></label>
            <label className="campo"><span>Se cobra</span>
              <select value={edit.periodo} onChange={(e) => setEdit({ ...edit, periodo: e.target.value as "MENSUAL" | "ANUAL" })}><option value="ANUAL">Por año</option><option value="MENSUAL">Por mes</option></select></label>
            <label className="campo"><span>Sucursales incluidas por defecto</span><input type="number" min={1} value={edit.sucursalesIncluidas} onChange={(e) => setEdit({ ...edit, sucursalesIncluidas: Math.max(1, Number(e.target.value) || 1) })} /></label>
          </div>
          <label className="campo"><span>Descripción (la ve usted al elegir el plan)</span><input value={edit.descripcion ?? ""} onChange={(e) => setEdit({ ...edit, descripcion: e.target.value })} /></label>
          <div className="reglas">
            <label className="regla"><input type="checkbox" checked={edit.permiteActualizaciones} onChange={(e) => setEdit({ ...edit, permiteActualizaciones: e.target.checked })} /><span><b>Incluye actualizaciones</b><small>Puede descargar versiones nuevas desde su panel de Actualizaciones.</small></span></label>
            <label className="regla"><input type="checkbox" checked={edit.activo} onChange={(e) => setEdit({ ...edit, activo: e.target.checked })} /><span><b>Disponible para vender</b><small>Si lo desactiva, no aparece al crear clientes; los que ya lo tienen lo conservan.</small></span></label>
          </div>
          <div className="fila-acciones"><span className="flex" /><button className="boton primario" disabled={edit.nombre.trim().length < 2 || edit.codigo.length < 2} onClick={guardar}>Guardar plan</button></div>
          <Aviso texto={msg} />
        </div>
      )}
      <div className="tabla-contenedor">
        <table className="tabla">
          <thead><tr><th>Plan</th><th className="der">Precio por sucursal</th><th>Incluye</th><th className="der">Clientes</th><th></th></tr></thead>
          <tbody>
            {planes.map((p) => (
              <tr key={p.id} className={p.activo ? "" : "inactiva"}>
                <td><b>{p.nombre}</b> <span className="suave mono pequeno">{p.codigo}</span><div className="suave pequeno">{p.descripcion}</div></td>
                <td className="der">{p.precioSucursal > 0 ? <>{rd(p.precioSucursal)}<div className="suave pequeno">por {p.periodo === "MENSUAL" ? "mes" : "año"}</div></> : <span className="texto-aviso">Sin precio</span>}</td>
                <td>{p.sucursalesIncluidas} sucursal(es){p.permiteActualizaciones ? " · con actualizaciones" : " · sin actualizaciones"}{!p.activo && " · no disponible"}</td>
                <td className="der">{p.clientes}</td>
                <td className="der"><button className="enlace" onClick={() => setEdit({ ...p })}>Editar</button></td>
              </tr>
            ))}
            {!planes.length && <tr><td colSpan={5} className="suave">Cargando…</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ---------------- Reglas y contacto ---------------- */
function ReglasPortal() {
  const { datos, recargar, error } = useDatos<Reglas>("/central/portal/reglas");
  const [r, setR] = useState<Reglas | null>(null);
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" } | null>(null);
  const v = r ?? datos;
  if (!v) return <Aviso texto={error} />;
  const set = (p: Partial<Reglas>) => setR({ ...v, ...p });
  const guardar = async () => {
    setMsg(null);
    try { await api("/central/portal/reglas", { metodo: "PUT", cuerpo: v }); setMsg({ t: "Reglas guardadas", tipo: "ok" }); setR(null); recargar(); }
    catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
  };
  return (
    <>
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Versión de prueba</h3>
        <label className="regla" style={{ maxWidth: 640 }}>
          <input type="checkbox" checked={v.pruebaActualiza} onChange={(e) => set({ pruebaActualiza: e.target.checked })} />
          <span><b>Permitir actualizaciones durante la prueba</b>
            <small>Apagado: un cliente que todavía no activó su licencia no puede descargar versiones nuevas y ve «Active la licencia para recibir actualizaciones». Encendido: puede actualizarse desde su panel; se anota cada descarga en el historial.</small></span>
        </label>
        <p className="suave pequeno">
          Fijos en esta versión (van dentro de cada instalación, que funciona sin internet): la prueba dura <b>15 días</b> y permite <b>2 sucursales</b>;
          el aviso de vencimiento sale <b>15 días</b> antes y, al vencer, hay <b>7 días de gracia</b>; después solo se consulta (no se vende ni se borra nada).
        </p>
      </div>
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Contacto que ven sus clientes</h3>
        <p className="suave pequeno">Aparece en la pantalla Licencia de cada cliente, para que sepan a quién llamar para renovar o ampliar.</p>
        <div className="dos-col">
          <label className="campo"><span>Nombre o empresa</span><input value={v.contactoNombre ?? ""} onChange={(e) => set({ contactoNombre: e.target.value })} placeholder="Soporte FactPOS" /></label>
          <label className="campo"><span>Correo</span><input value={v.contactoCorreo ?? ""} onChange={(e) => set({ contactoCorreo: e.target.value })} /></label>
          <label className="campo"><span>Teléfono</span><input value={v.contactoTelefono ?? ""} onChange={(e) => set({ contactoTelefono: e.target.value })} /></label>
          <label className="campo"><span>WhatsApp (con código de país, ej. 18095551234)</span><input value={v.contactoWhatsapp ?? ""} inputMode="numeric" onChange={(e) => set({ contactoWhatsapp: e.target.value.replace(/\D/g, "") })} /></label>
        </div>
      </div>
      <div className="fila-acciones"><span className="flex" /><button className="boton primario" disabled={!r} onClick={guardar}>Guardar reglas</button></div>
      {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}
    </>
  );
}
