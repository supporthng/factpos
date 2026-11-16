import { useEffect, useState } from "react";
import { api, rd } from "../api";
import { Aviso, Encabezado, useDatos } from "../ui";

/** Supervisión de las ventas enviadas a caja por todos los vendedores: lo pendiente aparta existencia hasta que se cobra, se anula o pasan 12 horas */
interface Fila { id: string; numero: string; total: string; estado: "PENDIENTE" | "COBRADA" | "ANULADA"; creadaEn: string; caja: string; sucursal: string; cliente: string | null; vendedor: string | null; lineas: number; encf: string | null }
const ESTADO: Record<Fila["estado"], [string, string]> = { PENDIENTE: ["Esperando cobro", "texto-alerta"], COBRADA: ["Cobrada", "texto-ok"], ANULADA: ["Anulada", "suave"] };
const hora = (iso: string) => new Date(iso).toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const horasDesde = (iso: string) => (Date.now() - new Date(iso).getTime()) / 3600e3;

export function PorCobrarTodas() {
  const r = useDatos<Fila[]>("/central/por-cobrar-todas");
  const [msg, setMsg] = useState("");
  const [ver, setVer] = useState<"PENDIENTE" | "TODAS">("PENDIENTE");
  useEffect(() => { const t = setInterval(() => void r.recargar(), 15000); return () => clearInterval(t); }, [r.recargar]); // eslint-disable-line react-hooks/exhaustive-deps
  const anular = async (f: Fila) => {
    if (!confirm(`¿Anular la venta #${f.numero}${f.vendedor ? ` de ${f.vendedor}` : ""}? La caja ya no la podrá cobrar y se libera la existencia apartada.`)) return;
    setMsg("");
    try { await api(`/central/por-cobrar-todas/${f.id}/anular`, { cuerpo: {} }); await r.recargar(); } catch (e) { setMsg((e as Error).message); }
  };
  const filas = (r.datos ?? []).filter((f) => ver === "TODAS" || f.estado === "PENDIENTE");
  const pendientes = (r.datos ?? []).filter((f) => f.estado === "PENDIENTE");
  return (
    <>
      <Encabezado titulo="Ventas por cobrar" descripcion="Lo que los vendedores enviaron a caja. Mientras está pendiente, la mercancía queda apartada (12 horas como máximo) para que nadie más la venda." />
      <div className="panel">
        <Aviso texto={r.error || msg} />
        <div className="fila-acciones" style={{ marginTop: 0 }}>
          <button className={"boton" + (ver === "PENDIENTE" ? " primario" : "")} onClick={() => setVer("PENDIENTE")}>Pendientes ({pendientes.length})</button>
          <button className={"boton" + (ver === "TODAS" ? " primario" : "")} onClick={() => setVer("TODAS")}>Pendientes y últimos 2 días</button>
        </div>
        {!filas.length ? <p className="suave">No hay ventas por cobrar.</p> : (
          <div className="tabla-contenedor"><table className="tabla">
            <thead><tr><th>#</th><th>Vendedor</th><th>Cliente</th><th>Caja</th><th>Enviada</th><th className="der">Líneas</th><th className="der">Total</th><th>Estado</th><th /></tr></thead>
            <tbody>{filas.map((f) => (
              <tr key={f.id}>
                <td><b>{f.numero}</b></td><td>{f.vendedor ?? "—"}</td><td>{f.cliente ?? <span className="suave">Mostrador</span>}</td><td>{f.sucursal} · {f.caja}</td><td className="suave">{hora(f.creadaEn)}</td>
                <td className="der">{f.lineas}</td><td className="der">{rd(f.total)}</td>
                <td className={ESTADO[f.estado][1]}>{ESTADO[f.estado][0]}{f.estado === "PENDIENTE" && horasDesde(f.creadaEn) >= 12 && <div className="suave">ya no aparta existencia</div>}{f.encf && <div className="suave">{f.encf}</div>}</td>
                <td className="der">{f.estado === "PENDIENTE" && <button className="boton chico" onClick={() => anular(f)}>Anular</button>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </>
  );
}
