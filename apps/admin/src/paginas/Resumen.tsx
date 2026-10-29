import { rd, num } from "../api";
import { Aviso, Encabezado, Kpi, Tabla, useDatos } from "../ui";

interface FilaSucursal {
  sucursal_id: string; sucursal: string; venta_hoy: string; transacciones_hoy: string;
  valor_inventario: string; productos_bajo_minimo: string; traspasos_por_recibir: string;
}

export function Resumen() {
  const { datos, error } = useDatos<FilaSucursal[]>("/central/sucursales");
  const bajo = useDatos<any[]>("/central/reportes/bajo-minimo");
  const filas = datos ?? [];
  const sum = (k: keyof FilaSucursal) => filas.reduce((a, f) => a + Number(f[k]), 0);

  return (
    <>
      <Encabezado titulo="Resumen" descripcion="Cómo van hoy todas las sucursales" />
      <Aviso texto={error} />
      <div className="kpis">
        <Kpi titulo="Venta de hoy" valor={rd(sum("venta_hoy"))} detalle={`${num(sum("transacciones_hoy"))} transacciones`} />
        <Kpi titulo="Inventario al costo" valor={rd(sum("valor_inventario"))} detalle={`${filas.length} sucursales`} />
        <Kpi titulo="Productos bajo mínimo" valor={num(sum("productos_bajo_minimo"))} tono={sum("productos_bajo_minimo") ? "alerta" : "ok"} />
        <Kpi titulo="Traspasos por recibir" valor={num(sum("traspasos_por_recibir"))} />
      </div>

      <h2>Por sucursal</h2>
      <div className="tarjetas-sucursal">
        {filas.map((f) => (
          <div key={f.sucursal_id} className="tarjeta">
            <h3>{f.sucursal}</h3>
            <div className="dato"><span>Venta de hoy</span><b>{rd(f.venta_hoy)}</b></div>
            <div className="dato"><span>Transacciones</span><b>{num(f.transacciones_hoy)}</b></div>
            <div className="dato"><span>Ticket promedio</span><b>{rd(Number(f.transacciones_hoy) ? Number(f.venta_hoy) / Number(f.transacciones_hoy) : 0)}</b></div>
            <div className="dato"><span>Inventario</span><b>{rd(f.valor_inventario)}</b></div>
            <div className="dato"><span>Bajo mínimo</span><b className={Number(f.productos_bajo_minimo) ? "texto-alerta" : ""}>{num(f.productos_bajo_minimo)}</b></div>
          </div>
        ))}
      </div>

      <h2>Reponer pronto</h2>
      <Tabla
        filas={bajo.datos ?? []}
        clave={(f) => f.sucursal_id + f.producto_id}
        vacio="Ningún producto está por debajo del mínimo"
        columnas={[
          { titulo: "Producto", valor: (f) => <><b>{f.nombre}</b> <span className="suave">{f.sku}</span></> },
          { titulo: "Sucursal", valor: (f) => filas.find((s) => s.sucursal_id === f.sucursal_id)?.sucursal ?? "" },
          { titulo: "Existencia", valor: (f) => num(f.cantidad, 0), der: true },
          { titulo: "Mínimo", valor: (f) => num(f.stock_minimo, 0), der: true },
          { titulo: "Sugerido comprar", valor: (f) => <b>{num(f.sugerido_comprar, 0)}</b>, der: true },
        ]}
      />
    </>
  );
}
