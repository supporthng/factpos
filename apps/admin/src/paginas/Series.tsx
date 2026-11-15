import { useState } from "react";
import { Aviso, Encabezado, useDatos } from "../ui";

/**
 * Series y garantías: se busca un equipo por su número de serie / IMEI, por el cliente, el producto o el e-NCF,
 * y se ve si su garantía sigue vigente. Las series se capturan al facturar los productos marcados «Lleva número de serie».
 */
interface Fila {
  id: string; serie: string; producto: string; sku: string; cliente: string | null; clienteDocumento: string | null; sucursal: string;
  numero: string; encf: string | null; vendidaEn: string; garantiaHasta: string | null; estado: "VIGENTE" | "POR_VENCER" | "VENCIDA" | "SIN_GARANTIA" | "DEVUELTA";
}
const ESTADO: Record<Fila["estado"], [string, string]> = {
  VIGENTE: ["En garantía", "texto-ok"], POR_VENCER: ["Vence pronto", "texto-alerta"], VENCIDA: ["Garantía vencida", "suave"], SIN_GARANTIA: ["Sin garantía", "suave"], DEVUELTA: ["Devuelta (factura anulada)", "suave"],
};
const fecha = (v: string) => new Date(v).toLocaleDateString("es-DO", { timeZone: "America/Santo_Domingo", day: "numeric", month: "short", year: "numeric" });

export function Series() {
  const [q, setQ] = useState("");
  const [buscar, setBuscar] = useState("");
  const [garantia, setGarantia] = useState("");
  const r = useDatos<Fila[]>(`/central/series?${new URLSearchParams({ ...(buscar ? { q: buscar } : {}), ...(garantia ? { garantia } : {}) })}`);
  return (
    <>
      <Encabezado titulo="Series y garantías" descripcion="Busque un equipo por su serie o IMEI, por el cliente o por la factura y vea si sigue en garantía." />
      <Aviso texto={r.error} />
      <div className="panel cab-compra">
        <label className="campo campo-prov"><span>Buscar</span>
          <input value={q} placeholder="Serie / IMEI, cliente, RNC, producto o e-NCF…" onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && setBuscar(q.trim())} /></label>
        <label className="campo"><span>Garantía</span>
          <select value={garantia} onChange={(e) => setGarantia(e.target.value)}>
            <option value="">Todas</option><option value="vigente">En garantía</option><option value="por_vencer">Vencen en 30 días</option><option value="vencida">Vencidas</option>
          </select></label>
        <button className="boton primario" onClick={() => setBuscar(q.trim())}>Buscar</button>
      </div>
      <div className="panel">
        {r.cargando && !r.datos ? <p className="suave">Cargando…</p> : !r.datos?.length ? <p className="suave">No hay series registradas con ese criterio. Las series se piden al facturar los productos marcados «Lleva número de serie / IMEI».</p> : (
          <div className="tabla-contenedor"><table className="tabla">
            <thead><tr><th>Serie / IMEI</th><th>Producto</th><th>Cliente</th><th>Factura</th><th>Vendida</th><th>Garantía hasta</th><th>Estado</th></tr></thead>
            <tbody>{r.datos.map((f) => (
              <tr key={f.id}>
                <td><b>{f.serie}</b></td>
                <td>{f.producto}<div className="suave">{f.sucursal}</div></td>
                <td>{f.cliente ?? <span className="suave">Mostrador</span>}{f.clienteDocumento && <div className="suave">{f.clienteDocumento}</div>}</td>
                <td>{f.encf ?? `#${f.numero}`}</td>
                <td>{fecha(f.vendidaEn)}</td>
                <td>{f.garantiaHasta ? fecha(f.garantiaHasta + "T12:00:00") : "—"}</td>
                <td className={ESTADO[f.estado][1]}>{ESTADO[f.estado][0]}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </>
  );
}
