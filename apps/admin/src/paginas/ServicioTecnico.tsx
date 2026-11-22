import { useState } from "react";
import { api, num, rd } from "../api";
import { Aviso, Encabezado, useDatos } from "../ui";

/**
 * Servicio técnico y garantías: la orden de servicio de un artículo vendido. Se abre buscando la serie (de ahí sale quién lo compró y
 * si la garantía sigue vigente), el técnico la mueve por sus estados y al final se entrega. Se imprime la orden para el cliente.
 */
interface Orden {
  id: string; numero: string; codigo: string; estado: string; descripcion: string; serie: string | null; falla: string; lugar: "TALLER" | "DOMICILIO"; direccion: string | null; telefono: string | null;
  tecnico: string | null; garantiaHasta: string | null; enGarantia: boolean; diagnostico: string | null; solucion: string | null; costoManoObra: string; costoPiezas: string;
  recibidaEn: string; listaEn: string | null; entregadaEn: string | null; factura: number | null; clienteId: string | null; cliente: string | null; clienteDocumento: string | null; sucursal: string; creadaPor: string | null;
  historial?: { estado: string; nota: string | null; fecha: string; por: string | null }[];
}
interface Serie { id: string; serie: string; producto: string; factura: number; vendidaEn: string; garantiaHasta: string | null; vigente: boolean; cliente: string | null; clienteDocumento: string | null; telefono: string | null; direccion: string | null }
const ESTADO: Record<string, string> = { RECIBIDO: "Recibido", EN_REVISION: "En revisión", EN_REPARACION: "En reparación", ESPERANDO_PIEZA: "Esperando pieza", LISTO: "Listo", ENTREGADO: "Entregado", SIN_REPARACION: "Sin reparación", CANCELADO: "Cancelado" };
const SIGUIENTE: Record<string, string[]> = {
  RECIBIDO: ["EN_REVISION", "SIN_REPARACION", "CANCELADO"], EN_REVISION: ["EN_REPARACION", "ESPERANDO_PIEZA", "SIN_REPARACION"],
  EN_REPARACION: ["ESPERANDO_PIEZA", "LISTO", "SIN_REPARACION"], ESPERANDO_PIEZA: ["EN_REPARACION", "SIN_REPARACION"], LISTO: ["ENTREGADO"],
};
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
      <Encabezado titulo="Servicio técnico" descripcion="Garantías y reparaciones de lo que se vendió: busque la serie, abra la orden y siga su estado hasta entregarla.">
        <button className="boton primario no-imprimir" onClick={() => { setNueva(true); setSel(null); }}>Nueva orden</button>
      </Encabezado>
      {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}
      <Aviso texto={lista.error} />
      {nueva && <NuevaOrden onCerrar={() => setNueva(false)} onError={(t) => setMsg({ t, tipo: "error" })}
        onListo={(id, codigo, enG) => { setNueva(false); setMsg({ t: `Orden ${codigo} abierta${enG ? " (cubre garantía)" : " (fuera de garantía: se cobra)"}.`, tipo: "ok" }); lista.recargar(); setSel(id); }} />}
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
                <td>{o.descripcion}{o.serie && <div className="suave">Serie {o.serie}</div>}</td>
                <td>{o.cliente ?? <span className="suave">—</span>}</td>
                <td>{o.enGarantia ? <span style={{ color: "var(--ok, #1b7f3b)" }}>Cubre garantía</span> : <span className="suave">Se cobra</span>}</td>
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
  const [tecnico, setTecnico] = useState("");
  const elegir = (s: Serie) => { setSerie(s); setDireccion(s.direccion ?? ""); setTelefono(s.telefono ?? ""); };
  const guardar = async () => {
    try {
      const r = await api<{ id: string; numero: string; enGarantia: boolean }>("/central/servicio", { cuerpo: {
        ...(serie ? { serieId: serie.id } : { descripcion }), falla, lugar, ...(direccion.trim() ? { direccion: direccion.trim() } : {}), ...(telefono.trim() ? { telefono: telefono.trim() } : {}), ...(tecnico.trim() ? { tecnico: tecnico.trim() } : {}),
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
        <p><button className="boton chico" onClick={() => setLibre(true)}>Abrir sin serie ni factura</button></p>
      </>}
      {(serie || libre) && <>
        {serie
          ? <p><b>{serie.producto}</b> · Serie {serie.serie} · Fact. #{serie.factura} · {serie.cliente ?? "sin cliente"}<br />
            {serie.vigente ? <span style={{ color: "var(--ok, #1b7f3b)" }}>Garantía vigente hasta {fechaCorta(serie.garantiaHasta!)}: el servicio no se cobra.</span> : <span>{serie.garantiaHasta ? `La garantía venció el ${fechaCorta(serie.garantiaHasta)}` : "Sin garantía"}: el servicio se cobra.</span>}{" "}
            <button className="boton chico" onClick={() => setSerie(null)}>Cambiar</button></p>
          : <label className="campo"><span>Artículo</span><input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Ej. Nevera Samsung 14 pies" /></label>}
        <label className="campo"><span>Falla que reporta el cliente</span><input value={falla} maxLength={500} onChange={(e) => setFalla(e.target.value)} /></label>
        <div className="panel cab-compra">
          <label className="campo"><span>Dónde</span><select value={lugar} onChange={(e) => setLugar(e.target.value as "TALLER" | "DOMICILIO")}><option value="TALLER">En el taller</option><option value="DOMICILIO">A domicilio</option></select></label>
          <label className="campo"><span>Teléfono</span><input value={telefono} onChange={(e) => setTelefono(e.target.value)} /></label>
          <label className="campo"><span>Técnico</span><input value={tecnico} onChange={(e) => setTecnico(e.target.value)} /></label>
        </div>
        {lugar === "DOMICILIO" && <label className="campo"><span>Dirección</span><input value={direccion} onChange={(e) => setDireccion(e.target.value)} /></label>}
      </>}
      <div className="fila-acciones" style={{ marginTop: 8 }}>
        {(serie || libre) && <button className="boton primario" onClick={guardar} disabled={falla.trim().length < 3 || (!serie && descripcion.trim().length < 2)}>Abrir orden</button>}
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
  if (!o) return <div className="tarjeta suave">{d.error || "Cargando…"}</div>;
  const cerrada = ["ENTREGADO", "SIN_REPARACION", "CANCELADO"].includes(o.estado);
  const cobro = o.enGarantia ? 0 : Number(mo ?? o.costoManoObra) + Number(pz ?? o.costoPiezas);
  const enviar = async (estado?: string) => {
    try {
      await api(`/central/servicio/${id}`, { metodo: "PUT", cuerpo: {
        ...(estado ? { estado } : {}), ...(nota.trim() ? { nota: nota.trim() } : {}), ...(diag !== null ? { diagnostico: diag } : {}), ...(sol !== null ? { solucion: sol } : {}),
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
      <p style={{ margin: "4px 0" }}><span className="suave">Artículo:</span> <b>{o.descripcion}</b>{o.serie && ` · Serie ${o.serie}`}{o.factura && ` · Fact. #${o.factura}`}</p>
      <p style={{ margin: "4px 0" }}><span className="suave">Falla reportada:</span> {o.falla}</p>
      <p style={{ margin: "4px 0" }}><span className="suave">Atención:</span> {o.lugar === "TALLER" ? "En el taller" : `A domicilio · ${o.direccion ?? ""}`}</p>
      <p style={{ margin: "4px 0" }}><span className="suave">Garantía:</span> {o.enGarantia ? `Cubre garantía (hasta ${fechaCorta(o.garantiaHasta!)})` : o.garantiaHasta ? `Vencida el ${fechaCorta(o.garantiaHasta)}: se cobra` : "Sin garantía: se cobra"}</p>
      {cerrada && <>
        {o.diagnostico && <p style={{ margin: "4px 0" }}><span className="suave">Diagnóstico:</span> {o.diagnostico}</p>}
        {o.solucion && <p style={{ margin: "4px 0" }}><span className="suave">Solución:</span> {o.solucion}</p>}
      </>}
      {!cerrada && <div className="no-imprimir">
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
          {(SIGUIENTE[o.estado] ?? []).map((s) => <button key={s} className={"boton" + (s === "LISTO" || s === "ENTREGADO" ? " primario" : "")} onClick={() => enviar(s)}>{ESTADO[s]}</button>)}
        </div>
      </div>}
      {cerrada && !o.enGarantia && Number(o.costoManoObra) + Number(o.costoPiezas) > 0 && <p style={{ margin: "4px 0" }}><b>Costo del servicio: {rd(Number(o.costoManoObra) + Number(o.costoPiezas))}</b></p>}
      <hr />
      <b>Historial</b>
      <ul style={{ margin: "4px 0 0 18px", padding: 0 }}>{(o.historial ?? []).map((h, i) => <li key={i}>{fechaHora(h.fecha)} · {ESTADO[h.estado]}{h.nota ? ` · ${h.nota}` : ""}{h.por ? ` — ${h.por}` : ""}</li>)}</ul>
      <div className="solo-imprimir" style={{ marginTop: 36 }}>Firma del cliente: ______________________________</div>
      <div className="fila-acciones no-imprimir" style={{ marginTop: 8 }}><button className="boton" onClick={() => window.print()}>Imprimir orden</button></div>
    </div>
  );
}
