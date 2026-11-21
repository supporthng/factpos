import { useCallback, useEffect, useState } from "react";
import { api, rd, type Ajustes } from "./api";
import { Modal } from "./Venta";
import { SelectorComprobante, requiereDocumento, tieneDocumentoFiscal, type TipoComprobante } from "./Comprobante";
import type { VentaRegistrada } from "./Ticket";

/**
 * Ventas por cobrar: las que la oficina armó y envió a esta caja. El cajero elige comprobante y forma de pago y cobra;
 * el comprobante fiscal sale en este momento. Los precios y descuentos ya fueron autorizados al enviarla.
 */
export interface PorCobrarResumen { id: string; numero: string; total: string; notas: string | null; creadaEn: string; cliente: string | null; vendedor: string | null; lineas: number; inicial?: string; aPlazos?: boolean }
interface Detalle {
  id: string; numero: string; notas: string | null; total: string; subtotal: string; descuento: string; itbis: string;
  cliente: { id: string; nombre: string; tipoDocumento: string; documento: string | null } | null;
  lineas: { linea: number; descripcion: string; cantidad: string; precio: string | null; total: string }[];
  /** Venta a plazos: la caja cobra solo la inicial; el resto queda a crédito con su plan de cuotas */
  plazos: { plan: string; cuotas: number; frecuencia: string; interesPct: string; inicial: string; financiado: string; interes: string; totalAPagar: string;
    garante: { nombre: string | null; documento: string | null; telefono: string | null } | null; excepciones: string[]; excepcionMotivo: string | null } | null;
}
const FORMAS = [["EFECTIVO", "Efectivo"], ["TARJETA", "Tarjeta"], ["TRANSFERENCIA", "Transferencia"], ["MIXTO", "Mixto"]] as const;
type Forma = (typeof FORMAS)[number][0];
const hora = (iso: string) => new Date(iso).toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const cent = (v: string) => Math.round((Number(v) || 0) * 100);
const dinero = (c: number) => (c / 100).toFixed(2);

export function PanelPorCobrar({ ajustes, permitirSin, onCobrada, onCerrar }: {
  ajustes: Ajustes; permitirSin: boolean; onCobrada: (v: VentaRegistrada) => void; onCerrar: () => void;
}) {
  const ruta = `/cajas/${ajustes.cajaId}/por-cobrar`;
  const [lista, setLista] = useState<PorCobrarResumen[]>([]);
  const [elegida, setElegida] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<Detalle | null>(null);
  const [cobrando, setCobrando] = useState(false);
  const [tipo, setTipo] = useState<TipoComprobante>("E32");
  const [forma, setForma] = useState<Forma>("EFECTIVO");
  const [recibido, setRecibido] = useState("");
  const [tarjeta, setTarjeta] = useState("");
  const [refTarjeta, setRefTarjeta] = useState("");
  const [transferencia, setTransferencia] = useState("");
  const [refTransf, setRefTransf] = useState("");
  const [msg, setMsg] = useState("");
  const [trabajando, setTrabajando] = useState(false);

  const recargar = useCallback(async () => {
    try { setLista(await api<PorCobrarResumen[]>(ajustes.servidor, ruta)); } catch (e) { setMsg((e as Error).message); }
  }, [ajustes, ruta]);
  useEffect(() => { recargar(); const t = setInterval(recargar, 10000); return () => clearInterval(t); }, [recargar]);

  // La primera venta de la lista se muestra completa de entrada; si la elegida ya no está (cobrada o devuelta), pasa a la siguiente
  useEffect(() => {
    if (!lista.length) { setElegida(null); setDetalle(null); return; }
    if (!elegida || !lista.some((x) => x.id === elegida)) setElegida(lista[0]!.id);
  }, [lista, elegida]);
  useEffect(() => {
    if (!elegida) return;
    let vivo = true;
    api<Detalle>(ajustes.servidor, `${ruta}/${elegida}`).then((d) => { if (vivo) { setDetalle(d); setMsg(""); } }).catch((e) => { if (vivo) { setMsg((e as Error).message); recargar(); } });
    return () => { vivo = false; };
  }, [elegida, ajustes, ruta, recargar]);

  const abrirCobro = () => { setTipo("E32"); setForma("EFECTIVO"); setRecibido(""); setTarjeta(""); setRefTarjeta(""); setTransferencia(""); setRefTransf(""); setMsg(""); setCobrando(true); };

  // En una venta a plazos la caja cobra solo la inicial
  const cobraC = detalle?.plazos ? cent(detalle.plazos.inicial) : cent(detalle?.total ?? "0");
  const total = cobraC / 100;
  const totalC = cobraC;
  const falla = detalle && requiereDocumento(tipo) && ["E31", "B01", "B14", "B15", "B16"].includes(tipo) && !tieneDocumentoFiscal(detalle.cliente as never)
    ? "Este comprobante requiere un cliente con RNC o cédula; la venta no lo tiene. Use consumo final o pida a la oficina que la reenvíe con cliente." : "";
  // Mixto: tarjeta y transferencia se escriben; el efectivo cubre lo que falta
  const otrosC = forma === "MIXTO" ? cent(tarjeta) + cent(transferencia) : 0;
  const efectivoC = forma === "MIXTO" ? Math.max(totalC - otrosC, 0) : forma === "EFECTIVO" ? totalC : 0;
  const cambioC = (forma === "EFECTIVO" || forma === "MIXTO") && cent(recibido) > efectivoC && efectivoC > 0 ? cent(recibido) - efectivoC : 0;
  const errorPago = forma === "MIXTO" && otrosC > totalC ? "Tarjeta y transferencia superan el total."
    : forma === "MIXTO" && otrosC === 0 ? "Escriba lo que se paga con tarjeta o transferencia; el resto se cobra en efectivo."
    : (forma === "EFECTIVO" || forma === "MIXTO") && recibido && cent(recibido) < efectivoC ? "El efectivo recibido es menor que lo que falta." : "";

  const cobrar = async () => {
    if (!detalle || falla || errorPago || trabajando) return;
    const pagos: Record<string, string>[] = [];
    if (forma === "MIXTO") {
      if (cent(tarjeta) > 0) pagos.push({ formaPago: "TARJETA", monto: dinero(cent(tarjeta)), ...(refTarjeta.trim() ? { referencia: refTarjeta.trim() } : {}) });
      if (cent(transferencia) > 0) pagos.push({ formaPago: "TRANSFERENCIA", monto: dinero(cent(transferencia)), ...(refTransf.trim() ? { referencia: refTransf.trim() } : {}) });
      if (efectivoC > 0) pagos.push({ formaPago: "EFECTIVO", monto: dinero(efectivoC), ...(recibido ? { recibido: dinero(cent(recibido)) } : {}) });
    } else {
      pagos.push({ formaPago: forma, monto: dinero(totalC), ...(forma === "EFECTIVO" && recibido ? { recibido: dinero(cent(recibido)) } : {}), ...(forma !== "EFECTIVO" && refTarjeta.trim() ? { referencia: refTarjeta.trim() } : {}) });
    }
    setTrabajando(true); setMsg("");
    try {
      const v = await api<VentaRegistrada>(ajustes.servidor, `${ruta}/${detalle.id}/cobrar`, { cuerpo: { tipoDocumento: tipo, pagos } });
      onCobrada(v);
    } catch (e) { setMsg((e as Error).message); setTrabajando(false); }
  };
  const devolver = async () => {
    if (!detalle || !confirm(`¿Devolver la venta #${detalle.numero} a la oficina sin cobrar? Quedará anulada.`)) return;
    try { await api(ajustes.servidor, `${ruta}/${detalle.id}/anular`, { cuerpo: {} }); setDetalle(null); setElegida(null); recargar(); } catch (e) { setMsg((e as Error).message); }
  };

  // Ventana de cobro: solo comprobante, forma de pago y total (el desglose de la factura está en la pantalla anterior)
  if (cobrando && detalle) {
    return (
      <Modal titulo={`Cobrar #${detalle.numero}`} onCerrar={() => setCobrando(false)}>
        <p><b>{detalle.cliente?.nombre ?? "Consumidor final"}</b>{detalle.cliente?.documento && <span className="suave"> · {detalle.cliente.documento}</span>}</p>
        <p style={{ margin: "4px 0 10px" }}><span className="suave">{detalle.plazos ? "Inicial a cobrar" : "Total a cobrar"}</span><br /><b style={{ fontSize: "1.9em" }}>{rd(total)}</b></p>
        {detalle.plazos && <p className="suave" style={{ margin: "0 0 10px" }}>La factura es de {rd(detalle.total)}. Al cobrar la inicial, {rd(detalle.plazos.financiado)} quedan a crédito en {detalle.plazos.cuotas} cuotas.</p>}
        <SelectorComprobante tipo={tipo} onTipo={setTipo} permitirSin={permitirSin} compacto />
        <div className="fila-acciones" style={{ marginTop: 8 }}>
          {FORMAS.map(([id, nombre]) => <button key={id} className={"boton" + (forma === id ? " primario" : "")} onClick={() => { setForma(id); setRecibido(""); setTarjeta(""); setTransferencia(""); }}>{nombre}</button>)}
        </div>
        {forma === "MIXTO" && (
          <>
            <div className="fila-acciones" style={{ alignItems: "flex-end" }}>
              <label className="campo"><span>Tarjeta</span><input className="numero" inputMode="decimal" value={tarjeta} placeholder="0.00" onChange={(e) => setTarjeta(e.target.value.replace(/[^\d.]/g, ""))} /></label>
              <label className="campo"><span>Voucher (opcional)</span><input value={refTarjeta} maxLength={60} onChange={(e) => setRefTarjeta(e.target.value)} /></label>
            </div>
            <div className="fila-acciones" style={{ alignItems: "flex-end" }}>
              <label className="campo"><span>Transferencia</span><input className="numero" inputMode="decimal" value={transferencia} placeholder="0.00" onChange={(e) => setTransferencia(e.target.value.replace(/[^\d.]/g, ""))} /></label>
              <label className="campo"><span>Referencia (opcional)</span><input value={refTransf} maxLength={60} onChange={(e) => setRefTransf(e.target.value)} /></label>
            </div>
            <p>Efectivo (lo que falta): <b>{rd(dinero(efectivoC))}</b></p>
          </>
        )}
        {(forma === "EFECTIVO" || (forma === "MIXTO" && efectivoC > 0)) && (
          <label className="campo"><span>Efectivo recibido</span><input className="numero" inputMode="decimal" value={recibido} placeholder={rd(dinero(efectivoC))} onChange={(e) => setRecibido(e.target.value.replace(/[^\d.]/g, ""))} /></label>
        )}
        {(forma === "TARJETA" || forma === "TRANSFERENCIA") && (
          <label className="campo"><span>{forma === "TARJETA" ? "Voucher (opcional)" : "Referencia (opcional)"}</span><input value={refTarjeta} maxLength={60} onChange={(e) => setRefTarjeta(e.target.value)} /></label>
        )}
        {cambioC > 0 && <p>Devuelta: <b>{rd(dinero(cambioC))}</b></p>}
        {(falla || errorPago || msg) && <p className="error">{falla || errorPago || msg}</p>}
        <div className="fila-acciones">
          <button className="boton" onClick={() => setCobrando(false)}>← Ver factura</button>
          <span className="flex" />
          <button className="boton primario" disabled={!!falla || !!errorPago || trabajando} onClick={cobrar}>{trabajando ? "Cobrando…" : detalle.plazos ? `Cobrar inicial ${rd(total)}` : `Cobrar ${rd(total)}`}</button>
        </div>
      </Modal>
    );
  }

  // Pantalla de ventas por cobrar: la lista a la izquierda y la factura completa de la elegida a la derecha
  return (
    <Modal titulo="Por cobrar" onCerrar={onCerrar} ancho clase="por-cobrar">
      {msg && <p className="error">{msg}</p>}
      {!lista.length ? <><p className="suave">No hay ventas esperando cobro en esta caja.</p><div className="fila-acciones"><button className="boton" onClick={onCerrar}>Cerrar</button></div></> : (
        <div className="pc-grid">
          <div className="pc-lista">
            {lista.map((p) => (
              <button key={p.id} className={"pc-fila" + (p.id === elegida ? " activa" : "")} onClick={() => setElegida(p.id)}>
                <span><b>#{p.numero}</b> · {p.cliente ?? "Consumidor final"}{p.aPlazos && <span className="suave"> · a plazos</span>}</span>
                <span className="suave">{p.vendedor ?? ""} · {hora(p.creadaEn)} · {p.lineas} {p.lineas === 1 ? "línea" : "líneas"}</span>
                <b>{rd(p.total)}</b>
              </button>
            ))}
          </div>
          <div className="pc-factura">
            {!detalle || detalle.id !== elegida ? <p className="suave">Cargando la factura…</p> : (
              <>
                <h4 style={{ margin: "0 0 2px" }}>Factura #{detalle.numero}</h4>
                <p style={{ margin: "0 0 8px" }}><b>{detalle.cliente?.nombre ?? "Consumidor final"}</b>{detalle.cliente?.documento && <span className="suave"> · {detalle.cliente.documento}</span>}</p>
                {detalle.notas && <p className="nota">{detalle.notas}</p>}
                <div className="tabla-contenedor"><table className="tabla"><thead><tr><th>Producto</th><th className="der">Cant.</th><th className="der">Precio</th><th className="der">Total</th></tr></thead><tbody>
                  {detalle.lineas.map((l) => (
                    <tr key={l.linea}><td>{l.descripcion}</td><td className="der">{Number(l.cantidad)}</td><td className="der">{l.precio ? rd(l.precio) : ""}</td><td className="der">{rd(l.total)}</td></tr>
                  ))}
                </tbody></table></div>
                {detalle.plazos && (
                  <div className="nota" style={{ margin: "8px 0" }}>
                    <b>Venta a plazos · {detalle.plazos.plan}</b>
                    <div>Inicial a cobrar ahora: <b>{rd(detalle.plazos.inicial)}</b></div>
                    <div>Queda a crédito: {rd(detalle.plazos.financiado)}{Number(detalle.plazos.interes) > 0 ? ` + ${rd(detalle.plazos.interes)} de interés (${Number(detalle.plazos.interesPct)} %)` : " (sin interés)"} = {rd(detalle.plazos.totalAPagar)} en {detalle.plazos.cuotas} cuotas</div>
                    {detalle.plazos.garante?.nombre && <div>Garante: {detalle.plazos.garante.nombre}{detalle.plazos.garante.documento ? ` · ${detalle.plazos.garante.documento}` : ""}</div>}
                    {detalle.plazos.excepciones.length > 0 && <div className="suave">Aprobado por un supervisor: {detalle.plazos.excepciones.join("; ")}{detalle.plazos.excepcionMotivo ? ` — ${detalle.plazos.excepcionMotivo}` : ""}</div>}
                  </div>
                )}
                <p className="der">Subtotal {rd(detalle.subtotal)}{Number(detalle.descuento) > 0 && ` · Descuento ${rd(detalle.descuento)}`} · ITBIS {rd(detalle.itbis)}<br /><b style={{ fontSize: "1.5em" }}>Total {rd(detalle.total)}</b></p>
                <div className="fila-acciones">
                  <button className="boton" onClick={devolver}>Devolver sin cobrar</button>
                  <span className="flex" />
                  <button className="boton" onClick={onCerrar}>Cerrar</button>
                  <button className="boton primario" onClick={abrirCobro}>{detalle.plazos ? `Cobrar inicial ${rd(detalle.plazos.inicial)}` : `Cobrar ${rd(detalle.total)}`}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
