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
  respaldoExtraGb?: number; lectorCupo?: number; lectorUsadas?: number; respaldoUsadoBytes?: number; respaldoCopias?: number; lectorHistorial?: { mes: string; usadas: number }[]; planId: string | null; plan: string | null; precioEspecial: string | null; periodo: "MENSUAL" | "ANUAL" | null; precioSucursal: number | null;
}
interface Plan {
  id: string; codigo: string; nombre: string; descripcion: string | null; precioSucursal: number; periodo: "MENSUAL" | "ANUAL";
  sucursalesIncluidas: number; modulos: string[]; permiteActualizaciones: boolean; activo: boolean; orden: number; clientes: number;
}
interface Instalacion {
  id: string; estado: "PENDIENTE" | "ASIGNADA" | "RECHAZADA" | "LIBERADA"; empresa: string | null; rnc: string | null; equipo: string | null; versionApp: string | null;
  sucursalesEnUso: number | null; apiUrl: string | null; solicitadaEn: string; ultimoContacto: string; nota: string | null; clienteId: string | null; cliente: string | null; slug: string | null;
  correo: string | null; telefono: string | null; contacto: string | null; planId: string | null; plan: string | null; sucursalesSolicitadas: number | null; mensaje: string | null;
}
interface Reglas { pruebaActualiza: boolean; plazoHoras: number; contactoNombre: string | null; contactoTelefono: string | null; contactoWhatsapp: string | null; contactoCorreo: string | null }
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

type Vista = "clientes" | "instalaciones" | "invitaciones" | "planes" | "gastos" | "reglas";
type Filtro = "todos" | "atencion" | "vigentes" | "sin_activar" | "suspendidos";

export function Portal() {
  const [vista, setVista] = useState<Vista>("clientes");
  const planes = useDatos<Plan[]>("/central/portal/planes");
  const pendientes = useDatos<Instalacion[]>("/central/portal/instalaciones?estado=PENDIENTE");
  const nPend = pendientes.datos?.length ?? 0;
  return (
    <>
      <Encabezado titulo="Clientes y licencias"
        descripcion="Cada cliente instala su propio FactPOS con su propia nube. Aquí se manejan sus planes, licencias y cobros; sus datos nunca pasan por el portal." />
      <div className="pestanas">
        {([["clientes", "Clientes"], ["instalaciones", "Solicitudes"], ["invitaciones", "Invitaciones"], ["planes", "Planes y precios"], ["gastos", "Gastos y costos"], ["reglas", "Reglas y contacto"]] as const).map(([v, t]) => (
          <button key={v} className={vista === v ? "activa" : ""} onClick={() => { setVista(v); pendientes.recargar(); }}>
            {t}{v === "instalaciones" && nPend > 0 && <span className="insignia">{nPend}</span>}
          </button>
        ))}
      </div>
      {nPend > 0 && vista !== "instalaciones" && (
        <div className="aviso-licencia">
          <span><b>{nPend}</b> solicitud(es) de activación: {pendientes.datos!.slice(0, 3).map((i) => i.empresa || i.equipo || "Sin nombre").join(", ")}{nPend > 3 ? "…" : ""}</span>
          <button className="enlace" onClick={() => setVista("instalaciones")}>Revisar solicitudes</button>
        </div>
      )}
      {vista === "clientes" && <Clientes planes={planes.datos ?? []} />}
      {vista === "instalaciones" && <Instalaciones planes={planes.datos ?? []} onCambio={pendientes.recargar} />}
      {vista === "invitaciones" && <Invitaciones />}
      {vista === "planes" && <Planes planes={planes.datos ?? []} recargar={planes.recargar} />}
      {vista === "gastos" && <Gastos />}
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
        <table className="tabla apilada">
          <thead><tr><th>Cliente</th><th>Plan</th><th>Licencia</th><th>Sucursales</th><th>Instalación</th><th>Consumo</th><th></th></tr></thead>
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
                  <td className="pequeno">
                    <div>Respaldos: {((c.respaldoUsadoBytes ?? 0) / 1024 ** 3).toFixed(2)} / {2 + (c.respaldoExtraGb ?? 0)} GB</div>
                    <div>Facturas IA: {c.lectorUsadas ?? 0} / {c.lectorCupo ?? 0}</div>
                  </td>
                  <td className="der"><button className="enlace" onClick={() => setAbierto(abierto === c.id ? null : c.id)}>{abierto === c.id ? "Cerrar" : "Administrar"}</button></td>
                </tr>
                {abierto === c.id && (
                  <tr><td colSpan={7} className="detalle-cliente"><DetalleCliente key={`${c.vence}${c.sucursales}${c.planId}${c.estadoLicencia}`} c={c} planes={planes} onCambio={recargar} onClave={(k) => setClave({ cliente: c.nombre, clave: k })} /></td></tr>
                )}
              </Fragment>
            ))}
            {!lista.length && <tr><td colSpan={7} className="suave">{datos ? (todos.length ? "Ningún cliente coincide con el filtro." : "Todavía no hay clientes. Cree el primero con «Nuevo cliente».") : "Cargando…"}</td></tr>}
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
  CREADA: "Licencia creada", RENOVADA: "Renovada", ACTIVADA: "Activada por el cliente", LIBERADA: "Instalación liberada", TRASLADO_INICIADO: "Traslado a otro equipo iniciado", TRASLADO_COMPLETADO: "Traslado completado", SUSPENDIDA: "Suspendida",
  SOLICITUD: "Solicitud de activación recibida", SOLICITUD_RECHAZADA: "Solicitud rechazada", CLAVE_NUEVA: "Clave de activación nueva", CONTACTO_RECHAZADO: "Contacto rechazado", TUNEL_FIJO: "Dirección fija creada", PRUEBA_DESCARGA: "Descarga en prueba", REGLAS: "Reglas cambiadas", RESPALDO_ESPACIO: "Espacio de respaldos cambiado", LECTOR_CUPO: "Cupo del lector de facturas cambiado",
};

function DetalleCliente({ c, planes, onCambio, onClave }: { c: Cliente; planes: Plan[]; onCambio: () => void; onClave: (k: string) => void }) {
  const [l, setL] = useState({ sucursales: c.sucursales ?? 1, vence: c.vence ?? masUnAno(), estado: c.estadoLicencia ?? "ACTIVA", planId: c.planId ?? "", precio: c.precioEspecial ?? "" });
  const plan = planes.find((p) => p.id === l.planId);
  const precio = l.precio !== "" ? Number(l.precio) : plan?.precioSucursal ?? 0;
  const periodo = plan?.periodo ?? c.periodo ?? "ANUAL";
  const [ren, setRen] = useState({ meses: mesesDe(periodo), monto: "", referencia: "" });
  const montoSugerido = precio * l.sucursales * (ren.meses / mesesDe(periodo));
  const [api_, setApi] = useState(c.apiUrl ?? "");
  const [extraGb, setExtraGb] = useState(String(c.respaldoExtraGb ?? 0));
  const [cupoLector, setCupoLector] = useState(String(c.lectorCupo ?? 0));
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
        <h4>Consumo</h4>
        <table className="tabla">
          <tbody>
            <tr><td>Respaldos en la nube</td><td className="der">{((c.respaldoUsadoBytes ?? 0) / 1024 ** 3).toFixed(2)} GB de {2 + (c.respaldoExtraGb ?? 0)} GB · {c.respaldoCopias ?? 0} copias</td></tr>
            <tr><td>Facturas leídas este mes</td><td className="der">{c.lectorUsadas ?? 0} de {c.lectorCupo ?? 0}</td></tr>
            {(c.lectorHistorial ?? []).map((h) => <tr key={h.mes}><td className="suave">Facturas leídas · {h.mes}</td><td className="der suave">{h.usadas}</td></tr>)}
          </tbody>
        </table>
        <h4>Espacio de respaldos en la nube</h4>
        <div className="en-linea">
          <label className="campo" style={{ margin: 0 }}><span>GB extra contratados (se suman a los 2 GB base)</span>
            <input className="numero" inputMode="numeric" value={extraGb} onChange={(e) => setExtraGb(e.target.value.replace(/\D/g, ""))} /></label>
          <button className="boton" onClick={() => hacer(() => api(`/central/portal/clientes/${c.id}/respaldo-extra`, { metodo: "PUT", cuerpo: { gb: Number(extraGb || 0) } }), "Espacio guardado")}>Guardar</button>
        </div>
        <h4>Lector de facturas (IA)</h4>
        <div className="en-linea">
          <label className="campo" style={{ margin: 0 }}><span>Facturas por mes (0 = apagado) · este mes lleva {c.lectorUsadas ?? 0}</span>
            <input className="numero" inputMode="numeric" value={cupoLector} onChange={(e) => setCupoLector(e.target.value.replace(/\D/g, ""))} /></label>
          <button className="boton" onClick={() => hacer(() => api(`/central/portal/clientes/${c.id}/lector`, { metodo: "PUT", cuerpo: { cupo: Number(cupoLector || 0) } }), "Cupo del lector guardado")}>Guardar</button>
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
        <table className="tabla apilada">
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
        <h3 style={{ marginTop: 0 }}>Solicitudes de activación</h3>
        <label className="campo" style={{ maxWidth: 360 }}><span>Plazo con que se compromete a contactar al cliente (horas)</span>
          <input type="number" min={1} max={720} value={v.plazoHoras} onChange={(e) => set({ plazoHoras: Math.max(1, Number(e.target.value) || 24) })} /></label>
        <p className="suave pequeno">El cliente lo lee al enviar su solicitud: «en un plazo de {v.plazoHoras} horas se estarán comunicando con usted para confirmar el pago y activar su licencia».</p>
        <h3>Contacto que ven sus clientes</h3>
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

/* ---------------- Instalaciones detectadas / solicitudes de activación ---------------- */
const ESTADO_INST: Record<string, { t: string; c: string }> = {
  PENDIENTE: { t: "Espera activación", c: "aviso" }, ASIGNADA: { t: "Activada", c: "ok" }, RECHAZADA: { t: "Rechazada", c: "alerta" }, LIBERADA: { t: "Liberada", c: "alerta" },
};

function Instalaciones({ planes, onCambio }: { planes: Plan[]; onCambio: () => void }) {
  const [filtro, setFiltro] = useState<"PENDIENTE" | "ASIGNADA" | "">("PENDIENTE");
  const { datos, recargar, error } = useDatos<Instalacion[]>(`/central/portal/instalaciones${filtro ? `?estado=${filtro}` : ""}`, [filtro]);
  const clientes = useDatos<Cliente[]>("/central/portal/clientes");
  const [abierta, setAbierta] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" } | null>(null);
  const hecho = (t: string) => { setMsg({ t, tipo: "ok" }); setAbierta(null); recargar(); clientes.recargar(); onCambio(); };
  const rechazar = async (i: Instalacion) => {
    if (!confirm(`¿Rechazar la solicitud de ${i.empresa || i.equipo || "esta instalación"}? Seguirá en prueba y podrá activarse con una clave.`)) return;
    try { await api(`/central/portal/instalaciones/${i.id}/rechazar`, { cuerpo: {} }); hecho("Solicitud rechazada"); } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
  };
  return (
    <>
      <p className="suave pequeno" style={{ marginTop: 0, maxWidth: 720 }}>
        El cliente instala FactPOS, usa sus 15 días de prueba y, si le interesa, pulsa «Solicitar activación» en su pantalla Licencia: elige plan y manda sus datos.
        Llega aquí. Usted lo contacta, confirma el pago y pulsa «Aprobar»: la instalación recibe su licencia sola, sin teclear ninguna clave.
        Las instalaciones que no piden nada no aparecen aquí.
      </p>
      <div className="chips-filtro">
        {([["PENDIENTE", "Por atender"], ["ASIGNADA", "Activadas"], ["", "Todas"]] as const).map(([f, t]) => (
          <button key={f} className={filtro === f ? "activo" : ""} onClick={() => setFiltro(f)}>{t}</button>
        ))}
        <span className="flex" /><button className="boton" onClick={() => recargar()}>Actualizar</button>
      </div>
      <Aviso texto={error} />
      {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}
      <div className="tabla-contenedor">
        <table className="tabla apilada">
          <thead><tr><th>Solicitud</th><th>Contacto</th><th>Plan pedido</th><th>Recibida</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {(datos ?? []).map((i) => (
              <Fragment key={i.id}>
                <tr>
                  <td><b>{i.empresa || "Empresa sin nombre"}</b>
                    <div className="suave pequeno">{[i.rnc && `RNC ${i.rnc}`, i.equipo && `Equipo ${i.equipo}`].filter(Boolean).join(" · ")}</div>
                    {i.cliente && <div className="pequeno">Cliente: <a href={`/${i.slug}/`} target="_blank" rel="noreferrer">{i.cliente}</a></div>}
                    <div className="suave pequeno">{i.versionApp ? `v${i.versionApp}` : ""}</div></td>
                  <td>{i.contacto && <div>{i.contacto}</div>}
                    {i.telefono && <div><a href={`tel:${i.telefono}`}>{i.telefono}</a></div>}
                    {i.correo && <div className="pequeno"><a href={`mailto:${i.correo}`}>{i.correo}</a></div>}
                    {!i.telefono && !i.correo && <span className="suave">—</span>}</td>
                  <td>{i.plan ?? <span className="suave">Sin elegir</span>}{i.sucursalesSolicitadas ? <div className="suave pequeno">{i.sucursalesSolicitadas} sucursal(es)</div> : null}
                    {i.mensaje && <div className="suave pequeno" title={i.mensaje}>“{i.mensaje.length > 60 ? i.mensaje.slice(0, 60) + "…" : i.mensaje}”</div>}</td>
                  <td>{hace(i.solicitadaEn)}<div className="suave pequeno">Visto {hace(i.ultimoContacto)}</div></td>
                  <td><span className={`pastilla ${ESTADO_INST[i.estado].c}`}>{ESTADO_INST[i.estado].t}</span>{i.nota && <div className="suave pequeno">{i.nota}</div>}</td>
                  <td className="der">
                    {i.estado !== "ASIGNADA" && <button className="boton primario" onClick={() => setAbierta(abierta === i.id ? null : i.id)}>{abierta === i.id ? "Cerrar" : "Aprobar…"}</button>}
                    {i.estado === "PENDIENTE" && <> <button className="enlace" onClick={() => rechazar(i)}>Rechazar</button></>}
                  </td>
                </tr>
                {abierta === i.id && <tr><td colSpan={6} className="detalle-cliente"><Aprobar i={i} planes={planes} clientes={clientes.datos ?? []} onListo={hecho} /></td></tr>}
              </Fragment>
            ))}
            {datos && !datos.length && <tr><td colSpan={6} className="suave">{filtro === "PENDIENTE" ? "No hay solicitudes por atender. Cuando un cliente en prueba pida su activación, aparecerá aquí." : "Sin instalaciones."}</td></tr>}
            {!datos && <tr><td colSpan={6} className="suave">Cargando…</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Aprobar({ i, planes, clientes, onListo }: { i: Instalacion; planes: Plan[]; clientes: Cliente[]; onListo: (t: string) => void }) {
  const activos = planes.filter((p) => p.activo);
  const libres = clientes.filter((c) => c.licenciaId && !c.activada);
  const [modo, setModo] = useState<"existente" | "nuevo">(libres.length ? "existente" : "nuevo");
  const [clienteId, setClienteId] = useState(libres[0]?.id ?? "");
  const [c, setC] = useState({ nombre: i.empresa ?? "", slug: aSlug(i.empresa ?? ""), rnc: i.rnc ?? "" });
  const pedido = activos.find((p) => p.id === i.planId) ?? activos[0];
  const [planId, setPlanId] = useState(pedido?.id ?? "");
  const [l, setL] = useState({ sucursales: Math.max(1, i.sucursalesSolicitadas ?? pedido?.sucursalesIncluidas ?? i.sucursalesEnUso ?? 1), vence: masMeses(mesesDe(pedido?.periodo)) });
  const [msg, setMsg] = useState("");
  const [trabajando, setTrabajando] = useState(false);
  const plan = activos.find((p) => p.id === planId);
  const elegirPlan = (id: string) => {
    setPlanId(id);
    const p = activos.find((x) => x.id === id);
    if (p) setL({ sucursales: Math.max(p.sucursalesIncluidas, i.sucursalesSolicitadas ?? 1), vence: masMeses(mesesDe(p.periodo)) });
  };
  const aprobar = async () => {
    setTrabajando(true); setMsg("");
    try {
      await api(`/central/portal/instalaciones/${i.id}/aprobar`, { cuerpo: {
        ...(modo === "existente" ? { clienteId } : { cliente: { nombre: c.nombre.trim(), slug: c.slug, rnc: c.rnc || null, apiUrl: i.apiUrl || null, correo: i.correo, telefono: i.telefono, contacto: i.contacto } }),
        licencia: { sucursales: l.sucursales, vence: l.vence, planId: planId || null, modulos: plan?.modulos ?? [] },
      } });
      onListo("Licencia activada. El cliente la recibe sola en unos minutos (o al pulsar «Comprobar ahora» en su pantalla Licencia). Confirme el pago con él si aún no lo hizo.");
    } catch (e) { setMsg((e as Error).message); }
    finally { setTrabajando(false); }
  };
  return (
    <div className="panel renovar">
      <h4 style={{ marginTop: 0 }}>Activar {i.empresa || i.equipo || "esta instalación"}</h4>
      <div className="en-linea" style={{ marginBottom: 10 }}>
        <label className="regla"><input type="radio" checked={modo === "existente"} disabled={!libres.length} onChange={() => setModo("existente")} /><span><b>Asignar a un cliente existente</b><small>{libres.length ? "Que todavía no tenga instalación activada." : "No hay clientes sin activar."}</small></span></label>
        <label className="regla"><input type="radio" checked={modo === "nuevo"} onChange={() => setModo("nuevo")} /><span><b>Crear un cliente nuevo</b><small>Con los datos de la solicitud.</small></span></label>
      </div>
      {modo === "existente" ? (
        <label className="campo" style={{ maxWidth: 420 }}><span>Cliente</span>
          <select value={clienteId} onChange={(e) => setClienteId(e.target.value)}>{libres.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select></label>
      ) : (
        <div className="tres-col">
          <label className="campo"><span>Nombre de la empresa</span><input value={c.nombre} onChange={(e) => setC({ ...c, nombre: e.target.value, slug: aSlug(e.target.value) })} /></label>
          <label className="campo"><span>Nombre corto (su dirección)</span><input className="mono" value={c.slug} onChange={(e) => setC({ ...c, slug: aSlug(e.target.value) })} /></label>
          <label className="campo"><span>RNC</span><input value={c.rnc} inputMode="numeric" onChange={(e) => setC({ ...c, rnc: e.target.value.replace(/\D/g, "") })} /></label>
        </div>
      )}
      <div className="tres-col">
        <label className="campo"><span>Plan</span>
          <select value={planId} onChange={(e) => elegirPlan(e.target.value)}><option value="">Sin plan (a medida)</option>{activos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label>
        <label className="campo"><span>Sucursales permitidas</span><input type="number" min={1} value={l.sucursales} onChange={(e) => setL({ ...l, sucursales: Math.max(1, Number(e.target.value) || 1) })} /></label>
        <label className="campo"><span>Vence</span><input type="date" value={l.vence} onChange={(e) => setL({ ...l, vence: e.target.value })} /></label>
      </div>
      {plan && plan.precioSucursal > 0 && <p className="suave pequeno">Cobro: {l.sucursales} × {rd(plan.precioSucursal)} = <b>{rd(l.sucursales * plan.precioSucursal)}</b> por {plan.periodo === "MENSUAL" ? "mes" : "año"}.</p>}
      <div className="fila-acciones"><span className="flex" />
        <button className="boton primario" disabled={trabajando || (modo === "existente" ? !clienteId : c.nombre.trim().length < 2 || c.slug.length < 3)} onClick={aprobar}>{trabajando ? "Activando…" : "Aprobar y activar"}</button>
      </div>
      <Aviso texto={msg} />
    </div>
  );
}

/* ---------- Invitaciones por WhatsApp ---------- */
interface Invitacion {
  id: string; nombre: string; telefono: string; nota: string | null; creadaEn: string; enviadaEn: string | null;
  visitas: number; primeraVisita: string | null; ultimaVisita: string | null; descargas: number; ultimaDescarga: string | null; mensaje: string;
}
function Invitaciones() {
  const { datos, error, recargar } = useDatos<{ plantilla: string; base: string; lista: Invitacion[] }>("/central/portal/invitaciones");
  const [nombre, setNombre] = useState("");
  const [tel, setTel] = useState("");
  const [nota, setNota] = useState("");
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" } | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [enlace, setEnlace] = useState<string | null>(null);
  const texto = mensaje ?? datos?.plantilla ?? "";

  const enviar = async () => {
    setTrabajando(true); setMsg(null);
    try {
      const r = await api<{ id: string; whatsapp: string }>("/central/portal/invitaciones", { cuerpo: { nombre, telefono: tel, nota: nota || null, mensaje: texto } });
      const ventana = window.open(r.whatsapp, "_blank", "noopener");
      setEnlace(ventana ? null : r.whatsapp); // si el navegador bloqueó la ventana, queda el enlace a mano
      await api(`/central/portal/invitaciones/${r.id}/enviada`, { cuerpo: {} });
      setMsg({ t: `Se abrió WhatsApp con la invitación para ${nombre}. Pulse «Enviar» allí.`, tipo: "ok" });
      setNombre(""); setTel(""); setNota(""); await recargar();
    } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
    finally { setTrabajando(false); }
  };
  const reenviar = (i: Invitacion) => window.open(`https://wa.me/${i.telefono}?text=${encodeURIComponent(i.mensaje)}`, "_blank", "noopener");
  const quitar = async (i: Invitacion) => {
    if (!confirm(`¿Quitar la invitación de ${i.nombre}? Su enlace dejará de contarse.`)) return;
    try { await api(`/central/portal/invitaciones/${i.id}`, { metodo: "DELETE" }); await recargar(); } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
  };
  const estado = (i: Invitacion) => i.descargas > 0 ? ["Descargó", "ok"] : i.visitas > 0 ? ["Vio la página", "aviso"] : i.enviadaEn ? ["Enviada", ""] : ["Sin enviar", ""];

  return (
    <>
      <Aviso texto={error} />
      {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}
      {enlace && <p><a className="boton primario" href={enlace} target="_blank" rel="noreferrer">Abrir WhatsApp con la invitación</a></p>}
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Invitar a conocer FactPOS</h3>
        <p className="suave pequeno">Escriba el WhatsApp de la persona: se abre WhatsApp con el mensaje listo y un enlace propio a la página con el recorrido interactivo y la descarga. Aquí verá si lo abrió y si descargó.</p>
        <div className="rejilla-3" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12 }}>
          <label className="campo"><span>Nombre o negocio</span><input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Colmado Don Pepe" /></label>
          <label className="campo"><span>WhatsApp (con código de país)</span><input inputMode="numeric" value={tel} onChange={(e) => setTel(e.target.value.replace(/[^\d+\s-]/g, ""))} placeholder="18095551234" /></label>
          <label className="campo"><span>Nota interna <em className="suave">(opcional)</em></span><input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Lo conocí en la feria" /></label>
        </div>
        <label className="campo"><span>Mensaje <em className="suave">({"{nombre}"} y {"{link}"} se completan solos)</em></span>
          <textarea rows={11} value={texto} onChange={(e) => setMensaje(e.target.value)} style={{ width: "100%", fontFamily: "inherit" }} /></label>
        <div className="en-linea">
          <button className="boton primario" disabled={trabajando || nombre.trim().length < 2 || tel.replace(/\D/g, "").length < 10 || texto.trim().length < 10} onClick={enviar}>{trabajando ? "Preparando…" : "Enviar por WhatsApp"}</button>
          {mensaje != null && <button className="boton fantasma" onClick={() => setMensaje(null)}>Restaurar mensaje</button>}
          {datos && <a className="enlace" href={`${datos.base}/invitacion`} target="_blank" rel="noreferrer">Ver la página de invitación</a>}
        </div>
      </div>
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Invitaciones enviadas</h3>
        <table className="tabla apilada">
          <thead><tr><th>Invitado</th><th>WhatsApp</th><th>Estado</th><th className="der">Visitas</th><th className="der">Descargas</th><th>Enviada</th><th /></tr></thead>
          <tbody>
            {(datos?.lista ?? []).map((i) => { const [t, c] = estado(i); return (
              <tr key={i.id}>
                <td><b>{i.nombre}</b>{i.nota && <div className="suave pequeno">{i.nota}</div>}</td>
                <td className="mono">{i.telefono}</td>
                <td><span className={"pastilla " + c}>{t}</span>{i.ultimaVisita && <div className="suave pequeno">Visto {hace(i.ultimaVisita)}</div>}</td>
                <td className="der">{i.visitas}</td><td className="der">{i.descargas}</td>
                <td className="suave pequeno">{i.enviadaEn ? hace(i.enviadaEn) : "—"}</td>
                <td className="der"><button className="enlace" onClick={() => reenviar(i)}>Reenviar</button> · <button className="enlace" onClick={() => quitar(i)}>Quitar</button></td>
              </tr>); })}
            {datos && datos.lista.length === 0 && <tr><td colSpan={7} className="suave">Todavía no ha invitado a nadie.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}


/* ---------- Apps de pago y costo por licencia ---------- */
interface GastoFila { id: string; servicio: string; para: string | null; monto: number; moneda: "USD" | "DOP"; tasa: number; activo: boolean; notas: string | null; montoDop: number }
interface ResumenGastos {
  gastos: GastoFila[]; totalMensualDop: number; licencias: number; sucursales: number; ingresoMensualDop: number;
  costoPorLicencia: number | null; costoPorSucursal: number | null; margenDop: number;
}
const gastoVacio = { id: "", servicio: "", para: "", monto: 0, moneda: "USD" as "USD" | "DOP", tasa: 60, activo: true, notas: "" };

function Gastos() {
  const { datos, recargar } = useDatos<ResumenGastos>("/central/portal/gastos");
  const [edit, setEdit] = useState<typeof gastoVacio | null>(null);
  const [msg, setMsg] = useState("");
  const guardar = async () => {
    if (!edit) return;
    setMsg("");
    try {
      const { id, ...cuerpo } = edit;
      await api(id ? `/central/portal/gastos/${id}` : "/central/portal/gastos", { metodo: id ? "PUT" : "POST", cuerpo: { ...cuerpo, para: cuerpo.para || null, notas: cuerpo.notas || null } });
      setEdit(null); recargar();
    } catch (e) { setMsg((e as Error).message); }
  };
  return (
    <>
      <div className="fila-acciones" style={{ marginBottom: 12 }}>
        <span className="suave pequeno" style={{ maxWidth: 640 }}>
          Anote cada app de pago que usa para dar el servicio (Vercel, Cloudflare, Claude API…) con lo que paga al mes. Con eso se calcula cuánto le cuesta cada licencia y cuánto le queda.
        </span>
        <span className="flex" />
        <button className="boton primario" onClick={() => setEdit({ ...gastoVacio })}>Agregar app de pago</button>
      </div>
      <Aviso texto={msg} />
      {datos && (
        <div className="panel">
          <table className="tabla"><tbody>
            <tr><td>Total pagado al mes</td><td className="der"><b>{rd(datos.totalMensualDop)}</b></td></tr>
            <tr><td>Licencias vigentes · sucursales</td><td className="der">{datos.licencias} · {datos.sucursales}</td></tr>
            <tr><td>Costo por licencia (al mes)</td><td className="der"><b>{datos.costoPorLicencia != null ? rd(datos.costoPorLicencia) : "—"}</b></td></tr>
            <tr><td>Costo por sucursal (al mes)</td><td className="der">{datos.costoPorSucursal != null ? rd(datos.costoPorSucursal) : "—"}</td></tr>
            <tr><td>Ingreso mensual por licencias</td><td className="der">{rd(datos.ingresoMensualDop)}</td></tr>
            <tr><td>Margen mensual</td><td className={"der " + (datos.margenDop < 0 ? "texto-alerta" : "texto-ok")}><b>{rd(datos.margenDop)}</b></td></tr>
          </tbody></table>
        </div>
      )}
      {edit && (
        <div className="panel">
          <div className="encabezado-sub"><h3>{edit.id ? "Editar app de pago" : "Nueva app de pago"}</h3><button className="enlace" onClick={() => setEdit(null)}>Cancelar</button></div>
          <div className="tres-col">
            <label className="campo"><span>App o servicio</span><input autoFocus value={edit.servicio} onChange={(e) => setEdit({ ...edit, servicio: e.target.value })} placeholder="Vercel, Cloudflare R2, Claude API…" /></label>
            <label className="campo"><span>Para qué se usa</span><input value={edit.para ?? ""} onChange={(e) => setEdit({ ...edit, para: e.target.value })} /></label>
            <label className="campo"><span>Monto pagado al mes</span><input className="numero" inputMode="decimal" value={edit.monto || ""} placeholder="0.00" onChange={(e) => setEdit({ ...edit, monto: Number(e.target.value.replace(/[^\d.]/g, "")) || 0 })} /></label>
            <label className="campo"><span>Moneda</span>
              <select value={edit.moneda} onChange={(e) => setEdit({ ...edit, moneda: e.target.value as "USD" | "DOP" })}><option value="USD">Dólares (US$)</option><option value="DOP">Pesos (RD$)</option></select></label>
            {edit.moneda === "USD" && <label className="campo"><span>RD$ por cada dólar</span><input className="numero" inputMode="decimal" value={edit.tasa || ""} onChange={(e) => setEdit({ ...edit, tasa: Number(e.target.value.replace(/[^\d.]/g, "")) || 0 })} /></label>}
            <label className="check"><input type="checkbox" checked={edit.activo} onChange={(e) => setEdit({ ...edit, activo: e.target.checked })} /> Lo estoy pagando</label>
          </div>
          <button className="boton primario" disabled={edit.servicio.trim().length < 2 || (edit.moneda === "USD" && !edit.tasa)} onClick={guardar}>Guardar</button>
        </div>
      )}
      <div className="tabla-contenedor">
        <table className="tabla">
          <thead><tr><th>App</th><th>Para qué</th><th className="der">Monto mensual</th><th className="der">En RD$</th><th></th></tr></thead>
          <tbody>
            {datos?.gastos.map((g) => (
              <tr key={g.id} className={g.activo ? "" : "inactiva"}>
                <td><b>{g.servicio}</b>{!g.activo && <span className="suave pequeno"> · sin pagar</span>}</td>
                <td className="suave">{g.para ?? ""}</td>
                <td className="der">{g.moneda === "USD" ? `US$ ${g.monto.toFixed(2)}` : rd(g.monto)}</td>
                <td className="der">{rd(g.montoDop)}</td>
                <td className="der">
                  <button className="enlace" onClick={() => setEdit({ ...g, para: g.para ?? "", notas: g.notas ?? "" })}>Editar</button>{" "}
                  <button className="enlace" onClick={async () => { if (confirm(`¿Quitar ${g.servicio}?`)) { await api(`/central/portal/gastos/${g.id}`, { metodo: "DELETE" }); recargar(); } }}>Quitar</button>
                </td>
              </tr>
            ))}
            {datos && !datos.gastos.length && <tr><td colSpan={5} className="suave">Todavía no ha anotado ninguna app de pago.</td></tr>}
            {!datos && <tr><td colSpan={5} className="suave">Cargando…</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
