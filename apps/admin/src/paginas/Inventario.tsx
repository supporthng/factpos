import { useState } from "react";
import { api, rd, num, descargarCsv, puede } from "../api";
import { Aviso, Encabezado, Tabla, useCatalogo, useDatos } from "../ui";
import { ActualizarInventarioExcel } from "./ActualizarInventarioExcel";

interface Fila {
  productoId: string; sku: string; nombre: string; existenciaTotal: string; valorTotal: string;
  sucursales: Record<string, { sucursalId: string; cantidad: number; valor: number; minimo: number | null; bajoMinimo: boolean }>;
}

/** Inventario consolidado: cada producto con su existencia en todas las sucursales. */
export function Inventario() {
  const { sucursales } = useCatalogo();
  const [q, setQ] = useState("");
  const [bajo, setBajo] = useState(false);
  const [buscar, setBuscar] = useState("");
  const ruta = `/central/inventario?${new URLSearchParams({ ...(buscar ? { q: buscar } : {}), ...(bajo ? { soloBajoMinimo: "1" } : {}) })}`;
  const { datos, error, recargar } = useDatos<Fila[]>(ruta);
  const [excel, setExcel] = useState(false);
  const [editar, setEditar] = useState<{ productoId: string; sucursalId: string; nombre: string; sucursal: string } | null>(null);

  const total = (datos ?? []).reduce((a, f) => a + Number(f.valorTotal), 0);

  return (
    <>
      <Encabezado titulo="Inventario" descripcion={`Existencia por sucursal · valor total al costo ${rd(total)}`}>
        {puede("admin.inventario") && <button className="boton" onClick={() => setExcel(true)}>Actualizar con Excel</button>}
        <button className="boton fantasma" onClick={() => descargarCsv("/central/reportes/valorizacion", "valorizacion-inventario")}>Exportar valorización</button>
      </Encabezado>
      <div className="filtros">
        <input placeholder="Buscar por nombre o SKU" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && setBuscar(q)} />
        <button className="boton" onClick={() => setBuscar(q)}>Buscar</button>
        <label className="check"><input type="checkbox" checked={bajo} onChange={(e) => setBajo(e.target.checked)} /> Solo bajo mínimo</label>
      </div>
      <Aviso texto={error} />
      <Tabla
        filas={datos ?? []}
        clave={(f) => f.productoId}
        columnas={[
          { titulo: "Producto", valor: (f) => <><b>{f.nombre}</b><br /><span className="suave pequeno">{f.sku}</span></> },
          ...sucursales.map((s) => ({
            titulo: s.nombre,
            der: true,
            valor: (f: Fila) => {
              const x = f.sucursales[s.nombre];
              return (
                <button className={"celda-stock" + (x?.bajoMinimo ? " alerta" : "")} title="Mínimo / máximo"
                  onClick={() => setEditar({ productoId: f.productoId, sucursalId: s.id, nombre: f.nombre, sucursal: s.nombre })}>
                  {x ? num(x.cantidad, 0) : "—"}
                  {x?.minimo !== null && x?.minimo !== undefined && <small>mín {num(x.minimo)}</small>}
                </button>
              );
            },
          })),
          { titulo: "Total", valor: (f) => <b>{num(f.existenciaTotal)}</b>, der: true },
          { titulo: "Valor al costo", valor: (f) => rd(f.valorTotal), der: true },
        ]}
      />
      <p className="suave pequeno">Toque una existencia para cambiar el mínimo, el máximo o habilitar el producto en esa sucursal.</p>
      {excel && <ActualizarInventarioExcel onCerrar={() => setExcel(false)} onTerminado={() => recargar()} />}
      {editar && <Parametros {...editar} onCerrar={() => setEditar(null)} />}
    </>
  );
}

function Parametros({ productoId, sucursalId, nombre, sucursal, onCerrar }: {
  productoId: string; sucursalId: string; nombre: string; sucursal: string; onCerrar: () => void;
}) {
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [activo, setActivo] = useState(true);
  const [msg, setMsg] = useState("");
  const guardar = async () => {
    try {
      await api("/central/inventario/parametros", {
        metodo: "PUT",
        cuerpo: [{ productoId, sucursalId, ...(min ? { stockMinimo: min } : {}), ...(max ? { stockMaximo: max } : {}), activo }],
      });
      onCerrar();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  return (
    <div className="fondo-modal" onMouseDown={onCerrar}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3>{nombre}</h3>
        <p className="suave">{sucursal}</p>
        <div className="dos-col">
          <label className="campo"><span>Stock mínimo</span><input inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} placeholder="Sin cambio" /></label>
          <label className="campo"><span>Stock máximo</span><input inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} placeholder="Sin cambio" /></label>
        </div>
        <label className="check"><input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} /> Se vende en esta sucursal</label>
        <Aviso texto={msg} />
        <div className="acciones-modal">
          <button className="boton fantasma" onClick={onCerrar}>Cancelar</button>
          <button className="boton primario" onClick={guardar}>Guardar</button>
        </div>
      </div>
    </div>
  );
}
