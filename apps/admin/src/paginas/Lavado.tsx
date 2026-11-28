import { useEffect, useMemo, useState } from "react";
import { api, rd } from "../api";
import { Aviso, Encabezado, useCatalogo, useDatos } from "../ui";
import { NuevaFactura, type BaseDuplicada, type ClienteB } from "./NuevaFactura";

/**
 * Lavado de vehículos y auto detailing (módulo LAVADO). El tablero muestra los vehículos del local en tres columnas (en espera, lavando, listos):
 * se recibe el vehículo (la placa trae su ficha), se elige el servicio (el precio depende del tamaño), se asigna lavador y bahía, y al quedar listo
 * se avisa al cliente por WhatsApp y se cobra con una factura normal. El lavador gana una comisión por cada lavado.
 */
const TODOS = [["BICICLETA", "Bicicleta"], ["MOTO", "Motor"], ["CARRO", "Carro"], ["JEEPETA", "Jeepeta"], ["CAMIONETA", "Camioneta"], ["CAMION", "Camión o guagua"]] as const;
/** En la gomera (módulo GOMERA) los vehículos incluyen la bicicleta; en un autolavado no */
function useTamanos() {
  const [taller, setTaller] = useState(false);
  useEffect(() => { api<{ activos: string[] }>("/central/empresa/modulos").then((r) => setTaller(r.activos.includes("GOMERA"))).catch(() => {}); }, []);
  return { taller, tam: taller ? TODOS : TODOS.filter(([id]) => id !== "BICICLETA") };
}
const nombreTamano = (id: string) => TODOS.find(([i]) => i === id)?.[1] ?? id;
interface Linea { servicioId: string; servicio: string; presentacionId: string; cantidad: number; comision: string }
interface Orden {
  id: string; numero: string; estado: "EN_ESPERA" | "LAVANDO" | "LISTO" | "ENTREGADO" | "CANCELADO"; placa: string; vehiculo: string; tamano: string; telefono: string | null; notas: string | null;
  lineas: Linea[]; ventaId: string | null; cliente: string | null; clienteDatos: ClienteB | null; bahiaId: string | null; bahia: string | null; lavadorId: string | null; lavador: string | null;
  entradaEn: string; inicioEn: string | null; listoEn: string | null; comision: string | null; sucursalId: string;
}
interface Insumo { productoId: string; cantidad: number }
interface Servicio { id: string; nombre: string; descripcion: string | null; presentaciones: Record<string, string>; comision: string; insumos: Insumo[]; activo: boolean }
interface Lavador { id: string; nombre: string; telefono: string | null; activo: boolean }
interface Bahia { id: string; nombre: string; activa: boolean; sucursalId: string; sucursal: string }
interface Vehiculo { id: string; placa: string; marca: string | null; modelo: string | null; color: string | null; tamano: string; clienteId: string | null; cliente: string | null; telefono: string | null; lavados: number }
const num = (v: string) => Number(v.replace(/[^\d.]/g, "")) || 0;
const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-DO", { timeZone: "America/Santo_Domingo", hour: "numeric", minute: "2-digit" });
const minutos = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
const duracion = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`);
/** Teléfono dominicano de 10 dígitos → número internacional para wa.me */
const whatsapp = (tel: string, texto: string) => {
  const d = tel.replace(/\D/g, "");
  const n = d.length === 10 ? `1${d}` : d;
  return `https://wa.me/${n}?text=${encodeURIComponent(texto)}`;
};

export function Lavado() {
  const [pestana, setPestana] = useState<"tablero" | "servicios" | "personal" | "comisiones">("tablero");
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" } | null>(null);
  const aviso = (t: string, tipo: "ok" | "error" = "ok") => setMsg({ t, tipo });
  const TABS = [["tablero", "Tablero"], ["servicios", "Servicios y precios"], ["personal", "Lavadores y bahías"], ["comisiones", "Comisiones"]] as const;
  return (
    <>
      <Encabezado titulo="Lavado de vehículos" descripcion="Reciba los vehículos, asigne lavador y bahía, avise al cliente cuando esté listo y cobre con una factura." />
      {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}
      <div className="fila-acciones" style={{ marginBottom: 10 }}>
        {TABS.map(([id, t]) => <button key={id} className={"boton" + (pestana === id ? " primario" : "")} onClick={() => { setPestana(id); setMsg(null); }}>{t}</button>)}
      </div>
      {pestana === "tablero" && <Tablero aviso={aviso} />}
      {pestana === "servicios" && <Servicios aviso={aviso} />}
      {pestana === "personal" && <Personal aviso={aviso} />}
      {pestana === "comisiones" && <Comisiones aviso={aviso} />}
    </>
  );
}

// ------------------------------------------------------------------------------------------------ Tablero
function Tablero({ aviso }: { aviso: (t: string, tipo?: "ok" | "error") => void }) {
  const ordenes = useDatos<Orden[]>("/central/lavado/ordenes?estado=ACTIVAS");
  const lavadores = useDatos<Lavador[]>("/central/lavado/lavadores");
  const bahias = useDatos<Bahia[]>("/central/lavado/bahias");
  const [nueva, setNueva] = useState(false);
  const [cobrando, setCobrando] = useState<Orden | null>(null);
  const actuar = async (ruta: string, cuerpo?: unknown, ok?: string) => {
    try { const r = await api<{ aviso?: string } | null>(ruta, { metodo: "POST", cuerpo: cuerpo ?? {} }); if (r?.aviso) aviso(r.aviso, "error"); else if (ok) aviso(ok); void ordenes.recargar(); }
    catch (e) { aviso((e as Error).message, "error"); }
  };
  if (cobrando) {
    const base: BaseDuplicada = {
      tipo: "E32", notas: `Lavado #${cobrando.numero} · ${cobrando.placa}`, cliente: cobrando.clienteDatos,
      lineas: cobrando.lineas.map((l) => ({ presentacionId: l.presentacionId, nombre: `${l.servicio} · ${nombreTamano(cobrando.tamano)}`, cantidad: String(l.cantidad), descuento: "" })),
    };
    return <NuevaFactura duplicarDe={base} onCerrar={() => setCobrando(null)}
      onCreada={async (ventaId) => {
        try { await api(`/central/lavado/ordenes/${cobrando.id}/factura`, { metodo: "POST", cuerpo: { ventaId } }); aviso(`Lavado #${cobrando.numero} cobrado y entregado.`); }
        catch (e) { aviso(`La factura se emitió, pero la orden no se pudo cerrar: ${(e as Error).message}`, "error"); }
        setCobrando(null); void ordenes.recargar();
      }} />;
  }
  const lista = ordenes.datos ?? [];
  const COL = [["EN_ESPERA", "En espera"], ["LAVANDO", "Lavando"], ["LISTO", "Listos para entregar"]] as const;
  return (
    <>
      <div className="fila-acciones" style={{ marginBottom: 10 }}>
        <button className="boton primario" onClick={() => setNueva(true)}>Recibir vehículo</button>
        <button className="boton" onClick={() => void ordenes.recargar()}>Actualizar</button>
      </div>
      <Aviso texto={ordenes.error} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 12, alignItems: "start" }}>
        {COL.map(([est, titulo]) => {
          const f = lista.filter((o) => o.estado === est);
          return (
            <div key={est} className="panel" style={{ minWidth: 0 }}>
              <h3 style={{ marginTop: 0 }}>{titulo} <span className="suave">({f.length})</span></h3>
              {!f.length && <p className="suave pequeno">Nada por aquí.</p>}
              {f.map((o) => (
                <div key={o.id} className="tarjeta" style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <b style={{ fontSize: "1.15em", letterSpacing: 1 }}>{o.placa}</b>
                    <span className="suave pequeno">#{o.numero} · {o.estado === "LAVANDO" && o.inicioEn ? `lavando ${duracion(minutos(o.inicioEn))}` : o.estado === "LISTO" && o.listoEn ? `listo desde ${hora(o.listoEn)}` : `entró ${hora(o.entradaEn)}`}</span>
                  </div>
                  <div className="pequeno">{o.vehiculo || "Vehículo"} · {nombreTamano(o.tamano)}{o.cliente ? ` · ${o.cliente}` : ""}</div>
                  <ul style={{ margin: "6px 0 6px 18px", padding: 0 }}>{o.lineas.map((l) => <li key={l.servicioId}>{l.servicio}{l.cantidad > 1 ? ` × ${l.cantidad}` : ""}</li>)}</ul>
                  {o.notas && <p className="suave pequeno" style={{ margin: "0 0 6px" }}>{o.notas}</p>}
                  {(o.estado === "EN_ESPERA" || o.estado === "LAVANDO") ? (
                    <div className="dos-col">
                      <label className="campo"><span>Lavador</span>
                        <select value={o.lavadorId ?? ""} onChange={(e) => void actuar(`/central/lavado/ordenes/${o.id}/asignar`, { lavadorId: e.target.value || null, bahiaId: o.bahiaId })}>
                          <option value="">Sin asignar</option>
                          {(lavadores.datos ?? []).filter((l) => l.activo || l.id === o.lavadorId).map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
                        </select></label>
                      <label className="campo"><span>Bahía</span>
                        <select value={o.bahiaId ?? ""} onChange={(e) => void actuar(`/central/lavado/ordenes/${o.id}/asignar`, { lavadorId: o.lavadorId, bahiaId: e.target.value || null })}>
                          <option value="">Sin bahía</option>
                          {(bahias.datos ?? []).filter((b) => b.sucursalId === o.sucursalId && (b.activa || b.id === o.bahiaId)).map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
                        </select></label>
                    </div>
                  ) : <p className="pequeno" style={{ margin: "0 0 6px" }}>{o.lavador ? `Lavó: ${o.lavador}` : "Sin lavador"}{o.bahia ? ` · ${o.bahia}` : ""}{o.comision ? ` · comisión ${rd(Number(o.comision))}` : ""}</p>}
                  <div className="fila-acciones" style={{ flexWrap: "wrap" }}>
                    {o.estado === "EN_ESPERA" && <button className="boton primario" onClick={() => void actuar(`/central/lavado/ordenes/${o.id}/estado`, { estado: "LAVANDO" })}>Empezar</button>}
                    {o.estado === "LAVANDO" && <button className="boton primario" onClick={() => void actuar(`/central/lavado/ordenes/${o.id}/estado`, { estado: "LISTO" })}>Terminar</button>}
                    {o.estado === "LISTO" && <>
                      <button className="boton primario" onClick={() => setCobrando(o)}>Cobrar y entregar</button>
                      {o.telefono && <a className="boton" target="_blank" rel="noreferrer"
                        href={whatsapp(o.telefono, `Hola${o.cliente ? ` ${o.cliente.split(" ")[0]}` : ""}, su vehículo placa ${o.placa} ya está listo. ¡Lo esperamos!`)}>Avisar por WhatsApp</a>}
                    </>}
                    <button className="boton" onClick={() => confirm(`¿Cancelar la orden #${o.numero} (${o.placa})?`) && void actuar(`/central/lavado/ordenes/${o.id}/estado`, { estado: "CANCELADO" }, "Orden cancelada.")}>Cancelar</button>
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
      {nueva && <NuevaOrden onCerrar={() => setNueva(false)} onCreada={(n) => { setNueva(false); aviso(`Orden #${n} creada.`); void ordenes.recargar(); }} lavadores={lavadores.datos ?? []} bahias={bahias.datos ?? []} />}
    </>
  );
}

function NuevaOrden({ onCerrar, onCreada, lavadores, bahias }: { onCerrar: () => void; onCreada: (numero: string) => void; lavadores: Lavador[]; bahias: Bahia[] }) {
  const { sucursales } = useCatalogo();
  const { taller, tam } = useTamanos();
  const [sinPlaca, setSinPlaca] = useState(false);
  const servicios = useDatos<Servicio[]>("/central/lavado/servicios");
  const [placa, setPlaca] = useState("");
  const [encontrados, setEncontrados] = useState<Vehiculo[]>([]);
  const [veh, setVeh] = useState<Vehiculo | null>(null);
  const [f, setF] = useState({ marca: "", modelo: "", color: "", tamano: "CARRO", telefono: "" });
  const [elegidos, setElegidos] = useState<Record<string, number>>({});
  const [lavadorId, setLavadorId] = useState("");
  const [bahiaId, setBahiaId] = useState("");
  const [sucursalId, setSucursalId] = useState(sucursales[0]?.id ?? "");
  const [notas, setNotas] = useState("");
  const [msg, setMsg] = useState("");
  const [guardando, setGuardando] = useState(false);
  const buscar = async (v: string) => {
    setPlaca(v); setVeh(null);
    if (v.trim().length < 2) return setEncontrados([]);
    try { setEncontrados(await api<Vehiculo[]>(`/central/lavado/vehiculos?q=${encodeURIComponent(v.trim())}`)); } catch { setEncontrados([]); }
  };
  const elegir = (v: Vehiculo) => {
    setVeh(v); setPlaca(v.placa); setEncontrados([]);
    setF({ marca: v.marca ?? "", modelo: v.modelo ?? "", color: v.color ?? "", tamano: v.tamano, telefono: v.telefono ?? "" });
  };
  const activos = (servicios.datos ?? []).filter((s) => s.activo);
  const sinPrecio = activos.filter((s) => elegidos[s.id] && !s.presentaciones[f.tamano]);
  const crear = async () => {
    setMsg("");
    if (!sinPlaca && placa.trim().length < 3) return setMsg("Escriba la placa.");
    if (!Object.values(elegidos).some((n) => n > 0)) return setMsg("Elija al menos un servicio.");
    if (sinPrecio.length) return setMsg(`«${sinPrecio[0].nombre}» no tiene precio para ${nombreTamano(f.tamano).toLowerCase()}.`);
    setGuardando(true);
    try {
      // Sin placa (pinchazo de una bicicleta o un motor): no se crea ficha del vehículo, solo el tipo
      const v = sinPlaca ? null : await api<{ id: string }>("/central/lavado/vehiculos", { metodo: "POST", cuerpo: {
        placa, marca: f.marca || null, modelo: f.modelo || null, color: f.color || null, tamano: f.tamano, clienteId: veh?.clienteId ?? null } });
      const r = await api<{ numero: string }>("/central/lavado/ordenes", { metodo: "POST", cuerpo: {
        ...(v ? { vehiculoId: v.id } : { tamano: f.tamano, descripcion: f.marca || null }), sucursalId: sucursalId || undefined, lavadorId: lavadorId || null, bahiaId: bahiaId || null, telefono: f.telefono.trim() || null, notas: notas.trim() || null,
        servicios: Object.entries(elegidos).filter(([, n]) => n > 0).map(([servicioId, cantidad]) => ({ servicioId, cantidad })) } });
      onCreada(r.numero);
    } catch (e) { setMsg((e as Error).message); setGuardando(false); }
  };
  return (
    <div className="fondo-modal" onMouseDown={onCerrar}>
      <div className="modal" style={{ maxWidth: 640 }} onMouseDown={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>{taller ? "Recibir trabajo" : "Recibir vehículo"}</h3>
        <Aviso texto={msg} />
        {taller && <label style={{ display: "block", margin: "0 0 6px" }}><input type="checkbox" checked={sinPlaca} onChange={(e) => setSinPlaca(e.target.checked)} /> Sin placa (bicicleta, motor o trabajo rápido)</label>}
        {!sinPlaca && <label className="campo"><span>Placa</span>
          <input autoFocus value={placa} maxLength={14} style={{ textTransform: "uppercase" }} onChange={(e) => void buscar(e.target.value)} placeholder="A123456" /></label>}
        {encontrados.length > 0 && <div className="desplegable" style={{ position: "static", marginBottom: 8 }}>{encontrados.map((v) => (
          <button key={v.id} onMouseDown={(e) => { e.preventDefault(); elegir(v); }}><b>{v.placa}</b> <span className="suave">{[v.marca, v.modelo, v.color].filter(Boolean).join(" ")} · {nombreTamano(v.tamano)}{v.cliente ? ` · ${v.cliente}` : ""} · {v.lavados} lavados</span></button>))}</div>}
        {veh && <p className="texto-ok pequeno">Vehículo conocido: {veh.lavados} {veh.lavados === 1 ? "lavado" : "lavados"} anteriores.</p>}
        <div className="dos-col">
          <label className="campo"><span>Marca</span><input value={f.marca} maxLength={40} onChange={(e) => setF({ ...f, marca: e.target.value })} /></label>
          <label className="campo"><span>Modelo</span><input value={f.modelo} maxLength={40} onChange={(e) => setF({ ...f, modelo: e.target.value })} /></label>
          <label className="campo"><span>Color</span><input value={f.color} maxLength={30} onChange={(e) => setF({ ...f, color: e.target.value })} /></label>
          <label className="campo"><span>{taller ? "Tipo de vehículo (define el precio)" : "Tamaño (define el precio)"}</span>
            <select value={f.tamano} onChange={(e) => setF({ ...f, tamano: e.target.value })}>{tam.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></label>
          <label className="campo"><span>Teléfono para avisarle (WhatsApp)</span><input inputMode="tel" value={f.telefono} maxLength={30} onChange={(e) => setF({ ...f, telefono: e.target.value })} /></label>
          {sucursales.length > 1 && <label className="campo"><span>Sucursal</span>
            <select value={sucursalId} onChange={(e) => { setSucursalId(e.target.value); setBahiaId(""); }}>{sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}</select></label>}
        </div>
        <h4 style={{ margin: "10px 0 4px" }}>Servicios</h4>
        {!activos.length && <p className="suave pequeno">Todavía no hay servicios: créelos en «Servicios y precios».</p>}
        {activos.map((s) => {
          const ok = !!s.presentaciones[f.tamano];
          return (
            <label key={s.id} className="en-linea" style={{ display: "flex", gap: 8, opacity: ok ? 1 : 0.55, marginBottom: 4 }}>
              <input type="checkbox" checked={!!elegidos[s.id]} onChange={(e) => setElegidos({ ...elegidos, [s.id]: e.target.checked ? 1 : 0 })} />
              <span>{s.nombre}{!ok && <span className="suave"> · sin precio para {nombreTamano(f.tamano).toLowerCase()}</span>}</span>
            </label>
          );
        })}
        <div className="dos-col">
          <label className="campo"><span>Lavador (opcional ahora)</span>
            <select value={lavadorId} onChange={(e) => setLavadorId(e.target.value)}><option value="">Se asigna después</option>{lavadores.filter((l) => l.activo).map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}</select></label>
          <label className="campo"><span>Bahía (opcional)</span>
            <select value={bahiaId} onChange={(e) => setBahiaId(e.target.value)}><option value="">Sin bahía</option>{bahias.filter((b) => b.activa && (!sucursalId || b.sucursalId === sucursalId)).map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}</select></label>
        </div>
        <label className="campo"><span>Notas (rayones, objetos en el vehículo…)</span><input value={notas} maxLength={500} onChange={(e) => setNotas(e.target.value)} /></label>
        <div className="fila-acciones">
          <button className="boton primario" disabled={guardando} onClick={() => void crear()}>{guardando ? "Guardando…" : "Crear orden"}</button>
          <button className="boton" onClick={onCerrar}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ Servicios
function Servicios({ aviso }: { aviso: (t: string, tipo?: "ok" | "error") => void }) {
  const { tam } = useTamanos();
  const lista = useDatos<Servicio[]>("/central/lavado/servicios");
  const { productos } = useCatalogo();
  const aux = useDatos<{ impuestos: { id: string; nombre: string; tasa: number }[]; categorias: { id: string; nombre: string }[] }>("/central/productos-auxiliares");
  const [nuevo, setNuevo] = useState(false);
  const [nombre, setNombre] = useState("");
  const [comision, setComision] = useState("");
  const [precios, setPrecios] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);
  const presentacion = (id: string) => {
    for (const p of productos) { const x = p.presentaciones.find((y) => y.id === id); if (x) return `${p.nombre}${x.nombre !== "Unidad" ? ` · ${x.nombre}` : ""}`; }
    return "—";
  };
  const crear = async () => {
    if (nombre.trim().length < 2) return aviso("Escriba el nombre del servicio.", "error");
    const tams = tam.filter(([id]) => num(precios[id] ?? "") > 0);
    if (!tams.length) return aviso("Escriba el precio de al menos un tamaño.", "error");
    const itbis = aux.datos?.impuestos.find((i) => i.tasa === 0.18) ?? aux.datos?.impuestos[0];
    if (!itbis) return aviso("No hay ITBIS configurado.", "error");
    setGuardando(true);
    try {
      // Un producto de tipo servicio con una presentación por tamaño: así factura, ITBIS y comprobante funcionan como en cualquier venta
      const p = await api<{ id: string }>("/central/productos", { metodo: "POST", cuerpo: {
        sku: "LAV" + Date.now().toString(36).slice(-6).toUpperCase(), nombre: nombre.trim(), tipo: "SERVICIO", impuestoId: itbis.id, precioIncluyeItbis: true, categoriaId: null,
        presentaciones: tams.map(([id, n]) => ({ nombre: n, factor: "1", codigos: [], precios: { "1": num(precios[id]).toFixed(2) }, porcentajes: {}, bases: {} })),
        sucursales: [], proveedores: [],
      } });
      const det = await api<{ presentaciones: { id: string; nombre: string }[] }>(`/central/productos/${p.id}`);
      const map: Record<string, string> = {};
      for (const [id, n] of tams) { const pr = det.presentaciones.find((x) => x.nombre === n); if (pr) map[id] = pr.id; }
      await api("/central/lavado/servicios", { metodo: "POST", cuerpo: { nombre: nombre.trim(), presentaciones: map, comision: num(comision), activo: true, insumos: [] } });
      window.dispatchEvent(new Event("factpos:catalogo"));
      setNuevo(false); setNombre(""); setComision(""); setPrecios({}); aviso("Servicio creado."); void lista.recargar();
    } catch (e) { aviso((e as Error).message, "error"); }
    setGuardando(false);
  };
  const guardar = async (s: Servicio, cambios: Partial<Servicio>) => {
    const n = { ...s, ...cambios };
    try { await api(`/central/lavado/servicios/${s.id}`, { metodo: "PUT", cuerpo: { nombre: n.nombre, descripcion: n.descripcion, presentaciones: n.presentaciones, comision: Number(n.comision), activo: n.activo, insumos: n.insumos } }); void lista.recargar(); }
    catch (e) { aviso((e as Error).message, "error"); }
  };
  return (
    <>
      <Aviso texto={lista.error} />
      <div className="fila-acciones" style={{ marginBottom: 10 }}><button className="boton primario" onClick={() => setNuevo(!nuevo)}>{nuevo ? "Cerrar" : "Nuevo servicio"}</button></div>
      {nuevo && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Nuevo servicio</h3>
          <div className="dos-col">
            <label className="campo"><span>Nombre (Lavado completo, Pulido, Encerado…)</span><input value={nombre} maxLength={80} onChange={(e) => setNombre(e.target.value)} /></label>
            <label className="campo"><span>Comisión del lavador por cada lavado (RD$)</span><input className="numero" inputMode="decimal" value={comision} onChange={(e) => setComision(e.target.value.replace(/[^\d.]/g, ""))} /></label>
          </div>
          <p className="suave pequeno">Precio por tamaño, con ITBIS incluido. Deje en blanco el tamaño que no atiende.</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 8 }}>
            {tam.map(([id, n]) => <label key={id} className="campo"><span>{n}</span>
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
              <b>{s.nombre}</b>
              <span className="en-linea">
                <label className="en-linea">Comisión RD$ <input className="numero" style={{ width: 80 }} inputMode="decimal" defaultValue={Number(s.comision)} onBlur={(e) => num(e.target.value) !== Number(s.comision) && void guardar(s, { comision: String(num(e.target.value)) })} /></label>
                <button className="boton" onClick={() => void guardar(s, { activo: !s.activo })}>{s.activo ? "Desactivar" : "Activar"}</button>
              </span>
            </div>
            <ul className="pequeno" style={{ margin: "6px 0 0 18px", padding: 0 }}>
              {TODOS.filter(([id]) => s.presentaciones[id]).map(([id, n]) => <li key={id}>{n}: {presentacion(s.presentaciones[id])}</li>)}
            </ul>
            <Insumos s={s} nombreDe={(id) => productos.find((p) => p.id === id)?.nombre ?? "Producto"} guardar={(ins) => guardar(s, { insumos: ins })} />
          </div>
        ))}
        <p className="suave pequeno" style={{ margin: "6px 0 0" }}>Los precios se cambian en Productos (cada servicio es un producto de tipo servicio con una presentación por tamaño).</p>
      </div>
    </>
  );
}

/** Lo que gasta cada lavado de un servicio: al quedar listo el lavado se descuenta del inventario (opcional) */
function Insumos({ s, nombreDe, guardar }: { s: Servicio; nombreDe: (id: string) => string; guardar: (ins: Insumo[]) => void }) {
  const { productos } = useCatalogo();
  const [abierto, setAbierto] = useState(false);
  const [q, setQ] = useState("");
  const [pid, setPid] = useState("");
  const [cant, setCant] = useState("1");
  const opciones = productos.filter((p) => !s.insumos.some((i) => i.productoId === p.id) && (!q.trim() || p.nombre.toLowerCase().includes(q.trim().toLowerCase()) || p.sku.toLowerCase().includes(q.trim().toLowerCase()))).slice(0, 50);
  return (
    <div style={{ marginTop: 6 }}>
      <button className="enlace pequeno" onClick={() => setAbierto(!abierto)}>{abierto ? "Ocultar insumos" : `Insumos por lavado (${s.insumos.length})`}</button>
      {abierto && (
        <div>
          {s.insumos.map((i) => (
            <div key={i.productoId} className="en-linea pequeno" style={{ justifyContent: "space-between" }}>
              <span>{nombreDe(i.productoId)} · {i.cantidad}</span>
              <button className="enlace" aria-label="Quitar insumo" onClick={() => guardar(s.insumos.filter((x) => x.productoId !== i.productoId))}>✕</button>
            </div>
          ))}
          {!s.insumos.length && <p className="suave pequeno" style={{ margin: "4px 0" }}>Sin insumos: el lavado no mueve inventario.</p>}
          <div className="en-linea" style={{ flexWrap: "wrap", gap: 6, marginTop: 4 }}>
            <input placeholder="Buscar producto…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 170, flex: "none" }} />
            <select value={pid} onChange={(e) => setPid(e.target.value)} style={{ width: 240, flex: "none" }}>
              <option value="">Elija el insumo…</option>
              {opciones.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
            <input className="numero" style={{ width: 80, flex: "none" }} inputMode="decimal" value={cant} onChange={(e) => setCant(e.target.value.replace(/[^\d.]/g, ""))} aria-label="Cantidad por lavado" />
            <button className="boton" disabled={!pid || !num(cant)} onClick={() => { guardar([...s.insumos, { productoId: pid, cantidad: num(cant) }]); setPid(""); setCant("1"); setQ(""); }}>Agregar</button>
          </div>
          <p className="suave pequeno" style={{ margin: "4px 0 0" }}>Cantidad por cada lavado de este servicio, en la unidad del producto.</p>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ Lavadores y bahías
function Personal({ aviso }: { aviso: (t: string, tipo?: "ok" | "error") => void }) {
  const lavadores = useDatos<Lavador[]>("/central/lavado/lavadores");
  const bahias = useDatos<Bahia[]>("/central/lavado/bahias");
  const { sucursales } = useCatalogo();
  const [nl, setNl] = useState(""); const [tel, setTel] = useState(""); const [nb, setNb] = useState(""); const [suc, setSuc] = useState(sucursales[0]?.id ?? "");
  const ir = async (fn: () => Promise<unknown>, ok: string, recargar: () => void) => { try { await fn(); aviso(ok); recargar(); } catch (e) { aviso((e as Error).message, "error"); } };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 12, alignItems: "start" }}>
      <div className="panel" style={{ minWidth: 0 }}>
        <h3 style={{ marginTop: 0 }}>Lavadores</h3>
        {(lavadores.datos ?? []).map((l) => (
          <div key={l.id} className="en-linea" style={{ justifyContent: "space-between", marginBottom: 6, opacity: l.activo ? 1 : 0.6 }}>
            <span>{l.nombre}{l.telefono ? <span className="suave"> · {l.telefono}</span> : ""}</span>
            <button className="boton" onClick={() => void ir(() => api(`/central/lavado/lavadores/${l.id}`, { metodo: "PUT", cuerpo: { nombre: l.nombre, telefono: l.telefono, activo: !l.activo } }), l.activo ? "Lavador desactivado." : "Lavador activado.", lavadores.recargar)}>{l.activo ? "Desactivar" : "Activar"}</button>
          </div>
        ))}
        <div className="dos-col">
          <label className="campo"><span>Nombre</span><input value={nl} maxLength={80} onChange={(e) => setNl(e.target.value)} /></label>
          <label className="campo"><span>Teléfono (opcional)</span><input value={tel} maxLength={30} onChange={(e) => setTel(e.target.value)} /></label>
        </div>
        <button className="boton primario" onClick={() => void ir(async () => { await api("/central/lavado/lavadores", { metodo: "POST", cuerpo: { nombre: nl, telefono: tel || null } }); setNl(""); setTel(""); }, "Lavador agregado.", lavadores.recargar)}>Agregar lavador</button>
      </div>
      <div className="panel" style={{ minWidth: 0 }}>
        <h3 style={{ marginTop: 0 }}>Bahías</h3>
        {(bahias.datos ?? []).map((b) => (
          <div key={b.id} className="en-linea" style={{ justifyContent: "space-between", marginBottom: 6, opacity: b.activa ? 1 : 0.6 }}>
            <span>{b.nombre}{sucursales.length > 1 ? <span className="suave"> · {b.sucursal}</span> : ""}</span>
            <button className="boton" onClick={() => void ir(() => api(`/central/lavado/bahias/${b.id}`, { metodo: "PUT", cuerpo: { nombre: b.nombre, activa: !b.activa } }), b.activa ? "Bahía desactivada." : "Bahía activada.", bahias.recargar)}>{b.activa ? "Desactivar" : "Activar"}</button>
          </div>
        ))}
        <div className="dos-col">
          <label className="campo"><span>Nombre (Bahía 1, Detailing…)</span><input value={nb} maxLength={40} onChange={(e) => setNb(e.target.value)} /></label>
          {sucursales.length > 1 && <label className="campo"><span>Sucursal</span><select value={suc} onChange={(e) => setSuc(e.target.value)}>{sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}</select></label>}
        </div>
        <button className="boton primario" onClick={() => void ir(async () => { await api("/central/lavado/bahias", { metodo: "POST", cuerpo: { nombre: nb, sucursalId: suc || undefined } }); setNb(""); }, "Bahía agregada.", bahias.recargar)}>Agregar bahía</button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ Comisiones
function Comisiones({ aviso }: { aviso: (t: string, tipo?: "ok" | "error") => void }) {
  const hoy = new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10);
  const [desde, setDesde] = useState(hoy.slice(0, 8) + "01");
  const [hasta, setHasta] = useState(hoy);
  const lista = useDatos<{ lavadorId: string; lavador: string; lavados: number; total: string; pendiente: string }[]>(`/central/lavado/comisiones?desde=${desde}&hasta=${hasta}`, [desde, hasta]);
  const filas = lista.datos ?? [];
  const totales = useMemo(() => filas.reduce((a, f) => ({ lavados: a.lavados + f.lavados, total: a.total + Number(f.total), pendiente: a.pendiente + Number(f.pendiente) }), { lavados: 0, total: 0, pendiente: 0 }), [filas]);
  const liquidar = async (f: { lavadorId: string; lavador: string; pendiente: string }) => {
    if (!confirm(`Marcar como pagado lo pendiente de ${f.lavador} (${rd(Number(f.pendiente))}) hasta el ${hasta.split("-").reverse().join("/")}?\n\nEl pago en sí se hace fuera del sistema.`)) return;
    try { const r = await api<{ ordenes: number; total: string }>("/central/lavado/comisiones/liquidar", { metodo: "POST", cuerpo: { lavadorId: f.lavadorId, hasta } }); aviso(`Liquidado: ${r.ordenes} lavados por ${rd(Number(r.total))}.`); void lista.recargar(); }
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
        <thead><tr><th>Lavador</th><th className="der">Lavados</th><th className="der">Comisión</th><th className="der">Pendiente de pago</th><th /></tr></thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.lavadorId}><td>{f.lavador}</td><td className="der">{f.lavados}</td><td className="der">{rd(Number(f.total))}</td><td className="der">{rd(Number(f.pendiente))}</td>
              <td className="der">{Number(f.pendiente) > 0 && <button className="boton" onClick={() => void liquidar(f)}>Marcar pagado</button>}</td></tr>
          ))}
          {!filas.length && <tr><td colSpan={5} className="suave">No hay lavados terminados en esas fechas.</td></tr>}
        </tbody>
        {filas.length > 0 && <tfoot><tr><th>Total</th><th className="der">{totales.lavados}</th><th className="der">{rd(totales.total)}</th><th className="der">{rd(totales.pendiente)}</th><th /></tr></tfoot>}
      </table>
      <p className="suave pequeno">La comisión se acumula cuando el lavado queda «Listo»: es la suma de lo que gana el lavador por cada servicio de la orden.</p>
    </div>
  );
}
