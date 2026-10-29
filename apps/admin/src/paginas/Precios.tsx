import { useMemo, useState } from "react";
import { api, rd } from "../api";
import { Aviso, Encabezado, SelectorProducto, useCatalogo, useDatos } from "../ui";

interface FilaPrecio {
  presentacionId: string; presentacion: string; factor: string; nivel: number; lista: string;
  sucursalId: string | null; sucursal: string | null; precio: string; costo: string; margenPct: string | null;
}
const NIVELES = [1, 2, 3];
const clave = (p: string, n: number, s: string | null) => `${p}|${n}|${s ?? ""}`;

/**
 * Precios por sucursal: la columna "General" aplica a todas; si una sucursal
 * tiene su propio precio, ese manda allí. Dejar vacía una celda de sucursal
 * la devuelve al precio general.
 */
export function Precios() {
  const { sucursales, productos } = useCatalogo();
  const [productoId, setProductoId] = useState(productos[0]?.id ?? "");
  const { datos, recargar } = useDatos<FilaPrecio[]>(productoId ? `/central/precios/${productoId}` : null);
  const [cambios, setCambios] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" } | null>(null);
  const producto = productos.find((p) => p.id === productoId);
  const aux = useDatos<{ preciosPorSucursal: boolean }>("/central/productos-auxiliares");
  const porSucursal = !!aux.datos?.preciosPorSucursal;
  const columnasSucursal = porSucursal ? sucursales : [];

  const alternar = async () => {
    const activo = !porSucursal;
    if (activo && !confirm("Con precios por sucursal, cada sucursal puede tener precios propios. ¿Activar?")) return;
    try {
      await api("/central/empresa/precios-por-sucursal", { metodo: "PUT", cuerpo: { activo } });
      aux.recargar();
      setMsg({ t: activo ? "Precios por sucursal activados. Una celda de sucursal vacía usa el precio general." : "Precios por sucursal desactivados: todas las sucursales usan el precio general. Los precios propios se conservan por si lo vuelve a activar.", tipo: "ok" });
    } catch (e) {
      setMsg({ t: (e as Error).message, tipo: "error" });
    }
  };

  const actual = useMemo(() => {
    const m = new Map<string, FilaPrecio>();
    for (const f of datos ?? []) m.set(clave(f.presentacionId, f.nivel, f.sucursalId), f);
    return m;
  }, [datos]);
  const costoDe = (presId: string) => (datos ?? []).find((f) => f.presentacionId === presId)?.costo;

  const guardar = async () => {
    const lista = Object.entries(cambios).map(([k, v]) => {
      const [presentacionId, nivel, sucursalId] = k.split("|");
      return { presentacionId, nivel: Number(nivel), sucursalId: sucursalId || null, precio: v === "" ? null : v };
    });
    try {
      await api("/central/precios", { metodo: "PUT", cuerpo: lista });
      setCambios({});
      setMsg({ t: `${lista.length} precio(s) actualizados. Las terminales los toman en menos de un minuto.`, tipo: "ok" });
      recargar();
    } catch (e) {
      setMsg({ t: (e as Error).message, tipo: "error" });
    }
  };

  const celda = (presId: string, nivel: number, sucId: string | null) => {
    const k = clave(presId, nivel, sucId);
    const f = actual.get(k);
    const valor = cambios[k] ?? f?.precio ?? "";
    const general = actual.get(clave(presId, nivel, null))?.precio;
    const costo = Number(costoDe(presId) ?? 0);
    const p = Number(valor || general || 0);
    const bajoCosto = p > 0 && costo > 0 && p < costo;
    return (
      <td key={k} className="der">
        <input
          className={"numero" + (k in cambios ? " cambiado" : "") + (bajoCosto ? " alerta" : "")}
          inputMode="decimal"
          value={valor}
          placeholder={sucId ? (general ? `${Number(general).toFixed(2)}` : "—") : "—"}
          title={bajoCosto ? "Por debajo del costo" : undefined}
          onChange={(e) => setCambios({ ...cambios, [k]: e.target.value.replace(/[^\d.]/g, "") })}
        />
      </td>
    );
  };

  return (
    <>
      <Encabezado titulo="Precios" descripcion="Precio 1 (detalle), Precio 2 y Precio 3 (por mayor). El nivel de cada cliente se define en su ficha.">
        <label className="interruptor" title="Apagado: todas las sucursales venden al mismo precio">
          <input type="checkbox" checked={porSucursal} onChange={alternar} disabled={!aux.datos} />Precios distintos por sucursal
        </label>
        <button className="boton primario" disabled={!Object.keys(cambios).length} onClick={guardar}>Guardar cambios</button>
      </Encabezado>
      <div className="filtros"><div style={{ width: 380 }}><SelectorProducto valor={productoId} onCambio={(v) => { setProductoId(v); setCambios({}); }} /></div></div>
      {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}
      {producto?.presentaciones.map((pr) => (
        <div key={pr.id} className="panel">
          <div className="encabezado-sub">
            <h3>{producto.nombre} · {pr.nombre} <span className="suave">× {Number(pr.factor)}</span></h3>
            <span className="suave">Costo actual {rd(costoDe(pr.id))}</span>
          </div>
          <div className="tabla-contenedor">
            <table className="tabla tabla-edicion">
              <thead>
                <tr><th>Nivel</th><th className="der">General</th>{columnasSucursal.map((s) => <th key={s.id} className="der">{s.nombre}</th>)}<th className="der">Margen general</th></tr>
              </thead>
              <tbody>
                {NIVELES.map((n) => {
                  const g = actual.get(clave(pr.id, n, null));
                  return (
                    <tr key={n}>
                      <td><b>Precio {n}</b> <span className="suave">{n === 1 ? "Detalle" : n === 2 ? "Mayorista" : "Distribuidor"}</span></td>
                      {celda(pr.id, n, null)}
                      {columnasSucursal.map((s) => celda(pr.id, n, s.id))}
                      <td className="der">{g?.margenPct ? `${g.margenPct}%` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      <p className="suave pequeno">Las celdas en rojo están por debajo del costo.{porSucursal ? " Una celda de sucursal vacía usa el precio general." : " Todas las sucursales usan estos precios; el inventario y los reportes siguen siendo de cada sucursal."}</p>
    </>
  );
}
