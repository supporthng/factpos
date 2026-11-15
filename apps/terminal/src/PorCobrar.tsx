import { useCallback, useEffect, useState } from "react";
import { api, rd, type Ajustes } from "./api";
import { Modal } from "./Venta";
import { SelectorComprobante, requiereDocumento, tieneDocumentoFiscal, type TipoComprobante } from "./Comprobante";
import type { VentaRegistrada } from "./Ticket";

/**
 * Ventas por cobrar: las que la oficina armó y envió a esta caja. El cajero elige comprobante y forma de pago y cobra;
 * el comprobante fiscal sale en este momento. Los precios y descuentos ya fueron autorizados al enviarla.
 */
export interface PorCobrarResumen { id: string; numero: string; total: string; notas: string | null; creadaEn: string; cliente: string | null; vendedor: string | null; lineas: number }
interface Detalle {
  id: string; numero: string; notas: string | null; total: string; subtotal: string; descuento: string; itbis: string;
  cliente: { id: string; nombre: string; tipoDocumento: string; documento: string | null } | null;
  lineas: { linea: number; descripcion: string; cantidad: string; precio: string | null; total: string }[];
}
const FORMAS = [["EFECTIVO", "Efectivo"], ["TARJETA", "Tarjeta"], ["TRANSFERENCIA", "Transferencia"]] as const;
const hora = (iso: string) => new Date(iso).toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export function PanelPorCobrar({ ajustes, permitirSin, onCobrada, onCerrar }: {
  ajustes: Ajustes; permitirSin: boolean; onCobrada: (v: VentaRegistrada) => void; onCerrar: () => void;
}) {
  const ruta = `/cajas/${ajustes.cajaId}/por-cobrar`;
  const [lista, setLista] = useState<PorCobrarResumen[]>([]);
  const [abierta, setAbierta] = useState<Detalle | null>(null);
  const [tipo, setTipo] = useState<TipoComprobante>("E32");
  const [forma, setForma] = useState<(typeof FORMAS)[number][0]>("EFECTIVO");
  const [recibido, setRecibido] = useState("");
  const [referencia, setReferencia] = useState("");
  const [msg, setMsg] = useState("");
  const [trabajando, setTrabajando] = useState(false);

  const recargar = useCallback(async () => {
    try { setLista(await api<PorCobrarResumen[]>(ajustes.servidor, ruta)); } catch (e) { setMsg((e as Error).message); }
  }, [ajustes, ruta]);
  useEffect(() => { recargar(); const t = setInterval(recargar, 10000); return () => clearInterval(t); }, [recargar]);

  const abrir = async (id: string) => {
    setMsg("");
    try {
      const d = await api<Detalle>(ajustes.servidor, `${ruta}/${id}`);
      setAbierta(d); setTipo("E32"); setForma("EFECTIVO"); setRecibido(""); setReferencia("");
    } catch (e) { setMsg((e as Error).message); recargar(); }
  };

  const total = Number(abierta?.total ?? 0);
  const falla = abierta && requiereDocumento(tipo) && ["E31", "B01", "B14", "B15", "B16"].includes(tipo) && !tieneDocumentoFiscal(abierta.cliente as never)
    ? "Este comprobante requiere un cliente con RNC o cédula; la venta no lo tiene. Use consumo final o pida a la oficina que la reenvíe con cliente." : "";
  const cambio = forma === "EFECTIVO" && Number(recibido) > total ? Number(recibido) - total : 0;

  const cobrar = async () => {
    if (!abierta || falla || trabajando) return;
    if (forma === "EFECTIVO" && recibido && Number(recibido) < total) return setMsg("El efectivo recibido es menor que el total.");
    setTrabajando(true); setMsg("");
    try {
      const v = await api<VentaRegistrada>(ajustes.servidor, `${ruta}/${abierta.id}/cobrar`, { cuerpo: {
        tipoDocumento: tipo,
        pagos: [{ formaPago: forma, monto: total.toFixed(2), ...(forma === "EFECTIVO" && recibido ? { recibido: Number(recibido).toFixed(2) } : {}), ...(forma !== "EFECTIVO" && referencia.trim() ? { referencia: referencia.trim() } : {}) }],
      } });
      onCobrada(v);
    } catch (e) { setMsg((e as Error).message); setTrabajando(false); }
  };
  const devolver = async () => {
    if (!abierta || !confirm(`¿Devolver la venta #${abierta.numero} a la oficina sin cobrar? Quedará anulada.`)) return;
    try { await api(ajustes.servidor, `${ruta}/${abierta.id}/anular`, { cuerpo: {} }); setAbierta(null); recargar(); } catch (e) { setMsg((e as Error).message); }
  };

  if (abierta) {
    return (
      <Modal titulo={`Por cobrar #${abierta.numero}`} onCerrar={onCerrar}>
        <p><b>{abierta.cliente?.nombre ?? "Consumidor final"}</b>{abierta.cliente?.documento && <span className="suave"> · {abierta.cliente.documento}</span>}</p>
        {abierta.notas && <p className="nota">{abierta.notas}</p>}
        <div className="tabla-contenedor"><table className="tabla"><thead><tr><th>Producto</th><th className="der">Cant.</th><th className="der">Precio</th><th className="der">Total</th></tr></thead><tbody>
          {abierta.lineas.map((l) => (
            <tr key={l.linea}><td>{l.descripcion}</td><td className="der">{Number(l.cantidad)}</td><td className="der">{l.precio ? rd(l.precio) : ""}</td><td className="der">{rd(l.total)}</td></tr>
          ))}
        </tbody></table></div>
        <p className="der">Subtotal {rd(abierta.subtotal)}{Number(abierta.descuento) > 0 && ` · Descuento ${rd(abierta.descuento)}`} · ITBIS {rd(abierta.itbis)}<br /><b style={{ fontSize: "1.4em" }}>Total {rd(total)}</b></p>
        <SelectorComprobante tipo={tipo} onTipo={setTipo} permitirSin={permitirSin} compacto />
        <div className="fila-acciones" style={{ marginTop: 8 }}>
          {FORMAS.map(([id, nombre]) => <button key={id} className={"boton" + (forma === id ? " primario" : "")} onClick={() => setForma(id)}>{nombre}</button>)}
        </div>
        {forma === "EFECTIVO"
          ? <label className="campo"><span>Efectivo recibido</span><input className="numero" inputMode="decimal" value={recibido} placeholder={rd(total)} onChange={(e) => setRecibido(e.target.value.replace(/[^\d.]/g, ""))} /></label>
          : <label className="campo"><span>Referencia (opcional)</span><input value={referencia} maxLength={60} onChange={(e) => setReferencia(e.target.value)} /></label>}
        {cambio > 0 && <p>Devuelta: <b>{rd(cambio)}</b></p>}
        {(falla || msg) && <p className="error">{falla || msg}</p>}
        <div className="fila-acciones">
          <button className="boton" onClick={() => { setAbierta(null); setMsg(""); recargar(); }}>← Por cobrar</button>
          <button className="boton" onClick={devolver}>Devolver sin cobrar</button>
          <span className="flex" />
          <button className="boton primario" disabled={!!falla || trabajando} onClick={cobrar}>{trabajando ? "Cobrando…" : `Cobrar ${rd(total)}`}</button>
        </div>
      </Modal>
    );
  }
  return (
    <Modal titulo="Por cobrar" onCerrar={onCerrar}>
      {msg && <p className="error">{msg}</p>}
      {!lista.length ? <p className="suave">No hay ventas esperando cobro en esta caja.</p> : (
        <div className="tabla-contenedor"><table className="tabla"><thead><tr><th>#</th><th>Cliente</th><th>Vendedor</th><th>Enviada</th><th className="der">Líneas</th><th className="der">Total</th><th /></tr></thead><tbody>
          {lista.map((p) => (
            <tr key={p.id}><td><b>{p.numero}</b></td><td>{p.cliente ?? "Consumidor final"}</td><td>{p.vendedor ?? ""}</td><td className="suave">{hora(p.creadaEn)}</td><td className="der">{p.lineas}</td><td className="der">{rd(p.total)}</td>
              <td className="der"><button className="boton primario" onClick={() => abrir(p.id)}>Cobrar</button></td></tr>
          ))}
        </tbody></table></div>
      )}
      <div className="fila-acciones"><button className="boton" onClick={onCerrar}>Cerrar</button></div>
    </Modal>
  );
}
