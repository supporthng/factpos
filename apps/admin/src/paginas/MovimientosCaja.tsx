import { useState } from "react";
import { hoy, rd } from "../api";
import { Encabezado, Kpi, SelectorSucursal, Tabla, useDatos } from "../ui";

/** Retiros, gastos, sencillo y abonos hechos en las cajas, con quién aprobó. */
const NOMBRE: Record<string, string> = { RETIRO: "Retiro", GASTO: "Gasto", DEPOSITO: "Sencillo", ABONO_CLIENTE: "Abono de cliente", LIQUIDACION_DELIVERY: "Liquidación delivery" };

export function MovimientosCaja() {
  const inicioMes = hoy().slice(0, 8) + "01";
  const [desde, setDesde] = useState(inicioMes);
  const [hasta, setHasta] = useState(hoy());
  const [sucursal, setSucursal] = useState("");
  const [tipo, setTipo] = useState("");
  const params = new URLSearchParams({ desde, hasta, ...(sucursal ? { sucursalId: sucursal } : {}), ...(tipo ? { tipo } : {}) });
  const { datos } = useDatos<{ movimientos: any[]; porTipo: any[]; porCategoria: any[] }>(`/central/caja/movimientos?${params}`);
  const total = (t: string) => datos?.porTipo.find((x) => x.tipo === t)?.monto ?? 0;
  return (
    <>
      <Encabezado titulo="Retiros y gastos de caja" descripcion="Dinero que entró o salió de las gavetas fuera de las ventas, con quién lo aprobó." />
      <div className="fila-acciones" style={{ marginBottom: 12, flexWrap: "wrap" }}>
        <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        <SelectorSucursal valor={sucursal} onCambio={setSucursal} />
        <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
          <option value="">Todos los tipos</option>
          {Object.entries(NOMBRE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div className="kpis">
        <Kpi titulo="Retiros" valor={rd(total("RETIRO"))} />
        <Kpi titulo="Gastos" valor={rd(total("GASTO"))} tono={Number(total("GASTO")) > 0 ? "alerta" : undefined} />
        <Kpi titulo="Abonos de clientes" valor={rd(total("ABONO_CLIENTE"))} tono="ok" />
        <Kpi titulo="Sencillo" valor={rd(total("DEPOSITO"))} />
      </div>
      {!!datos?.porCategoria.length && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Gastos por categoría</h3>
          <Tabla filas={datos.porCategoria} clave={(f) => f.categoria} columnas={[
            { titulo: "Categoría", valor: (f) => f.categoria },
            { titulo: "Cantidad", valor: (f) => f.cantidad, der: true },
            { titulo: "Total", valor: (f) => rd(f.monto), der: true },
            { titulo: "Con NCF (606)", valor: (f) => rd(f.conComprobante ?? 0), der: true },
          ]} />
        </div>
      )}
      <Tabla
        filas={datos?.movimientos ?? []}
        clave={(f) => f.id}
        vacio="No hay movimientos en estas fechas"
        columnas={[
          { titulo: "Fecha", valor: (f) => new Date(f.creadoEn).toLocaleString("es-DO", { dateStyle: "short", timeStyle: "short" }) },
          { titulo: "Caja", valor: (f) => `${f.sucursal} · ${f.caja}` },
          { titulo: "Tipo", valor: (f) => NOMBRE[f.tipo] ?? f.tipo },
          { titulo: "Detalle", valor: (f) => <>{f.concepto}{f.categoria ? <span className="suave"> · {f.categoria}</span> : null}{f.comprobante ? <span className="mono suave"> · {f.comprobante}</span> : null}</> },
          { titulo: "Cajero", valor: (f) => f.usuario },
          { titulo: "Aprobó", valor: (f) => f.autorizadoPor ?? "—" },
          { titulo: "Monto", valor: (f) => <span className={["RETIRO", "GASTO"].includes(f.tipo) ? "texto-alerta" : ""}>{["RETIRO", "GASTO"].includes(f.tipo) ? "−" : ""}{rd(f.monto)}</span>, der: true },
        ]}
      />
    </>
  );
}
