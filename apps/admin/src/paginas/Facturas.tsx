import { SelectorPeriodo } from "../periodos";
import { useState } from "react";
import { api, esLocal, hoy, num, puede, rd } from "../api";
import { imprimirCarta, imprimirHtml } from "../impresion";
import { NuevaFactura } from "./NuevaFactura";
import { Aviso, Encabezado, SelectorSucursal, Tabla, useDatos } from "../ui";

/**
 * Facturas: buscar cualquier factura, reimprimirla, modificarla (nota y, en las internas, el cliente) o anularla.
 * Ver y modificar piden el permiso «Facturas»; anular pide además el de supervisor.
 */
interface Fila {
  id: string; numero: number; tipo: string; comprobante: string | null; total: string; fecha: string;
  sucursal: string; caja: string | null; cajero: string | null; cliente: string | null; anulada: boolean;
}
interface Detalle {
  id: string; numero: number; tipoDocumento: string; numeroDocumento: string | null; fecha: string; sucursal: string; caja: string | null; cajero: string | null;
  subtotal: string; descuento: string; itbis: string; total: string; notas: string | null; anulada: boolean;
  anulacion: { numero: number; fecha: string; motivo: string; por: string | null } | null;
  cliente: { id: string; nombre: string; documento: string | null } | null;
  sucursalId?: string;
  fiscal: { encf: string; codigoSeguridad: string | null; fechaFirma?: string | null; urlQr?: string | null; venceSecuencia?: string | null } | null;
  lineas: { descripcion: string; cantidad: string; precio: string; total: string }[] | null;
  pagos: { formaPago: string; monto: string }[] | null;
}

const NOMBRE: Record<string, string> = {
  E31: "e-CF Crédito fiscal", E32: "e-CF Consumo", B01: "NCF Crédito fiscal", B02: "NCF Consumo", B14: "NCF Régimen especial",
  B15: "NCF Gubernamental", B16: "NCF Exportación", SIN: "Sin comprobante",
};
const prefijo = (t: string) => (t.startsWith("E") ? "E" : t.startsWith("B") ? "B" : "FI-");
const fecha = (v: string) => new Date(v).toLocaleString("es-DO", { dateStyle: "short", timeStyle: "short" });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

/** Factura en CARTA (8½ × 11): encabezado de la empresa, cliente, detalle, totales y, en e-CF, el QR y datos de la firma. */
function imprimirCartaFactura(d: Detalle) {
  void imprimirCarta({
    titulo: NOMBRE[d.tipoDocumento] ?? d.tipoDocumento,
    numero: d.fiscal?.encf ?? d.numeroDocumento ?? `Nº ${d.numero}`,
    datos: [["Fecha", fecha(d.fecha)], ["Factura interna", String(d.numero)], ["Sucursal", d.sucursal], ...(d.cajero ? [["Atendido por", d.cajero] as [string, string]] : [])],
    etiquetaCliente: "Facturado a",
    cliente: d.cliente ? { nombre: d.cliente.nombre, documento: d.cliente.documento } : { nombre: "Consumidor final" },
    lineas: (d.lineas ?? []).map((l) => ({ descripcion: l.descripcion, cantidad: num(l.cantidad, 3), precio: rd(l.precio), total: rd(l.total) })),
    totales: [["Subtotal", rd(d.subtotal)], ...(Number(d.descuento) ? [["Descuento", rd(d.descuento)] as [string, string]] : []), ["ITBIS", rd(d.itbis)]],
    total: ["Total", rd(d.total)],
    notas: d.notas,
    pie: [(d.pagos ?? []).length ? `Forma de pago: ${(d.pagos ?? []).map((p) => `${p.formaPago} ${rd(p.monto)}`).join(" · ")}` : "", d.fiscal ? "" : "Documento sin comprobante fiscal."],
    fiscal: d.fiscal ? { encf: d.fiscal.encf, codigoSeguridad: d.fiscal.codigoSeguridad, fechaFirma: d.fiscal.fechaFirma, venceSecuencia: d.fiscal.venceSecuencia, urlQr: d.fiscal.urlQr } : null,
    anulada: d.anulada,
  }, d.sucursalId);
}

/** Abre una página lista para imprimir (la representación con QR se reimprime desde la caja). */
function imprimir(d: Detalle) {
  const filas = (d.lineas ?? []).map((l) => `<tr><td>${esc(l.descripcion)}<br><small>${num(l.cantidad, 3)} × ${rd(l.precio)}</small></td><td class="d">${rd(l.total)}</td></tr>`).join("");
  void imprimirHtml(`<!doctype html><meta charset="utf-8"><title>Factura ${esc(d.numeroDocumento ?? d.fiscal?.encf ?? d.numero)}</title>
<style>body{font:13px system-ui,sans-serif;margin:16px;max-width:380px}h1{font-size:16px;margin:0 0 4px}table{width:100%;border-collapse:collapse}td{padding:3px 0;vertical-align:top}.d{text-align:right}hr{border:0;border-top:1px dashed #888;margin:8px 0}small{color:#555}.anulada{color:#b00;font-weight:700;text-align:center;border:2px solid #b00;padding:4px;margin:8px 0}</style>
<h1>${esc(NOMBRE[d.tipoDocumento] ?? d.tipoDocumento)}</h1>
<div>${esc(d.fiscal?.encf ?? d.numeroDocumento ?? "")} · Nº ${d.numero}</div>
<div>${esc(d.sucursal)}${d.caja ? ` · ${esc(d.caja)}` : ""}<br>${fecha(d.fecha)}${d.cajero ? ` · ${esc(d.cajero)}` : ""}</div>
${d.cliente ? `<div>Cliente: ${esc(d.cliente.nombre)}${d.cliente.documento ? ` (${esc(d.cliente.documento)})` : ""}</div>` : ""}
${d.anulada ? `<div class="anulada">ANULADA</div>` : ""}<hr><table>${filas}</table><hr>
<table><tr><td>Subtotal</td><td class="d">${rd(d.subtotal)}</td></tr><tr><td>Descuento</td><td class="d">${rd(d.descuento)}</td></tr><tr><td>ITBIS</td><td class="d">${rd(d.itbis)}</td></tr><tr><td><b>Total</b></td><td class="d"><b>${rd(d.total)}</b></td></tr></table>
<hr>${(d.pagos ?? []).map((p) => `<div>${esc(p.formaPago)}: ${rd(p.monto)}</div>`).join("")}${d.notas ? `<p>${esc(d.notas)}</p>` : ""}
<p><small>Reimpresión desde la administración</small></p>`);
}

export function Facturas() {
  const [desde, setDesde] = useState(hoy().slice(0, 8) + "01");
  const [hasta, setHasta] = useState(hoy());
  const [sucursalId, setSucursalId] = useState("");
  const [familia, setFamilia] = useState("");
  const [estado, setEstado] = useState("");
  const [q, setQ] = useState("");
  const [recarga, setRecarga] = useState(0);
  const [ver, setVer] = useState<string | null>(null);
  const params = new URLSearchParams({ desde, hasta, ...(sucursalId ? { sucursalId } : {}), ...(familia ? { familia } : {}), ...(estado ? { estado } : {}), ...(q.trim() ? { q: q.trim() } : {}) });
  const lista = useDatos<Fila[]>(`/central/facturas?${params}`, [recarga]);
  const [nueva, setNueva] = useState(false);

  if (nueva) return <NuevaFactura onCerrar={() => setNueva(false)} onCreada={(id) => { setNueva(false); setRecarga((n) => n + 1); setVer(id); }} />;
  return (
    <>
      <Encabezado titulo="Facturas" descripcion="Cree una factura, o busque cualquiera para reimprimirla, modificarla o anularla. Cada tipo se identifica por su prefijo: E (electrónico), B (NCF serie B) y FI- (sin comprobante).">
        {esLocal() && <button className="boton primario" onClick={() => setNueva(true)}>Nueva factura</button>}
      </Encabezado>
      <div className="fila-acciones" style={{ marginBottom: 12, flexWrap: "wrap" }}>
        <SelectorPeriodo desde={desde} hasta={hasta} onCambio={(a, b) => { setDesde(a); setHasta(b); }} />
        <input type="date" aria-label="Desde" value={desde} onChange={(e) => setDesde(e.target.value)} />
        <input type="date" aria-label="Hasta" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        <SelectorSucursal valor={sucursalId} onCambio={setSucursalId} />
        <select value={familia} onChange={(e) => setFamilia(e.target.value)}>
          <option value="">Todos los comprobantes</option><option value="E">E · e-CF electrónico</option><option value="B">B · NCF serie B</option><option value="SIN">FI- · Sin comprobante</option>
        </select>
        <select value={estado} onChange={(e) => setEstado(e.target.value)}>
          <option value="">Emitidas y anuladas</option><option value="EMITIDA">Solo emitidas</option><option value="ANULADA">Solo anuladas</option>
        </select>
        <input placeholder="Número, e-NCF/NCF o cliente" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && setRecarga((n) => n + 1)} />
        <button className="boton primario" onClick={() => setRecarga((n) => n + 1)}>Buscar</button>
      </div>
      <Aviso texto={lista.error} />
      <Tabla
        filas={lista.datos ?? []} clave={(f) => f.id} vacio="No hay facturas con este filtro."
        columnas={[
          { titulo: "Comprobante", valor: (f) => <><button className="enlace" onClick={() => setVer(f.id)}>{f.comprobante ?? `Nº ${f.numero}`}</button><div className="suave">{prefijo(f.tipo)} · {NOMBRE[f.tipo] ?? f.tipo}</div></> },
          { titulo: "Fecha", valor: (f) => fecha(f.fecha) },
          { titulo: "Sucursal / caja", valor: (f) => <>{f.sucursal}<div className="suave">{f.caja ?? ""}{f.cajero ? ` · ${f.cajero}` : ""}</div></> },
          { titulo: "Cliente", valor: (f) => f.cliente ?? "Mostrador" },
          { titulo: "Total", der: true, valor: (f) => rd(f.total) },
          { titulo: "Estado", valor: (f) => <span className={"pastilla " + (f.anulada ? "alerta" : "ok")}>{f.anulada ? "Anulada" : "Emitida"}</span> },
        ]}
      />
      {ver && <VerFactura id={ver} onCerrar={() => setVer(null)} onCambio={() => setRecarga((n) => n + 1)} />}
    </>
  );
}

function VerFactura({ id, onCerrar, onCambio }: { id: string; onCerrar: () => void; onCambio: () => void }) {
  const { datos: d, error, recargar } = useDatos<Detalle>(`/central/facturas/${id}`);
  const [modo, setModo] = useState<"ver" | "modificar" | "anular">("ver");
  const [motivo, setMotivo] = useState("");
  const [notas, setNotas] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [res, setRes] = useState<{ clienteId: string; nombre: string; documento: string | null }[]>([]);
  const [cliente, setCliente] = useState<{ id: string | null; nombre: string } | undefined>(undefined);
  const [msg, setMsg] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const interna = d?.tipoDocumento === "SIN";
  // Edición de líneas (solo facturas sin comprobante): al guardar se corrige la factura (nueva con los cambios, la original queda anulada)
  type LineaEd = { presentacionId: string; descripcion: string; cantidad: string; descuento: string };
  const [lineas, setLineas] = useState<LineaEd[] | null>(null);
  const [qp, setQp] = useState("");
  const [resP, setResP] = useState<{ presentacionId: string; nombre: string; precio: string | null }[]>([]);
  const empezarEdicion = () => {
    setMsg(""); setModo("modificar");
    setLineas((d?.lineas ?? []).map((l: any) => ({ presentacionId: l.presentacionId, descripcion: l.descripcion, cantidad: String(Number(l.cantidad)), descuento: String(Number(l.descuentoManual ?? 0)) })));
  };
  const buscarProducto = async (v: string) => {
    setQp(v);
    if (v.trim().length < 2) return setResP([]);
    try { setResP(await api(`/central/facturas/buscar-producto?q=${encodeURIComponent(v.trim())}`)); } catch { setResP([]); }
  };
  const cambioLineas = !!lineas && JSON.stringify(lineas.map((l) => [l.presentacionId, Number(l.cantidad), Number(l.descuento)])) !==
    JSON.stringify((d?.lineas ?? []).map((l: any) => [l.presentacionId, Number(l.cantidad), Number(l.descuentoManual ?? 0)]));
  const corregir = () => ejecutar(async () => {
    const r: any = await api(`/central/facturas/${id}/corregir`, {
      metodo: "POST", cuerpo: {
        motivo, items: lineas!.map((l) => ({ presentacionId: l.presentacionId, cantidad: l.cantidad, ...(Number(l.descuento) > 0 ? { descuentoManual: Number(l.descuento).toFixed(2) } : {}) })),
        ...(notas !== null ? { notas: notas.trim() || null } : {}), ...(cliente ? { clienteId: cliente.id } : {}),
      },
    });
    setLineas(null);
    return r;
  }, "Factura corregida: la original quedó anulada y se emitió una nueva con los cambios");

  const buscar = async (v: string) => {
    setQ(v);
    if (v.trim().length < 2) return setRes([]);
    try { setRes(await api(`/central/cxc/buscar?q=${encodeURIComponent(v.trim())}`)); } catch { setRes([]); }
  };
  const ejecutar = async (f: () => Promise<unknown>, ok: string) => {
    setOcupado(true); setMsg("");
    try { await f(); setMsg(ok); setModo("ver"); setMotivo(""); onCambio(); recargar(); } catch (e) { setMsg((e as Error).message); }
    setOcupado(false);
  };
  const guardar = () => ejecutar(() => api(`/central/facturas/${id}`, {
    metodo: "PUT", cuerpo: { motivo, ...(notas !== null ? { notas: notas.trim() || null } : {}), ...(cliente ? { clienteId: cliente.id } : {}) },
  }), "Factura modificada");
  const anular = () => ejecutar(() => api(`/central/facturas/${id}/anular`, { metodo: "POST", cuerpo: { motivo } }), "Factura anulada");

  return (
    <div className="fondo-modal" onMouseDown={onCerrar}>
      <div className="modal ancho" onMouseDown={(e) => e.stopPropagation()}>
        <div className="fila-acciones" style={{ marginTop: 0 }}>
          <h2 style={{ margin: 0 }}>{d ? `${d.fiscal?.encf ?? d.numeroDocumento ?? `Nº ${d.numero}`}` : "Factura"}</h2><span className="flex" />
          {d && <button className="boton chico" onClick={() => imprimirCartaFactura(d)} title="Hoja carta 8½ × 11">Imprimir carta</button>}
          {d && <button className="boton chico" onClick={() => imprimir(d)} title="Ticket angosto">Imprimir ticket</button>}
        </div>
        <Aviso texto={error} />
        {msg && <Aviso texto={msg} tipo={/modificada|anulada$|corregida/.test(msg) ? "ok" : "error"} />}
        {d && <>
          <p><b>{NOMBRE[d.tipoDocumento] ?? d.tipoDocumento}</b> <span className="pastilla">{prefijo(d.tipoDocumento)}</span> {d.anulada && <span className="pastilla alerta">Anulada</span>}<br />
            <span className="suave">{d.sucursal}{d.caja ? ` · ${d.caja}` : ""} · {fecha(d.fecha)}{d.cajero ? ` · ${d.cajero}` : ""}</span><br />
            Cliente: {d.cliente ? `${d.cliente.nombre}${d.cliente.documento ? ` (${d.cliente.documento})` : ""}` : "Mostrador"}</p>
          {d.anulacion && <p className="nota">Anulada el {fecha(d.anulacion.fecha)}{d.anulacion.por ? ` por ${d.anulacion.por}` : ""}: {d.anulacion.motivo}</p>}
          {d.notas && <p className="nota">{d.notas}</p>}
          <Tabla filas={d.lineas ?? []} clave={(_, i) => String(i)} columnas={[
            { titulo: "Detalle", valor: (l) => l.descripcion },
            { titulo: "Cant.", der: true, valor: (l) => num(l.cantidad, 3) },
            { titulo: "Precio", der: true, valor: (l) => rd(l.precio) },
            { titulo: "Total", der: true, valor: (l) => rd(l.total) },
          ]} />
          <p style={{ textAlign: "right" }}>ITBIS {rd(d.itbis)} · <b>Total {rd(d.total)}</b><br />
            <span className="suave">{(d.pagos ?? []).map((p) => `${p.formaPago} ${rd(p.monto)}`).join(" · ")}</span></p>

          {modo === "ver" && !d.anulada && (
            <div className="fila-acciones">
              <span className="flex" />
              {puede("admin.facturas") && <button className="boton" onClick={() => { if (interna) empezarEdicion(); else { setMsg(""); setModo("modificar"); } }}>Modificar</button>}
              {puede("venta.anular") && <button className="boton peligro" onClick={() => { setMsg(""); setModo("anular"); }}>Anular</button>}
            </div>
          )}
          {modo === "modificar" && <>
            <p className="suave">{interna ? "Puede cambiar los productos, cantidades, descuentos, la nota y el cliente. Si cambia productos o montos, la factura original queda anulada («Corregida») y se emite una nueva con los cambios, siempre que su turno siga abierto." : "Esta factura tiene comprobante fiscal: solo se puede cambiar la nota. Para corregir otros datos, anúlela y emita una nueva."}</p>
            <label className="campo"><span>Nota de la factura</span><textarea maxLength={300} value={notas ?? d.notas ?? ""} onChange={(e) => setNotas(e.target.value)} /></label>
            {interna && lineas && <>
              <table className="tabla" style={{ width: "100%" }}><thead><tr><th>Producto</th><th style={{ textAlign: "right" }}>Cant.</th><th style={{ textAlign: "right" }}>Descuento RD$</th><th /></tr></thead><tbody>
                {lineas.map((l, i) => (
                  <tr key={i}>
                    <td>{l.descripcion}</td>
                    <td style={{ textAlign: "right" }}><input inputMode="decimal" style={{ width: 80, textAlign: "right" }} value={l.cantidad} onChange={(e) => setLineas(lineas.map((x, j) => j === i ? { ...x, cantidad: e.target.value.replace(/[^\d.]/g, "") } : x))} /></td>
                    <td style={{ textAlign: "right" }}><input inputMode="decimal" style={{ width: 90, textAlign: "right" }} value={l.descuento} onChange={(e) => setLineas(lineas.map((x, j) => j === i ? { ...x, descuento: e.target.value.replace(/[^\d.]/g, "") } : x))} /></td>
                    <td><button className="enlace" onClick={() => setLineas(lineas.filter((_, j) => j !== i))}>Quitar</button></td>
                  </tr>
                ))}
              </tbody></table>
              <label className="campo"><span>Agregar producto</span><input placeholder="Buscar producto por nombre, SKU o código" value={qp} onChange={(e) => buscarProducto(e.target.value)} /></label>
              {resP.map((p) => <button key={p.presentacionId} className="enlace" style={{ display: "block" }} onClick={() => { setLineas([...lineas, { presentacionId: p.presentacionId, descripcion: p.nombre, cantidad: "1", descuento: "0" }]); setResP([]); setQp(""); }}>{p.nombre}{p.precio ? ` · ${rd(p.precio)}` : ""}</button>)}
              <p className="suave pequeno">El precio de cada producto es el vigente; para cobrar menos use el descuento. Se mantiene la misma forma de pago por el nuevo total.</p>
            </>}
            {interna && <>
              <label className="campo"><span>Cliente{cliente ? `: ${cliente.nombre}` : ""}</span><input placeholder="Buscar cliente por nombre o documento" value={q} onChange={(e) => buscar(e.target.value)} /></label>
              {res.map((c) => <button key={c.clienteId} className="enlace" style={{ display: "block" }} onClick={() => { setCliente({ id: c.clienteId, nombre: c.nombre }); setRes([]); setQ(""); }}>{c.nombre}{c.documento ? ` · ${c.documento}` : ""}</button>)}
              <button className="enlace" onClick={() => setCliente({ id: null, nombre: "Mostrador" })}>Dejar como cliente mostrador</button>
            </>}
            <label className="campo"><span>Motivo del cambio (obligatorio)</span><input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Mínimo 10 caracteres" /><small className="suave">{motivo.trim().length < 10 ? `Faltan ${10 - motivo.trim().length} caracteres para poder guardar` : "Listo"}</small></label>
            <div className="fila-acciones"><span className="flex" /><button className="boton" onClick={() => { setModo("ver"); setLineas(null); }}>Cancelar</button>
              <button className="boton primario" disabled={ocupado || motivo.trim().length < 10 || (!!lineas && lineas.length === 0)} onClick={cambioLineas ? corregir : guardar}>{cambioLineas ? "Corregir factura" : "Guardar cambios"}</button></div>
          </>}
          {modo === "anular" && <>
            <p className="suave">Se emite la nota de crédito (o anulación interna), la mercancía regresa al inventario y la devolución se registra en un turno abierto de la sucursal.
              {!esLocal() && " Esto se hace en la administración de la sucursal."}</p>
            <label className="campo"><span>Motivo de la anulación (obligatorio)</span><input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Mínimo 10 caracteres" /></label>
            <div className="fila-acciones"><span className="flex" /><button className="boton" onClick={() => setModo("ver")}>Cancelar</button>
              <button className="boton peligro" disabled={ocupado || motivo.trim().length < 10} onClick={anular}>Anular factura</button></div>
          </>}
        </>}
        <div className="fila-acciones"><span className="flex" /><button className="boton" onClick={onCerrar}>Cerrar</button></div>
      </div>
    </div>
  );
}
