import { SelectorComprobante, ClienteFiscalRapido, requiereDocumento, tieneDocumentoFiscal, type TipoComprobante } from "./Comprobante";
import { useMemo, useState } from "react";
import { Decimal } from "decimal.js";
import type { Cupon } from "@factpos/compartido";
import { api, rd, ErrorApi, type Ajustes } from "./api";
import { uuidv7 } from "@factpos/compartido";
import { useConexion, venderSinServidor } from "./contingencia";
import type { Usuario } from "./App";
import type { Cliente } from "./Venta";
import { Modal } from "./Venta";

import type { VentaRegistrada } from "./Ticket";
export type ResultadoVenta = VentaRegistrada;

const BILLETES = [100, 200, 500, 1000, 2000];

/**
 * Cobro con pago mixto. El efectivo cubre lo que no se pague con otros medios;
 * el cambio se calcula sobre lo recibido. Enter confirma.
 */
/** Lo que la caja ya calculó con su catálogo: con esto imprime si no hay servidor. */
export interface CobroLocal {
  lineas: VentaRegistrada["lineas"];
  totales: { subtotal: string; descuento: string; itbis: string; total: string };
  turnoId: string;
  hayDescuentos: boolean;
}

export type MetodoPago = "EFECTIVO" | "TARJETA" | "TRANSFERENCIA" | "MIXTO";

export function Cobro({ ajustes, usuario, cliente, cupon, total, items, aprobacionDescuento, motivoDescuento, local, onCerrar, onVendido, alFallar, metodo = "EFECTIVO", notas, tipo, onTipo, onCliente, onBuscarCliente }: {
  ajustes: Ajustes; usuario: Usuario; cliente: Cliente | null; cupon: Cupon | null; total: string;
  items: { presentacionId: string; cantidad: string; descuentoManual?: string; precioVariable?: string }[];
  aprobacionDescuento?: string; motivoDescuento?: string;
  local?: CobroLocal;
  onCerrar: () => void; onVendido: (r: ResultadoVenta) => void;
  /** Se llama si el cobro falla (p. ej. para refrescar ofertas con tope) */
  alFallar?: () => void;
  /** Forma de pago elegida en la pantalla de venta (la ventana abre lista para esa forma) */
  metodo?: MetodoPago;
  /** Observaciones de la venta */
  notas?: string;
  /** Tipo de comprobante (se elige en la pantalla de venta o aquí) */
  tipo: TipoComprobante; onTipo: (t: TipoComprobante) => void;
  /** Un cliente elegido o creado aquí mismo (RNC con consulta a la DGII) */
  onCliente: (c: Cliente) => void;
  /** Abrir la búsqueda completa de clientes y volver al cobro */
  onBuscarCliente: () => void;
}) {
  const [tarjeta, setTarjeta] = useState(metodo === "TARJETA" ? total : "");
  const [verOtros, setVerOtros] = useState(metodo !== "EFECTIVO");
  const [refTarjeta, setRefTarjeta] = useState("");
  const [transferencia, setTransferencia] = useState(metodo === "TRANSFERENCIA" ? total : "");
  const [credito, setCredito] = useState("");
  const [recibido, setRecibido] = useState("");
  const tipoFactura = tipo;
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState("");
  // Mismo id si se reintenta: el servidor no duplica la venta
  const [ventaId] = useState(() => uuidv7());
  const conexion = useConexion();
  const sinServidor = !conexion.enLinea;

  const n = (v: string) => new Decimal(v || 0);
  const otros = n(tarjeta).plus(n(transferencia)).plus(n(credito));
  const efectivo = Decimal.max(new Decimal(total).minus(otros), 0);
  const cambio = recibido ? n(recibido).minus(efectivo) : new Decimal(0);
  const disponibleCredito = cliente ? n(cliente.limiteCredito).minus(cliente.saldo) : new Decimal(0);

  const motivoNoContingencia = cupon ? "Sin servidor no se aplican cupones: quite el cupón" :
    local?.hayDescuentos ? "Sin servidor no se aplican descuentos: quítelos" :
    n(credito).gt(0) ? "Sin servidor no se vende a crédito" :
    tipoFactura !== "E32" ? "Sin servidor solo se permite factura electrónica de consumo E32" : "";
  const error = useMemo(() => {
    if (sinServidor && motivoNoContingencia) return motivoNoContingencia;
    if (otros.gt(total)) return "Los pagos superan el total";
    if (n(tarjeta).gt(0) && !/^[A-Za-z0-9-]{4,}$/.test(refTarjeta.trim())) return "Escriba el número de aprobación del voucher de la tarjeta";
    if (efectivo.gt(0) && recibido && cambio.lt(0)) return "El efectivo recibido no alcanza";
    if (n(credito).gt(0) && !cliente) return "Para vender a crédito seleccione un cliente (F4)";
    if (n(credito).gt(disponibleCredito)) return `Crédito disponible: ${rd(disponibleCredito.toFixed(2))}`;
    if (["E31", "B01", "B14", "B15"].includes(tipoFactura) && !(cliente && ["RNC", "CEDULA"].includes(cliente.tipoDocumento))) return "Crédito fiscal requiere cliente con RNC o cédula";
    return "";
  }, [otros, efectivo, recibido, cambio, credito, cliente, tipoFactura, total, tarjeta, refTarjeta, sinServidor, motivoNoContingencia]);

  const cobrar = async () => {
    if (error || enviando) return;
    setEnviando(true);
    setMsg("");
    const pagos = [
      ...(n(tarjeta).gt(0) ? [{ formaPago: "TARJETA", monto: n(tarjeta).toFixed(2), referencia: refTarjeta || undefined }] : []),
      ...(n(transferencia).gt(0) ? [{ formaPago: "TRANSFERENCIA", monto: n(transferencia).toFixed(2) }] : []),
      ...(n(credito).gt(0) ? [{ formaPago: "CREDITO", monto: n(credito).toFixed(2) }] : []),
      ...(efectivo.gt(0) ? [{ formaPago: "EFECTIVO", monto: efectivo.toFixed(2), recibido: (recibido ? n(recibido) : efectivo).toFixed(2) }] : []),
    ];
    // Sin servidor: la venta se guarda en la caja con un e-NCF de reserva
    const contingencia = async () => {
      if (!local) throw new Error("No hay conexión con el servidor de la sucursal");
      const cambioTotal = pagos.reduce((a, p) => a.plus(p.recibido ? n(p.recibido).minus(p.monto) : 0), new Decimal(0));
      const ticket = await venderSinServidor(ajustes, {
        ventaId, usuarioOriginal: usuario.id, turnoId: local.turnoId,
        items: items.map((i) => ({ presentacionId: i.presentacionId, cantidad: i.cantidad, precioVariable: i.precioVariable })),
        pagos, clienteId: cliente?.id, total, notas: notas || undefined,
        ticket: {
          notas: notas || null,
          id: ventaId, tipoDocumento: "E32", ...local.totales, cambio: cambioTotal.toFixed(2), cupon: null, lineas: local.lineas,
          pagos, cliente: cliente ? { nombre: cliente.nombre, documento: cliente.documento } : null,
        },
      });
      onVendido(ticket);
    };
    try {
      if (sinServidor) return await contingencia();
      const r = await api<ResultadoVenta>(ajustes.servidor, `/cajas/${ajustes.cajaId}/ventas`, {
        cuerpo: {
          ventaId, usuarioId: usuario.id, clienteId: cliente?.id, cuponCodigo: cupon?.codigo,
          tipoDocumento: tipoFactura, items, pagos,
          autorizacionDescuento: aprobacionDescuento, motivoDescuento, notas: notas || undefined,
        },
      });
      onVendido({ ...r, cliente: cliente ? { nombre: cliente.nombre, documento: cliente.documento } : null });
    } catch (e) {
      // Se cayó el servidor justo al cobrar: si se puede, se guarda en la caja
      if (e instanceof ErrorApi && e.estado === 0 && !motivoNoContingencia && local) {
        try { await contingencia(); return; } catch (e2) { setMsg((e2 as Error).message); setEnviando(false); return; }
      }
      const m = (e as Error).message;
      // Si otra caja vendió las últimas unidades en oferta, el total cambió: se recalcula
      if (alFallar && /no coinciden con el total/.test(m)) {
        alFallar();
        setMsg("Otra caja vendió las últimas unidades en oferta y el total cambió. Revise el nuevo total y cobre de nuevo.");
      } else setMsg(m);
      setEnviando(false);
    }
  };

  const campo = (etiqueta: string, valor: string, set: (v: string) => void, extra?: React.ReactNode) => (
    <label className="campo fila-campo">
      <span>{etiqueta}</span>
      <input inputMode="decimal" value={valor} placeholder="0.00"
        onChange={(e) => set(e.target.value.replace(/[^\d.]/g, ""))} onKeyDown={(e) => e.key === "Enter" && cobrar()} />
      {extra}
    </label>
  );

  return (
    <Modal titulo="Cobrar" onCerrar={onCerrar}>
      {sinServidor && (
        <div className="aviso-cobro-contingencia">
          <b>Sin conexión con el servidor.</b> La venta se guarda en esta caja y la factura sale como
          <b> consumo (E32) en contingencia</b>. Solo efectivo, tarjeta o transferencia.
        </div>
      )}
      <div className="cobro-total"><span>Total a pagar</span><b>{rd(total)}</b></div>

      <div className="cobro-efectivo">
        <label className="campo">
          <span>Efectivo recibido {efectivo.gt(0) && <em>· a cobrar en efectivo {rd(efectivo.toFixed(2))}</em>}</span>
          <input autoFocus={metodo === "EFECTIVO" || metodo === "MIXTO"} className="entrada-grande" inputMode="decimal" value={recibido} placeholder={efectivo.toFixed(2)}
            onChange={(e) => setRecibido(e.target.value.replace(/[^\d.]/g, ""))} onKeyDown={(e) => e.key === "Enter" && cobrar()} />
        </label>
        <div className="billetes">
          <button className="boton fantasma" onClick={() => setRecibido(efectivo.toFixed(2))}>Exacto</button>
          {BILLETES.filter((b) => b >= efectivo.toNumber()).slice(0, 4).map((b) => (
            <button key={b} className="boton fantasma" onClick={() => setRecibido(String(b))}>{rd(b)}</button>
          ))}
        </div>
        {recibido && cambio.gte(0) && <div className="cambio-grande">Cambio: {rd(cambio.toFixed(2))}</div>}
      </div>

      <details className="otros-pagos" open={verOtros} onToggle={(e) => setVerOtros((e.target as HTMLDetailsElement).open)}>
        <summary>Tarjeta, transferencia o crédito (pago mixto)</summary>
        {campo("Tarjeta", tarjeta, setTarjeta, (
          <input autoFocus={metodo === "TARJETA"} className={"ref" + (n(tarjeta).gt(0) && refTarjeta.trim().length < 4 ? " requerido" : "")} placeholder="Núm. de aprobación" aria-label="Número de aprobación del voucher"
            value={refTarjeta} onChange={(e) => setRefTarjeta(e.target.value.replace(/[^A-Za-z0-9-]/g, "").toUpperCase())} onKeyDown={(e) => e.key === "Enter" && cobrar()} />
        ))}
        <div className="billetes">
          <button className="boton fantasma" onClick={() => { setTarjeta(new Decimal(total).minus(n(transferencia)).minus(n(credito)).toFixed(2)); setRecibido(""); }}>Todo con tarjeta</button>
        </div>
        {campo("Transferencia", transferencia, setTransferencia)}
        {cliente && Number(cliente.limiteCredito) > 0 && campo(`Crédito (disp. ${rd(disponibleCredito.toFixed(2))})`, credito, setCredito)}
      </details>

      <div className="cobro-seccion">
        <span className="cobro-etiqueta">Comprobante</span>
        <SelectorComprobante tipo={tipoFactura} onTipo={onTipo} soloConsumo={sinServidor} />
        <small className="suave">La numeración se asigna al confirmar. Los NCF de serie B requieren rangos autorizados vigentes.</small>
      </div>
      <div className="cobro-seccion">
        <span className="cobro-etiqueta">Cliente</span>
        <div className="cobro-cliente">
          <span>{cliente ? <><b>{cliente.nombre}</b>{cliente.documento && <> · {cliente.documento}</>}</> : <><b>Cliente mostrador</b> <span className="suave">(consumidor final)</span></>}</span>
          {!sinServidor && <button className="boton chico" onClick={onBuscarCliente}>{cliente ? "Cambiar" : "Buscar o crear cliente"}</button>}
        </div>
        {!sinServidor && requiereDocumento(tipoFactura) && !tieneDocumentoFiscal(cliente) && (
          <ClienteFiscalRapido ajustes={ajustes} usuario={usuario} onCliente={onCliente} onManual={onBuscarCliente} />
        )}
      </div>

      {(error || msg) && <p className="error">{error || msg}</p>}
      <button className="boton cobrar" disabled={!!error || enviando} onClick={cobrar}>
        {enviando ? "Registrando…" : "Confirmar cobro (Enter)"}
      </button>
    </Modal>
  );
}
