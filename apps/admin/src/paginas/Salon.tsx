import { useMemo, useState } from "react";
import { api, rd } from "../api";
import { Aviso, Encabezado, useCatalogo, useDatos } from "../ui";
import { NuevaFactura, type BaseDuplicada, type ClienteB } from "./NuevaFactura";

/**
 * Peluquerías, barberías, salones de uñas y spa (módulo SALON). «Hoy» muestra el día en columnas (por llegar, en espera, en servicio, por cobrar);
 * «Agenda» las citas de cualquier día por estilista. Se agenda con hora o se anota un turno sin cita (barbería). El servicio tiene duración y
 * precio (único o por largo del cabello); al terminar se cobra con una factura normal y el estilista gana su comisión (monto o %).
 */
const VARIANTES = [["UNICO", "Único"], ["CORTO", "Cabello corto"], ["MEDIO", "Cabello medio"], ["LARGO", "Cabello largo"]] as const;
const nombreVariante = (id: string) => VARIANTES.find(([i]) => i === id)?.[1] ?? id;
interface Linea { servicioId: string; servicio: string; variante: string; presentacionId: string; cantidad: number; duracion: number }
interface Cita {
  id: string; numero: string; origen: "CITA" | "TURNO"; estado: "PROGRAMADA" | "EN_ESPERA" | "EN_SERVICIO" | "TERMINADA" | "COBRADA" | "CANCELADA" | "NO_LLEGO";
  nombre: string; telefono: string | null; notas: string | null; lineas: Linea[]; ventaId: string | null; clienteDatos: ClienteB | null; sucursalId: string;
  estilistaId: string | null; estilista: string | null; sillaId: string | null; silla: string | null; inicioEn: string; duracionMin: number; finEn: string;
  llegoEn: string | null; servicioInicioEn: string | null; comision: string | null; visitas: number;
}
interface Insumo { productoId: string; cantidad: number }
interface Servicio { id: string; nombre: string; descripcion: string | null; duracionMin: number; presentaciones: Record<string, string>; comisionTipo: "MONTO" | "PORCIENTO"; comision: string; insumos: Insumo[]; activo: boolean }
interface Estilista { id: string; nombre: string; telefono: string | null; activo: boolean }
interface Silla { id: string; nombre: string; activa: boolean; sucursalId: string; sucursal: string }
const num = (v: string) => Number(v.replace(/[^\d.]/g, "")) || 0;
const ZONA = { timeZone: "America/Santo_Domingo" } as const;
const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-DO", { ...ZONA, hour: "numeric", minute: "2-digit" });
const diaLargo = (f: string) => new Date(`${f}T12:00:00-04:00`).toLocaleDateString("es-DO", { ...ZONA, weekday: "long", day: "numeric", month: "long" });
const hoyRD = () => new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10);
const sumarDias = (f: string, n: number) => new Date(new Date(`${f}T12:00:00Z`).getTime() + n * 86400e3).toISOString().slice(0, 10);
const duracion = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`);
/** Teléfono dominicano de 10 dígitos → número internacional para wa.me */
const whatsapp = (tel: string, texto: string) => {
  const d = tel.replace(/\D/g, "");
  return `https://wa.me/${d.length === 10 ? `1${d}` : d}?text=${encodeURIComponent(texto)}`;
};
const resumen = (c: Cita) => c.lineas.map((l) => l.servicio + (l.cantidad > 1 ? ` × ${l.cantidad}` : "")).join(", ");
type Aviso_ = (t: string, tipo?: "ok" | "error") => void;

export function Salon() {
  const [pestana, setPestana] = useState<"hoy" | "agenda" | "servicios" | "equipo" | "clientes" | "comisiones">("hoy");
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" } | null>(null);
  const aviso: Aviso_ = (t, tipo = "ok") => setMsg({ t, tipo });
  const TABS = [["hoy", "Hoy"], ["agenda", "Agenda"], ["servicios", "Servicios y precios"], ["equipo", "Equipo y sillas"], ["clientes", "Clientes"], ["comisiones", "Comisiones"]] as const;
  return (
    <>
      <Encabezado titulo="Citas y servicios" descripcion="Agende citas o anote turnos, asigne quién atiende, cobre con una factura y pague la comisión de cada estilista." />
      {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}
      <div className="fila-acciones" style={{ marginBottom: 10, flexWrap: "wrap" }}>
        {TABS.map(([id, t]) => <button key={id} className={"boton" + (pestana === id ? " primario" : "")} onClick={() => { setPestana(id); setMsg(null); }}>{t}</button>)}
      </div>
      {pestana === "hoy" && <Hoy aviso={aviso} />}
      {pestana === "agenda" && <Agenda aviso={aviso} />}
      {pestana === "servicios" && <Servicios aviso={aviso} />}
      {pestana === "equipo" && <Equipo aviso={aviso} />}
      {pestana === "clientes" && <Clientes />}
      {pestana === "comisiones" && <Comisiones aviso={aviso} />}
    </>
  );
}

// ------------------------------------------------------------------------------------------------ Tarjeta de cita (la usan «Hoy» y «Agenda»)
function TarjetaCita({ c, estilistas, sillas, aviso, recargar, cobrar }: { c: Cita; estilistas: Estilista[]; sillas: Silla[]; aviso: Aviso_; recargar: () => void; cobrar: (c: Cita) => void }) {
  const actuar = async (ruta: string, cuerpo?: unknown, ok?: string) => {
    try { const r = await api<{ aviso?: string } | null>(ruta, { metodo: "POST", cuerpo: cuerpo ?? {} }); if (r?.aviso) aviso(r.aviso, "error"); else if (ok) aviso(ok); recargar(); }
    catch (e) { aviso((e as Error).message, "error"); }
  };
  const abierta = ["PROGRAMADA", "EN_ESPERA", "EN_SERVICIO"].includes(c.estado);
  const nombre = c.nombre.split(" ")[0];
  const recordatorio = `Hola ${nombre}, le recordamos su cita de ${resumen(c)} para ${new Date(c.inicioEn).toLocaleDateString("es-DO", { ...ZONA, weekday: "long", day: "numeric", month: "long" })} a las ${hora(c.inicioEn)}. ¡Lo esperamos!`;
  return (
    <div className="tarjeta" style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <b>{c.nombre}</b>
        <span className="suave pequeno">{c.origen === "TURNO" ? `turno · llegó ${hora(c.llegoEn ?? c.inicioEn)}` : `${hora(c.inicioEn)} – ${hora(c.finEn)}`}</span>
      </div>
      <div className="pequeno">{resumen(c)} · {duracion(c.duracionMin)}{c.telefono ? ` · ${c.telefono}` : ""}{c.visitas > 0 ? ` · ${c.visitas} ${c.visitas === 1 ? "visita" : "visitas"} anteriores` : ""}</div>
      {c.notas && <p className="suave pequeno" style={{ margin: "4px 0" }}>{c.notas}</p>}
      {abierta ? (
        <div className="dos-col" style={{ marginTop: 6 }}>
          <label className="campo"><span>Atiende</span>
            <select value={c.estilistaId ?? ""} onChange={(e) => void actuar(`/central/salon/citas/${c.id}/asignar`, { estilistaId: e.target.value || null, sillaId: c.sillaId })}>
              <option value="">Sin asignar</option>
              {estilistas.filter((x) => x.activo || x.id === c.estilistaId).map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
            </select></label>
          <label className="campo"><span>Silla</span>
            <select value={c.sillaId ?? ""} onChange={(e) => void actuar(`/central/salon/citas/${c.id}/asignar`, { estilistaId: c.estilistaId, sillaId: e.target.value || null })}>
              <option value="">Sin silla</option>
              {sillas.filter((s) => s.sucursalId === c.sucursalId && (s.activa || s.id === c.sillaId)).map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select></label>
        </div>
      ) : <p className="pequeno" style={{ margin: "6px 0" }}>{c.estilista ? `Atendió: ${c.estilista}` : "Sin estilista"}{c.silla ? ` · ${c.silla}` : ""}{c.comision ? ` · comisión ${rd(Number(c.comision))}` : ""}</p>}
      <div className="fila-acciones" style={{ flexWrap: "wrap" }}>
        {c.estado === "PROGRAMADA" && <>
          <button className="boton primario" onClick={() => void actuar(`/central/salon/citas/${c.id}/estado`, { estado: "EN_ESPERA" })}>Llegó</button>
          {c.telefono && <a className="boton" target="_blank" rel="noreferrer" href={whatsapp(c.telefono, recordatorio)}>Recordar por WhatsApp</a>}
          <button className="boton" onClick={() => confirm(`¿Marcar que ${c.nombre} no llegó?`) && void actuar(`/central/salon/citas/${c.id}/estado`, { estado: "NO_LLEGO" }, "Marcada como «no llegó».")}>No llegó</button>
        </>}
        {(c.estado === "EN_ESPERA" || c.estado === "PROGRAMADA") && <button className="boton" onClick={() => void actuar(`/central/salon/citas/${c.id}/estado`, { estado: "EN_SERVICIO" })}>Empezar</button>}
        {c.estado === "EN_SERVICIO" && <button className="boton primario" onClick={() => void actuar(`/central/salon/citas/${c.id}/estado`, { estado: "TERMINADA" })}>Terminar</button>}
        {c.estado === "TERMINADA" && <button className="boton primario" onClick={() => cobrar(c)}>Cobrar</button>}
        {abierta || c.estado === "TERMINADA" ? <button className="boton" onClick={() => confirm(`¿Cancelar la cita de ${c.nombre}?`) && void actuar(`/central/salon/citas/${c.id}/estado`, { estado: "CANCELADA" }, "Cita cancelada.")}>Cancelar</button> : null}
      </div>
    </div>
  );
}

/** Cobrar: abre Nueva factura con los servicios de la cita; al emitirla, la cita queda cobrada y se acumula la comisión */
function Cobro({ c, onCerrar, onListo, aviso }: { c: Cita; onCerrar: () => void; onListo: () => void; aviso: Aviso_ }) {
  const base: BaseDuplicada = {
    tipo: "E32", notas: `Cita #${c.numero} · ${c.nombre}`, cliente: c.clienteDatos,
    lineas: c.lineas.map((l) => ({ presentacionId: l.presentacionId, nombre: l.variante === "UNICO" ? l.servicio : `${l.servicio} · ${nombreVariante(l.variante)}`, cantidad: String(l.cantidad), descuento: "" })),
  };
  return <NuevaFactura duplicarDe={base} onCerrar={onCerrar}
    onCreada={async (ventaId) => {
      try { await api(`/central/salon/citas/${c.id}/factura`, { metodo: "POST", cuerpo: { ventaId } }); aviso(`Cita de ${c.nombre} cobrada.`); }
      catch (e) { aviso(`La factura se emitió, pero la cita no se pudo cerrar: ${(e as Error).message}`, "error"); }
      onListo();
    }} />;
}

// ------------------------------------------------------------------------------------------------ Hoy
function Hoy({ aviso }: { aviso: Aviso_ }) {
  const citas = useDatos<Cita[]>("/central/salon/citas?vista=hoy");
  const estilistas = useDatos<Estilista[]>("/central/salon/estilistas");
  const sillas = useDatos<Silla[]>("/central/salon/sillas");
  const [nueva, setNueva] = useState<null | "CITA" | "TURNO">(null);
  const [cobrando, setCobrando] = useState<Cita | null>(null);
  if (cobrando) return <Cobro c={cobrando} aviso={aviso} onCerrar={() => setCobrando(null)} onListo={() => { setCobrando(null); void citas.recargar(); }} />;
  const lista = citas.datos ?? [];
  const COL = [["PROGRAMADA", "Por llegar"], ["EN_ESPERA", "En espera"], ["EN_SERVICIO", "En servicio"], ["TERMINADA", "Por cobrar"]] as const;
  return (
    <>
      <div className="fila-acciones" style={{ marginBottom: 10, flexWrap: "wrap" }}>
        <button className="boton primario" onClick={() => setNueva("CITA")}>Nueva cita</button>
        <button className="boton" onClick={() => setNueva("TURNO")}>Turno sin cita</button>
        <button className="boton" onClick={() => void citas.recargar()}>Actualizar</button>
      </div>
      <Aviso texto={citas.error} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 12, alignItems: "start" }}>
        {COL.map(([est, titulo]) => {
          const f = lista.filter((c) => c.estado === est);
          return (
            <div key={est} className="panel" style={{ minWidth: 0 }}>
              <h3 style={{ marginTop: 0 }}>{titulo} <span className="suave">({f.length})</span></h3>
              {!f.length && <p className="suave pequeno">Nada por aquí.</p>}
              {f.map((c) => <TarjetaCita key={c.id} c={c} estilistas={estilistas.datos ?? []} sillas={sillas.datos ?? []} aviso={aviso} recargar={() => void citas.recargar()} cobrar={setCobrando} />)}
            </div>
          );
        })}
      </div>
      {nueva && <NuevaCita origen={nueva} fechaInicial={hoyRD()} estilistas={estilistas.datos ?? []} sillas={sillas.datos ?? []} onCerrar={() => setNueva(null)}
        onCreada={(n) => { setNueva(null); aviso(nueva === "TURNO" ? `Turno #${n} anotado.` : `Cita #${n} agendada.`); void citas.recargar(); }} />}
    </>
  );
}

// ------------------------------------------------------------------------------------------------ Agenda
function Agenda({ aviso }: { aviso: Aviso_ }) {
  const [dia, setDia] = useState(hoyRD());
  const citas = useDatos<Cita[]>(`/central/salon/citas?vista=dia&fecha=${dia}`, [dia]);
  const estilistas = useDatos<Estilista[]>("/central/salon/estilistas");
  const sillas = useDatos<Silla[]>("/central/salon/sillas");
  const [nueva, setNueva] = useState(false);
  const [cobrando, setCobrando] = useState<Cita | null>(null);
  if (cobrando) return <Cobro c={cobrando} aviso={aviso} onCerrar={() => setCobrando(null)} onListo={() => { setCobrando(null); void citas.recargar(); }} />;
  const lista = (citas.datos ?? []).filter((c) => c.estado !== "CANCELADA");
  // Una columna por estilista con citas ese día (más «Sin asignar»)
  const nombres = new Map<string, string>();
  for (const c of lista) nombres.set(c.estilistaId ?? "", c.estilista ?? "Sin asignar");
  const columnas = [...nombres.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  return (
    <>
      <div className="fila-acciones" style={{ marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button className="boton" onClick={() => setDia(sumarDias(dia, -1))} aria-label="Día anterior">‹</button>
        <input type="date" value={dia} onChange={(e) => e.target.value && setDia(e.target.value)} />
        <button className="boton" onClick={() => setDia(sumarDias(dia, 1))} aria-label="Día siguiente">›</button>
        <button className="boton" onClick={() => setDia(hoyRD())}>Hoy</button>
        <button className="boton primario" onClick={() => setNueva(true)}>Nueva cita</button>
        <b style={{ textTransform: "capitalize" }}>{diaLargo(dia)}</b>
      </div>
      <Aviso texto={citas.error} />
      {!lista.length && <p className="suave">No hay citas ese día.</p>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 12, alignItems: "start" }}>
        {columnas.map(([id, nombre]) => (
          <div key={id || "sin"} className="panel" style={{ minWidth: 0 }}>
            <h3 style={{ marginTop: 0 }}>{nombre} <span className="suave">({lista.filter((c) => (c.estilistaId ?? "") === id).length})</span></h3>
            {lista.filter((c) => (c.estilistaId ?? "") === id).map((c) => (
              <div key={c.id}>
                <p className="pequeno" style={{ margin: "0 0 2px" }}><b>{hora(c.inicioEn)}</b> <span className="suave">{c.estado === "COBRADA" ? "cobrada" : c.estado === "NO_LLEGO" ? "no llegó" : ""}</span></p>
                <TarjetaCita c={c} estilistas={estilistas.datos ?? []} sillas={sillas.datos ?? []} aviso={aviso} recargar={() => void citas.recargar()} cobrar={setCobrando} />
              </div>
            ))}
          </div>
        ))}
      </div>
      {nueva && <NuevaCita origen="CITA" fechaInicial={dia} estilistas={estilistas.datos ?? []} sillas={sillas.datos ?? []} onCerrar={() => setNueva(false)}
        onCreada={(n) => { setNueva(false); aviso(`Cita #${n} agendada.`); void citas.recargar(); }} />}
    </>
  );
}

function NuevaCita({ origen, fechaInicial, estilistas, sillas, onCerrar, onCreada }: {
  origen: "CITA" | "TURNO"; fechaInicial: string; estilistas: Estilista[]; sillas: Silla[]; onCerrar: () => void; onCreada: (numero: string) => void;
}) {
  const { sucursales } = useCatalogo();
  const servicios = useDatos<Servicio[]>("/central/salon/servicios");
  const [f, setF] = useState({ nombre: "", telefono: "", fecha: fechaInicial, hora: "09:00", estilistaId: "", sillaId: "", notas: "" });
  const [elegidos, setElegidos] = useState<Record<string, { n: number; variante: string }>>({});
  const [sucursalId, setSucursalId] = useState(sucursales[0]?.id ?? "");
  const [msg, setMsg] = useState("");
  const [guardando, setGuardando] = useState(false);
  const activos = (servicios.datos ?? []).filter((s) => s.activo);
  const minutos = activos.reduce((a, s) => a + (elegidos[s.id]?.n ? s.duracionMin * elegidos[s.id].n : 0), 0);
  const crear = async () => {
    setMsg("");
    if (f.nombre.trim().length < 2) return setMsg("Escriba el nombre del cliente.");
    const sel = Object.entries(elegidos).filter(([, v]) => v.n > 0);
    if (!sel.length) return setMsg("Elija al menos un servicio.");
    setGuardando(true);
    try {
      const r = await api<{ numero: string }>("/central/salon/citas", { metodo: "POST", cuerpo: {
        origen, nombre: f.nombre.trim(), telefono: f.telefono.trim() || null, sucursalId: sucursalId || undefined, notas: f.notas.trim() || null,
        estilistaId: f.estilistaId || null, sillaId: f.sillaId || null,
        ...(origen === "CITA" ? { inicioEn: `${f.fecha}T${f.hora}:00-04:00` } : {}),
        servicios: sel.map(([servicioId, v]) => ({ servicioId, cantidad: v.n, variante: v.variante })),
      } });
      onCreada(r.numero);
    } catch (e) { setMsg((e as Error).message); setGuardando(false); }
  };
  return (
    <div className="fondo-modal" onMouseDown={onCerrar}>
      <div className="modal" style={{ maxWidth: 640 }} onMouseDown={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>{origen === "CITA" ? "Nueva cita" : "Turno sin cita"}</h3>
        <Aviso texto={msg} />
        <div className="dos-col">
          <label className="campo"><span>Cliente</span><input autoFocus value={f.nombre} maxLength={80} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></label>
          <label className="campo"><span>Teléfono (WhatsApp)</span><input inputMode="tel" value={f.telefono} maxLength={30} onChange={(e) => setF({ ...f, telefono: e.target.value })} /></label>
          {origen === "CITA" && <>
            <label className="campo"><span>Día</span><input type="date" value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} /></label>
            <label className="campo"><span>Hora</span><input type="time" step={300} value={f.hora} onChange={(e) => setF({ ...f, hora: e.target.value })} /></label>
          </>}
          <label className="campo"><span>Atiende (opcional)</span>
            <select value={f.estilistaId} onChange={(e) => setF({ ...f, estilistaId: e.target.value })}><option value="">Se asigna después</option>{estilistas.filter((x) => x.activo).map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select></label>
          <label className="campo"><span>Silla (opcional)</span>
            <select value={f.sillaId} onChange={(e) => setF({ ...f, sillaId: e.target.value })}><option value="">Sin silla</option>{sillas.filter((s) => s.activa && (!sucursalId || s.sucursalId === sucursalId)).map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}</select></label>
          {sucursales.length > 1 && <label className="campo"><span>Sucursal</span>
            <select value={sucursalId} onChange={(e) => { setSucursalId(e.target.value); setF({ ...f, sillaId: "" }); }}>{sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}</select></label>}
        </div>
        <h4 style={{ margin: "10px 0 4px" }}>Servicios {minutos > 0 && <span className="suave pequeno">· {duracion(minutos)}</span>}</h4>
        {!activos.length && <p className="suave pequeno">Todavía no hay servicios: créelos en «Servicios y precios».</p>}
        {activos.map((s) => {
          const e = elegidos[s.id];
          const variantes = VARIANTES.filter(([id]) => s.presentaciones[id]);
          return (
            <div key={s.id} className="en-linea" style={{ display: "flex", gap: 8, marginBottom: 4, flexWrap: "wrap", alignItems: "center" }}>
              <label className="en-linea" style={{ display: "flex", gap: 8 }}>
                <input type="checkbox" checked={!!e?.n} onChange={(ev) => setElegidos({ ...elegidos, [s.id]: { n: ev.target.checked ? 1 : 0, variante: e?.variante ?? variantes[0]?.[0] ?? "UNICO" } })} />
                <span>{s.nombre} <span className="suave pequeno">· {duracion(s.duracionMin)}</span></span>
              </label>
              {e?.n ? variantes.length > 1 && (
                <select value={e.variante} style={{ width: 160, flex: "none" }} onChange={(ev) => setElegidos({ ...elegidos, [s.id]: { ...e, variante: ev.target.value } })}>
                  {variantes.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
                </select>
              ) : null}
            </div>
          );
        })}
        <label className="campo"><span>Notas (color deseado, alergias…)</span><input value={f.notas} maxLength={500} onChange={(e) => setF({ ...f, notas: e.target.value })} /></label>
        <div className="fila-acciones">
          <button className="boton primario" disabled={guardando} onClick={() => void crear()}>{guardando ? "Guardando…" : origen === "CITA" ? "Agendar" : "Anotar turno"}</button>
          <button className="boton" onClick={onCerrar}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ Servicios
function Servicios({ aviso }: { aviso: Aviso_ }) {
  const lista = useDatos<Servicio[]>("/central/salon/servicios");
  const { productos } = useCatalogo();
  const aux = useDatos<{ impuestos: { id: string; nombre: string; tasa: number }[] }>("/central/productos-auxiliares");
  const [nuevo, setNuevo] = useState(false);
  const [nombre, setNombre] = useState("");
  const [dur, setDur] = useState("30");
  const [tipo, setTipo] = useState<"PORCIENTO" | "MONTO">("PORCIENTO");
  const [comision, setComision] = useState("");
  const [precios, setPrecios] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);
  const presentacion = (id: string) => {
    for (const p of productos) { const x = p.presentaciones.find((y) => y.id === id); if (x) return `${p.nombre}${x.nombre !== "Unidad" ? ` · ${x.nombre}` : ""}`; }
    return "—";
  };
  const crear = async () => {
    if (nombre.trim().length < 2) return aviso("Escriba el nombre del servicio.", "error");
    const vars = VARIANTES.filter(([id]) => num(precios[id] ?? "") > 0);
    if (!vars.length) return aviso("Escriba el precio (use «Único» si no depende del largo del cabello).", "error");
    const itbis = aux.datos?.impuestos.find((i) => i.tasa === 0.18) ?? aux.datos?.impuestos[0];
    if (!itbis) return aviso("No hay ITBIS configurado.", "error");
    setGuardando(true);
    try {
      // Un producto de tipo servicio con una presentación por variante: así factura, ITBIS y comprobante funcionan como en cualquier venta
      const p = await api<{ id: string }>("/central/productos", { metodo: "POST", cuerpo: {
        sku: "SAL" + Date.now().toString(36).slice(-6).toUpperCase(), nombre: nombre.trim(), tipo: "SERVICIO", impuestoId: itbis.id, precioIncluyeItbis: true, categoriaId: null,
        presentaciones: vars.map(([id, n]) => ({ nombre: n, factor: "1", codigos: [], precios: { "1": num(precios[id]).toFixed(2) }, porcentajes: {}, bases: {} })),
        sucursales: [], proveedores: [],
      } });
      const det = await api<{ presentaciones: { id: string; nombre: string }[] }>(`/central/productos/${p.id}`);
      const map: Record<string, string> = {};
      for (const [id, n] of vars) { const pr = det.presentaciones.find((x) => x.nombre === n); if (pr) map[id] = pr.id; }
      await api("/central/salon/servicios", { metodo: "POST", cuerpo: { nombre: nombre.trim(), duracionMin: num(dur) || 30, presentaciones: map, comisionTipo: tipo, comision: num(comision), activo: true, insumos: [] } });
      window.dispatchEvent(new Event("factpos:catalogo"));
      setNuevo(false); setNombre(""); setDur("30"); setComision(""); setPrecios({}); aviso("Servicio creado."); void lista.recargar();
    } catch (e) { aviso((e as Error).message, "error"); }
    setGuardando(false);
  };
  const guardar = async (s: Servicio, cambios: Partial<Servicio>) => {
    const n = { ...s, ...cambios };
    try {
      await api(`/central/salon/servicios/${s.id}`, { metodo: "PUT", cuerpo: {
        nombre: n.nombre, descripcion: n.descripcion, duracionMin: n.duracionMin, presentaciones: n.presentaciones, comisionTipo: n.comisionTipo, comision: Number(n.comision), activo: n.activo, insumos: n.insumos } });
      void lista.recargar();
    } catch (e) { aviso((e as Error).message, "error"); }
  };
  return (
    <>
      <Aviso texto={lista.error} />
      <div className="fila-acciones" style={{ marginBottom: 10 }}><button className="boton primario" onClick={() => setNuevo(!nuevo)}>{nuevo ? "Cerrar" : "Nuevo servicio"}</button></div>
      {nuevo && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Nuevo servicio</h3>
          <div className="dos-col">
            <label className="campo"><span>Nombre (Corte, Tinte, Barba, Manicure…)</span><input value={nombre} maxLength={80} onChange={(e) => setNombre(e.target.value)} /></label>
            <label className="campo"><span>Duración (minutos)</span><input className="numero" inputMode="numeric" value={dur} onChange={(e) => setDur(e.target.value.replace(/\D/g, ""))} /></label>
            <label className="campo"><span>Comisión del estilista</span>
              <select value={tipo} onChange={(e) => setTipo(e.target.value as "PORCIENTO" | "MONTO")}><option value="PORCIENTO">% de lo cobrado (sin ITBIS)</option><option value="MONTO">Monto fijo por servicio</option></select></label>
            <label className="campo"><span>{tipo === "PORCIENTO" ? "Porcentaje (%)" : "Monto (RD$)"}</span><input className="numero" inputMode="decimal" value={comision} onChange={(e) => setComision(e.target.value.replace(/[^\d.]/g, ""))} /></label>
          </div>
          <p className="suave pequeno">Precio con ITBIS incluido. Si no depende del largo del cabello, escriba solo «Único»; deje en blanco lo que no use.</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 8 }}>
            {VARIANTES.map(([id, n]) => <label key={id} className="campo"><span>{n}</span>
              <input className="numero" inputMode="decimal" value={precios[id] ?? ""} onChange={(e) => setPrecios({ ...precios, [id]: e.target.value.replace(/[^\d.]/g, "") })} /></label>)}
          </div>
          <button className="boton primario" disabled={guardando} onClick={() => void crear()}>{guardando ? "Creando…" : "Crear servicio"}</button>
        </div>
      )}
      <div className="panel">
        {!(lista.datos ?? []).length && <p className="suave">Todavía no hay servicios. Cree el primero con «Nuevo servicio».</p>}
        {(lista.datos ?? []).map((s) => (
          <div key={s.id} className="tarjeta" style={{ marginBottom: 8, opacity: s.activo ? 1 : 0.6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <b>{s.nombre} <span className="suave pequeno">· {duracion(s.duracionMin)}</span></b>
              <span className="en-linea" style={{ flexWrap: "wrap" }}>
                <label className="en-linea">Min <input className="numero" style={{ width: 60 }} inputMode="numeric" defaultValue={s.duracionMin} onBlur={(e) => num(e.target.value) >= 5 && num(e.target.value) !== s.duracionMin && void guardar(s, { duracionMin: num(e.target.value) })} /></label>
                <select value={s.comisionTipo} onChange={(e) => void guardar(s, { comisionTipo: e.target.value as "PORCIENTO" | "MONTO" })} aria-label="Tipo de comisión"><option value="PORCIENTO">%</option><option value="MONTO">RD$</option></select>
                <input className="numero" style={{ width: 70 }} inputMode="decimal" aria-label="Comisión" defaultValue={Number(s.comision)} onBlur={(e) => num(e.target.value) !== Number(s.comision) && void guardar(s, { comision: String(num(e.target.value)) })} />
                <button className="boton" onClick={() => void guardar(s, { activo: !s.activo })}>{s.activo ? "Desactivar" : "Activar"}</button>
              </span>
            </div>
            <ul className="pequeno" style={{ margin: "6px 0 0 18px", padding: 0 }}>
              {VARIANTES.filter(([id]) => s.presentaciones[id]).map(([id, n]) => <li key={id}>{n}: {presentacion(s.presentaciones[id])}</li>)}
            </ul>
            <Insumos s={s} nombreDe={(id) => productos.find((p) => p.id === id)?.nombre ?? "Producto"} guardar={(ins) => guardar(s, { insumos: ins })} />
          </div>
        ))}
        <p className="suave pequeno" style={{ margin: "6px 0 0" }}>Los precios se cambian en Productos (cada servicio es un producto de tipo servicio con una presentación por variante).</p>
      </div>
    </>
  );
}

/** Lo que gasta cada servicio: al terminarlo se descuenta del inventario (opcional) */
function Insumos({ s, nombreDe, guardar }: { s: Servicio; nombreDe: (id: string) => string; guardar: (ins: Insumo[]) => void }) {
  const { productos } = useCatalogo();
  const [abierto, setAbierto] = useState(false);
  const [q, setQ] = useState("");
  const [pid, setPid] = useState("");
  const [cant, setCant] = useState("1");
  const opciones = productos.filter((p) => !s.insumos.some((i) => i.productoId === p.id) && (!q.trim() || p.nombre.toLowerCase().includes(q.trim().toLowerCase()) || p.sku.toLowerCase().includes(q.trim().toLowerCase()))).slice(0, 50);
  return (
    <div style={{ marginTop: 6 }}>
      <button className="enlace pequeno" onClick={() => setAbierto(!abierto)}>{abierto ? "Ocultar insumos" : `Insumos por servicio (${s.insumos.length})`}</button>
      {abierto && (
        <div>
          {s.insumos.map((i) => (
            <div key={i.productoId} className="en-linea pequeno" style={{ justifyContent: "space-between" }}>
              <span>{nombreDe(i.productoId)} · {i.cantidad}</span>
              <button className="enlace" aria-label="Quitar insumo" onClick={() => guardar(s.insumos.filter((x) => x.productoId !== i.productoId))}>✕</button>
            </div>
          ))}
          {!s.insumos.length && <p className="suave pequeno" style={{ margin: "4px 0" }}>Sin insumos: el servicio no mueve inventario.</p>}
          <div className="en-linea" style={{ flexWrap: "wrap", gap: 6, marginTop: 4 }}>
            <input placeholder="Buscar producto…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 170, flex: "none" }} />
            <select value={pid} onChange={(e) => setPid(e.target.value)} style={{ width: 240, flex: "none" }}>
              <option value="">Elija el insumo…</option>
              {opciones.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
            <input className="numero" style={{ width: 80, flex: "none" }} inputMode="decimal" value={cant} onChange={(e) => setCant(e.target.value.replace(/[^\d.]/g, ""))} aria-label="Cantidad por servicio" />
            <button className="boton" disabled={!pid || !num(cant)} onClick={() => { guardar([...s.insumos, { productoId: pid, cantidad: num(cant) }]); setPid(""); setCant("1"); setQ(""); }}>Agregar</button>
          </div>
          <p className="suave pequeno" style={{ margin: "4px 0 0" }}>Cantidad por cada servicio, en la unidad del producto (por ejemplo, 1 tubo de tinte).</p>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ Equipo y sillas
function Equipo({ aviso }: { aviso: Aviso_ }) {
  const estilistas = useDatos<Estilista[]>("/central/salon/estilistas");
  const sillas = useDatos<Silla[]>("/central/salon/sillas");
  const { sucursales } = useCatalogo();
  const [ne, setNe] = useState(""); const [tel, setTel] = useState(""); const [ns, setNs] = useState(""); const [suc, setSuc] = useState(sucursales[0]?.id ?? "");
  const ir = async (fn: () => Promise<unknown>, ok: string, recargar: () => void) => { try { await fn(); aviso(ok); recargar(); } catch (e) { aviso((e as Error).message, "error"); } };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 12, alignItems: "start" }}>
      <div className="panel" style={{ minWidth: 0 }}>
        <h3 style={{ marginTop: 0 }}>Estilistas y barberos</h3>
        {(estilistas.datos ?? []).map((l) => (
          <div key={l.id} className="en-linea" style={{ justifyContent: "space-between", marginBottom: 6, opacity: l.activo ? 1 : 0.6 }}>
            <span>{l.nombre}{l.telefono ? <span className="suave"> · {l.telefono}</span> : ""}</span>
            <button className="boton" onClick={() => void ir(() => api(`/central/salon/estilistas/${l.id}`, { metodo: "PUT", cuerpo: { nombre: l.nombre, telefono: l.telefono, activo: !l.activo } }), l.activo ? "Desactivado." : "Activado.", estilistas.recargar)}>{l.activo ? "Desactivar" : "Activar"}</button>
          </div>
        ))}
        <div className="dos-col">
          <label className="campo"><span>Nombre</span><input value={ne} maxLength={80} onChange={(e) => setNe(e.target.value)} /></label>
          <label className="campo"><span>Teléfono (opcional)</span><input value={tel} maxLength={30} onChange={(e) => setTel(e.target.value)} /></label>
        </div>
        <button className="boton primario" onClick={() => void ir(async () => { await api("/central/salon/estilistas", { metodo: "POST", cuerpo: { nombre: ne, telefono: tel || null } }); setNe(""); setTel(""); }, "Agregado.", estilistas.recargar)}>Agregar</button>
      </div>
      <div className="panel" style={{ minWidth: 0 }}>
        <h3 style={{ marginTop: 0 }}>Sillas y estaciones</h3>
        {(sillas.datos ?? []).map((b) => (
          <div key={b.id} className="en-linea" style={{ justifyContent: "space-between", marginBottom: 6, opacity: b.activa ? 1 : 0.6 }}>
            <span>{b.nombre}{sucursales.length > 1 ? <span className="suave"> · {b.sucursal}</span> : ""}</span>
            <button className="boton" onClick={() => void ir(() => api(`/central/salon/sillas/${b.id}`, { metodo: "PUT", cuerpo: { nombre: b.nombre, activa: !b.activa } }), b.activa ? "Desactivada." : "Activada.", sillas.recargar)}>{b.activa ? "Desactivar" : "Activar"}</button>
          </div>
        ))}
        <div className="dos-col">
          <label className="campo"><span>Nombre (Silla 1, Lavacabezas…)</span><input value={ns} maxLength={40} onChange={(e) => setNs(e.target.value)} /></label>
          {sucursales.length > 1 && <label className="campo"><span>Sucursal</span><select value={suc} onChange={(e) => setSuc(e.target.value)}>{sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}</select></label>}
        </div>
        <button className="boton primario" onClick={() => void ir(async () => { await api("/central/salon/sillas", { metodo: "POST", cuerpo: { nombre: ns, sucursalId: suc || undefined } }); setNs(""); }, "Silla agregada.", sillas.recargar)}>Agregar silla</button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ Clientes (historial de visitas)
function Clientes() {
  const [q, setQ] = useState("");
  const lista = useDatos<Cita[]>(`/central/salon/citas?vista=historial&q=${encodeURIComponent(q)}`, [q]);
  const filas = lista.datos ?? [];
  return (
    <div className="panel">
      <label className="campo"><span>Buscar un cliente por nombre o teléfono</span><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Mínimo 3 letras o números" /></label>
      <Aviso texto={lista.error} />
      {q.trim().length >= 3 && !filas.length && <p className="suave">No hay visitas cobradas de ese cliente.</p>}
      {filas.length > 0 && (
        <table className="tabla">
          <thead><tr><th>Fecha</th><th>Cliente</th><th>Servicios</th><th>Lo atendió</th></tr></thead>
          <tbody>
            {filas.map((c) => (
              <tr key={c.id}>
                <td>{new Date(c.inicioEn).toLocaleDateString("es-DO", { ...ZONA, day: "numeric", month: "short", year: "numeric" })}</td>
                <td>{c.nombre}{c.telefono && <a className="pequeno" style={{ marginLeft: 6 }} target="_blank" rel="noreferrer" href={whatsapp(c.telefono, `Hola ${c.nombre.split(" ")[0]}, ¡ya toca su próxima visita! Escríbanos y le agendamos.`)}>WhatsApp</a>}</td>
                <td>{resumen(c)}</td><td>{c.estilista ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="suave pequeno">Para recordarle a un cliente que ya le toca su retoque: búsquelo aquí, mire cuándo fue su última visita y escríbale por WhatsApp.</p>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ Comisiones
function Comisiones({ aviso }: { aviso: Aviso_ }) {
  const hoy = hoyRD();
  const [desde, setDesde] = useState(hoy.slice(0, 8) + "01");
  const [hasta, setHasta] = useState(hoy);
  const lista = useDatos<{ estilistaId: string; estilista: string; servicios: number; total: string; pendiente: string }[]>(`/central/salon/comisiones?desde=${desde}&hasta=${hasta}`, [desde, hasta]);
  const filas = lista.datos ?? [];
  const totales = useMemo(() => filas.reduce((a, f) => ({ servicios: a.servicios + f.servicios, total: a.total + Number(f.total), pendiente: a.pendiente + Number(f.pendiente) }), { servicios: 0, total: 0, pendiente: 0 }), [filas]);
  const liquidar = async (f: { estilistaId: string; estilista: string; pendiente: string }) => {
    if (!confirm(`Marcar como pagado lo pendiente de ${f.estilista} (${rd(Number(f.pendiente))}) hasta el ${hasta.split("-").reverse().join("/")}?\n\nEl pago en sí se hace fuera del sistema.`)) return;
    try { const r = await api<{ citas: number; total: string }>("/central/salon/comisiones/liquidar", { metodo: "POST", cuerpo: { estilistaId: f.estilistaId, hasta } }); aviso(`Liquidado: ${r.citas} servicios por ${rd(Number(r.total))}.`); void lista.recargar(); }
    catch (e) { aviso((e as Error).message, "error"); }
  };
  return (
    <div className="panel">
      <div className="dos-col">
        <label className="campo"><span>Desde</span><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
        <label className="campo"><span>Hasta</span><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
      </div>
      <Aviso texto={lista.error} />
      <table className="tabla">
        <thead><tr><th>Estilista</th><th className="der">Citas cobradas</th><th className="der">Comisión</th><th className="der">Pendiente de pago</th><th /></tr></thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.estilistaId}><td>{f.estilista}</td><td className="der">{f.servicios}</td><td className="der">{rd(Number(f.total))}</td><td className="der">{rd(Number(f.pendiente))}</td>
              <td className="der">{Number(f.pendiente) > 0 && <button className="boton" onClick={() => void liquidar(f)}>Marcar pagado</button>}</td></tr>
          ))}
          {!filas.length && <tr><td colSpan={5} className="suave">No hay citas cobradas en esas fechas.</td></tr>}
        </tbody>
        {filas.length > 0 && <tfoot><tr><th>Total</th><th className="der">{totales.servicios}</th><th className="der">{rd(totales.total)}</th><th className="der">{rd(totales.pendiente)}</th><th /></tr></tfoot>}
      </table>
      <p className="suave pequeno">La comisión se acumula cuando la cita se cobra: un monto fijo por servicio, o el porcentaje de lo realmente facturado (sin ITBIS y con el descuento aplicado).</p>
    </div>
  );
}
