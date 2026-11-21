import { useEffect, useState } from "react";
import { api, hoy, puede, rd } from "../api";
import { Aviso, Encabezado, useDatos } from "../ui";

/**
 * Entregas programadas: la mercancía de una factura que se lleva a la casa del cliente.
 * Se programa con fecha, franja, chofer y camión; el chofer lleva el documento de entrega (sin precios ni saldos) y el cliente firma la constancia.
 */
interface Entrega {
  id: string; codigo: string; estado: "PROGRAMADA" | "EN_RUTA" | "ENTREGADA" | "NO_ENTREGADA" | "CANCELADA"; fecha: string; franja: "MANANA" | "TARDE" | "DIA";
  direccion: string; referencia: string | null; telefono: string | null; telefono2: string | null; instrucciones: string | null; vehiculo: string | null; orden: number;
  entregadaEn: string | null; recibeNombre: string | null; recibeCedula: string | null; observaciones: string | null; motivoNoEntrega: string | null;
  repartidorId: string | null; chofer: string | null; choferTelefono: string | null; ventaId: string; factura: number; documento: string | null;
  cliente: string | null; clienteDocumento: string | null; sucursal: string; items: { id: string; descripcion: string; cantidad: string; series: string[] }[] | null;
  empresa?: { nombre: string; rnc: string } | null;
}
interface Chofer { id: string; nombre: string; telefono: string | null; vehiculo: string | null; sucursal: string }
interface FacturaB { id: string; numero: number; documento: string | null; fecha: string; clienteId: string | null; cliente: string | null; clienteDocumento: string | null; telefono: string | null; direccion: string | null; sucursal: string }
interface Linea { ventaItemId: string; descripcion: string; pendiente: string; series: string[] }

const FRANJA = { MANANA: "Mañana", TARDE: "Tarde", DIA: "Todo el día" } as const;
const ESTADO = { PROGRAMADA: "Programada", EN_RUTA: "En ruta", ENTREGADA: "Entregada", NO_ENTREGADA: "No entregada", CANCELADA: "Cancelada" } as const;
const fecha = (s: string) => s.split("-").reverse().join("/");
const hora = (iso: string) => new Date(iso).toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", day: "2-digit", month: "short", hour: "numeric", minute: "2-digit" });
const suma = (d: number) => new Date(Date.now() - 4 * 3600e3 + d * 864e5).toISOString().slice(0, 10);

export function Entregas() {
  const editar = puede("admin.entregas");
  const [pestana, setPestana] = useState<"lista" | "nueva" | "ruta">("lista");
  const [desde, setDesde] = useState(hoy());
  const [hasta, setHasta] = useState(suma(7));
  const [estado, setEstado] = useState("PENDIENTES");
  const lista = useDatos<Entrega[]>(`/central/entregas?desde=${desde}&hasta=${hasta}&estado=${estado}`, [desde, hasta, estado]);
  const choferes = useDatos<Chofer[]>("/central/entregas/repartidores");
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" } | null>(null);
  const [doc, setDoc] = useState<string | null>(null);
  const [entregar, setEntregar] = useState<Entrega | null>(null);
  const filas = lista.datos ?? [];

  const accion = async (e: Entrega, ruta: string, cuerpo: Record<string, unknown> = {}) => {
    try { await api(`/central/entregas/${e.id}/${ruta}`, { cuerpo }); setMsg(null); lista.recargar(); } catch (x) { setMsg({ t: (x as Error).message, tipo: "error" }); }
  };
  const noEntregada = (e: Entrega) => { const m = prompt("¿Por qué no se entregó? (cliente ausente, dirección, etc.)"); if (m) accion(e, "no-entregada", { motivo: m }); };
  const reprogramar = async (e: Entrega) => {
    const f = prompt("Nueva fecha (AAAA-MM-DD)", e.fecha < hoy() ? hoy() : e.fecha);
    if (!f) return;
    try { await api(`/central/entregas/${e.id}`, { metodo: "PUT", cuerpo: { fechaProgramada: f } }); lista.recargar(); } catch (x) { setMsg({ t: (x as Error).message, tipo: "error" }); }
  };
  const asignar = async (e: Entrega, repartidorId: string) => {
    const c = choferes.datos?.find((x) => x.id === repartidorId);
    try { await api(`/central/entregas/${e.id}`, { metodo: "PUT", cuerpo: { repartidorId: repartidorId || null, ...(c?.vehiculo && !e.vehiculo ? { vehiculo: c.vehiculo } : {}) } }); lista.recargar(); } catch (x) { setMsg({ t: (x as Error).message, tipo: "error" }); }
  };

  return (
    <>
      <div className="no-imprimir">
        <Encabezado titulo="Entregas" descripcion="Programe la entrega de la mercancía, asigne chofer y camión, e imprima el documento de entrega que lleva el chofer.">
          {editar && <button className="boton primario" onClick={() => setPestana("nueva")}>Nueva entrega</button>}
        </Encabezado>
        {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}
        <Aviso texto={lista.error || choferes.error} />
        <div className="fila-acciones" style={{ marginBottom: 10 }}>
          {([["lista", "Entregas"], ["ruta", "Hoja de ruta del día"]] as const).map(([id, t]) => <button key={id} className={"boton" + (pestana === id ? " primario" : "")} onClick={() => setPestana(id)}>{t}</button>)}
        </div>
      </div>

      {pestana === "nueva" && editar && <NuevaEntrega choferes={choferes.datos ?? []} onCerrar={() => setPestana("lista")} onListo={(t) => { setMsg({ t, tipo: "ok" }); setPestana("lista"); lista.recargar(); }} />}

      {pestana === "lista" && (
        <>
          <div className="panel cab-compra no-imprimir">
            <label className="campo"><span>Desde</span><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
            <label className="campo"><span>Hasta</span><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
            <label className="campo"><span>Estado</span>
              <select value={estado} onChange={(e) => setEstado(e.target.value)}><option value="PENDIENTES">Pendientes</option><option value="">Todas</option>{Object.entries(ESTADO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          </div>
          <div className="tarjeta no-imprimir" style={{ overflowX: "auto" }}>
            <table className="tabla">
              <thead><tr><th>Entrega</th><th>Fecha</th><th>Cliente y dirección</th><th>Artículos</th><th>Chofer</th><th>Estado</th><th /></tr></thead>
              <tbody>
                {filas.length === 0 && <tr><td colSpan={7} className="suave">{lista.cargando ? "Cargando…" : "No hay entregas en ese rango."}</td></tr>}
                {filas.map((e) => (
                  <tr key={e.id} style={e.estado === "CANCELADA" ? { opacity: 0.5 } : undefined}>
                    <td><b>{e.codigo}</b><div className="suave pequeno">Factura #{e.factura}</div></td>
                    <td>{fecha(e.fecha)}<div className="suave pequeno">{FRANJA[e.franja]}</div></td>
                    <td><b>{e.cliente ?? "Cliente"}</b>{e.telefono && <span className="suave"> · {e.telefono}</span>}<div className="suave pequeno">{e.direccion}{e.referencia ? ` (${e.referencia})` : ""}</div>
                      {e.motivoNoEntrega && <div className="texto-alerta pequeno">No se entregó: {e.motivoNoEntrega}</div>}
                      {e.estado === "ENTREGADA" && <div className="texto-ok pequeno">Recibió {e.recibeNombre}{e.entregadaEn ? ` · ${hora(e.entregadaEn)}` : ""}{e.observaciones ? ` · ${e.observaciones}` : ""}</div>}</td>
                    <td>{(e.items ?? []).map((i) => <div key={i.id}>{Number(i.cantidad)} × {i.descripcion}{i.series.length > 0 && <span className="suave pequeno"> · {i.series.join(", ")}</span>}</div>)}</td>
                    <td>{editar && ["PROGRAMADA", "NO_ENTREGADA"].includes(e.estado)
                      ? <select value={e.repartidorId ?? ""} onChange={(x) => asignar(e, x.target.value)}><option value="">Sin chofer</option>{(choferes.datos ?? []).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select>
                      : e.chofer ?? "—"}{e.vehiculo && <div className="suave pequeno">{e.vehiculo}</div>}</td>
                    <td><span className={"pastilla" + (e.estado === "ENTREGADA" ? " recibida" : "")}>{ESTADO[e.estado]}</span></td>
                    <td className="der" style={{ whiteSpace: "nowrap" }}>
                      <button className="boton chico" onClick={() => setDoc(e.id)}>Documento</button>{" "}
                      {editar && e.estado === "PROGRAMADA" && <><button className="boton chico" onClick={() => accion(e, "salir")}>Sale a ruta</button>{" "}</>}
                      {editar && ["PROGRAMADA", "EN_RUTA"].includes(e.estado) && <><button className="boton chico primario" onClick={() => setEntregar(e)}>Entregada</button>{" "}<button className="boton chico" onClick={() => noEntregada(e)}>No se pudo</button>{" "}</>}
                      {editar && ["PROGRAMADA", "NO_ENTREGADA"].includes(e.estado) && <><button className="boton chico" onClick={() => reprogramar(e)}>Reprogramar</button>{" "}<button className="boton chico" onClick={() => confirm(`¿Cancelar la entrega ${e.codigo}?`) && accion(e, "cancelar")}>Cancelar</button></>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {pestana === "ruta" && <HojaRuta choferes={choferes.datos ?? []} />}
      {doc && <DocumentoModal id={doc} onCerrar={() => setDoc(null)} />}
      {entregar && <Constancia e={entregar} onCerrar={() => setEntregar(null)} onListo={() => { setEntregar(null); lista.recargar(); }} onError={(t) => setMsg({ t, tipo: "error" })} />}
    </>
  );
}

function Constancia({ e, onCerrar, onListo, onError }: { e: Entrega; onCerrar: () => void; onListo: () => void; onError: (t: string) => void }) {
  const [nombre, setNombre] = useState(e.cliente ?? "");
  const [cedula, setCedula] = useState("");
  const [obs, setObs] = useState("");
  const guardar = async () => {
    try { await api(`/central/entregas/${e.id}/entregar`, { cuerpo: { recibeNombre: nombre.trim(), ...(cedula.trim() ? { recibeCedula: cedula.trim() } : {}), ...(obs.trim() ? { observaciones: obs.trim() } : {}) } }); onListo(); } catch (x) { onError((x as Error).message); onCerrar(); }
  };
  return (
    <div className="fondo-modal" onMouseDown={onCerrar}>
      <div className="modal" onMouseDown={(x) => x.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>Constancia de entrega · {e.codigo}</h2>
        <p className="suave">Anote lo que dice el documento firmado que devolvió el chofer.</p>
        <label className="campo"><span>Quién recibió</span><input value={nombre} onChange={(x) => setNombre(x.target.value)} /></label>
        <label className="campo"><span>Cédula de quien recibió (opcional)</span><input value={cedula} maxLength={20} onChange={(x) => setCedula(x.target.value)} /></label>
        <label className="campo"><span>Daños o faltantes (opcional)</span><input value={obs} maxLength={400} onChange={(x) => setObs(x.target.value)} /></label>
        <div className="fila-acciones"><button className="boton primario" disabled={nombre.trim().length < 3} onClick={guardar}>Marcar entregada</button><button className="boton" onClick={onCerrar}>Cancelar</button></div>
      </div>
    </div>
  );
}

/** El documento que se le da al chofer: sin precios ni saldos, con la constancia de recibido para firmar */
export function DocumentoEntrega({ e }: { e: Entrega }) {
  const unidades = (e.items ?? []).reduce((a, i) => a + Number(i.cantidad), 0);
  return (
    <div className="doc-entrega" style={{ pageBreakAfter: "always", padding: "8px 4px", color: "#000" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, borderBottom: "2px solid #000", paddingBottom: 8 }}>
        <div><b style={{ fontSize: "1.3em" }}>{e.empresa?.nombre ?? ""}</b>{e.empresa?.rnc && <div>RNC {e.empresa.rnc}</div>}<div>{e.sucursal}</div></div>
        <div style={{ textAlign: "right" }}><b style={{ fontSize: "1.4em", letterSpacing: ".04em" }}>DOCUMENTO DE ENTREGA</b><div>No. {e.codigo}</div><div>Factura #{e.factura}{e.documento ? ` · ${e.documento}` : ""}</div></div>
      </div>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", margin: "10px 0" }}>
        <div style={{ flex: "1 1 300px" }}>
          <b>Entregar a</b><div style={{ fontSize: "1.1em" }}>{e.cliente ?? "Cliente"}{e.clienteDocumento ? ` · ${e.clienteDocumento}` : ""}</div>
          <div>{e.direccion}</div>{e.referencia && <div>Referencia: {e.referencia}</div>}
          <div>Tel.: {e.telefono ?? "—"}{e.telefono2 ? ` / ${e.telefono2}` : ""}</div>
        </div>
        <div style={{ flex: "1 1 220px" }}>
          <b>Programada</b><div>{fecha(e.fecha)} · {FRANJA[e.franja]}</div>
          <div>Chofer: <b>{e.chofer ?? "________________"}</b>{e.choferTelefono ? ` · ${e.choferTelefono}` : ""}</div>
          <div>Camión: {e.vehiculo ?? "________________"}</div>
        </div>
      </div>
      {e.instrucciones && <p style={{ border: "1px solid #000", padding: "6px 8px", margin: "6px 0" }}><b>Instrucciones:</b> {e.instrucciones}</p>}
      <table style={{ width: "100%", borderCollapse: "collapse", margin: "8px 0" }}>
        <thead><tr style={{ borderBottom: "1px solid #000", textAlign: "left" }}><th style={{ width: 28 }}>Cargó</th><th>Artículo</th><th>Serie</th><th style={{ textAlign: "right" }}>Cant.</th></tr></thead>
        <tbody>{(e.items ?? []).map((i) => (
          <tr key={i.id} style={{ borderBottom: "1px solid #bbb" }}><td style={{ padding: "6px 0" }}>☐</td><td>{i.descripcion}</td><td>{i.series.join(", ") || "—"}</td><td style={{ textAlign: "right" }}>{Number(i.cantidad)}</td></tr>))}
        </tbody>
        <tfoot><tr><td colSpan={3} style={{ textAlign: "right", paddingTop: 4 }}><b>Total de piezas</b></td><td style={{ textAlign: "right", paddingTop: 4 }}><b>{unidades}</b></td></tr></tfoot>
      </table>
      <div style={{ border: "1px solid #000", padding: "8px 10px", marginTop: 14 }}>
        <b>CONSTANCIA DE ENTREGA</b>
        <p style={{ margin: "4px 0" }}>Recibí la mercancía descrita arriba, completa y en buen estado, salvo lo anotado.</p>
        <div style={{ margin: "6px 0" }}>Daños o faltantes: ______________________________________________________________</div>
        <div style={{ margin: "6px 0" }}>______________________________________________________________________________</div>
        <div style={{ display: "flex", gap: 24, marginTop: 28 }}>
          <div style={{ flex: 1, borderTop: "1px solid #000", paddingTop: 4 }}>Nombre y firma de quien recibe</div>
          <div style={{ flex: 1, borderTop: "1px solid #000", paddingTop: 4 }}>Cédula</div>
          <div style={{ flex: 1, borderTop: "1px solid #000", paddingTop: 4 }}>Fecha y hora</div>
        </div>
        <div style={{ display: "flex", gap: 24, marginTop: 28 }}><div style={{ flex: 1, borderTop: "1px solid #000", paddingTop: 4 }}>Firma del chofer</div><div style={{ flex: 1 }} /><div style={{ flex: 1 }} /></div>
      </div>
      <p style={{ fontSize: ".85em", marginTop: 8 }}>Devuelva este documento firmado a la tienda. Documento no fiscal; no sustituye la factura.</p>
    </div>
  );
}

function DocumentoModal({ id, onCerrar }: { id: string; onCerrar: () => void }) {
  const { datos: e } = useDatos<Entrega>(`/central/entregas/${id}`);
  return (
    <div className="fondo-modal" onMouseDown={onCerrar}>
      <div className="modal ancho" onMouseDown={(x) => x.stopPropagation()}>
        <div className="fila-acciones no-imprimir" style={{ marginTop: 0, marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>Documento de entrega</h2><span className="flex" />
          <button className="boton primario" disabled={!e} onClick={() => window.print()}>Imprimir</button><button className="boton" onClick={onCerrar}>Cerrar</button>
        </div>
        {e ? <DocumentoEntrega e={e} /> : <p className="suave">Cargando…</p>}
      </div>
    </div>
  );
}

/** Hoja de ruta: todas las entregas de un día (y chofer) en orden, y sus documentos para imprimir juntos */
function HojaRuta({ choferes }: { choferes: Chofer[] }) {
  const [dia, setDia] = useState(hoy());
  const [chofer, setChofer] = useState("");
  const lista = useDatos<Entrega[]>(`/central/entregas?desde=${dia}&hasta=${dia}&estado=PENDIENTES${chofer ? `&repartidorId=${chofer}` : ""}`, [dia, chofer]);
  const [docs, setDocs] = useState<Entrega[] | null>(null);
  const [cargando, setCargando] = useState(false);
  const filas = (lista.datos ?? []).filter((e) => e.estado !== "CANCELADA");
  const piezas = filas.reduce((a, e) => a + (e.items ?? []).reduce((s, i) => s + Number(i.cantidad), 0), 0);
  useEffect(() => { setDocs(null); }, [dia, chofer]);
  const verDocumentos = async () => {
    setCargando(true);
    try { setDocs(await Promise.all(filas.map((e) => api<Entrega>(`/central/entregas/${e.id}`)))); } finally { setCargando(false); }
  };
  const nombreChofer = choferes.find((c) => c.id === chofer);
  return (
    <>
      <div className="panel cab-compra no-imprimir">
        <label className="campo"><span>Día</span><input type="date" value={dia} onChange={(e) => setDia(e.target.value)} /></label>
        <label className="campo"><span>Chofer</span><select value={chofer} onChange={(e) => setChofer(e.target.value)}><option value="">Todos</option>{choferes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></label>
        <button className="boton primario" disabled={!filas.length} onClick={() => window.print()}>Imprimir hoja de ruta</button>
        <button className="boton" disabled={!filas.length || cargando} onClick={verDocumentos}>{cargando ? "Preparando…" : "Ver documentos para imprimir"}</button>
      </div>
      <div className="tarjeta">
        <h3 style={{ marginTop: 0 }}>Hoja de ruta · {fecha(dia)}{nombreChofer ? ` · ${nombreChofer.nombre}` : ""}</h3>
        <table className="tabla">
          <thead><tr><th>#</th><th>Entrega</th><th>Cliente</th><th>Dirección</th><th>Teléfono</th><th>Franja</th><th className="der">Piezas</th><th>Chofer</th></tr></thead>
          <tbody>
            {filas.length === 0 && <tr><td colSpan={8} className="suave">{lista.cargando ? "Cargando…" : "No hay entregas pendientes ese día."}</td></tr>}
            {filas.map((e, i) => (
              <tr key={e.id}><td>{i + 1}</td><td>{e.codigo}</td><td><b>{e.cliente}</b></td><td>{e.direccion}{e.referencia ? ` (${e.referencia})` : ""}</td><td>{e.telefono ?? "—"}</td><td>{FRANJA[e.franja]}</td>
                <td className="der">{(e.items ?? []).reduce((s, x) => s + Number(x.cantidad), 0)}</td><td>{e.chofer ?? "—"}</td></tr>
            ))}
          </tbody>
          {filas.length > 0 && <tfoot><tr><td colSpan={6} className="der"><b>{filas.length} entregas</b></td><td className="der"><b>{piezas}</b></td><td /></tr></tfoot>}
        </table>
        <p className="suave pequeno">Sin precios. El camión sale con esta hoja y el documento de cada entrega.</p>
      </div>
      {docs && <div style={{ marginTop: 14 }}>{docs.map((e) => <DocumentoEntrega key={e.id} e={e} />)}</div>}
    </>
  );
}

function NuevaEntrega({ choferes, onCerrar, onListo }: { choferes: Chofer[]; onCerrar: () => void; onListo: (t: string) => void }) {
  const [q, setQ] = useState("");
  const [facturas, setFacturas] = useState<FacturaB[]>([]);
  const [factura, setFactura] = useState<FacturaB | null>(null);
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [sel, setSel] = useState<Record<string, { cant: string; series: string[] }>>({});
  const [dia, setDia] = useState(suma(1));
  const [franja, setFranja] = useState<"MANANA" | "TARDE" | "DIA">("DIA");
  const [direccion, setDireccion] = useState("");
  const [referencia, setReferencia] = useState("");
  const [tel, setTel] = useState(""); const [tel2, setTel2] = useState("");
  const [instr, setInstr] = useState("");
  const [chofer, setChofer] = useState(""); const [vehiculo, setVehiculo] = useState("");
  const [err, setErr] = useState("");
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (q.trim().length < 1 || factura) { setFacturas([]); return; }
    const t = setTimeout(() => api<FacturaB[]>(`/central/entregas/facturas?q=${encodeURIComponent(q.trim())}`).then(setFacturas).catch((e) => setErr((e as Error).message)), 250);
    return () => clearTimeout(t);
  }, [q, factura]);
  const elegir = async (f: FacturaB) => {
    setFactura(f); setFacturas([]); setDireccion(f.direccion ?? ""); setTel(f.telefono ?? ""); setErr("");
    try {
      const l = await api<Linea[]>(`/central/entregas/facturas/${f.id}/lineas`);
      setLineas(l.filter((x) => Number(x.pendiente) > 0));
      setSel(Object.fromEntries(l.filter((x) => Number(x.pendiente) > 0).map((x) => [x.ventaItemId, { cant: Number(x.pendiente).toString(), series: x.series.slice(0, Number(x.pendiente)) }])));
    } catch (e) { setErr((e as Error).message); }
  };
  const items = lineas.filter((l) => Number(sel[l.ventaItemId]?.cant) > 0);
  const problema = !factura ? "Busque la factura." : !items.length ? "Elija lo que se entrega." : direccion.trim().length < 5 ? "Escriba la dirección de entrega." : "";
  const guardar = async () => {
    setGuardando(true); setErr("");
    try {
      const r = await api<{ numero: string }>("/central/entregas", { cuerpo: {
        ventaId: factura!.id, fechaProgramada: dia, franja, direccion: direccion.trim(), ...(referencia.trim() ? { referencia: referencia.trim() } : {}), ...(tel.trim() ? { telefono: tel.trim() } : {}), ...(tel2.trim() ? { telefono2: tel2.trim() } : {}),
        ...(instr.trim() ? { instrucciones: instr.trim() } : {}), ...(chofer ? { repartidorId: chofer } : {}), ...(vehiculo.trim() ? { vehiculo: vehiculo.trim() } : {}),
        items: items.map((l) => ({ ventaItemId: l.ventaItemId, cantidad: sel[l.ventaItemId]!.cant, series: l.series.length ? sel[l.ventaItemId]!.series : [] })),
      } });
      onListo(`Entrega ${r.numero} programada para el ${fecha(dia)}.`);
    } catch (e) { setErr((e as Error).message); setGuardando(false); }
  };
  return (
    <div className="tarjeta no-imprimir" style={{ maxWidth: 900 }}>
      <h3 style={{ marginTop: 0 }}>Nueva entrega</h3>
      <Aviso texto={err} />
      {factura ? <p><b>Factura #{factura.numero}</b>{factura.documento ? ` · ${factura.documento}` : ""} · {factura.cliente ?? "sin cliente"} <button className="boton fantasma chico" onClick={() => { setFactura(null); setLineas([]); setSel({}); }}>Cambiar</button></p> : (
        <div className="selector-producto"><input value={q} placeholder="Buscar la factura por número, comprobante, cliente o cédula…" onChange={(e) => setQ(e.target.value)} />
          {facturas.length > 0 && <div className="desplegable">{facturas.map((f) => <button key={f.id} onMouseDown={(e) => { e.preventDefault(); elegir(f); }}><b>#{f.numero}</b> {f.cliente ?? "Sin cliente"} <span className="suave">{f.documento ?? ""} · {f.sucursal}</span></button>)}</div>}</div>)}
      {factura && lineas.length === 0 && <p className="suave">Esa factura no tiene artículos pendientes por entregar.</p>}
      {lineas.length > 0 && (
        <table className="tabla" style={{ marginTop: 8 }}>
          <thead><tr><th>Artículo</th><th className="der">Pendiente</th><th className="der">Entregar</th><th>Series</th></tr></thead>
          <tbody>{lineas.map((l) => (
            <tr key={l.ventaItemId}><td><b>{l.descripcion}</b></td><td className="der">{Number(l.pendiente)}</td>
              <td className="der"><input className="numero" style={{ width: 70 }} inputMode="decimal" value={sel[l.ventaItemId]?.cant ?? ""} onChange={(e) => setSel((s) => ({ ...s, [l.ventaItemId]: { cant: e.target.value.replace(/[^\d.]/g, ""), series: (s[l.ventaItemId]?.series ?? []).slice(0, Number(e.target.value) || 0) } }))} /></td>
              <td>{l.series.length ? l.series.map((s) => {
                const on = sel[l.ventaItemId]?.series.includes(s);
                return <label key={s} className="en-linea" style={{ marginRight: 8 }}><input type="checkbox" checked={!!on} onChange={(e) => setSel((st) => { const a = st[l.ventaItemId]!; const series = e.target.checked ? [...a.series, s] : a.series.filter((x) => x !== s); return { ...st, [l.ventaItemId]: { cant: String(series.length), series } }; })} /> {s}</label>;
              }) : <span className="suave">—</span>}</td></tr>))}
          </tbody>
        </table>
      )}
      <div className="fila-acciones" style={{ alignItems: "end", flexWrap: "wrap", marginTop: 10 }}>
        <label className="campo"><span>Fecha de entrega</span><input type="date" min={hoy()} value={dia} onChange={(e) => setDia(e.target.value)} /></label>
        <label className="campo"><span>Franja</span><select value={franja} onChange={(e) => setFranja(e.target.value as typeof franja)}>{Object.entries(FRANJA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="campo"><span>Chofer</span><select value={chofer} onChange={(e) => { setChofer(e.target.value); const c = choferes.find((x) => x.id === e.target.value); if (c?.vehiculo && !vehiculo) setVehiculo(c.vehiculo); }}><option value="">Asignar después</option>{choferes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></label>
        <label className="campo"><span>Camión / placa</span><input value={vehiculo} maxLength={40} onChange={(e) => setVehiculo(e.target.value)} /></label>
      </div>
      <label className="campo"><span>Dirección de entrega</span><input value={direccion} maxLength={300} onChange={(e) => setDireccion(e.target.value)} /></label>
      <div className="fila-acciones" style={{ alignItems: "end", flexWrap: "wrap" }}>
        <label className="campo" style={{ flex: 2 }}><span>Referencia</span><input value={referencia} maxLength={200} placeholder="Frente a…, casa azul" onChange={(e) => setReferencia(e.target.value)} /></label>
        <label className="campo"><span>Teléfono</span><input value={tel} maxLength={30} onChange={(e) => setTel(e.target.value)} /></label>
        <label className="campo"><span>Otro teléfono</span><input value={tel2} maxLength={30} onChange={(e) => setTel2(e.target.value)} /></label>
      </div>
      <label className="campo"><span>Instrucciones para el chofer</span><input value={instr} maxLength={400} placeholder="Escaleras, hay que armar, retirar mueble viejo, hora preferida…" onChange={(e) => setInstr(e.target.value)} /></label>
      {problema && factura && <p className="suave pequeno">{problema}</p>}
      <div className="fila-acciones"><button className="boton primario" disabled={!!problema || guardando} onClick={guardar}>{guardando ? "Guardando…" : "Programar entrega"}</button><button className="boton" onClick={onCerrar}>Cancelar</button></div>
      <p className="suave pequeno">El documento de entrega no muestra precios ni saldos. Imprímalo desde la lista, o junto al de todas las entregas del día en «Hoja de ruta».</p>
    </div>
  );
}
