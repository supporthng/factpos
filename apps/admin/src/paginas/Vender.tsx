import { useEffect, useState } from "react";
import { api, esLocal, rd, sucursalPropia } from "../api";
import { Aviso, Encabezado, useDatos } from "../ui";
import { NuevaFactura } from "./NuevaFactura";

/**
 * Terminal de ventas (vendedor): arma la venta con los precios del cliente y la envía a una caja, donde el cliente paga
 * y se emite el comprobante. Aquí también ve el estado de lo que envió. No cobra, no emite facturas ni toca compras o precios.
 */
interface Fila { id: string; numero: string; total: string; estado: "PENDIENTE" | "COBRADA" | "ANULADA"; creadaEn: string; caja: string; sucursal: string; cliente: string | null; lineas: number; encf: string | null }
const ESTADO: Record<Fila["estado"], [string, string]> = { PENDIENTE: ["Esperando cobro", "texto-alerta"], COBRADA: ["Cobrada", "texto-ok"], ANULADA: ["Anulada", "suave"] };
const hora = (iso: string) => new Date(iso).toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

function MisVentas() {
  const r = useDatos<Fila[]>("/central/por-cobrar?mias=1");
  const [msg, setMsg] = useState("");
  useEffect(() => { const t = setInterval(() => void r.recargar(), 15000); return () => clearInterval(t); }, [r.recargar]); // eslint-disable-line react-hooks/exhaustive-deps
  const anular = async (f: Fila) => {
    if (!confirm(`¿Anular la venta #${f.numero}? La caja ya no la podrá cobrar.`)) return;
    setMsg("");
    try { await api(`/central/por-cobrar/${f.id}/anular`, { cuerpo: {} }); await r.recargar(); } catch (e) { setMsg((e as Error).message); }
  };
  return (
    <div className="panel">
      <Aviso texto={r.error || msg} />
      {!r.datos?.length ? <p className="suave">Todavía no ha enviado ventas a caja (se muestran las pendientes y las de los últimos 2 días).</p> : (
        <div className="tabla-contenedor"><table className="tabla">
          <thead><tr><th>#</th><th>Cliente</th><th>Caja</th><th>Enviada</th><th className="der">Líneas</th><th className="der">Total</th><th>Estado</th><th /></tr></thead>
          <tbody>{r.datos.map((f) => (
            <tr key={f.id}>
              <td><b>{f.numero}</b></td><td>{f.cliente ?? <span className="suave">Mostrador</span>}</td><td>{f.sucursal} · {f.caja}</td><td className="suave">{hora(f.creadaEn)}</td>
              <td className="der">{f.lineas}</td><td className="der">{rd(f.total)}</td>
              <td className={ESTADO[f.estado][1]}>{ESTADO[f.estado][0]}{f.encf && <div className="suave">{f.encf}</div>}</td>
              <td className="der">{f.estado === "PENDIENTE" && <button className="boton chico" onClick={() => anular(f)}>Anular</button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}

export function Vender() {
  const [pestana, setPestana] = useState<"nueva" | "mias">("nueva");
  const [version, setVersion] = useState(0); // al enviar una venta se reinicia la pantalla
  // Las ventas por cobrar viven en el servidor de la sucursal (caja, inventario y turno): en la administración de internet no se pueden crear.
  // Un servidor principal que también atiende una tienda (SUCURSAL_LOCAL en su .env) sí puede.
  if (!esLocal() && !sucursalPropia()) {
    return (
      <>
        <Encabezado titulo="Vender" descripcion="Arme la venta y envíela a la caja para cobrar." />
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Abra la administración local de la sucursal</h3>
          <p>Las ventas se arman y se envían a la caja desde la administración de la tienda (la que se abre con la dirección del servidor local), no desde internet. Allí están la caja, el inventario y el turno del cajero.</p>
          <p className="suave">Entre con el mismo usuario y contraseña. Cada vendedor solo ve lo que su rol permite.</p>
          <p className="suave">Si esta es la computadora principal y también es la tienda, agregue <b>SUCURSAL_LOCAL=nombre de la sucursal</b> en el archivo .env del servidor y reinícielo: así este mismo servidor puede vender.</p>
        </div>
      </>
    );
  }
  return (
    <>
      <div className="fila-acciones" style={{ marginTop: 0 }}>
        <button className={"boton" + (pestana === "nueva" ? " primario" : "")} onClick={() => setPestana("nueva")}>Nueva venta</button>
        <button className={"boton" + (pestana === "mias" ? " primario" : "")} onClick={() => setPestana("mias")}>Mis ventas enviadas</button>
      </div>
      {pestana === "nueva"
        ? <NuevaFactura key={version} soloEnviar onCerrar={() => setVersion(version + 1)} onCreada={() => setVersion(version + 1)} />
        : <><Encabezado titulo="Mis ventas enviadas" descripcion="Lo que envió a caja y si ya fue cobrado." /><MisVentas /></>}
    </>
  );
}
