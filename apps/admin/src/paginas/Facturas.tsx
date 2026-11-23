import { SelectorPeriodo } from "../periodos";
import { useEffect, useState } from "react";
import { api, esLocal, hoy, num, puede, rd } from "../api";
import { htmlCarta, imprimirHtml } from "../impresion";
import { NuevaFactura, type BaseDuplicada } from "./NuevaFactura";
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
  clienteCorreo?: string | null; clienteTelefono?: string | null;
  sucursalId?: string;
  lineasDevolucion?: { linea: number; cantidad: string; devuelta: string }[] | null; devolucionesParciales?: number;
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
function htmlCartaFactura(d: Detalle) {
  return htmlCarta({
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

/** Vista previa del documento tal como saldrá impreso, con el botón Imprimir. */
function VistaPrevia({ titulo, html, ancho, onCerrar }: { titulo: string; html: Promise<string> | string; ancho: number; onCerrar: () => void }) {
  const [doc, setDoc] = useState<string | null>(null);
  useEffect(() => { let vivo = true; void Promise.resolve(html).then((h) => { if (vivo) setDoc(h); }); return () => { vivo = false; }; }, [html]);
  return (
    <div className="fondo-modal" style={{ zIndex: 60 }} onMouseDown={(e) => { e.stopPropagation(); onCerrar(); }}>
      <div className="modal ancho" style={{ maxWidth: ancho + 48 }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="fila-acciones" style={{ marginTop: 0 }}>
          <h3 style={{ margin: 0 }}>Vista previa · {titulo}</h3><span className="flex" />
          <button className="boton primario" disabled={!doc} onClick={() => doc && void imprimirHtml(doc)}>Imprimir</button>
          <button className="boton" onClick={onCerrar}>Cerrar</button>
        </div>
        {doc === null ? <p className="suave">Preparando la vista previa…</p>
          : <iframe title="Vista previa de la factura" srcDoc={doc} style={{ width: "100%", maxWidth: ancho, height: "70vh", border: "1px solid #cfd6dd", borderRadius: 6, background: "#fff", display: "block", margin: "10px auto 0" }} />}
      </div>
    </div>
  );
}

/** Página para el ticket angosto (la representación con QR se reimprime desde la caja). */
function htmlTicket(d: Detalle) {
  const filas = (d.lineas ?? []).map((l) => `<tr><td>${esc(l.descripcion)}<br><small>${num(l.cantidad, 3)} × ${rd(l.precio)}</small></td><td class="d">${rd(l.total)}</td></tr>`).join("");
  return (`<!doctype html><meta charset="utf-8"><title>Factura ${esc(d.numeroDocumento ?? d.fiscal?.encf ?? d.numero)}</title>
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
  const [ver, setVer] = useState<{ id: string; accion?: Accion } | null>(null);
  const [duplicando, setDuplicando] = useState<BaseDuplicada | null>(null);
  const [aviso, setAviso] = useState("");
  const params = new URLSearchParams({ desde, hasta, ...(sucursalId ? { sucursalId } : {}), ...(familia ? { familia } : {}), ...(estado ? { estado } : {}), ...(q.trim() ? { q: q.trim() } : {}) });
  const lista = useDatos<Fila[]>(`/central/facturas?${params}`, [recarga]);
  const [nueva, setNueva] = useState(false);
  /** Duplicar: lee la factura y abre «Nueva factura» con el mismo cliente, tipo y líneas */
  const duplicar = async (id: string) => {
    setAviso("");
    try {
      const d = await api<Detalle>(`/central/facturas/${id}`);
      setDuplicando({
        tipo: d.tipoDocumento, notas: d.notas, cliente: d.cliente ? { id: d.cliente.id, nombre: d.cliente.nombre, documento: d.cliente.documento, telefono: d.clienteTelefono ?? null, correo: d.clienteCorreo ?? null } : null,
        lineas: (d.lineas ?? []).map((l: any) => ({ presentacionId: l.presentacionId, nombre: l.descripcion, cantidad: l.cantidad, descuento: String(l.descuentoManual ?? 0) })),
      });
    } catch (e) { setAviso((e as Error).message); }
  };

  if (nueva) return <NuevaFactura onCerrar={() => setNueva(false)} onCreada={(id) => { setNueva(false); setRecarga((n) => n + 1); setVer({ id }); }} />;
  if (duplicando) return <NuevaFactura duplicarDe={duplicando} onCerrar={() => setDuplicando(null)} onCreada={(id) => { setDuplicando(null); setRecarga((n) => n + 1); setVer({ id }); }} />;
  return (
    <>
      <Encabezado titulo="Facturas" descripcion="Cree una factura, o busque cualquiera para reimprimirla, modificarla o anularla. Cada tipo se identifica por su prefijo: E (electrónico), B (NCF serie B) y FI- (sin comprobante).">
        {esLocal() && <button className="boton primario" onClick={() => setNueva(true)}>Crear factura</button>}
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
      <Aviso texto={lista.error || aviso} />
      <Tabla
        filas={lista.datos ?? []} clave={(f) => f.id} vacio="No hay facturas con este filtro."
        columnas={[
          { titulo: "Comprobante", valor: (f) => <><button className="enlace" onClick={() => setVer({ id: f.id })}>{f.comprobante ?? `Nº ${f.numero}`}</button><div className="suave">{prefijo(f.tipo)} · {NOMBRE[f.tipo] ?? f.tipo}</div></> },
          { titulo: "Fecha", valor: (f) => fecha(f.fecha) },
          { titulo: "Sucursal / caja", valor: (f) => <>{f.sucursal}<div className="suave">{f.caja ?? ""}{f.cajero ? ` · ${f.cajero}` : ""}</div></> },
          { titulo: "Cliente", valor: (f) => f.cliente ?? "Mostrador" },
          { titulo: "Total", der: true, valor: (f) => rd(f.total) },
          { titulo: "Estado", valor: (f) => <span className={"pastilla " + (f.anulada ? "alerta" : "ok")}>{f.anulada ? "Anulada" : "Emitida"}</span> },
          { titulo: "Acciones", valor: (f) => (
            <div className="fila-acciones" style={{ flexWrap: "wrap", gap: 4, margin: 0 }}>
              <button className="boton chico" onClick={() => setVer({ id: f.id })}>Ver</button>
              <button className="boton chico" onClick={() => setVer({ id: f.id, accion: "imprimir" })}>Imprimir</button>
              {!f.anulada && puede("admin.facturas") && <button className="boton chico" onClick={() => setVer({ id: f.id, accion: "modificar" })}>Modificar</button>}
              {esLocal() && puede("admin.facturas") && <button className="boton chico" onClick={() => void duplicar(f.id)}>Duplicar</button>}
              {!f.anulada && puede("admin.cxc") && <button className="boton chico" onClick={() => setVer({ id: f.id, accion: "pagar" })}>Pagar</button>}
              {!f.anulada && <button className="boton chico" onClick={() => setVer({ id: f.id, accion: "correo" })}>Correo</button>}
              {!f.anulada && <button className="boton chico" onClick={() => setVer({ id: f.id, accion: "whatsapp" })}>WhatsApp</button>}
              {!f.anulada && puede("venta.anular") && <button className="boton chico peligro" onClick={() => setVer({ id: f.id, accion: "anular" })}>Anular</button>}
            </div>) },
        ]}
      />
      {ver && <VerFactura id={ver.id} accionInicial={ver.accion} onCerrar={() => setVer(null)} onCambio={() => setRecarga((n) => n + 1)} onDuplicar={esLocal() ? (id) => { setVer(null); void duplicar(id); } : undefined} />}
    </>
  );
}

type Accion = "imprimir" | "modificar" | "pagar" | "correo" | "whatsapp" | "anular";

function VerFactura({ id, accionInicial, onCerrar, onCambio, onDuplicar }: { id: string; accionInicial?: Accion; onCerrar: () => void; onCambio: () => void; onDuplicar?: (id: string) => void }) {
  const { datos: d, error, recargar } = useDatos<Detalle>(`/central/facturas/${id}`);
  const [modo, setModo] = useState<"ver" | "modificar" | "anular" | "devolver" | "pagar">("ver");
  const [cantDev, setCantDev] = useState<Record<number, string>>({});
  const [motivo, setMotivo] = useState("");
  const [notas, setNotas] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [res, setRes] = useState<{ clienteId: string; nombre: string; documento: string | null }[]>([]);
  const [cliente, setCliente] = useState<{ id: string | null; nombre: string } | undefined>(undefined);
  const [msg, setMsg] = useState("");
  const [envio, setEnvio] = useState<{ para: string; enviando: boolean } | null>(null);
  const [previa, setPrevia] = useState<{ titulo: string; html: Promise<string> | string; ancho: number } | null>(null);
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
  const devolver = () => ejecutar(() => api(`/central/facturas/${id}/devolver`, { metodo: "POST", cuerpo: {
    motivo, lineas: Object.entries(cantDev).filter(([, c]) => Number(c) > 0).map(([linea, cantidad]) => ({ linea: Number(linea), cantidad: String(Number(cantidad)) })),
  } }), "Devolución registrada: se emitió la nota de crédito por lo devuelto");
  const anular = () => ejecutar(() => api(`/central/facturas/${id}/anular`, { metodo: "POST", cuerpo: { motivo } }), "Factura anulada");

  // Pagar: una factura a crédito con saldo pendiente se abona aquí (queda el recibo de ingreso, igual que desde Cuentas por cobrar)
  const [pendiente, setPendiente] = useState<number | null>(null);
  const [montoPago, setMontoPago] = useState(""); const [formaPago, setFormaPago] = useState("EFECTIVO"); const [refPago, setRefPago] = useState("");
  const abrirPago = async () => {
    setMsg(""); setModo("pagar"); setPendiente(null);
    if (!d?.cliente) { setPendiente(0); return; }
    try {
      const fs = await api<{ ventaId: string; pendiente: string }[]>(`/central/cxc/${d.cliente.id}/facturas`);
      const f = fs.find((x) => x.ventaId === id);
      const pend = f ? Number(f.pendiente) : 0;
      setPendiente(pend); setMontoPago(pend > 0 ? pend.toFixed(2) : "");
    } catch (e) { setMsg((e as Error).message); setPendiente(0); }
  };
  const pagar = () => ejecutar(async () => {
    const r: any = await api(`/central/cxc/${d!.cliente!.id}/abonos`, { cuerpo: { monto: Number(montoPago).toFixed(2), formaPago, referencia: refPago.trim() || undefined, modo: "FACTURA", ventaId: id } });
    return r;
  }, "Pago registrado: queda en el recibo de ingreso de la factura");
  // La acción elegida en la lista de facturas se ejecuta apenas carga el detalle
  const [hecha, setHecha] = useState(false);
  useEffect(() => {
    if (!d || hecha || !accionInicial) return;
    setHecha(true);
    const digitos = String(d.clienteTelefono ?? "").replace(/\D/g, "");
    switch (accionInicial) {
      case "imprimir": setPrevia({ titulo: "carta", html: htmlCartaFactura(d), ancho: 816 }); break;
      case "modificar": if (d.tipoDocumento === "SIN") empezarEdicion(); else setModo("modificar"); break;
      case "pagar": void abrirPago(); break;
      case "anular": setModo("anular"); break;
      case "correo": setEnvio({ para: d.clienteCorreo ?? "", enviando: false }); break;
      case "whatsapp": {
        const doc = d.fiscal?.encf ?? d.numeroDocumento ?? `Nº ${d.numero}`;
        if (digitos.length >= 10) window.open(`https://wa.me/${digitos.length === 10 ? "1" + digitos : digitos}?text=${encodeURIComponent(`Hola${d.cliente ? `, ${d.cliente.nombre}` : ""}. Le enviamos su factura ${doc} por ${rd(d.total)}. ¡Gracias por su compra!`)}`, "_blank", "noopener");
        else { setEnvio({ para: d.clienteCorreo ?? "", enviando: false }); setMsg("El cliente no tiene teléfono registrado: agréguelo en Clientes para enviarle la factura por WhatsApp."); }
        break;
      }
    }
  }, [d]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="fondo-modal" onMouseDown={onCerrar}>
      <div className="modal ancho" onMouseDown={(e) => e.stopPropagation()}>
        <div className="fila-acciones" style={{ marginTop: 0 }}>
          <h2 style={{ margin: 0 }}>{d ? `${d.fiscal?.encf ?? d.numeroDocumento ?? `Nº ${d.numero}`}` : "Factura"}</h2><span className="flex" />
          {d && <button className="boton chico" onClick={() => setPrevia({ titulo: "carta", html: htmlCartaFactura(d), ancho: 816 })} title="Ver cómo saldrá en hoja carta 8½ × 11">Imprimir carta</button>}
          {d && <button className="boton chico" onClick={() => setPrevia({ titulo: "ticket", html: htmlTicket(d), ancho: 380 })} title="Ver cómo saldrá en ticket angosto">Imprimir ticket</button>}
          {d && !d.anulada && <button className="boton chico" onClick={() => setEnvio(envio ? null : { para: d.clienteCorreo ?? "", enviando: false })}>Enviar al cliente</button>}
          {d && onDuplicar && puede("admin.facturas") && <button className="boton chico" onClick={() => onDuplicar(id)} title="Hacer otra factura igual a esta">Duplicar</button>}
          {d && !d.anulada && puede("admin.cxc") && <button className="boton chico" onClick={() => void abrirPago()}>Pagar</button>}
        </div>
        <Aviso texto={error} />
        {msg && <Aviso texto={msg} tipo={/modificada|anulada$|corregida|enviada|Devolución registrada|Pago registrado/.test(msg) ? "ok" : "error"} />}
        {d && envio && (() => {
          const digitos = String(d.clienteTelefono ?? "").replace(/\D/g, "");
          const doc = d.fiscal?.encf ?? d.numeroDocumento ?? `Nº ${d.numero}`;
          const texto = `Hola${d.cliente ? `, ${d.cliente.nombre}` : ""}. Le enviamos su factura ${doc} por ${rd(d.total)}. ¡Gracias por su compra!`;
          const wa = digitos.length >= 10 ? `https://wa.me/${digitos.length === 10 ? "1" + digitos : digitos}?text=${encodeURIComponent(texto)}` : null;
          const enviar = async () => {
            setEnvio({ ...envio, enviando: true }); setMsg("");
            try { await api(`/central/facturas/${id}/enviar`, { cuerpo: { para: [envio.para.trim()] } }); setMsg(`Factura enviada a ${envio.para.trim()}.`); setEnvio(null); }
            catch (e) { setMsg((e as Error).message); setEnvio({ ...envio, enviando: false }); }
          };
          return (
            <div className="panel">
              <b>Enviar la factura al cliente</b>
              <label className="campo"><span>Correo del cliente</span><input type="email" value={envio.para} onChange={(e) => setEnvio({ ...envio, para: e.target.value })} placeholder="cliente@correo.com" /></label>
              <div className="fila-acciones">
                <button className="boton primario" disabled={envio.enviando || !envio.para.includes("@")} onClick={enviar}>{envio.enviando ? "Enviando…" : "Enviar por correo"}</button>
                {wa ? <a className="boton" href={wa} target="_blank" rel="noreferrer">Abrir WhatsApp</a> : <span className="suave pequeno">Para WhatsApp el cliente necesita un teléfono.</span>}
              </div>
              <p className="suave pequeno" style={{ margin: "6px 0 0" }}>El correo lleva el detalle de la factura. Para un PDF, use «Imprimir carta» y elija «Guardar como PDF».</p>
            </div>
          );
        })()}
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
              {puede("venta.anular") && <button className="boton" onClick={() => { setMsg(""); setCantDev({}); setModo("devolver"); }}>Devolver parte</button>}
              {puede("venta.anular") && <button className="boton peligro" onClick={() => { setMsg(""); setModo("anular"); }}>Anular</button>}
            </div>
          )}
          {modo === "pagar" && (
            <div className="panel">
              <b>Pagar esta factura</b>
              {pendiente === null && <p className="suave">Buscando el saldo…</p>}
              {pendiente === 0 && <p>{d.cliente ? "Esta factura no tiene saldo pendiente: ya está pagada o no se vendió a crédito." : "La factura es de mostrador (sin cliente): no tiene cuenta por cobrar."}</p>}
              {pendiente !== null && pendiente > 0 && <>
                <p>Saldo pendiente de esta factura: <b>{rd(pendiente)}</b></p>
                <div className="panel cab-compra">
                  <label className="campo"><span>Monto</span><input inputMode="decimal" value={montoPago} onChange={(e) => setMontoPago(e.target.value.replace(/[^\d.]/g, ""))} /></label>
                  <label className="campo"><span>Forma de pago</span><select value={formaPago} onChange={(e) => setFormaPago(e.target.value)}><option value="EFECTIVO">Efectivo</option><option value="TARJETA">Tarjeta</option><option value="TRANSFERENCIA">Transferencia</option><option value="CHEQUE">Cheque</option></select></label>
                  <label className="campo"><span>Referencia</span><input value={refPago} maxLength={40} onChange={(e) => setRefPago(e.target.value)} placeholder="Nº de transferencia o cheque" /></label>
                </div></>}
              <div className="fila-acciones"><span className="flex" /><button className="boton" onClick={() => setModo("ver")}>Cancelar</button>
                {pendiente !== null && pendiente > 0 && <button className="boton primario" disabled={ocupado || !(Number(montoPago) > 0) || Number(montoPago) > pendiente + 0.001} onClick={pagar}>Registrar pago</button>}</div>
            </div>)}
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
          {modo === "devolver" && <>
            <p className="suave">Escriba cuántas unidades devuelve el cliente de cada línea. Se emite una nota de crédito solo por eso, la mercancía regresa al inventario y la devolución del dinero se registra en un turno abierto de la sucursal. La factura sigue vigente.
              {!esLocal() && " Esto se hace en la administración de la sucursal."}</p>
            <table className="tabla" style={{ width: "100%" }}><thead><tr><th>Producto</th><th style={{ textAlign: "right" }}>Vendido</th><th style={{ textAlign: "right" }}>Ya devuelto</th><th style={{ textAlign: "right" }}>Devolver</th></tr></thead><tbody>
              {(d.lineas ?? []).map((l: any, i: number) => {
                const x = d.lineasDevolucion?.[i];
                const queda = x ? Number(x.cantidad) - Number(x.devuelta) : 0;
                return (
                  <tr key={i}><td>{l.descripcion}</td><td style={{ textAlign: "right" }}>{num(l.cantidad, 3)}</td><td style={{ textAlign: "right" }}>{x ? num(x.devuelta, 3) : ""}</td>
                    <td style={{ textAlign: "right" }}>{queda > 0 && x ? <input inputMode="decimal" style={{ width: 80, textAlign: "right" }} value={cantDev[x.linea] ?? ""} placeholder="0"
                      onChange={(e) => setCantDev({ ...cantDev, [x.linea]: e.target.value.replace(/[^\d.]/g, "") })} /> : <span className="suave">—</span>}</td></tr>
                );
              })}
            </tbody></table>
            <label className="campo"><span>Motivo de la devolución (obligatorio)</span><input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Mínimo 10 caracteres" /></label>
            <div className="fila-acciones"><span className="flex" /><button className="boton" onClick={() => setModo("ver")}>Cancelar</button>
              <button className="boton primario" disabled={ocupado || motivo.trim().length < 10 || !Object.values(cantDev).some((c) => Number(c) > 0)} onClick={devolver}>Registrar devolución</button></div>
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
      {previa && <VistaPrevia {...previa} onCerrar={() => setPrevia(null)} />}
    </div>
  );
}
