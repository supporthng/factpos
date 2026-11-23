import { useEffect, useState } from "react";
import { api, num, rd } from "../api";
import { Aviso, Encabezado, useDatos } from "../ui";

/**
 * Servicio técnico y reparaciones (cualquier negocio): la orden de un artículo vendido aquí (se busca por la serie y de ahí sale la garantía) o de un
 * equipo que trae el cliente. Garantía de la tienda, del fabricante o sin garantía (se cotiza y el cliente aprueba o rechaza antes de reparar).
 * El técnico la mueve por sus estados y al final se entrega. Se imprime la orden para el cliente.
 */
interface Orden {
  id: string; numero: string; codigo: string; estado: string; descripcion: string; serie: string | null; falla: string; lugar: "TALLER" | "DOMICILIO"; direccion: string | null; telefono: string | null;
  tecnico: string | null; garantiaHasta: string | null; enGarantia: boolean; diagnostico: string | null; solucion: string | null; costoManoObra: string; costoPiezas: string;
  recibidaEn: string; listaEn: string | null; entregadaEn: string | null; factura: number | null; clienteId: string | null; cliente: string | null; clienteDocumento: string | null; sucursal: string; creadaPor: string | null;
  tipoGarantia: "TIENDA" | "FABRICANTE" | "SIN"; marca: string | null; modelo: string | null; accesorios: string | null; estadoEquipo: string | null;
  cotizManoObra: string | null; cotizPiezas: string | null; cotizNota: string | null; cotizEn: string | null; aprobacion: "PENDIENTE" | "APROBADA" | "RECHAZADA" | null;
  aprobacionEn: string | null; aprobacionPor: string | null; aprobacionMedio: string | null; cobroRevision: string; fabricanteReferencia: string | null; fabricanteEnvio: string | null; fabricanteRegreso: string | null;
  historial?: { estado: string; nota: string | null; fecha: string; por: string | null }[];
}
interface Serie { id: string; serie: string; producto: string; factura: number; vendidaEn: string; garantiaHasta: string | null; vigente: boolean; cliente: string | null; clienteDocumento: string | null; telefono: string | null; direccion: string | null }
const ESTADO: Record<string, string> = { RECIBIDO: "Recibido", EN_REVISION: "En revisión", COTIZADO: "Esperando aprobación", EN_REPARACION: "En reparación", ESPERANDO_PIEZA: "Esperando pieza", EN_FABRICANTE: "En el fabricante", LISTO: "Listo", ENTREGADO: "Entregado", SIN_REPARACION: "Sin reparación", CANCELADO: "Cancelado" };
const SIGUIENTE: Record<string, string[]> = {
  RECIBIDO: ["EN_REVISION", "SIN_REPARACION", "CANCELADO"], EN_REVISION: ["EN_REPARACION", "ESPERANDO_PIEZA", "EN_FABRICANTE", "SIN_REPARACION"],
  COTIZADO: ["SIN_REPARACION", "CANCELADO"], EN_REPARACION: ["ESPERANDO_PIEZA", "LISTO", "SIN_REPARACION"], ESPERANDO_PIEZA: ["EN_REPARACION", "SIN_REPARACION"],
  EN_FABRICANTE: ["EN_REPARACION", "LISTO", "SIN_REPARACION"], LISTO: ["ENTREGADO"],
};
const GARANTIA: Record<string, string> = { TIENDA: "Garantía de la tienda", FABRICANTE: "Garantía del fabricante", SIN: "Sin garantía" };
const MEDIO: Record<string, string> = { PRESENCIAL: "Presencial", TELEFONO: "Por teléfono", WHATSAPP: "Por WhatsApp" };
const MEDIO_VER: Record<string, string> = { ...MEDIO, ENLACE: "Por el enlace del celular" };
const fechaCorta = (s: string) => s.slice(0, 10).split("-").reverse().join("/");
const fechaHora = (iso: string) => new Date(iso).toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
const decimal = (v: string) => v.replace(/[^\d.]/g, "");

export function ServicioTecnico() {
  const [filtro, setFiltro] = useState("ABIERTAS");
  const [q, setQ] = useState("");
  const params = new URLSearchParams({ estado: filtro, ...(q.trim() ? { q: q.trim() } : {}) }).toString();
  const lista = useDatos<Orden[]>(`/central/servicio?${params}`, [params]);
  const [nueva, setNueva] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" } | null>(null);
  const filas = lista.datos ?? [];
  return (
    <>
      <style>{`.solo-imprimir{display:none}@media print{.solo-imprimir{display:block}.no-imprimir{display:none!important}}`}</style>
      <Encabezado titulo="Servicio técnico" descripcion="Reparaciones en garantía y sin garantía, de lo que vendió o de equipos que trae el cliente: abra la orden, cotice si se cobra y siga su estado hasta entregarla.">
        <button className="boton primario no-imprimir" onClick={() => { setNueva(true); setSel(null); }}>Nueva orden</button>
      </Encabezado>
      {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}
      <Aviso texto={lista.error} />
      <Opciones onMsg={(t, tipo) => setMsg({ t, tipo })} />
      {nueva && <NuevaOrden onCerrar={() => setNueva(false)} onError={(t) => setMsg({ t, tipo: "error" })}
        onListo={(id, codigo, enG) => { setNueva(false); setMsg({ t: `Orden ${codigo} abierta${enG ? " (cubre garantía)" : " (sin garantía: haga la cotización para que el cliente la apruebe)"}.`, tipo: "ok" }); lista.recargar(); setSel(id); }} />}
      <div className="panel cab-compra no-imprimir">
        <label className="campo"><span>Ver</span>
          <select value={filtro} onChange={(e) => setFiltro(e.target.value)}>
            <option value="ABIERTAS">Abiertas</option>{Object.entries(ESTADO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></label>
        <label className="campo"><span>Serie, artículo, cliente o número</span><input value={q} onChange={(e) => setQ(e.target.value)} /></label>
      </div>
      <div className="tarjeta no-imprimir" style={{ overflowX: "auto" }}>
        <table className="tabla">
          <thead><tr><th>Orden</th><th>Recibida</th><th>Artículo</th><th>Cliente</th><th>Garantía</th><th>Estado</th><th>Técnico</th><th /></tr></thead>
          <tbody>
            {filas.length === 0 && <tr><td colSpan={8} className="suave">{lista.cargando ? "Cargando…" : "No hay órdenes con ese filtro."}</td></tr>}
            {filas.map((o) => (
              <tr key={o.id} style={sel === o.id ? { background: "var(--fondo-suave, #eef4ff)" } : undefined}>
                <td><b>{o.codigo}</b></td>
                <td>{fechaHora(o.recibidaEn)}</td>
                <td>{o.descripcion}{(o.marca || o.modelo) && <div className="suave">{[o.marca, o.modelo].filter(Boolean).join(" ")}</div>}{o.serie && <div className="suave">Serie {o.serie}</div>}</td>
                <td>{o.cliente ?? <span className="suave">—</span>}</td>
                <td>{o.enGarantia ? <span style={{ color: "var(--ok, #1b7f3b)" }}>{GARANTIA[o.tipoGarantia]}</span> : <span className="suave">Se cobra</span>}</td>
                <td>{ESTADO[o.estado]}</td>
                <td>{o.tecnico ?? <span className="suave">—</span>}</td>
                <td className="der"><button className="boton chico" onClick={() => setSel(sel === o.id ? null : o.id)}>{sel === o.id ? "Ocultar" : "Abrir"}</button></td>
              </tr>
            ))}
          </tbody>
          {filas.length > 0 && <tfoot><tr><td colSpan={8} className="suave">{num(filas.length)} órdenes</td></tr></tfoot>}
        </table>
      </div>
      {sel && <Detalle id={sel} onCambio={() => lista.recargar()} onError={(t) => setMsg({ t, tipo: "error" })} />}
    </>
  );
}

interface ClienteB { id: string; nombre: string; documento: string | null; telefono: string | null; direccion: string | null }

/** Buscar un cliente (nombre, RNC o teléfono) o crear uno nuevo ahí mismo: toda orden lleva cliente para avisarle y enviarle la cotización. */
function ElegirCliente({ valor, onElegir, onError }: { valor: ClienteB | null; onElegir: (c: ClienteB | null) => void; onError: (t: string) => void }) {
  const [q, setQ] = useState("");
  const [lista, setLista] = useState<ClienteB[]>([]);
  const [nuevo, setNuevo] = useState(false);
  const [nombre, setNombre] = useState(""); const [tel, setTel] = useState("");
  useEffect(() => {
    if (q.trim().length < 2) { setLista([]); return; }
    const t = setTimeout(() => api<ClienteB[]>(`/central/clientes?q=${encodeURIComponent(q.trim())}`).then((r) => setLista(r.slice(0, 8))).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [q]);
  const crear = async () => {
    try {
      const c = await api<ClienteB>("/central/clientes", { cuerpo: { nombre: nombre.trim(), telefono: tel.trim() || null, tipoDocumento: "NINGUNO", documento: null, nivel: 1 } });
      onElegir(c); setNuevo(false);
    } catch (e) { onError((e as Error).message); }
  };
  if (valor) return <p style={{ margin: "6px 0" }}><span className="suave">Cliente:</span> <b>{valor.nombre}</b>{valor.documento && ` · ${valor.documento}`}{valor.telefono && ` · ${valor.telefono}`} <button className="boton chico" onClick={() => onElegir(null)}>Cambiar</button></p>;
  return (
    <div className="panel" style={{ margin: "6px 0" }}>
      <label className="campo"><span>Cliente (obligatorio)</span><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre, RNC, cédula o teléfono" /></label>
      {lista.length > 0 && <table className="tabla"><tbody>{lista.map((c) => (
        <tr key={c.id}><td><b>{c.nombre}</b><div className="suave">{[c.documento, c.telefono].filter(Boolean).join(" · ") || "sin documento ni teléfono"}</div></td>
          <td className="der"><button className="boton chico primario" onClick={() => onElegir(c)}>Elegir</button></td></tr>))}</tbody></table>}
      {q.trim().length >= 2 && lista.length === 0 && <p className="suave pequeno" style={{ margin: "4px 0" }}>No hay clientes con ese dato.</p>}
      {!nuevo
        ? <p style={{ margin: "4px 0" }}><button className="boton chico" onClick={() => { setNuevo(true); setNombre(q.trim()); }}>Cliente nuevo</button></p>
        : <div className="panel cab-compra">
          <label className="campo"><span>Nombre del cliente nuevo</span><input value={nombre} onChange={(e) => setNombre(e.target.value)} /></label>
          <label className="campo"><span>Teléfono (WhatsApp)</span><input value={tel} onChange={(e) => setTel(e.target.value)} /></label>
          <button className="boton primario" disabled={nombre.trim().length < 3} onClick={crear}>Guardar cliente</button>
          <button className="boton" onClick={() => setNuevo(false)}>Cancelar</button>
        </div>}
    </div>
  );
}

function NuevaOrden({ onCerrar, onListo, onError }: { onCerrar: () => void; onListo: (id: string, codigo: string, enGarantia: boolean) => void; onError: (t: string) => void }) {
  const [q, setQ] = useState("");
  const [buscado, setBuscado] = useState("");
  const res = useDatos<Serie[]>(buscado ? `/central/servicio/series?q=${encodeURIComponent(buscado)}` : null, [buscado]);
  const [serie, setSerie] = useState<Serie | null>(null);
  const [libre, setLibre] = useState(false);
  const [descripcion, setDescripcion] = useState("");
  const [falla, setFalla] = useState("");
  const [lugar, setLugar] = useState<"TALLER" | "DOMICILIO">("TALLER");
  const [direccion, setDireccion] = useState("");
  const [telefono, setTelefono] = useState("");
  const [cliente, setCliente] = useState<ClienteB | null>(null);
  const [tecnico, setTecnico] = useState("");
  const [tipoG, setTipoG] = useState<"" | "TIENDA" | "FABRICANTE" | "SIN">("");
  const [marca, setMarca] = useState(""); const [modelo, setModelo] = useState(""); const [serieLibre, setSerieLibre] = useState("");
  const [accesorios, setAccesorios] = useState(""); const [estadoEquipo, setEstadoEquipo] = useState("");
  const elegir = (s: Serie) => { setSerie(s); setDireccion(s.direccion ?? ""); setTelefono(s.telefono ?? ""); };
  const elegirCliente = (c: ClienteB | null) => { setCliente(c); if (c) { setTelefono((t) => t || (c.telefono ?? "")); setDireccion((d) => d || (c.direccion ?? "")); } };
  const serieOk = !!serie || serieLibre.trim().length >= 3;
  const hist = useDatos<{ codigo: string; recibidaEn: string }[]>(!serie && serieLibre.trim().length >= 4 ? `/central/servicio?q=${encodeURIComponent(serieLibre.trim())}` : null, [serieLibre]).datos ?? [];
  const sinCliente = !(serie?.cliente) && !cliente; // la venta ya trae su cliente; si no, hay que elegirlo
  const guardar = async () => {
    try {
      const r = await api<{ id: string; numero: string; enGarantia: boolean }>("/central/servicio", { cuerpo: {
        ...(cliente ? { clienteId: cliente.id } : {}), ...(serie ? { serieId: serie.id } : { descripcion, ...(serieLibre.trim() ? { serieLibre: serieLibre.trim() } : {}) }), falla, lugar,
        ...(tipoG ? { tipoGarantia: tipoG } : {}), ...(marca.trim() ? { marca: marca.trim() } : {}), ...(modelo.trim() ? { modelo: modelo.trim() } : {}),
        ...(accesorios.trim() ? { accesorios: accesorios.trim() } : {}), ...(estadoEquipo.trim() ? { estadoEquipo: estadoEquipo.trim() } : {}), ...(direccion.trim() ? { direccion: direccion.trim() } : {}), ...(telefono.trim() ? { telefono: telefono.trim() } : {}), ...(tecnico.trim() ? { tecnico: tecnico.trim() } : {}),
      } });
      onListo(r.id, `No. ${r.numero}`, r.enGarantia);
    } catch (e) { onError((e as Error).message); }
  };
  return (
    <div className="tarjeta no-imprimir" style={{ marginBottom: 12, maxWidth: 760 }}>
      <b>Nueva orden de servicio</b>
      {!serie && !libre && <>
        <div className="panel cab-compra">
          <label className="campo"><span>Serie, factura, cliente o cédula</span><input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && setBuscado(q.trim())} /></label>
          <button className="boton" onClick={() => setBuscado(q.trim())} disabled={q.trim().length < 2}>Buscar</button>
        </div>
        {buscado && <table className="tabla"><tbody>
          {(res.datos ?? []).length === 0 && <tr><td className="suave">{res.cargando ? "Buscando…" : "No se encontró. Si el artículo no se vendió aquí, abra la orden sin factura."}</td></tr>}
          {(res.datos ?? []).map((s) => (
            <tr key={s.id}>
              <td><b>{s.producto}</b><div className="suave">Serie {s.serie} · Fact. #{s.factura} · {s.cliente ?? "sin cliente"}</div></td>
              <td>{s.vigente ? <span style={{ color: "var(--ok, #1b7f3b)" }}>Garantía hasta {fechaCorta(s.garantiaHasta!)}</span> : <span className="suave">{s.garantiaHasta ? `Garantía vencida ${fechaCorta(s.garantiaHasta)}` : "Sin garantía"}</span>}</td>
              <td className="der"><button className="boton chico primario" onClick={() => elegir(s)}>Elegir</button></td>
            </tr>))}
        </tbody></table>}
        <p><button className="boton chico" onClick={() => setLibre(true)}>El equipo no se vendió aquí (abrir sin factura)</button></p>
      </>}
      {(serie || libre) && <>
        {serie
          ? <p><b>{serie.producto}</b> · Serie {serie.serie} · Fact. #{serie.factura} · {serie.cliente ?? "sin cliente"}<br />
            {serie.vigente ? <span style={{ color: "var(--ok, #1b7f3b)" }}>Garantía vigente hasta {fechaCorta(serie.garantiaHasta!)}: el servicio no se cobra.</span> : <span>{serie.garantiaHasta ? `La garantía venció el ${fechaCorta(serie.garantiaHasta)}` : "Sin garantía"}: el servicio se cobra.</span>}{" "}
            <button className="boton chico" onClick={() => setSerie(null)}>Cambiar</button></p>
          : <>
            <label className="campo"><span>Equipo</span><input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Ej. Nevera 14 pies" /></label>
            <div className="panel cab-compra">
              <label className="campo"><span>Marca</span><input value={marca} onChange={(e) => setMarca(e.target.value)} /></label>
              <label className="campo"><span>Modelo</span><input value={modelo} onChange={(e) => setModelo(e.target.value)} /></label>
              <label className="campo"><span>Serie (obligatoria)</span><input value={serieLibre} onChange={(e) => setSerieLibre(e.target.value)} placeholder="Número de serie del equipo" />{hist.length > 0 && <span className="suave pequeno" style={{ color: "var(--aviso, #b45309)" }}>Este equipo ya tiene {hist.length} orden(es) de servicio: {hist.slice(0, 3).map((h) => `${h.codigo} (${fechaCorta(h.recibidaEn)})`).join(", ")}</span>}</label>
            </div>
          </>}
        <div className="panel cab-compra">
          <label className="campo"><span>Garantía</span>
            <select value={tipoG} onChange={(e) => setTipoG(e.target.value as typeof tipoG)}>
              <option value="">{serie?.vigente ? "Garantía de la tienda (vigente)" : "Sin garantía (se cotiza y se cobra)"}</option>
              {serie?.vigente && <option value="SIN">Sin garantía (se cotiza y se cobra)</option>}
              <option value="FABRICANTE">Garantía del fabricante</option>
            </select></label>
          <label className="campo"><span>Accesorios que deja</span><input value={accesorios} onChange={(e) => setAccesorios(e.target.value)} placeholder="Cable, control remoto…" /></label>
          <label className="campo"><span>Estado en que llega</span><input value={estadoEquipo} onChange={(e) => setEstadoEquipo(e.target.value)} placeholder="Rayones, golpes…" /></label>
        </div>
        {!serie?.cliente && <ElegirCliente valor={cliente} onElegir={elegirCliente} onError={onError} />}
        <label className="campo"><span>Falla que reporta el cliente</span><input value={falla} maxLength={500} onChange={(e) => setFalla(e.target.value)} /></label>
        <div className="panel cab-compra">
          <label className="campo"><span>Dónde</span><select value={lugar} onChange={(e) => setLugar(e.target.value as "TALLER" | "DOMICILIO")}><option value="TALLER">En el taller</option><option value="DOMICILIO">A domicilio</option></select></label>
          <label className="campo"><span>Teléfono</span><input value={telefono} onChange={(e) => setTelefono(e.target.value)} /></label>
          <label className="campo"><span>Técnico</span><input value={tecnico} onChange={(e) => setTecnico(e.target.value)} /></label>
        </div>
        {lugar === "DOMICILIO" && <label className="campo"><span>Dirección</span><input value={direccion} onChange={(e) => setDireccion(e.target.value)} /></label>}
      </>}
      <div className="fila-acciones" style={{ marginTop: 8 }}>
        {(serie || libre) && <button className="boton primario" onClick={guardar} disabled={falla.trim().length < 3 || sinCliente || !serieOk || (!serie && descripcion.trim().length < 2)}>Abrir orden</button>}
        <button className="boton" onClick={onCerrar}>Cancelar</button>
      </div>
    </div>
  );
}

function Detalle({ id, onCambio, onError }: { id: string; onCambio: () => void; onError: (t: string) => void }) {
  const d = useDatos<Orden>(`/central/servicio/${id}`, [id]);
  const o = d.datos;
  const [nota, setNota] = useState("");
  const [diag, setDiag] = useState<string | null>(null);
  const [sol, setSol] = useState<string | null>(null);
  const [tec, setTec] = useState<string | null>(null);
  const [mo, setMo] = useState<string | null>(null);
  const [pz, setPz] = useState<string | null>(null);
  const [cMo, setCMo] = useState(""); const [cPz, setCPz] = useState(""); const [cNota, setCNota] = useState("");
  const [decPor, setDecPor] = useState(""); const [decMedio, setDecMedio] = useState("PRESENCIAL"); const [revision, setRevision] = useState<string | null>(null);
  const [fabRef, setFabRef] = useState<string | null>(null);
  const [enlace, setEnlace] = useState<{ url: string; alcanzable: boolean; wa: string | null; vence: string; mensaje: string } | null>(null);
  const cfg = useDatos<{ cobrarRevision: boolean; montoRevision: string }>("/central/servicio/config", []);
  if (!o) return <div className="tarjeta suave">{d.error || "Cargando…"}</div>;
  const cerrada = ["ENTREGADO", "SIN_REPARACION", "CANCELADO"].includes(o.estado);
  const cobro = o.enGarantia ? 0 : Number(mo ?? o.costoManoObra) + Number(pz ?? o.costoPiezas);
  const aprobada = o.enGarantia || o.aprobacion === "APROBADA";
  const cotizacion = Number(o.cotizManoObra ?? 0) + Number(o.cotizPiezas ?? 0);
  const revisionSugerida = cfg.datos?.cobrarRevision ? cfg.datos.montoRevision : "0";
  const generarEnlace = async (accion: "wa" | "copiar") => {
    try {
      const r = await api<{ url: string; alcanzable: boolean; wa: string | null; vence: string; mensaje: string }>(`/central/servicio/${id}/enlace`, { metodo: "POST", cuerpo: {} });
      setEnlace(r);
      if (accion === "wa" && r.wa) window.open(r.wa, "_blank", "noopener");
      if (accion === "copiar" || !r.wa) await navigator.clipboard?.writeText(r.mensaje).catch(() => {});
    } catch (e) { onError((e as Error).message); }
  };
  const llamar = async (cuerpo: Record<string, unknown>, despues?: () => void) => {
    try { await api(`/central/servicio/${id}`, { metodo: "PUT", cuerpo }); despues?.(); d.recargar(); onCambio(); } catch (e) { onError((e as Error).message); }
  };
  const enviar = async (estado?: string) => {
    try {
      await api(`/central/servicio/${id}`, { metodo: "PUT", cuerpo: {
        ...(estado ? { estado } : {}), ...(fabRef !== null ? { fabricanteReferencia: fabRef } : {}), ...(nota.trim() ? { nota: nota.trim() } : {}), ...(diag !== null ? { diagnostico: diag } : {}), ...(sol !== null ? { solucion: sol } : {}),
        ...(tec !== null ? { tecnico: tec } : {}), ...(mo !== null ? { costoManoObra: Number(mo || 0) } : {}), ...(pz !== null ? { costoPiezas: Number(pz || 0) } : {}),
      } });
      setNota(""); setDiag(null); setSol(null); setTec(null); setMo(null); setPz(null); d.recargar(); onCambio();
    } catch (e) { onError((e as Error).message); }
  };
  return (
    <div className="tarjeta" style={{ marginTop: 12, maxWidth: 760 }}>
      <div className="solo-imprimir" style={{ textAlign: "center" }}><b style={{ fontSize: "1.2em" }}>ORDEN DE SERVICIO</b></div>
      <p style={{ margin: "4px 0" }}><b>{o.codigo}</b> · {ESTADO[o.estado]} · {o.sucursal} · recibida {fechaHora(o.recibidaEn)}</p>
      <p style={{ margin: "4px 0" }}><span className="suave">Cliente:</span> <b>{o.cliente ?? "—"}</b>{o.clienteDocumento && ` · ${o.clienteDocumento}`}{o.telefono && ` · ${o.telefono}`}</p>
      <p style={{ margin: "4px 0" }}><span className="suave">Artículo:</span> <b>{o.descripcion}</b>{(o.marca || o.modelo) && ` · ${[o.marca, o.modelo].filter(Boolean).join(" ")}`}{o.serie && ` · Serie ${o.serie}`}{o.factura ? ` · Fact. #${o.factura}` : " · no vendido aquí"}</p>
      {(o.accesorios || o.estadoEquipo) && <p style={{ margin: "4px 0" }}><span className="suave">Recibido con:</span> {[o.accesorios && `accesorios: ${o.accesorios}`, o.estadoEquipo && `estado: ${o.estadoEquipo}`].filter(Boolean).join(" · ")}</p>}
      <p style={{ margin: "4px 0" }}><span className="suave">Falla reportada:</span> {o.falla}</p>
      <p style={{ margin: "4px 0" }}><span className="suave">Atención:</span> {o.lugar === "TALLER" ? "En el taller" : `A domicilio · ${o.direccion ?? ""}`}</p>
      <p style={{ margin: "4px 0" }}><span className="suave">Garantía:</span> {o.tipoGarantia === "TIENDA" ? `Garantía de la tienda (hasta ${fechaCorta(o.garantiaHasta!)}): no se cobra` : o.tipoGarantia === "FABRICANTE" ? "Garantía del fabricante: no se cobra al cliente" : o.garantiaHasta ? `Vencida el ${fechaCorta(o.garantiaHasta)}: se cobra` : "Sin garantía: se cotiza y se cobra"}</p>
      {o.tipoGarantia === "FABRICANTE" && (o.fabricanteReferencia || o.fabricanteEnvio) && <p style={{ margin: "4px 0" }}><span className="suave">Fabricante:</span> ref. {o.fabricanteReferencia ?? "—"}{o.fabricanteEnvio && ` · enviado ${fechaCorta(o.fabricanteEnvio)}`}{o.fabricanteRegreso && ` · regresó ${fechaCorta(o.fabricanteRegreso)}`}</p>}
      {o.cotizEn && <p style={{ margin: "4px 0" }}><span className="suave">Cotización:</span> <b>{rd(Number(o.cotizManoObra) + Number(o.cotizPiezas))}</b> (mano de obra {rd(Number(o.cotizManoObra))} + piezas {rd(Number(o.cotizPiezas))}){o.cotizNota && ` · ${o.cotizNota}`}
        {o.aprobacion === "APROBADA" && o.aprobacionEn && ` · Aprobada por ${o.aprobacionPor} (${MEDIO_VER[o.aprobacionMedio ?? ""]?.toLowerCase()}) el ${fechaHora(o.aprobacionEn)}`}
        {o.aprobacion === "RECHAZADA" && o.aprobacionEn && ` · Rechazada por ${o.aprobacionPor} (${MEDIO_VER[o.aprobacionMedio ?? ""]?.toLowerCase()}) el ${fechaHora(o.aprobacionEn)}`}
        {o.aprobacion === "PENDIENTE" && " · Esperando respuesta del cliente"}</p>}
      {o.aprobacion === "RECHAZADA" && Number(o.cobroRevision) > 0 && <p style={{ margin: "4px 0" }}><b>Revisión a cobrar: {rd(Number(o.cobroRevision))}</b> (se cobra con una factura normal)</p>}
      {cerrada && <>
        {o.diagnostico && <p style={{ margin: "4px 0" }}><span className="suave">Diagnóstico:</span> {o.diagnostico}</p>}
        {o.solucion && <p style={{ margin: "4px 0" }}><span className="suave">Solución:</span> {o.solucion}</p>}
      </>}
      {!cerrada && <div className="no-imprimir">
        {!o.enGarantia && ["RECIBIDO", "EN_REVISION", "COTIZADO"].includes(o.estado) && <>
          <hr />
          <b>Cotización para el cliente</b>
          <div className="panel cab-compra">
            <label className="campo"><span>Mano de obra</span><input inputMode="decimal" value={cMo} onChange={(e) => setCMo(decimal(e.target.value))} placeholder={o.cotizManoObra ?? ""} /></label>
            <label className="campo"><span>Piezas</span><input inputMode="decimal" value={cPz} onChange={(e) => setCPz(decimal(e.target.value))} placeholder={o.cotizPiezas ?? ""} /></label>
            <label className="campo"><span>Detalle (piezas, tiempo)</span><input value={cNota} maxLength={400} onChange={(e) => setCNota(e.target.value)} /></label>
          </div>
          <div className="fila-acciones">
            <button className="boton primario" disabled={!(Number(cMo || 0) + Number(cPz || 0) > 0)}
              onClick={() => llamar({ cotizar: { manoObra: Number(cMo || 0), piezas: Number(cPz || 0), ...(cNota.trim() ? { nota: cNota.trim() } : {}) } }, () => { setCMo(""); setCPz(""); setCNota(""); })}>{o.aprobacion === "PENDIENTE" ? "Enviar cotización nueva" : "Enviar cotización"}</button>
            <span className="suave pequeno">Sin la aprobación del cliente no se puede reparar.</span>
          </div>
          {o.aprobacion === "PENDIENTE" && <div className="panel" style={{ marginTop: 8 }}>
            <b>Respuesta del cliente a {rd(cotizacion)}</b>
            <div className="fila-acciones" style={{ margin: "6px 0" }}>
              <button className="boton primario" onClick={() => generarEnlace("wa")}>Enviar por WhatsApp (el cliente aprueba desde su celular)</button>
              <button className="boton" onClick={() => generarEnlace("copiar")}>Copiar mensaje con enlace</button>
              <button className="boton" onClick={() => { d.recargar(); onCambio(); }}>Ver si ya respondió</button>
            </div>
            {enlace && <div className="suave pequeno" style={{ marginBottom: 6 }}>
              Enlace (vale hasta el {fechaCorta(enlace.vence)}): <span className="mono" style={{ wordBreak: "break-all" }}>{enlace.url}</span>
              {!enlace.wa && <><br />El cliente no tiene teléfono en la orden: el mensaje quedó copiado para que lo pegue donde prefiera.</>}
              {!enlace.alcanzable && <><br /><b>Atención:</b> este servidor no tiene una dirección pública (túnel o dirección de internet): el cliente solo podría abrir el enlace dentro de su red. Active el acceso por internet para que le funcione desde su celular.</>}
            </div>}
            <p className="suave pequeno" style={{ margin: "0 0 6px" }}>O registre usted la respuesta si el cliente la dio en persona o por teléfono:</p>
            <div className="panel cab-compra">
              <label className="campo"><span>Quién respondió</span><input value={decPor} onChange={(e) => setDecPor(e.target.value)} placeholder={o.cliente ?? "Nombre"} /></label>
              <label className="campo"><span>Por qué medio</span><select value={decMedio} onChange={(e) => setDecMedio(e.target.value)}>{Object.entries(MEDIO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label className="campo"><span>Revisión a cobrar si rechaza</span><input inputMode="decimal" value={revision ?? (Number(revisionSugerida) ? revisionSugerida : "")} onChange={(e) => setRevision(decimal(e.target.value))} placeholder="0" /></label>
            </div>
            <div className="fila-acciones">
              <button className="boton primario" disabled={decPor.trim().length < 2} onClick={() => llamar({ decision: { resultado: "APROBADA", por: decPor.trim(), medio: decMedio } }, () => setDecPor(""))}>El cliente aprobó</button>
              <button className="boton" disabled={decPor.trim().length < 2} onClick={() => llamar({ decision: { resultado: "RECHAZADA", por: decPor.trim(), medio: decMedio, cobrarRevision: Number(revision ?? revisionSugerida ?? 0) || 0 } }, () => setDecPor(""))}>El cliente rechazó</button>
            </div>
          </div>}
        </>}
        {o.tipoGarantia === "FABRICANTE" && <label className="campo"><span>Referencia del envío o reclamo al fabricante</span><input value={fabRef ?? o.fabricanteReferencia ?? ""} onChange={(e) => setFabRef(e.target.value)} maxLength={80} /></label>}
        <hr />
        <label className="campo"><span>Diagnóstico</span><input value={diag ?? o.diagnostico ?? ""} onChange={(e) => setDiag(e.target.value)} maxLength={600} /></label>
        <label className="campo"><span>Solución aplicada</span><input value={sol ?? o.solucion ?? ""} onChange={(e) => setSol(e.target.value)} maxLength={600} /></label>
        <div className="panel cab-compra">
          <label className="campo"><span>Técnico</span><input value={tec ?? o.tecnico ?? ""} onChange={(e) => setTec(e.target.value)} /></label>
          <label className="campo"><span>Mano de obra</span><input inputMode="decimal" value={mo ?? (Number(o.costoManoObra) ? o.costoManoObra : "")} onChange={(e) => setMo(decimal(e.target.value))} /></label>
          <label className="campo"><span>Piezas</span><input inputMode="decimal" value={pz ?? (Number(o.costoPiezas) ? o.costoPiezas : "")} onChange={(e) => setPz(decimal(e.target.value))} /></label>
        </div>
        <p className="suave" style={{ margin: "4px 0" }}>{o.enGarantia ? "Cubre garantía: no se le cobra al cliente." : `A cobrar al cliente: ${rd(cobro)} (se cobra con una factura normal).`}</p>
        <label className="campo"><span>Nota del cambio de estado</span><input value={nota} onChange={(e) => setNota(e.target.value)} maxLength={400} /></label>
        <div className="fila-acciones">
          <button className="boton" onClick={() => enviar()}>Guardar datos</button>
          {(SIGUIENTE[o.estado] ?? []).filter((s) => (aprobada || !["EN_REPARACION", "ESPERANDO_PIEZA", "LISTO"].includes(s)) && (s !== "EN_FABRICANTE" || o.tipoGarantia === "FABRICANTE")).map((s) => <button key={s} className={"boton" + (s === "LISTO" || s === "ENTREGADO" ? " primario" : "")} onClick={() => enviar(s)}>{ESTADO[s]}</button>)}
        </div>
      </div>}
      {cerrada && !o.enGarantia && o.estado !== "SIN_REPARACION" && Number(o.costoManoObra) + Number(o.costoPiezas) > 0 && <p style={{ margin: "4px 0" }}><b>Costo del servicio: {rd(Number(o.costoManoObra) + Number(o.costoPiezas))}</b></p>}
      <hr />
      <b>Historial</b>
      <ul style={{ margin: "4px 0 0 18px", padding: 0 }}>{(o.historial ?? []).map((h, i) => <li key={i}>{fechaHora(h.fecha)} · {ESTADO[h.estado]}{h.nota ? ` · ${h.nota}` : ""}{h.por ? ` — ${h.por}` : ""}</li>)}</ul>
      <div className="solo-imprimir" style={{ marginTop: 36 }}>Firma del cliente: ______________________________</div>
      <div className="fila-acciones no-imprimir" style={{ marginTop: 8 }}><button className="boton" onClick={() => window.print()}>Imprimir orden</button></div>
    </div>
  );
}

/** Opciones del servicio: ¿se cobra la revisión cuando el cliente rechaza la cotización? (opcional) */
function Opciones({ onMsg }: { onMsg: (t: string, tipo: "ok" | "error") => void }) {
  const c = useDatos<{ cobrarRevision: boolean; montoRevision: string }>("/central/servicio/config", []);
  const [abierto, setAbierto] = useState(false);
  const [cobrar, setCobrar] = useState<boolean | null>(null);
  const [monto, setMonto] = useState<string | null>(null);
  const cobra = cobrar ?? c.datos?.cobrarRevision ?? false;
  const m = monto ?? (Number(c.datos?.montoRevision) ? c.datos!.montoRevision : "");
  const guardar = async () => {
    try { await api("/central/servicio/config", { metodo: "PUT", cuerpo: { cobrarRevision: cobra, montoRevision: Number(m || 0) } }); onMsg("Opciones guardadas.", "ok"); setCobrar(null); setMonto(null); c.recargar(); }
    catch (e) { onMsg((e as Error).message, "error"); }
  };
  return (
    <div className="no-imprimir" style={{ marginBottom: 8 }}>
      <button className="boton chico" onClick={() => setAbierto(!abierto)}>{abierto ? "Ocultar opciones" : "Opciones del servicio"}</button>
      {abierto && <div className="panel cab-compra" style={{ marginTop: 6 }}>
        <label className="campo" style={{ flexDirection: "row", gap: 8, alignItems: "center" }}><input type="checkbox" checked={cobra} onChange={(e) => setCobrar(e.target.checked)} /><span>Cobrar la revisión si el cliente rechaza la cotización</span></label>
        {cobra && <label className="campo"><span>Monto de la revisión</span><input inputMode="decimal" value={m} onChange={(e) => setMonto(decimal(e.target.value))} /></label>}
        <button className="boton primario" onClick={guardar}>Guardar</button>
      </div>}
    </div>
  );
}
