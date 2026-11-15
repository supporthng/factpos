import { useEffect, useState } from "react";
import { api } from "../api";
import { Aviso, Encabezado } from "../ui";

/**
 * Consultar existencias (vendedor): busca un producto y muestra cuánto hay en CADA sucursal. Es solo de consulta:
 * no muestra costos y no permite sacar mercancía de otra sucursal (la venta sale del inventario de la caja que la cobra).
 */
interface Fila { productoId: string; sku: string; nombre: string; sucursales: Record<string, { sucursalId: string; cantidad: number }> }

export function ConsultaExistencias() {
  const [q, setQ] = useState("");
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (q.trim().length < 2) { setFilas(null); setError(""); return; }
    const t = setTimeout(() => api<Fila[]>(`/central/existencias?q=${encodeURIComponent(q.trim())}`).then((r) => { setFilas(r); setError(""); }).catch((e) => setError((e as Error).message)), 300);
    return () => clearTimeout(t);
  }, [q]);
  const nombres = [...new Set((filas ?? []).flatMap((f) => Object.keys(f.sucursales)))].sort();
  return (
    <>
      <Encabezado titulo="Consultar existencias" descripcion="Vea en qué sucursales hay un producto. Es solo de consulta: la venta sale del inventario de la caja que la cobra." />
      <Aviso texto={error} />
      <div className="panel">
        <label className="campo"><span>Producto</span><input autoFocus value={q} placeholder="Nombre, SKU o código de barras (mínimo 2 letras)…" onChange={(e) => setQ(e.target.value)} /></label>
        {filas && !filas.length && <p className="suave">No se encontró ningún producto con inventario.</p>}
        {!!filas?.length && (
          <div className="tabla-contenedor"><table className="tabla">
            <thead><tr><th>Producto</th>{nombres.map((n) => <th key={n} className="der">{n}</th>)}<th className="der">Total</th></tr></thead>
            <tbody>{filas.map((f) => (
              <tr key={f.productoId}>
                <td><b>{f.nombre}</b><div className="suave">{f.sku}</div></td>
                {nombres.map((n) => { const c = f.sucursales[n]?.cantidad ?? 0; return <td key={n} className={"der " + (c > 0 ? "" : "suave")}>{c > 0 ? Number(c).toLocaleString("es-DO") : "Sin existencia"}</td>; })}
                <td className="der"><b>{Object.values(f.sucursales).reduce((a, x) => a + x.cantidad, 0).toLocaleString("es-DO")}</b></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        {!filas && !error && <p className="suave">Escriba el producto que busca el cliente.</p>}
      </div>
    </>
  );
}
