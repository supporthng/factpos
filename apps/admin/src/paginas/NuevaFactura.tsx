import { useFuncionSeguridad } from "../seguridad";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, puede, rd } from "../api";
import { Aviso, Encabezado, useCatalogo, useDatos } from "../ui";
import { BuscadorLinea } from "./Compras";

/**
 * Nueva factura desde la administración: se factura contra una caja con el turno abierto (ahí entra el dinero),
 * con los precios, ofertas e ITBIS del servidor, igual que en la caja.
 */
interface CajaAbierta { cajaId: string; caja: string; tipo?: string; sucursalId: string; sucursal: string; cajero: string | null; abiertoEn: string }
export interface ClienteB { id: string; nombre: string; documento: string | null; tipoDocumento?: string | null; telefono?: string | null; correo?: string | null; direccion?: string | null; nivel?: number | null; limiteCredito?: string; diasCredito?: number; saldo?: string }
interface Cotizacion {
  subtotal: string; descuento: string; itbis: string; total: string; ofertasAgotadas?: unknown; cupon?: { codigo: string; total: string } | null;
  lineas: { presentacionId: string; descripcion: string; cantidad: string; precio: string | null; oferta: string | null; descuento?: string; itbis?: string; total: string }[];
}
interface LineaF { clave: string; presentacionId: string; nombre: string; cantidad: string; descuento: string; /** precio libre (vacío = el de lista) */ precio: string; /** el producto pide número de serie por unidad */ usaSeries?: boolean; /** series escritas (una por unidad; separadas por coma, espacio o renglón) */ series: string }
interface PrevPlazos { plan: { nombre: string; cuotas: number; frecuencia: string; interesPct: string }; total: string; inicial: string; financiado: string; interes: string; totalAPagar: string; cuotaMonto: string; excepciones: string[]; puedeAprobar: boolean }
interface PagoF { id: string; forma: (typeof FORMAS)[number][0]; monto: string; recibido: string; referencia: string }

const TIPOS: { id: string; nombre: string; fiscal: boolean; pideCliente: boolean }[] = [
  { id: "E32", nombre: "Factura de consumo electrónica (e-CF)", fiscal: true, pideCliente: false },
  { id: "E31", nombre: "Factura de crédito fiscal electrónica (e-CF)", fiscal: true, pideCliente: true },
  { id: "B02", nombre: "Factura de consumo (NCF serie B)", fiscal: true, pideCliente: false },
  { id: "B01", nombre: "Factura de crédito fiscal (NCF serie B)", fiscal: true, pideCliente: true },
  { id: "B14", nombre: "Régimen especial (NCF B14)", fiscal: true, pideCliente: true },
  { id: "B15", nombre: "Gubernamental (NCF B15)", fiscal: true, pideCliente: true },
  { id: "SIN", nombre: "Interna, sin comprobante fiscal", fiscal: false, pideCliente: false },
];
const FORMAS = [["EFECTIVO", "Efectivo"], ["TARJETA", "Tarjeta"], ["TRANSFERENCIA", "Transferencia"], ["CREDITO", "A crédito (cuenta por cobrar)"], ["OTRO", "Otro"]] as const;
const n = (v: string | number | null | undefined) => Number(v ?? 0) || 0;
const seriesDe = (l: { series: string }) => l.series.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
const limpiar = (v: string) => v.replace(/[^\d.]/g, "");

/** `soloEnviar`: pantalla del vendedor (terminal de ventas): arma la venta y la envía a una caja; no cobra ni emite comprobantes. */
/** Factura que se copia para hacer otra igual (Duplicar): cliente, tipo, notas y líneas; los precios se vuelven a calcular con los de hoy. */
export interface BaseDuplicada { tipo: string; notas: string | null; cliente: ClienteB | null; lineas: { presentacionId: string; nombre: string; cantidad: string; descuento: string }[] }

export function NuevaFactura({ onCerrar, onCreada, soloEnviar = false, duplicarDe }: { onCerrar: () => void; onCreada: (id: string) => void; soloEnviar?: boolean; duplicarDe?: BaseDuplicada }) {
  const base = soloEnviar ? "/central/ventas" : "/central/facturas";
  // «Sin comprobante» solo si un administrador lo activó en Sistema › Seguridad
  const { habilitada: sinComprobante } = useFuncionSeguridad("venta_sin_comprobante");
  const { productos } = useCatalogo();
  const cajasTodas = useDatos<CajaAbierta[]>(`${base}/cajas-abiertas`);
  const cajas = { ...cajasTodas, datos: soloEnviar ? (cajasTodas.datos?.filter((c) => c.tipo !== "FACTURACION") ?? null) : cajasTodas.datos };
  const [cajaId, setCajaId] = useState("");
  const [cliente, setCliente] = useState<ClienteB | null>(duplicarDe?.cliente ?? null);
  const [busca, setBusca] = useState("");
  const [encontrados, setEncontrados] = useState<ClienteB[]>([]);
  const [tipo, setTipo] = useState(duplicarDe && TIPOS.some((x) => x.id === duplicarDe.tipo) ? duplicarDe.tipo : "E32");
  const [lineas, setLineas] = useState<LineaF[]>(() => (duplicarDe?.lineas ?? []).map((l) => ({ clave: crypto.randomUUID(), presentacionId: l.presentacionId, nombre: l.nombre, cantidad: String(Number(l.cantidad)), descuento: Number(l.descuento) > 0 ? String(Number(l.descuento)) : "", precio: "", usaSeries: false, series: "" })));
  const [cot, setCot] = useState<Cotizacion | null>(null);
  const [errCot, setErrCot] = useState("");
  const [pagos, setPagos] = useState<PagoF[]>([{ id: crypto.randomUUID(), forma: "EFECTIVO", monto: "", recibido: "", referencia: "" }]);
  const [cuponTxt, setCuponTxt] = useState("");
  const [cupon, setCupon] = useState("");
  const [motivo, setMotivo] = useState("");
  const puedeDescuento = puede("venta.descuento");
  const puedeLibre = puede("venta.precio_libre");
  const [motivoPrecio, setMotivoPrecio] = useState("");
  // Farmacias: la receta se pide cuando el servidor avisa que hay un medicamento controlado o con receta
  const [receta, setReceta] = useState<{ paciente: string; medico: string; exequatur: string; fechaReceta: string } | null>(null);
  /** «cobrar» = se emite aquí mismo; «enviar» = se manda a una caja y allí se cobra (el comprobante sale al cobrar) */
  const [modo, setModo] = useState<"cobrar" | "enviar">(soloEnviar ? "enviar" : "cobrar");
  const [enviada, setEnviada] = useState("");
  const [notas, setNotas] = useState(duplicarDe?.notas ?? "");
  const [msg, setMsg] = useState("");
  const [guardando, setGuardando] = useState(false);
  const ventaId = useRef(crypto.randomUUID()); // si se reintenta por un corte de red, no se duplica la factura
  const buscarRef = useRef<HTMLInputElement>(null);
  const cantRefs = useRef(new Map<string, HTMLInputElement>());
  const [foco, setFoco] = useState<string | null>(null);

  useEffect(() => { // las líneas copiadas no saben si su producto pide series: se completa cuando carga el catálogo
    if (!duplicarDe || productos.length === 0) return;
    setLineas((ls) => ls.map((l) => (l.usaSeries ? l : { ...l, usaSeries: !!productos.find((x) => x.presentaciones.some((pr) => pr.id === l.presentacionId))?.usaSeries })));
  }, [productos, duplicarDe]);
  useEffect(() => { if (!cajaId && cajas.datos?.[0]) setCajaId(cajas.datos[0].cajaId); }, [cajas.datos, cajaId]);

  useEffect(() => {
    if (busca.trim().length < 2) { setEncontrados([]); return; }
    const t = setTimeout(() => api<ClienteB[]>(`/central/clientes?q=${encodeURIComponent(busca.trim())}`).then((r) => setEncontrados(r.slice(0, 8))).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [busca]);

  const validas = lineas.filter((l) => n(l.cantidad) > 0);
  const items = () => validas.map((l) => ({ presentacionId: l.presentacionId, cantidad: l.cantidad, ...(n(l.descuento) > 0 ? { descuentoManual: n(l.descuento).toFixed(2) } : {}), ...(puedeLibre && n(l.precio) > 0 ? { precioLibre: n(l.precio).toFixed(2) } : {}), ...(l.usaSeries ? { series: seriesDe(l) } : {}) }));
  // Precios del servidor: se recalculan al cambiar productos, cantidades o cliente
  useEffect(() => {
    if (!cajaId || !validas.length) { setCot(null); setErrCot(""); return; }
    let vivo = true;
    const t = setTimeout(async () => {
      try {
        const r = await api<Cotizacion>(`${base}/cotizar`, { cuerpo: { cajaId, clienteId: cliente?.id, items: items() , ...(cupon ? { cuponCodigo: cupon } : {}) } });
        if (vivo) { setCot(r); setErrCot(""); }
      } catch (e) { if (vivo) { setCot(null); setErrCot((e as Error).message); } }
    }, 350);
    return () => { vivo = false; clearTimeout(t); };
  }, [cajaId, cliente?.id, cupon, JSON.stringify(validas.map((l) => [l.presentacionId, l.cantidad, l.descuento, l.precio, l.series]))]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!foco) return;
    const el = cantRefs.current.get(foco);
    if (el) { el.focus(); el.select(); setFoco(null); }
  }, [foco, lineas]);

  const agregar = (presentacionId: string) => {
    const p = productos.find((x) => x.presentaciones.some((pr) => pr.id === presentacionId));
    const pr = p?.presentaciones.find((x) => x.id === presentacionId);
    if (!p || !pr) return;
    const ya = lineas.find((l) => l.presentacionId === presentacionId);
    if (ya) { setLineas((ls) => ls.map((l) => (l.clave === ya.clave ? { ...l, cantidad: String(n(l.cantidad) + 1) } : l))); return; }
    const clave = crypto.randomUUID();
    setLineas((ls) => [...ls, { clave, presentacionId, nombre: `${p.nombre}${pr.nombre !== "Unidad" ? ` · ${pr.nombre}` : ""}`, cantidad: "1", descuento: "", precio: "", usaSeries: !!p.usaSeries, series: "" }]);
    setFoco(clave);
  };

  const t = TIPOS.find((x) => x.id === tipo)!;
  const total = n(cot?.total);
  const unico = pagos.length === 1;
  const montoDe = (p: PagoF) => (unico ? total : n(p.monto));
  const pagado = pagos.reduce((a, p) => a + montoDe(p), 0);
  const falta = Math.round((total - pagado) * 100) / 100;
  const hayDescuento = lineas.some((l) => n(l.descuento) > 0);
  const hayPrecioLibre = puedeLibre && lineas.some((l) => n(l.precio) > 0);
  const cajaSel = cajas.datos?.find((c) => c.cajaId === cajaId);
  // Crédito a plazos: si parte del cobro queda a crédito, se puede financiar en cuotas con un plan predefinido
  const planes = useDatos<{ id: string; nombre: string; cuotas: number; frecuencia: string; interesPct: string; activo: boolean }[]>(puede("admin.cxc") ? "/central/cxc/config/planes" : null);
  const [planId, setPlanId] = useState("");
  const [sinPlan, setSinPlan] = useState<{ id: string; error: string } | null>(null);
  const montoCredito = pagos.filter((p) => p.forma === "CREDITO").reduce((a, p) => a + montoDe(p), 0);
  const planElegido = planes.datos?.find((p) => p.id === planId);
  // Venta a plazos (solo en la pantalla del vendedor): plan del catálogo, inicial y garante; la caja cobra solo la inicial
  const planesVenta = useDatos<{ id: string; nombre: string; cuotas: number; frecuencia: string; interesPct: string; inicialMinPct: string; montoMinimo: string }[]>(soloEnviar ? "/central/por-cobrar/planes" : null);
  const [aPlazos, setAPlazos] = useState(false);
  const [planVenta, setPlanVenta] = useState("");
  const [inicial, setInicial] = useState("");
  const [gNombre, setGNombre] = useState(""); const [gDoc, setGDoc] = useState(""); const [gTel, setGTel] = useState("");
  const [motivoCredito, setMotivoCredito] = useState("");
  const [prev, setPrev] = useState<PrevPlazos | null>(null);
  const [errPrev, setErrPrev] = useState("");
  const financiamiento = () => ({
    planId: planVenta, inicial: n(inicial).toFixed(2),
    garante: { nombre: gNombre.trim(), documento: gDoc.trim(), ...(gTel.trim() ? { telefono: gTel.trim() } : {}) },
    ...(motivoCredito.trim() ? { motivoExcepcion: motivoCredito.trim() } : {}),
  });
  useEffect(() => {
    if (!aPlazos || !planVenta || !cliente || !cot || n(inicial) <= 0) { setPrev(null); setErrPrev(""); return; }
    let vivo = true;
    const t = setTimeout(async () => {
      try {
        const r = await api<PrevPlazos>("/central/por-cobrar/plazos/previsualizar", { cuerpo: { clienteId: cliente.id, total: cot.total, financiamiento: financiamiento() } });
        if (vivo) { setPrev(r); setErrPrev(""); }
      } catch (e) { if (vivo) { setPrev(null); setErrPrev((e as Error).message); } }
    }, 350);
    return () => { vivo = false; clearTimeout(t); };
  }, [aPlazos, planVenta, cliente?.id, cot?.total, inicial, gNombre, gDoc]); // eslint-disable-line react-hooks/exhaustive-deps
  const planSel = planesVenta.datos?.find((p) => p.id === planVenta);
  const inicialMinima = planSel && cot ? Math.ceil(n(cot.total) * n(planSel.inicialMinPct)) / 100 : 0;
  const puedeEnviar = !!cajaSel && cajaSel.tipo !== "FACTURACION";
  const enviando = modo === "enviar" && puedeEnviar;
  const cambio = pagos.reduce((a, p) => a + (p.forma === "EFECTIVO" && n(p.recibido) > montoDe(p) ? n(p.recibido) - montoDe(p) : 0), 0);
  const cambiarPago = (id: string, c: Partial<PagoF>) => setPagos((ps) => ps.map((p) => (p.id === id ? { ...p, ...c } : p)));
  const agregarPago = () => setPagos((ps) => [...(ps.length === 1 ? [{ ...ps[0], monto: total ? total.toFixed(2) : "" }] : ps), { id: crypto.randomUUID(), forma: "TARJETA", monto: "", recibido: "", referencia: "" }]);
  const problema = useMemo(() => {
    if (!cajas.datos?.length) return "";
    if (!validas.length) return "Agregue al menos un producto.";
    if (errCot) return errCot;
    if (!cot) return "Calculando…";
    if (hayDescuento && motivo.trim().length < 5) return "Escriba el motivo del descuento.";
    if (hayPrecioLibre && motivoPrecio.trim().length < 5) return "Escriba el motivo del cambio de precio.";
    const sinSeries = validas.find((l) => l.usaSeries && seriesDe(l).length !== n(l.cantidad));
    if (sinSeries) return `${sinSeries.nombre}: escriba ${n(sinSeries.cantidad)} número(s) de serie (lleva ${seriesDe(sinSeries).length}).`;
    if (enviando && soloEnviar && aPlazos) {
      if (!cliente) return "La venta a plazos requiere un cliente.";
      if (!planVenta) return "Elija el plan de financiamiento.";
      if (n(inicial) <= 0) return "Escriba la inicial que paga el cliente.";
      if (errPrev) return errPrev;
      if (!prev) return "Calculando el plan…";
      if (prev.excepciones.length && !prev.puedeAprobar) return `Un supervisor debe decidir: ${prev.excepciones.join("; ")}.`;
      if (prev.excepciones.length && motivoCredito.trim().length < 5) return "Escriba el motivo para aprobar el crédito.";
    }
    if (enviando) return "";
    if (t.pideCliente && !(cliente?.documento)) return "Este comprobante requiere un cliente con RNC o cédula.";
    if (pagos.some((p) => p.forma === "CREDITO") && !cliente) return "La venta a crédito requiere un cliente.";
    if (Math.abs(falta) >= 0.005) return falta > 0 ? `Faltan ${rd(falta)} por cobrar.` : `Los pagos se pasan por ${rd(-falta)}.`;
    if (pagos.some((p) => montoDe(p) <= 0)) return "Cada pago debe tener un monto.";
    if (pagos.some((p) => p.forma === "EFECTIVO" && p.recibido && n(p.recibido) < montoDe(p))) return "El efectivo recibido es menor que el monto en efectivo.";
    return "";
  }, [aPlazos, planVenta, inicial, prev, errPrev, motivoCredito, enviando, hayPrecioLibre, motivoPrecio, cajas.datos, validas.length, errCot, cot, t.pideCliente, cliente, pagos, falta, hayDescuento, motivo, total]); // eslint-disable-line react-hooks/exhaustive-deps

  const enviar = async () => {
    if (problema || !cot) return;
    setGuardando(true); setMsg(""); setEnviada("");
    try {
      const r = await api<{ numero: string }>("/central/por-cobrar", { cuerpo: {
        cajaId, clienteId: cliente?.id, notas: notas.trim() || undefined, items: items(),
        ...(hayDescuento ? { motivoDescuento: motivo.trim() } : {}), ...(hayPrecioLibre ? { motivoPrecio: motivoPrecio.trim() } : {}),
        ...(soloEnviar && aPlazos ? { financiamiento: financiamiento() } : {}),
      } });
      setEnviada(`Venta #${r.numero} enviada a ${cajaSel?.caja ?? "la caja"}: el cajero la verá en «Por cobrar»${aPlazos ? ` y cobrará la inicial de ${rd(n(inicial))}` : ""}.`);
      setAPlazos(false); setPlanVenta(""); setInicial(""); setGNombre(""); setGDoc(""); setGTel(""); setMotivoCredito(""); setPrev(null);
      setLineas([]); setCliente(null); setNotas(""); setMotivo(""); setMotivoPrecio(""); setCupon(""); setCuponTxt(""); setCot(null);
      ventaId.current = crypto.randomUUID();
    } catch (e) { setMsg((e as Error).message); }
    setGuardando(false);
  };

  const crear = async () => {
    if (problema || !cot) return;
    if (!confirm(`Se emitirá ${t.nombre} por ${rd(total)}${t.fiscal ? ".\n\nUn comprobante fiscal no se puede modificar: solo se anula." : "."}\n\n¿Continuar?`)) return;
    setGuardando(true); setMsg("");
    try {
      const r = await api<{ id: string }>("/central/facturas", { cuerpo: {
        cajaId, clienteId: cliente?.id, tipoDocumento: tipo, notas: notas.trim() || undefined, ventaId: ventaId.current,
        items: items(), ...(cupon ? { cuponCodigo: cupon } : {}), ...(hayDescuento ? { motivoDescuento: motivo.trim() } : {}), ...(hayPrecioLibre ? { motivoPrecio: motivoPrecio.trim() } : {}),
        ...(receta ? { receta: { paciente: receta.paciente.trim(), medico: receta.medico.trim(), ...(receta.exequatur.trim() ? { exequatur: receta.exequatur.trim() } : {}), ...(receta.fechaReceta ? { fechaReceta: receta.fechaReceta } : {}) } } : {}),
        pagos: pagos.map((p) => ({
          formaPago: p.forma, monto: montoDe(p).toFixed(2),
          ...(p.forma === "EFECTIVO" && n(p.recibido) >= montoDe(p) && p.recibido ? { recibido: n(p.recibido).toFixed(2) } : {}),
          ...(p.referencia.trim() ? { referencia: p.referencia.trim() } : {}),
        })),
      } });
      if (planId && cliente && montoCredito > 0) {
        try { await api(`/central/cxc/${cliente.id}/planes`, { cuerpo: { planId, ventaId: r.id, capital: montoCredito.toFixed(2) } }); }
        catch (e) { setSinPlan({ id: r.id, error: (e as Error).message }); setGuardando(false); return; } // la factura ya está hecha: se avisa y se deja ir a verla
      }
      onCreada(r.id);
    } catch (e) {
      const m = (e as Error).message;
      if (/^RECETA:/.test(m)) { setReceta((r) => r ?? { paciente: "", medico: "", exequatur: "", fechaReceta: "" }); setMsg(m.replace(/^RECETA:\s*/, "")); }
      else setMsg(m);
      setGuardando(false);
    }
  };

  const bloqueCaja = (
    <label className="campo"><span>{cajas.datos?.every((c) => c.tipo === "FACTURACION") ? "Facturar desde" : "Caja (turno abierto)"}</span>
          <select value={cajaId} onChange={(e) => setCajaId(e.target.value)}>
            {cajas.datos?.map((c) => <option key={c.cajaId} value={c.cajaId}>{c.sucursal} · {c.tipo === "FACTURACION" ? "Facturación (sin caja)" : c.caja}{c.cajero && c.tipo !== "FACTURACION" ? ` · ${c.cajero}` : ""}</option>)}
          </select>
        </label>
  );
  const bloqueCliente = (
        <div className="campo campo-prov"><span>Cliente {t.pideCliente ? "(obligatorio)" : "(opcional: sin cliente = mostrador)"}</span>
          {cliente ? (
            <span className="en-linea"><b>{cliente.nombre}</b><span className="suave">{cliente.documento ?? "sin documento"}</span><button className="boton fantasma" onClick={() => setCliente(null)}>✕ Quitar</button></span>
          ) : (
            <div className="selector-producto">
              <input value={busca} placeholder="Buscar cliente por nombre, RNC, cédula o teléfono…" onChange={(e) => setBusca(e.target.value)} />
              {encontrados.length > 0 && <div className="desplegable">{encontrados.map((c) => (
                <button key={c.id} onMouseDown={(e) => { e.preventDefault(); setCliente(c); setBusca(""); setEncontrados([]); }}><b>{c.nombre}</b> <span className="suave">{c.documento ?? ""}</span></button>
              ))}</div>}
            </div>
          )}
        </div>
  );
  const bloqueLineas = (
    <>
        {!lineas.length ? <p className="suave vacio-compra">Busque los productos que lleva el cliente.</p> : (
          <div className="tabla-contenedor"><table className="tabla tabla-edicion">
            <thead><tr><th>#</th><th>Producto</th><th className="der">Cantidad</th><th className="der">Precio{puedeLibre ? " (editable)" : ""}</th>{puedeDescuento && <th className="der">Descuento RD$</th>}<th className="der">Total</th><th /></tr></thead>
            <tbody>{lineas.map((l, i) => {
              const c = cot?.lineas.find((x) => x.presentacionId === l.presentacionId);
              return (
                <tr key={l.clave}>
                  <td className="suave">{i + 1}</td>
                  <td><b>{l.nombre}</b>{c?.oferta && <span className="pastilla en-oferta">{c.oferta}</span>}
                    {l.usaSeries && <textarea rows={Math.min(4, Math.max(1, n(l.cantidad)))} value={l.series} placeholder={`Serie / IMEI (${n(l.cantidad)}): una por renglón o separadas por coma`}
                      style={{ display: "block", width: "100%", marginTop: 4 }} aria-label="Series"
                      onChange={(e) => setLineas((ls) => ls.map((x) => (x.clave === l.clave ? { ...x, series: e.target.value.toUpperCase() } : x)))} />}
                    {l.usaSeries && <span className={seriesDe(l).length === n(l.cantidad) ? "suave pequeno texto-ok" : "suave pequeno"}>{seriesDe(l).length} de {n(l.cantidad)} series</span>}</td>
                  <td className="der" style={{ width: 110 }}><input className="numero" inputMode="decimal" value={l.cantidad} aria-label="Cantidad"
                    ref={(el) => { if (el) cantRefs.current.set(l.clave, el); else cantRefs.current.delete(l.clave); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); buscarRef.current?.focus(); } }}
                    onChange={(e) => setLineas((ls) => ls.map((x) => (x.clave === l.clave ? { ...x, cantidad: limpiar(e.target.value) } : x)))} /></td>
                  {puedeLibre
                    ? <td className="der" style={{ width: 130 }}><input className="numero" inputMode="decimal" value={l.precio} placeholder={c?.precio ? n(c.precio).toFixed(2) : "…"} aria-label="Precio"
                        onChange={(e) => setLineas((ls) => ls.map((x) => (x.clave === l.clave ? { ...x, precio: limpiar(e.target.value) } : x)))} /></td>
                    : <td className="der">{c?.precio ? rd(c.precio) : "…"}</td>}
                  {puedeDescuento && <td className="der" style={{ width: 120 }}><input className="numero" inputMode="decimal" value={l.descuento} placeholder="0" aria-label="Descuento"
                    onChange={(e) => setLineas((ls) => ls.map((x) => (x.clave === l.clave ? { ...x, descuento: limpiar(e.target.value) } : x)))} /></td>}
                  <td className="der">{c ? rd(c.total) : "…"}</td>
                  <td><button className="boton fantasma" aria-label="Quitar" onClick={() => setLineas((ls) => ls.filter((x) => x.clave !== l.clave))}>✕</button></td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
    </>
  );
  const bloqueNotas = (
        <label className="campo"><span>Notas (salen en la factura)</span><input value={notas} maxLength={300} onChange={(e) => setNotas(e.target.value)} /></label>
  );
  const bloqueCupon = (
    <>
        <label className="campo"><span>Cupón de descuento</span>
          {cupon ? <span className="en-linea"><b>{cupon}</b>{cot?.cupon ? <span className="texto-ok">−{rd(cot.cupon.total)}</span> : null}<button className="boton fantasma" onClick={() => { setCupon(""); setCuponTxt(""); }}>✕ Quitar</button></span>
            : <span className="en-linea"><input value={cuponTxt} placeholder="Código del cupón" onChange={(e) => setCuponTxt(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === "Enter" && cuponTxt.trim() && setCupon(cuponTxt.trim())} />
              <button className="boton" disabled={!cuponTxt.trim()} onClick={() => setCupon(cuponTxt.trim())}>Aplicar</button></span>}
        </label>
        {puedeDescuento && hayDescuento && <label className="campo campo-prov"><span>Motivo del descuento (queda en auditoría)</span><input value={motivo} maxLength={200} onChange={(e) => setMotivo(e.target.value)} /></label>}
        {hayPrecioLibre && <label className="campo campo-prov"><span>Motivo del cambio de precio (queda en auditoría)</span><input value={motivoPrecio} maxLength={200} onChange={(e) => setMotivoPrecio(e.target.value)} /></label>}
        {!puedeDescuento && <p className="suave pequeno">Para dar descuentos por línea se necesita el permiso «Aprobar descuentos».</p>}
    </>
  );
  const sinCajas = cajas.datos && !cajas.datos.length;
  // Terminal de ventas (vendedor): carrito a la izquierda; cliente, caja, notas y total siempre a la vista a la derecha
  if (soloEnviar) {
    return (
      <div className="tv">
        <div className="tv-izq">
          <Aviso texto={cajas.error || msg} />
          {enviada && <Aviso tipo="info" texto={enviada} />}
          {sinCajas && <Aviso tipo="info" texto="No hay ninguna caja con el turno abierto para recibir la venta. Pida al cajero que abra su turno." />}
          <div className="panel tv-buscar"><BuscadorLinea inputRef={buscarRef} onElegir={agregar} /></div>
          <div className="panel tv-carrito">
            <div className="tv-titulo"><h3>Venta en curso</h3><span className="suave">{validas.length} {validas.length === 1 ? "línea" : "líneas"}</span></div>
            {lineas.length ? bloqueLineas : <div className="tv-vacio"><b>Todavía no hay productos</b><span className="suave">Escriba el nombre o el SKU arriba y presione Enter para agregarlo.</span></div>}
          </div>
        </div>
        <aside className="tv-der">
          <div className="panel tv-cliente">
            <div className="tv-titulo"><h3>Cliente</h3>{cliente && <button className="boton fantasma chico" onClick={() => setCliente(null)}>Cambiar</button>}</div>
            {cliente ? (
              <div className="tv-cliente-ficha">
                <b>{cliente.nombre}</b>
                <dl>
                  <dt>{cliente.tipoDocumento === "RNC" ? "RNC" : cliente.tipoDocumento === "CEDULA" ? "Cédula" : "Documento"}</dt><dd>{cliente.documento ?? "—"}</dd>
                  <dt>Teléfono</dt><dd>{cliente.telefono || "—"}</dd>
                  <dt>Correo</dt><dd>{cliente.correo || "—"}</dd>
                  <dt>Dirección</dt><dd>{cliente.direccion || "—"}</dd>
                  <dt>Precio</dt><dd>Nivel {cliente.nivel ?? 1}</dd>
                  <dt>Crédito</dt><dd>{n(cliente.limiteCredito) > 0 ? `límite ${rd(cliente.limiteCredito!)} · ${cliente.diasCredito ?? 30} días` : "sin límite asignado"}</dd>
                  <dt>Debe</dt><dd className={n(cliente.saldo) > 0 ? "texto-alerta" : ""}>{rd(cliente.saldo ?? 0)}{n(cliente.limiteCredito) > 0 && <span className="suave"> · disponible {rd(Math.max(0, n(cliente.limiteCredito) - n(cliente.saldo)))}</span>}</dd>
                </dl>
              </div>
            ) : (
              <div className="selector-producto">
                <input value={busca} placeholder="Buscar por nombre, RNC, cédula o teléfono…" onChange={(e) => setBusca(e.target.value)} />
                {encontrados.length > 0 && <div className="desplegable">{encontrados.map((c) => (
                  <button key={c.id} onMouseDown={(e) => { e.preventDefault(); setCliente(c); setBusca(""); setEncontrados([]); }}><b>{c.nombre}</b> <span className="suave">{c.documento ?? ""}</span></button>
                ))}</div>}
                <p className="suave pequeno" style={{ margin: "6px 0 0" }}>Sin cliente = venta de mostrador.</p>
              </div>
            )}
          </div>
          {(planesVenta.datos?.length ?? 0) > 0 && (
            <div className="panel tv-datos">
              <label className="en-linea"><input type="checkbox" checked={aPlazos} onChange={(e) => setAPlazos(e.target.checked)} /> <b>Vender a plazos (financiamiento)</b></label>
              {aPlazos && (
                <>
                  {!cliente && <p className="suave pequeno">Elija primero el cliente: el crédito se registra a su nombre.</p>}
                  <label className="campo"><span>Plan</span>
                    <select value={planVenta} onChange={(e) => { setPlanVenta(e.target.value); const p = planesVenta.datos?.find((x) => x.id === e.target.value); if (p && cot && !n(inicial)) setInicial((Math.ceil(n(cot.total) * n(p.inicialMinPct)) / 100 || "").toString()); }}>
                      <option value="">Elija el plan…</option>
                      {(planesVenta.datos ?? []).map((p) => <option key={p.id} value={p.id}>{p.nombre} · {n(p.interesPct) > 0 ? `${n(p.interesPct)} % de interés` : "sin interés"}</option>)}
                    </select></label>
                  <label className="campo"><span>Inicial (RD$){planSel && n(planSel.inicialMinPct) > 0 ? ` · mínimo ${n(planSel.inicialMinPct)} % = ${rd(inicialMinima)}` : ""}</span>
                    <input className="numero" inputMode="decimal" value={inicial} onChange={(e) => setInicial(limpiar(e.target.value))} /></label>
                  <h4 style={{ margin: "8px 0 2px" }}>Garante</h4>
                  <label className="campo"><span>Nombre</span><input value={gNombre} maxLength={120} onChange={(e) => setGNombre(e.target.value)} /></label>
                  <label className="campo"><span>Cédula del garante</span><input value={gDoc} inputMode="numeric" maxLength={13} placeholder="000-0000000-0" onChange={(e) => setGDoc(e.target.value)} /></label>
                  <label className="campo"><span>Teléfono (opcional)</span><input value={gTel} maxLength={30} onChange={(e) => setGTel(e.target.value)} /></label>
                  {errPrev && n(inicial) > 0 && planVenta && <p className="texto-alerta pequeno">{errPrev}</p>}
                  {prev && (
                    <div className="tv-fila-plazos">
                      <div className="tv-fila"><span>Inicial (la cobra la caja)</span><b>{rd(prev.inicial)}</b></div>
                      <div className="tv-fila"><span>Se financia</span><span>{rd(prev.financiado)}</span></div>
                      <div className="tv-fila"><span>{n(prev.plan.interesPct) > 0 ? `Interés ${n(prev.plan.interesPct)} %` : "Sin interés"}</span><span>{rd(prev.interes)}</span></div>
                      <div className="tv-fila"><span>{prev.plan.cuotas} cuotas de</span><b>{rd(prev.cuotaMonto)}</b></div>
                      <div className="tv-fila"><span>Total a pagar a plazos</span><span>{rd(prev.totalAPagar)}</span></div>
                      {prev.excepciones.length > 0 && (
                        <div className="panel" style={{ marginTop: 6 }}>
                          <b className="texto-alerta">El cliente no cumple todo:</b>
                          <ul style={{ margin: "4px 0 6px 18px", padding: 0 }}>{prev.excepciones.map((x) => <li key={x}>{x}</li>)}</ul>
                          {prev.puedeAprobar
                            ? <label className="campo"><span>Usted puede aprobarlo: escriba el motivo (queda registrado)</span><input value={motivoCredito} maxLength={200} onChange={(e) => setMotivoCredito(e.target.value)} /></label>
                            : <p className="suave pequeno">Un supervisor con el permiso «Vender a crédito» debe decidir y enviar esta venta.</p>}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
          <div className="panel tv-datos">{bloqueCaja}</div>
          <div className="panel tv-datos">{bloqueNotas}{bloqueCupon}</div>
          <div className="panel tv-total">
            {cot ? (
              <>
                <div className="tv-fila"><span>Subtotal</span><span>{rd(cot.subtotal)}</span></div>
                {n(cot.descuento) > 0 && <div className="tv-fila texto-ok"><span>Descuento</span><span>−{rd(cot.descuento)}</span></div>}
                <div className="tv-fila"><span>ITBIS</span><span>{rd(cot.itbis)}</span></div>
              </>
            ) : <div className="tv-fila suave"><span>{lineas.length ? "Calculando…" : "Sin productos"}</span><span /></div>}
            <div className="tv-gran"><span>Total</span><b>{rd(total)}</b></div>
            <button className="boton primario tv-enviar" disabled={!!problema || guardando} onClick={enviar}>{guardando ? "Enviando…" : aPlazos && n(inicial) > 0 ? `Enviar a caja · inicial ${rd(n(inicial))}` : "Enviar a caja"}</button>
            {aPlazos && <p className="suave pequeno" style={{ margin: "8px 0 0" }}>La caja cobra la inicial, emite la factura y crea el plan de cuotas. El interés de cada plan solo lo cambia el administrador.</p>}
            {problema && lineas.length > 0 && <p className="suave pequeno" style={{ margin: "8px 0 0" }}>{problema}</p>}
          </div>
        </aside>
      </div>
    );
  }

  return (
    <>
      {!soloEnviar && <div className="migas"><button className="enlace" onClick={() => (!lineas.length || confirm("La factura no se ha emitido. ¿Salir?")) && onCerrar()}>Facturas</button><span>/</span><span>Nueva factura</span></div>}
      {soloEnviar
        ? <Encabezado titulo="Nueva venta" descripcion="Busque los productos, arme la venta y envíela a la caja: el cliente paga allí y la caja emite el comprobante." />
        : <Encabezado titulo="Nueva factura" descripcion="Se factura como en la caja: precios del cliente, ofertas e ITBIS del sistema, y sale del inventario de esa caja." />}
      <Aviso texto={cajas.error || msg} />
      {receta && (
        <div className="panel">
          <h3>Receta</h3>
          <div className="dos-col">
            <label className="campo"><span>Paciente</span><input value={receta.paciente} onChange={(e) => setReceta({ ...receta, paciente: e.target.value })} /></label>
            <label className="campo"><span>Médico</span><input value={receta.medico} onChange={(e) => setReceta({ ...receta, medico: e.target.value })} /></label>
            <label className="campo"><span>Exequátur (opcional)</span><input value={receta.exequatur} onChange={(e) => setReceta({ ...receta, exequatur: e.target.value })} /></label>
            <label className="campo"><span>Fecha de la receta</span><input type="date" value={receta.fechaReceta} onChange={(e) => setReceta({ ...receta, fechaReceta: e.target.value })} /></label>
          </div>
        </div>
      )}
      {sinPlan && <div className="panel"><Aviso texto={`La factura se emitió, pero el plan de cuotas no se pudo crear: ${sinPlan.error}. Puede hacerlo desde Cuentas por cobrar › Financiar la deuda en cuotas.`} /><div className="fila-acciones"><button className="boton primario" onClick={() => onCreada(sinPlan.id)}>Ver la factura</button></div></div>}
      {enviada && <Aviso tipo="info" texto={enviada} />}
      {sinCajas && <Aviso tipo="info" texto={soloEnviar ? "No hay ninguna caja con el turno abierto para recibir la venta. Pida al cajero que abra su turno." : "No hay ninguna caja con turno abierto. Si esta tienda factura sin punto de venta, active la caja de facturación en Sistema › Sucursales y terminales («+ Caja de facturación»). Si usa caja, abra el turno en ella e intente de nuevo."} />}

      <div className="panel cab-compra">
        {bloqueCaja}
        {puedeEnviar && !soloEnviar && <label className="campo"><span>Qué hacer con la venta</span>
          <select value={modo} onChange={(e) => setModo(e.target.value as "cobrar" | "enviar")}>
            <option value="cobrar">Cobrar y facturar aquí</option><option value="enviar">Enviar a la caja para que cobre</option>
          </select></label>}
        {!enviando && <label className="campo"><span>Comprobante</span>
          <select value={tipo} onChange={(e) => setTipo(e.target.value)}>{TIPOS.filter((x) => x.id !== "SIN" || sinComprobante).map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select>
        </label>}
        {bloqueCliente}
      </div>

      <div className="panel">
        <BuscadorLinea inputRef={buscarRef} onElegir={agregar} />
        {bloqueLineas}
        {bloqueNotas}
      </div>

      {!enviando && <div className="panel">
        <h3>Cobro</h3>
        {pagos.map((p, i) => (
          <div key={p.id} className="cab-compra" style={{ marginBottom: 8 }}>
            <label className="campo"><span>{unico ? "Forma de pago" : `Pago ${i + 1}`}</span>
              <select value={p.forma} onChange={(e) => cambiarPago(p.id, { forma: e.target.value as PagoF["forma"] })}>{FORMAS.map(([id, nombre]) => <option key={id} value={id}>{nombre}</option>)}</select>
            </label>
            {!unico && <label className="campo"><span>Monto</span><span className="en-linea"><input className="numero" inputMode="decimal" value={p.monto} onChange={(e) => cambiarPago(p.id, { monto: limpiar(e.target.value) })} />
              {falta > 0 && <button className="boton fantasma" title="Poner lo que falta" onClick={() => cambiarPago(p.id, { monto: (n(p.monto) + falta).toFixed(2) })}>+ resto</button>}</span></label>}
            {p.forma === "EFECTIVO" && <label className="campo"><span>Efectivo recibido</span><input className="numero" inputMode="decimal" value={p.recibido} placeholder={montoDe(p) ? rd(montoDe(p)) : ""} onChange={(e) => cambiarPago(p.id, { recibido: limpiar(e.target.value) })} /></label>}
            {(p.forma === "TARJETA" || p.forma === "TRANSFERENCIA" || p.forma === "OTRO") && <label className="campo"><span>Referencia (opcional)</span><input value={p.referencia} maxLength={60} onChange={(e) => cambiarPago(p.id, { referencia: e.target.value })} /></label>}
            {!unico && <button className="boton fantasma" aria-label="Quitar pago" onClick={() => setPagos((ps) => ps.filter((x) => x.id !== p.id))}>✕</button>}
          </div>
        ))}
        {montoCredito > 0 && cliente && puede("admin.cxc") && (planes.datos ?? []).some((p) => p.activo) && (
          <div className="en-linea" style={{ flexWrap: "wrap", gap: 12, margin: "6px 0" }}>
            <label className="campo"><span>Financiar el crédito en cuotas</span>
              <select value={planId} onChange={(e) => setPlanId(e.target.value)}>
                <option value="">No: queda como crédito normal ({cliente.nombre})</option>
                {(planes.datos ?? []).filter((p) => p.activo).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select></label>
            {planElegido && <span className="suave pequeno">{rd(montoCredito)} + {planElegido.interesPct}% de interés = {rd(montoCredito * (1 + Number(planElegido.interesPct) / 100))} en {planElegido.cuotas} cuotas de ≈ {rd((montoCredito * (1 + Number(planElegido.interesPct) / 100)) / planElegido.cuotas)}</span>}
          </div>
        )}
        <div className="en-linea" style={{ flexWrap: "wrap", gap: 12 }}>
          <button className="boton" onClick={agregarPago} disabled={!total}>＋ Pago mixto (agregar otra forma de pago)</button>
          {!unico && <span className={falta === 0 ? "texto-ok" : "texto-alerta"}>{falta === 0 ? "Cobro completo" : falta > 0 ? `Faltan ${rd(falta)}` : `Se pasa por ${rd(-falta)}`}</span>}
          {cambio > 0 && <span>Devuelta: <b>{rd(cambio)}</b></span>}
        </div>
      </div>}

      <div className="panel cab-compra">
        {bloqueCupon}
      </div>

      <div className="barra-compra">
        <span className="suave">{validas.length} línea(s)</span>
        {cot && <><span>Subtotal {rd(cot.subtotal)}</span>{n(cot.descuento) > 0 && <span className="texto-ok">Descuento {rd(cot.descuento)}</span>}<span>ITBIS {rd(cot.itbis)}</span></>}
        <b className="total-compra">Total {rd(total)}</b>
        <button className="boton primario" disabled={!!problema || guardando} onClick={enviando ? enviar : crear}>{enviando ? (guardando ? "Enviando…" : "Enviar a caja") : guardando ? "Emitiendo…" : "Emitir factura"}</button>
      </div>
      {problema && lineas.length > 0 && <p className="suave pequeno">{problema}</p>}
    </>
  );
}
