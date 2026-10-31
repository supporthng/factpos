import { formatoTicket, medidasTicket } from "@factpos/compartido";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { rd } from "./api";
import type { ConfigCaja, Usuario } from "./App";

export interface VentaRegistrada {
  id: string; numero: string; tipoDocumento: "E31" | "E32" | "E34" | "B01" | "B02" | "B14" | "B15" | "B16" | "SIN"; numeroDocumento?: string | null; fecha: string;
  encfModificado?: string | null; motivo?: string | null;
  subtotal: string; descuento: string; itbis: string; total: string; cambio: string;
  cupon: { codigo: string; total: string } | null;
  lineas: { descripcion: string; cantidad: string; precio: string; total: string; oferta: string | null; descuentoOferta: string; descuentoCupon: string }[];
  pagos: { formaPago: string; monto: string; recibido?: string; cambio?: string; referencia?: string }[];
  fiscal: { encf: string; codigoSeguridad: string; fechaFirma: string; urlQr: string; modo: "ECF" | "RFCE"; venceSecuencia: string } | null;
  cliente?: { nombre: string; documento: string | null } | null;
  /** Observaciones de la venta */
  notas?: string | null;
  /** Hecha en la caja sin servidor: el e-CF se firma al volver el servidor */
  contingencia?: boolean;
}

/** Encabezado del ticket según el formato elegido por el administrador (logo, datos del negocio y líneas extra). */
export function EncabezadoTicket({ config }: { config: ConfigCaja }) {
  const fmt = formatoTicket(config.marca.formato);
  const med = medidasTicket(fmt);
  return (
    <div className="t-centro">
      {config.marca.logo && config.marca.logoEnTicket && <img className="t-logo" src={config.marca.logo} alt="" style={{ maxWidth: med.logoAncho, maxHeight: med.logoAlto }} />}
      <b className="t-grande">{config.empresa}</b>
      {fmt.mostrarRnc && <div>RNC {config.rnc}</div>}
      {fmt.mostrarSucursal && <div>{config.sucursal}</div>}
      {fmt.mostrarDireccion && config.direccion && <div>{config.direccion}</div>}
      {fmt.mostrarTelefono && config.telefono && <div>Tel. {config.telefono}</div>}
      {fmt.encabezadoExtra.split("\n").filter((l) => l.trim()).map((l, i) => <div key={i}>{l}</div>)}
    </div>
  );
}

const NOMBRE_TIPO: Record<string, string> = {
  E31: "Factura de Crédito Fiscal Electrónica",
  E32: "Factura de Consumo Electrónica",
  E34: "Nota de Crédito Electrónica",
  B01: "Factura con NCF de Crédito Fiscal",
  B02: "Factura con NCF de Consumo",
  B14: "Factura con NCF de Régimen Especial",
  B15: "Factura con NCF Gubernamental",
  B16: "Factura con NCF de Exportación",
  SIN: "Factura interna sin comprobante fiscal",
};
const PAGO: Record<string, string> = { EFECTIVO: "Efectivo", TARJETA: "Tarjeta", TRANSFERENCIA: "Transferencia", CREDITO: "Crédito", DELIVERY: "Delivery" };

const fechaRD = (iso: string) => new Date(iso).toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", hour12: false });

/**
 * Representación impresa del e-CF (ticket de 80 mm) con el código QR del
 * timbre electrónico, el e-NCF y el código de seguridad.
 * Enter imprime · Esc vuelve a vender.
 */
export function Ticket({ venta, copia = false, config, usuario, onCerrar }: {
  venta: VentaRegistrada; copia?: boolean; config: ConfigCaja; usuario: Usuario; onCerrar: () => void;
}) {
  const [qr, setQr] = useState("");
  const fmt = formatoTicket(config.marca.formato);
  const med = medidasTicket(fmt);
  useEffect(() => {
    if (!venta.fiscal?.urlQr) return setQr("");
    QRCode.toDataURL(venta.fiscal.urlQr, { margin: 0, width: 220, errorCorrectionLevel: "M" }).then(setQr);
  }, [venta]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Enter") { e.preventDefault(); window.print(); }
      if (e.key === "Escape") onCerrar();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onCerrar]);

  return (
    <div className="fondo-modal" onMouseDown={onCerrar}>
      <div className="modal ticket-modal" onMouseDown={(e) => e.stopPropagation()}>
        {!copia && venta.tipoDocumento !== "E34" && Number(venta.cambio) > 0 && <div className="cambio-grande centro">Cambio: {rd(venta.cambio)}</div>}
        {venta.tipoDocumento === "E34" && <div className="centro aviso-devolucion">Devolver al cliente: <b>{rd(venta.total)}</b></div>}
        <style>{`@media print { @page { size: ${fmt.papel}mm auto; margin: 0; } }`}</style>
        <div className="ticket" id="ticket" style={{ width: med.ancho, fontSize: med.letra }}>
          <EncabezadoTicket config={config} />
          <div className="t-linea" />
          {copia && <div className="t-centro t-copia">*** COPIA ***</div>}
          <div className="t-centro"><b>{NOMBRE_TIPO[venta.tipoDocumento] ?? venta.tipoDocumento}</b></div>
          <div className="t-fila"><span>{venta.fiscal ? "e-NCF" : venta.tipoDocumento === "SIN" ? "Número interno" : "NCF"}</span><b>{venta.fiscal?.encf ?? venta.numeroDocumento ?? "Pendiente"}</b></div>
          {venta.tipoDocumento === "E31" && venta.fiscal && <div className="t-fila"><span>Válida hasta</span><span>{venta.fiscal.venceSecuencia.split("-").reverse().join("-")}</span></div>}
          {venta.encfModificado && <div className="t-fila"><span>Modifica e-NCF</span><span>{venta.encfModificado}</span></div>}
          {venta.tipoDocumento === "E34" && venta.motivo && <div className="t-fila"><span>Motivo</span><span>{venta.motivo}</span></div>}
          <div className="t-fila"><span>Fecha</span><span>{fechaRD(venta.fecha)}</span></div>
          <div className="t-fila"><span>{config.nombre} · #{venta.numero}</span>{fmt.mostrarCajero && <span>{usuario.nombre}</span>}</div>
          {fmt.mostrarCliente && venta.cliente && (
            <>
              <div className="t-fila"><span>Cliente</span><span>{venta.cliente.nombre}</span></div>
              {venta.cliente.documento && <div className="t-fila"><span>RNC/Cédula</span><span>{venta.cliente.documento}</span></div>}
            </>
          )}
          <div className="t-linea" />
          {venta.lineas.map((l, i) => (
            <div key={i} className="t-item">
              <div>{l.descripcion}</div>
              <div className="t-fila"><span>{Number(l.cantidad) % 1 ? Number(l.cantidad).toFixed(3) : l.cantidad} × {rd(l.precio)}</span><span>{rd(l.total)}</span></div>
              {Number(l.descuentoOferta) > 0 && <div className="t-fila t-desc"><span>  {l.oferta}</span><span>−{rd(l.descuentoOferta)}</span></div>}
              {Number(l.descuentoCupon) > 0 && <div className="t-fila t-desc"><span>  Cupón</span><span>−{rd(l.descuentoCupon)}</span></div>}
            </div>
          ))}
          <div className="t-linea" />
          <div className="t-fila"><span>Subtotal</span><span>{rd(venta.subtotal)}</span></div>
          <div className="t-fila"><span>ITBIS</span><span>{rd(venta.itbis)}</span></div>
          {fmt.mostrarAhorro && Number(venta.descuento) > 0 && <div className="t-fila"><span>Usted ahorró</span><span>{rd(venta.descuento)}</span></div>}
          <div className="t-fila t-total"><span>TOTAL</span><span>{rd(venta.total)}</span></div>
          {venta.pagos.map((p, i) => (
            <div key={i} className="t-fila"><span>{PAGO[p.formaPago] ?? p.formaPago}{p.formaPago === "TARJETA" && p.referencia ? ` · Aprob. ${p.referencia}` : ""}</span><span>{rd(p.recibido ?? p.monto)}</span></div>
          ))}
          {Number(venta.cambio) > 0 && <div className="t-fila"><span>Cambio</span><span>{rd(venta.cambio)}</span></div>}
          {venta.notas && <div className="t-nota">Nota: {venta.notas}</div>}
          <div className="t-linea" />
          <div className="t-centro">
            {venta.fiscal && (venta.contingencia || !venta.fiscal.codigoSeguridad) ? (
              <div className="t-contingencia">
                <b>EMITIDA EN CONTINGENCIA</b>
                <div>Firma electrónica pendiente: se completa y se envía a la DGII al restablecerse el sistema.</div>
              </div>
            ) : venta.fiscal ? (
              <>
                {fmt.mostrarQr && qr && <img src={qr} alt="Código QR del comprobante" className="t-qr" />}
                <div>Código de seguridad: <b>{venta.fiscal.codigoSeguridad}</b></div>
                <div>Fecha de firma: {fechaRD(venta.fiscal.fechaFirma)}</div>
              </>
            ) : null}
            {venta.tipoDocumento !== "E34" && fmt.pie && <div className="t-pie">{fmt.pie}</div>}
            {fmt.pieExtra && <div className="t-pie t-nota">{fmt.pieExtra}</div>}
          </div>
        </div>
        <div className="acciones-ticket">
          <button className="boton fantasma" onClick={onCerrar}>Nueva venta (Esc)</button>
          <button className="boton primario" onClick={() => window.print()}>Imprimir (Enter)</button>
        </div>
      </div>
    </div>
  );
}
