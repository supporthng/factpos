import { useEffect, useMemo, useRef, useState } from "react";
import { api, puede, rd } from "../api";
import { Aviso, Encabezado, useCatalogo, useDatos } from "../ui";
import { BuscadorLinea } from "./Compras";

/**
 * Nueva factura desde la administración: se factura contra una caja con el turno abierto (ahí entra el dinero),
 * con los precios, ofertas e ITBIS del servidor, igual que en la caja.
 */
interface CajaAbierta { cajaId: string; caja: string; sucursalId: string; sucursal: string; cajero: string | null; abiertoEn: string }
interface ClienteB { id: string; nombre: string; documento: string | null; tipoDocumento?: string | null }
interface Cotizacion {
  subtotal: string; descuento: string; itbis: string; total: string; ofertasAgotadas?: unknown; cupon?: { codigo: string; total: string } | null;
  lineas: { presentacionId: string; descripcion: string; cantidad: string; precio: string | null; oferta: string | null; descuento?: string; itbis?: string; total: string }[];
}
interface LineaF { clave: string; presentacionId: string; nombre: string; cantidad: string; descuento: string }
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
const limpiar = (v: string) => v.replace(/[^\d.]/g, "");

export function NuevaFactura({ onCerrar, onCreada }: { onCerrar: () => void; onCreada: (id: string) => void }) {
  const { productos } = useCatalogo();
  const cajas = useDatos<CajaAbierta[]>("/central/facturas/cajas-abiertas");
  const [cajaId, setCajaId] = useState("");
  const [cliente, setCliente] = useState<ClienteB | null>(null);
  const [busca, setBusca] = useState("");
  const [encontrados, setEncontrados] = useState<ClienteB[]>([]);
  const [tipo, setTipo] = useState("E32");
  const [lineas, setLineas] = useState<LineaF[]>([]);
  const [cot, setCot] = useState<Cotizacion | null>(null);
  const [errCot, setErrCot] = useState("");
  const [pagos, setPagos] = useState<PagoF[]>([{ id: crypto.randomUUID(), forma: "EFECTIVO", monto: "", recibido: "", referencia: "" }]);
  const [cuponTxt, setCuponTxt] = useState("");
  const [cupon, setCupon] = useState("");
  const [motivo, setMotivo] = useState("");
  const puedeDescuento = puede("venta.descuento");
  const [notas, setNotas] = useState("");
  const [msg, setMsg] = useState("");
  const [guardando, setGuardando] = useState(false);
  const ventaId = useRef(crypto.randomUUID()); // si se reintenta por un corte de red, no se duplica la factura
  const buscarRef = useRef<HTMLInputElement>(null);
  const cantRefs = useRef(new Map<string, HTMLInputElement>());
  const [foco, setFoco] = useState<string | null>(null);

  useEffect(() => { if (!cajaId && cajas.datos?.[0]) setCajaId(cajas.datos[0].cajaId); }, [cajas.datos, cajaId]);

  useEffect(() => {
    if (busca.trim().length < 2) { setEncontrados([]); return; }
    const t = setTimeout(() => api<ClienteB[]>(`/central/clientes?q=${encodeURIComponent(busca.trim())}`).then((r) => setEncontrados(r.slice(0, 8))).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [busca]);

  const validas = lineas.filter((l) => n(l.cantidad) > 0);
  const items = () => validas.map((l) => ({ presentacionId: l.presentacionId, cantidad: l.cantidad, ...(n(l.descuento) > 0 ? { descuentoManual: n(l.descuento).toFixed(2) } : {}) }));
  // Precios del servidor: se recalculan al cambiar productos, cantidades o cliente
  useEffect(() => {
    if (!cajaId || !validas.length) { setCot(null); setErrCot(""); return; }
    let vivo = true;
    const t = setTimeout(async () => {
      try {
        const r = await api<Cotizacion>("/central/facturas/cotizar", { cuerpo: { cajaId, clienteId: cliente?.id, items: items() , ...(cupon ? { cuponCodigo: cupon } : {}) } });
        if (vivo) { setCot(r); setErrCot(""); }
      } catch (e) { if (vivo) { setCot(null); setErrCot((e as Error).message); } }
    }, 350);
    return () => { vivo = false; clearTimeout(t); };
  }, [cajaId, cliente?.id, cupon, JSON.stringify(validas.map((l) => [l.presentacionId, l.cantidad, l.descuento]))]); // eslint-disable-line react-hooks/exhaustive-deps

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
    setLineas((ls) => [...ls, { clave, presentacionId, nombre: `${p.nombre}${pr.nombre !== "Unidad" ? ` · ${pr.nombre}` : ""}`, cantidad: "1", descuento: "" }]);
    setFoco(clave);
  };

  const t = TIPOS.find((x) => x.id === tipo)!;
  const total = n(cot?.total);
  const unico = pagos.length === 1;
  const montoDe = (p: PagoF) => (unico ? total : n(p.monto));
  const pagado = pagos.reduce((a, p) => a + montoDe(p), 0);
  const falta = Math.round((total - pagado) * 100) / 100;
  const hayDescuento = lineas.some((l) => n(l.descuento) > 0);
  const cambio = pagos.reduce((a, p) => a + (p.forma === "EFECTIVO" && n(p.recibido) > montoDe(p) ? n(p.recibido) - montoDe(p) : 0), 0);
  const cambiarPago = (id: string, c: Partial<PagoF>) => setPagos((ps) => ps.map((p) => (p.id === id ? { ...p, ...c } : p)));
  const agregarPago = () => setPagos((ps) => [...(ps.length === 1 ? [{ ...ps[0], monto: total ? total.toFixed(2) : "" }] : ps), { id: crypto.randomUUID(), forma: "TARJETA", monto: "", recibido: "", referencia: "" }]);
  const problema = useMemo(() => {
    if (!cajas.datos?.length) return "";
    if (!validas.length) return "Agregue al menos un producto.";
    if (errCot) return errCot;
    if (!cot) return "Calculando…";
    if (t.pideCliente && !(cliente?.documento)) return "Este comprobante requiere un cliente con RNC o cédula.";
    if (pagos.some((p) => p.forma === "CREDITO") && !cliente) return "La venta a crédito requiere un cliente.";
    if (Math.abs(falta) >= 0.005) return falta > 0 ? `Faltan ${rd(falta)} por cobrar.` : `Los pagos se pasan por ${rd(-falta)}.`;
    if (pagos.some((p) => montoDe(p) <= 0)) return "Cada pago debe tener un monto.";
    if (pagos.some((p) => p.forma === "EFECTIVO" && p.recibido && n(p.recibido) < montoDe(p))) return "El efectivo recibido es menor que el monto en efectivo.";
    if (hayDescuento && motivo.trim().length < 5) return "Escriba el motivo del descuento.";
    return "";
  }, [cajas.datos, validas.length, errCot, cot, t.pideCliente, cliente, pagos, falta, hayDescuento, motivo, total]); // eslint-disable-line react-hooks/exhaustive-deps

  const crear = async () => {
    if (problema || !cot) return;
    if (!confirm(`Se emitirá ${t.nombre} por ${rd(total)}${t.fiscal ? ".\n\nUn comprobante fiscal no se puede modificar: solo se anula." : "."}\n\n¿Continuar?`)) return;
    setGuardando(true); setMsg("");
    try {
      const r = await api<{ id: string }>("/central/facturas", { cuerpo: {
        cajaId, clienteId: cliente?.id, tipoDocumento: tipo, notas: notas.trim() || undefined, ventaId: ventaId.current,
        items: items(), ...(cupon ? { cuponCodigo: cupon } : {}), ...(hayDescuento ? { motivoDescuento: motivo.trim() } : {}),
        pagos: pagos.map((p) => ({
          formaPago: p.forma, monto: montoDe(p).toFixed(2),
          ...(p.forma === "EFECTIVO" && n(p.recibido) >= montoDe(p) && p.recibido ? { recibido: n(p.recibido).toFixed(2) } : {}),
          ...(p.referencia.trim() ? { referencia: p.referencia.trim() } : {}),
        })),
      } });
      onCreada(r.id);
    } catch (e) { setMsg((e as Error).message); setGuardando(false); }
  };

  const sinCajas = cajas.datos && !cajas.datos.length;
  return (
    <>
      <div className="migas"><button className="enlace" onClick={() => (!lineas.length || confirm("La factura no se ha emitido. ¿Salir?")) && onCerrar()}>Facturas</button><span>/</span><span>Nueva factura</span></div>
      <Encabezado titulo="Nueva factura" descripcion="Se factura como en la caja: precios del cliente, ofertas e ITBIS del sistema, y sale del inventario de esa caja." />
      <Aviso texto={cajas.error || msg} />
      {sinCajas && <Aviso tipo="info" texto="No hay ninguna caja con turno abierto. La factura necesita una caja abierta para registrar el cobro: abra el turno en la caja e intente de nuevo." />}

      <div className="panel cab-compra">
        <label className="campo"><span>Caja (turno abierto)</span>
          <select value={cajaId} onChange={(e) => setCajaId(e.target.value)}>
            {cajas.datos?.map((c) => <option key={c.cajaId} value={c.cajaId}>{c.sucursal} · {c.caja}{c.cajero ? ` · ${c.cajero}` : ""}</option>)}
          </select>
        </label>
        <label className="campo"><span>Comprobante</span>
          <select value={tipo} onChange={(e) => setTipo(e.target.value)}>{TIPOS.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select>
        </label>
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
      </div>

      <div className="panel">
        <BuscadorLinea inputRef={buscarRef} onElegir={agregar} />
        {!lineas.length ? <p className="suave vacio-compra">Busque los productos que lleva el cliente.</p> : (
          <div className="tabla-contenedor"><table className="tabla tabla-edicion">
            <thead><tr><th>#</th><th>Producto</th><th className="der">Cantidad</th><th className="der">Precio</th>{puedeDescuento && <th className="der">Descuento RD$</th>}<th className="der">Total</th><th /></tr></thead>
            <tbody>{lineas.map((l, i) => {
              const c = cot?.lineas.find((x) => x.presentacionId === l.presentacionId);
              return (
                <tr key={l.clave}>
                  <td className="suave">{i + 1}</td>
                  <td><b>{l.nombre}</b>{c?.oferta && <span className="pastilla en-oferta">{c.oferta}</span>}</td>
                  <td className="der" style={{ width: 110 }}><input className="numero" inputMode="decimal" value={l.cantidad} aria-label="Cantidad"
                    ref={(el) => { if (el) cantRefs.current.set(l.clave, el); else cantRefs.current.delete(l.clave); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); buscarRef.current?.focus(); } }}
                    onChange={(e) => setLineas((ls) => ls.map((x) => (x.clave === l.clave ? { ...x, cantidad: limpiar(e.target.value) } : x)))} /></td>
                  <td className="der">{c?.precio ? rd(c.precio) : "…"}</td>
                  {puedeDescuento && <td className="der" style={{ width: 120 }}><input className="numero" inputMode="decimal" value={l.descuento} placeholder="0" aria-label="Descuento"
                    onChange={(e) => setLineas((ls) => ls.map((x) => (x.clave === l.clave ? { ...x, descuento: limpiar(e.target.value) } : x)))} /></td>}
                  <td className="der">{c ? rd(c.total) : "…"}</td>
                  <td><button className="boton fantasma" aria-label="Quitar" onClick={() => setLineas((ls) => ls.filter((x) => x.clave !== l.clave))}>✕</button></td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
        <label className="campo"><span>Notas (salen en la factura)</span><input value={notas} maxLength={300} onChange={(e) => setNotas(e.target.value)} /></label>
      </div>

      <div className="panel">
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
        <div className="en-linea" style={{ flexWrap: "wrap", gap: 12 }}>
          <button className="boton" onClick={agregarPago} disabled={!total}>＋ Pago mixto (agregar otra forma de pago)</button>
          {!unico && <span className={falta === 0 ? "texto-ok" : "texto-alerta"}>{falta === 0 ? "Cobro completo" : falta > 0 ? `Faltan ${rd(falta)}` : `Se pasa por ${rd(-falta)}`}</span>}
          {cambio > 0 && <span>Devuelta: <b>{rd(cambio)}</b></span>}
        </div>
      </div>

      <div className="panel cab-compra">
        <label className="campo"><span>Cupón de descuento</span>
          {cupon ? <span className="en-linea"><b>{cupon}</b>{cot?.cupon ? <span className="texto-ok">−{rd(cot.cupon.total)}</span> : null}<button className="boton fantasma" onClick={() => { setCupon(""); setCuponTxt(""); }}>✕ Quitar</button></span>
            : <span className="en-linea"><input value={cuponTxt} placeholder="Código del cupón" onChange={(e) => setCuponTxt(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === "Enter" && cuponTxt.trim() && setCupon(cuponTxt.trim())} />
              <button className="boton" disabled={!cuponTxt.trim()} onClick={() => setCupon(cuponTxt.trim())}>Aplicar</button></span>}
        </label>
        {puedeDescuento && hayDescuento && <label className="campo campo-prov"><span>Motivo del descuento (queda en auditoría)</span><input value={motivo} maxLength={200} onChange={(e) => setMotivo(e.target.value)} /></label>}
        {!puedeDescuento && <p className="suave pequeno">Para dar descuentos por línea se necesita el permiso «Aprobar descuentos».</p>}
      </div>

      <div className="barra-compra">
        <span className="suave">{validas.length} línea(s)</span>
        {cot && <><span>Subtotal {rd(cot.subtotal)}</span>{n(cot.descuento) > 0 && <span className="texto-ok">Descuento {rd(cot.descuento)}</span>}<span>ITBIS {rd(cot.itbis)}</span></>}
        <b className="total-compra">Total {rd(total)}</b>
        <button className="boton primario" disabled={!!problema || guardando} onClick={crear}>{guardando ? "Emitiendo…" : "Emitir factura"}</button>
      </div>
      {problema && lineas.length > 0 && <p className="suave pequeno">{problema}</p>}
    </>
  );
}
