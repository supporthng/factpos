import { useState } from "react";
import { descargarCsv, rd, num } from "../api";
import { Encabezado, SelectorProducto, SelectorSucursal, Tabla, useCatalogo, useDatos } from "../ui";

const TIPOS: Record<string, string> = {
  SALDO_INICIAL: "Saldo inicial", VENTA: "Venta", DEVOLUCION_VENTA: "Devolución de venta", COMPRA: "Compra",
  DEVOLUCION_COMPRA: "Devolución a proveedor", AJUSTE_ENTRADA: "Ajuste entrada", AJUSTE_SALIDA: "Ajuste salida",
  MERMA: "Merma", VENCIMIENTO: "Vencido", CONSUMO_INTERNO: "Consumo interno", TRANSFERENCIA_SALIDA: "Traspaso enviado",
  TRANSFERENCIA_ENTRADA: "Traspaso recibido", CONTEO_FISICO: "Conteo físico",
};

/** Kardex: cada movimiento del producto con el saldo y el costo promedio resultantes. */
export function Kardex() {
  const { productos, sucursales } = useCatalogo();
  const [productoId, setProductoId] = useState(productos[0]?.id ?? "");
  const [sucursalId, setSucursalId] = useState(sucursales[0]?.id ?? "");
  const ruta = productoId && sucursalId ? `/central/kardex?productoId=${productoId}&sucursalId=${sucursalId}` : null;
  const { datos } = useDatos<any[]>(ruta);
  const filas = [...(datos ?? [])].reverse();
  const ultimo = datos?.[datos.length - 1];

  return (
    <>
      <Encabezado titulo="Kardex" descripcion="Historial completo de movimientos, con saldo y costo promedio después de cada uno.">
        <button className="boton fantasma" disabled={!ruta} onClick={() => ruta && descargarCsv(ruta, "kardex")}>Exportar CSV</button>
      </Encabezado>
      <div className="filtros">
        <div style={{ width: 360 }}><SelectorProducto valor={productoId} onCambio={setProductoId} /></div>
        <SelectorSucursal valor={sucursalId} onCambio={setSucursalId} todas={false} />
      </div>
      {ultimo && (
        <div className="kpis">
          <div className="kpi"><span className="suave">Existencia</span><b>{num(ultimo.saldo, 0)}</b></div>
          <div className="kpi"><span className="suave">Costo promedio</span><b>{rd(ultimo.costoPromedio)}</b></div>
          <div className="kpi"><span className="suave">Valor</span><b>{rd(ultimo.valorSaldo)}</b></div>
          <div className="kpi"><span className="suave">Movimientos</span><b>{num(datos!.length)}</b></div>
        </div>
      )}
      <Tabla
        filas={filas}
        clave={(_, i) => String(i)}
        vacio="Sin movimientos"
        columnas={[
          { titulo: "Fecha", valor: (f) => new Date(f.fecha).toLocaleString("es-DO") },
          { titulo: "Movimiento", valor: (f) => TIPOS[f.tipo] ?? f.tipo },
          { titulo: "Entrada", valor: (f) => Number(f.cantidad) > 0 ? <span className="texto-ok">{num(f.cantidad, f.cantidad % 1 ? 3 : 0)}</span> : "", der: true },
          { titulo: "Salida", valor: (f) => Number(f.cantidad) < 0 ? <span className="texto-alerta">{num(-f.cantidad, f.cantidad % 1 ? 3 : 0)}</span> : "", der: true },
          { titulo: "Costo", valor: (f) => rd(f.costo), der: true },
          { titulo: "Saldo", valor: (f) => <b>{num(f.saldo, 0)}</b>, der: true },
          { titulo: "Costo prom.", valor: (f) => rd(f.costoPromedio), der: true },
          { titulo: "Usuario", valor: (f) => f.usuario },
          { titulo: "Detalle", valor: (f) => <span className="suave">{f.motivo ?? ""}</span> },
        ]}
      />
    </>
  );
}
