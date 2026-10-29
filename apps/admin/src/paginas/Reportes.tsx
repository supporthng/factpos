import { useState } from "react";
import { descargarCsv, rd, num, hoy } from "../api";
import { Aviso, Encabezado, SelectorSucursal, Tabla, useDatos } from "../ui";

const REPORTES: { id: string; titulo: string; grupo: string; fechas?: boolean }[] = [
  { id: "ventas-sucursal", titulo: "Ventas por sucursal", grupo: "Ventas", fechas: true },
  { id: "ventas-diarias", titulo: "Ventas por día y caja", grupo: "Ventas", fechas: true },
  { id: "utilidad-productos", titulo: "Utilidad por producto", grupo: "Ventas", fechas: true },
  { id: "formas-pago", titulo: "Ventas por forma de pago", grupo: "Ventas", fechas: true },
  { id: "niveles-precio", titulo: "Ventas por nivel de precio", grupo: "Ventas", fechas: true },
  { id: "ofertas", titulo: "Rendimiento de ofertas", grupo: "Ventas", fechas: true },
  { id: "cupones", titulo: "Uso de cupones", grupo: "Ventas" },
  { id: "valorizacion", titulo: "Valorización del inventario", grupo: "Inventario" },
  { id: "bajo-minimo", titulo: "Bajo mínimo (sugerido de compra)", grupo: "Inventario" },
  { id: "por-vencer", titulo: "Próximos a vencer (60 días)", grupo: "Inventario" },
  { id: "perdidas", titulo: "Pérdidas: mermas, vencidos y ajustes", grupo: "Inventario", fechas: true },
  { id: "ajustes", titulo: "Detalle de ajustes", grupo: "Inventario", fechas: true },
  { id: "traspasos", titulo: "Traspasos", grupo: "Inventario" },
  { id: "cierres-caja", titulo: "Cierres de caja (cuadres)", grupo: "Operación", fechas: true },
  { id: "delivery", titulo: "Delivery", grupo: "Operación", fechas: true },
  { id: "saldo-clientes", titulo: "Saldo de clientes (fiado)", grupo: "Operación" },
];

// Columnas técnicas que no se muestran
const OCULTAR = new Set(["sucursal_id", "almacen_id", "producto_id", "caja_id", "turno_id", "categoria_id", "empresa_id", "oferta_id", "cliente_id", "id"]);
const DINERO = /venta|total|valor|monto|costo|utilidad|descuento|itbis|saldo|limite|precio|cargos|ticket|devoluciones|diferencia|efectivo|tarjeta|transferencia|credito/i;
const SIGLAS: Record<string, string> = { itbis: "ITBIS", isc: "ISC", sku: "SKU", ncf: "NCF", rnc: "RNC", encf: "e-NCF" };
/** "venta_total" → "Venta total"; "itbis" → "ITBIS" */
const etiqueta = (c: string) => {
  const t = c.split("_").map((w) => SIGLAS[w] ?? w).join(" ");
  return t.charAt(0).toUpperCase() + t.slice(1);
};

export function Reportes() {
  const [rep, setRep] = useState(REPORTES[0].id);
  const [sucursalId, setSucursalId] = useState("");
  const inicioMes = hoy().slice(0, 8) + "01";
  const [desde, setDesde] = useState(inicioMes);
  const [hasta, setHasta] = useState(hoy());
  const def = REPORTES.find((r) => r.id === rep)!;
  const params = new URLSearchParams({
    ...(sucursalId ? { sucursalId } : {}),
    ...(def.fechas ? { desde, hasta } : {}),
  });
  const ruta = `/central/reportes/${rep}?${params}`;
  const { datos, error, cargando } = useDatos<Record<string, any>[]>(ruta);
  const filas = datos ?? [];
  const cols = filas.length ? Object.keys(filas[0]).filter((c) => !OCULTAR.has(c)) : [];

  const formato = (c: string, v: any) => {
    if (v === null || v === undefined) return "—";
    if (typeof v === "boolean") return v ? "Sí" : "No";
    if (typeof v === "object") return Array.isArray(v) ? v.join(", ") : JSON.stringify(v);
    if (/^-?\d+(\.\d+)?$/.test(String(v))) return DINERO.test(c) && !/pct|porc/.test(c) ? rd(v) : num(v, String(v).includes(".") && Number(v) % 1 ? 2 : 0);
    if (/^\d{4}-\d{2}-\d{2}T/.test(String(v))) return new Date(v).toLocaleString("es-DO", { dateStyle: "short", timeStyle: "short" });
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return new Date(`${v}T12:00:00`).toLocaleDateString("es-DO", { day: "2-digit", month: "2-digit", year: "numeric" });
    return String(v);
  };
  const totales = cols.filter((c) => DINERO.test(c) && filas.every((f) => f[c] === null || /^-?\d+(\.\d+)?$/.test(String(f[c]))) && !/costo_unitario|precio|promedio|limite/.test(c));

  return (
    <>
      <Encabezado titulo="Reportes" descripcion="Todas las sucursales o una sola. Exporte a Excel con el botón CSV.">
        <button className="boton fantasma" disabled={!filas.length} onClick={() => descargarCsv(ruta, `${rep}-${hasta}`)}>Exportar CSV</button>
      </Encabezado>
      <div className="reportes">
        <nav className="lista-reportes">
          {[...new Set(REPORTES.map((r) => r.grupo))].map((g) => (
            <div key={g}>
              <span className="grupo-titulo">{g}</span>
              {REPORTES.filter((r) => r.grupo === g).map((r) => (
                <button key={r.id} className={r.id === rep ? "activo" : ""} onClick={() => setRep(r.id)}>{r.titulo}</button>
              ))}
            </div>
          ))}
        </nav>
        <section>
          <div className="filtros">
            <SelectorSucursal valor={sucursalId} onCambio={setSucursalId} />
            {def.fechas && <>
              <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
              <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
            </>}
            {cargando && <span className="suave">Cargando…</span>}
          </div>
          <Aviso texto={error} />
          <h2>{def.titulo}</h2>
          {totales.length > 0 && (
            <div className="kpis">
              {totales.slice(0, 4).map((c) => (
                <div key={c} className="kpi"><span className="suave">{etiqueta(c)}</span><b>{rd(filas.reduce((a, f) => a + Number(f[c] ?? 0), 0))}</b></div>
              ))}
            </div>
          )}
          <Tabla
            filas={filas}
            clave={(_, i) => String(i)}
            vacio="Sin datos para este filtro"
            columnas={cols.map((c) => ({
              titulo: etiqueta(c),
              der: filas.some((f) => /^-?\d+(\.\d+)?$/.test(String(f[c]))),
              valor: (f: Record<string, any>) => formato(c, f[c]),
            }))}
          />
        </section>
      </div>
    </>
  );
}
