import { useState } from "react";
import { descargarCsv, rd, num, hoy } from "../api";
import { Aviso, Encabezado, SelectorSucursal, Tabla, useDatos } from "../ui";

type Rep = { id: string; titulo: string; grupo: string; desc: string; fechas?: boolean; porProducto?: boolean };
const REPORTES: Rep[] = [
  { id: "ventas-sucursal", titulo: "Ventas por sucursal", grupo: "Ventas", fechas: true, desc: "Cuánto vendió cada sucursal en el período: facturas, descuentos, ITBIS y total." },
  { id: "ventas-comprobante", titulo: "Ventas por tipo de comprobante", grupo: "Ventas", fechas: true, desc: "Separa lo facturado con e-CF (E), NCF serie B y facturas internas (FI-)." },
  { id: "ventas-diarias", titulo: "Ventas por día y caja", grupo: "Ventas", fechas: true, desc: "Día a día, cuánto vendió cada caja." },
  { id: "ventas-producto", titulo: "Ventas por producto (día o mes)", grupo: "Ventas", fechas: true, porProducto: true, desc: "Cuántas unidades se vendieron de cada producto, por día o por mes. Escriba el nombre o el SKU para ver uno solo. Las cajas y paquetes cuentan por unidad; las devoluciones restan." },
  { id: "mas-vendidos", titulo: "Productos más vendidos", grupo: "Ventas", fechas: true, desc: "Los 200 productos que más unidades vendieron en el período, del que más al que menos." },
  { id: "utilidad-productos", titulo: "Utilidad por producto", grupo: "Ventas", fechas: true, desc: "Qué productos dejan más ganancia: venta menos costo." },
  { id: "formas-pago", titulo: "Formas de pago", grupo: "Ventas", fechas: true, desc: "Cuánto entró en efectivo, tarjeta, transferencia y crédito." },
  { id: "niveles-precio", titulo: "Ventas por nivel de precio", grupo: "Ventas", fechas: true, desc: "Cuánto se vendió con el precio 1, 2 y 3." },
  { id: "ofertas", titulo: "Rendimiento de ofertas", grupo: "Ventas", fechas: true, desc: "Qué ofertas se usaron y cuánto descuento dieron." },
  { id: "cupones", titulo: "Uso de cupones", grupo: "Ventas", desc: "Cupones emitidos y cuántas veces se canjearon." },
  { id: "valorizacion", titulo: "Valorización del inventario", grupo: "Inventario", desc: "Cuánto dinero hay en mercancía, a costo, por sucursal." },
  { id: "sin-stock", titulo: "Productos sin stock", grupo: "Inventario", desc: "Productos agotados (existencia 0 o menos) en el almacén principal, con lo que vendían en los últimos 30 días y su última venta: lo primero que hay que reponer va arriba." },
  { id: "bajo-minimo", titulo: "Bajo mínimo", grupo: "Inventario", desc: "Productos por debajo de su existencia mínima, con la cantidad sugerida a comprar." },
  { id: "reposicion", titulo: "Reposición inteligente", grupo: "Inventario", desc: "Qué comprar según lo que se vende y lo que queda." },
  { id: "por-vencer", titulo: "Vencidos y por vencer", grupo: "Inventario", desc: "Lotes vencidos o que vencen en los próximos 60 días." },
  { id: "perdidas", titulo: "Pérdidas", grupo: "Inventario", fechas: true, desc: "Mermas, vencidos, ajustes de salida, consumo interno y faltantes de conteo: lo que se perdió y cuánto costó. No incluye entradas." },
  { id: "entradas-noche", titulo: "Entradas por noche", grupo: "Ventas", fechas: true, desc: "Entradas vendidas de cada tipo e ingreso, por noche (de 6:00 a. m. a 6:00 a. m.). Requiere elegir la categoría de entradas en Datos de la empresa." },
  { id: "cortesias", titulo: "Cortesías y anulaciones de cuentas", grupo: "Control", fechas: true, desc: "Productos regalados y anulados después de enviarlos a la barra o cocina: quién, quién autorizó, motivo y valor." },
  { id: "ajustes", titulo: "Detalle de ajustes", grupo: "Inventario", fechas: true, desc: "Todos los ajustes de existencia: quién, cuándo y por qué." },
  { id: "traspasos", titulo: "Traspasos", grupo: "Inventario", desc: "Mercancía movida entre sucursales o almacenes." },
  { id: "anulaciones", titulo: "Anulaciones de facturas", grupo: "Control", fechas: true, desc: "Facturas anuladas, quién las anuló y quién lo autorizó." },
  { id: "anulaciones-cajero", titulo: "Anulaciones por cajero", grupo: "Control", fechas: true, desc: "Cuántas anulaciones hace cada cajero por día. Sirve para detectar abusos." },
  { id: "cierres-caja", titulo: "Cierres de caja", grupo: "Operación", fechas: true, desc: "Cuadre de cada turno: esperado, contado y diferencia." },
  { id: "delivery", titulo: "Delivery", grupo: "Operación", fechas: true, desc: "Pedidos a domicilio y su estado." },
  { id: "saldo-clientes", titulo: "Saldo de clientes (fiado)", grupo: "Operación", desc: "Lo que cada cliente debe en este momento." },
  { id: "historial-ventas", titulo: "Ventas del sistema anterior", grupo: "Historial anterior", fechas: true, desc: "Ventas importadas de WilPOS. Son solo de consulta: no son facturas de FactPOS." },
  { id: "historial-ventas-producto", titulo: "Productos vendidos (sistema anterior)", grupo: "Historial anterior", fechas: true, desc: "Cuánto se vendió de cada producto en el historial importado." },
];
const GRUPOS = ["Ventas", "Inventario", "Control", "Operación", "Historial anterior"];

const dia = (d: Date) => d.toISOString().slice(0, 10);
const sumar = (f: string, n: number) => dia(new Date(new Date(`${f}T12:00:00Z`).getTime() + n * 86400e3));
function rango(k: string): [string, string] {
  const h = hoy();
  const [y, m] = [Number(h.slice(0, 4)), Number(h.slice(5, 7))];
  const pad = (n: number) => String(n).padStart(2, "0");
  switch (k) {
    case "hoy": return [h, h];
    case "ayer": return [sumar(h, -1), sumar(h, -1)];
    case "semana": { const dow = new Date(`${h}T12:00:00Z`).getUTCDay(); return [sumar(h, -((dow + 6) % 7)), h]; }
    case "mes": return [`${y}-${pad(m)}-01`, h];
    case "mes-ant": { const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1; return [`${py}-${pad(pm)}-01`, sumar(`${y}-${pad(m)}-01`, -1)]; }
    default: return [`${y}-01-01`, h];
  }
}
const RANGOS: [string, string][] = [["hoy", "Hoy"], ["ayer", "Ayer"], ["semana", "Esta semana"], ["mes", "Este mes"], ["mes-ant", "Mes anterior"], ["anio", "Este año"]];

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
  const [grupo, setGrupo] = useState("Todos");
  const [buscarRep, setBuscarRep] = useState("");
  const [buscarFila, setBuscarFila] = useState("");
  const [sucursalId, setSucursalId] = useState("");
  const [r0, r1] = rango("mes");
  const [desde, setDesde] = useState(r0);
  const [hasta, setHasta] = useState(r1);
  const [producto, setProducto] = useState("");
  const [agrupar, setAgrupar] = useState<"dia" | "mes">("dia");
  const def = REPORTES.find((r) => r.id === rep)!;
  const params = new URLSearchParams({
    ...(sucursalId ? { sucursalId } : {}),
    ...(def.fechas ? { desde, hasta } : {}),
    ...(def.porProducto ? { agrupar, ...(producto.trim() ? { producto: producto.trim() } : {}) } : {}),
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
  const totales = cols.filter((c) => (DINERO.test(c) || c === "unidades") && filas.every((f) => f[c] === null || /^-?\d+(\.\d+)?$/.test(String(f[c]))) && !/costo_unitario|precio|promedio|limite/.test(c));

  const q = buscarFila.trim().toLowerCase();
  const visibles = q ? filas.filter((f) => cols.some((c) => formato(c, f[c]).toLowerCase().includes(q))) : filas;
  const qr = buscarRep.trim().toLowerCase();
  const lista = REPORTES.filter((r) => (grupo === "Todos" || r.grupo === grupo) && (!qr || (r.titulo + " " + r.desc).toLowerCase().includes(qr)));
  const rangoActivo = def.fechas ? RANGOS.find(([k]) => { const [a, b] = rango(k); return a === desde && b === hasta; })?.[0] : undefined;
  const elegir = (id: string) => { setRep(id); setBuscarFila(""); };

  return (
    <>
      <Encabezado titulo="Reportes" descripcion="Elija un reporte, el período y la sucursal. Se puede exportar a Excel (CSV).">
        <button className="boton" disabled={!filas.length} onClick={() => descargarCsv(ruta, `${rep}-${hasta}`)}>Exportar a Excel (CSV)</button>
      </Encabezado>
      <div className="rp">
        <aside className="rp-menu">
          <input type="search" className="rp-buscar" placeholder="Buscar reporte…" value={buscarRep} onChange={(e) => setBuscarRep(e.target.value)} aria-label="Buscar reporte" />
          <div className="rp-chips" role="tablist">
            {["Todos", ...GRUPOS].map((g) => <button key={g} className={g === grupo ? "activo" : ""} onClick={() => setGrupo(g)}>{g}</button>)}
          </div>
          <div className="rp-lista">
            {lista.map((r) => (
              <button key={r.id} className={"rp-item" + (r.id === rep ? " activo" : "")} onClick={() => elegir(r.id)}>
                <b>{r.titulo}</b>
                <span>{r.grupo}</span>
              </button>
            ))}
            {!lista.length && <p className="suave rp-vacio">Ningún reporte coincide.</p>}
          </div>
        </aside>
        <section className="rp-panel">
          <header className="rp-cabecera">
            <span className="rp-grupo">{def.grupo}</span>
            <h2>{def.titulo}</h2>
            <p className="suave">{def.desc}</p>
          </header>
          <div className="rp-filtros">
            {def.fechas && (
              <div className="rp-campo rp-periodo"><span>Período</span>
                <div className="rp-chips rp-rangos">
                  {RANGOS.map(([k, t]) => <button key={k} className={k === rangoActivo ? "activo" : ""} onClick={() => { const [a, b] = rango(k); setDesde(a); setHasta(b); }}>{t}</button>)}
                </div>
              </div>
            )}
            <label className="rp-campo"><span>Sucursal</span><SelectorSucursal valor={sucursalId} onCambio={setSucursalId} /></label>
            {def.fechas && <>
              <label className="rp-campo"><span>Desde</span><input type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} /></label>
              <label className="rp-campo"><span>Hasta</span><input type="date" value={hasta} min={desde} onChange={(e) => setHasta(e.target.value)} /></label>
            </>}
            {def.porProducto && <>
              <label className="rp-campo"><span>Producto (nombre o SKU)</span><input type="search" placeholder="Todos los productos" value={producto} onChange={(e) => setProducto(e.target.value)} /></label>
              <div className="rp-campo"><span>Agrupar por</span>
                <div className="rp-chips rp-rangos">
                  <button className={agrupar === "dia" ? "activo" : ""} onClick={() => setAgrupar("dia")}>Día</button>
                  <button className={agrupar === "mes" ? "activo" : ""} onClick={() => setAgrupar("mes")}>Mes</button>
                </div>
              </div>
            </>}
            {cargando && <span className="suave rp-cargando">Cargando…</span>}
          </div>
          <Aviso texto={error} />
          {totales.length > 0 && (
            <div className="kpis">
              {totales.slice(0, 4).map((c) => (
                <div key={c} className="kpi"><span className="suave">{etiqueta(c)}</span><b>{c === "unidades" ? num(visibles.reduce((a, f) => a + Number(f[c] ?? 0), 0), 0) : rd(visibles.reduce((a, f) => a + Number(f[c] ?? 0), 0))}</b></div>
              ))}
            </div>
          )}
          {filas.length > 0 && (
            <div className="rp-barra">
              <input type="search" placeholder="Filtrar los resultados…" value={buscarFila} onChange={(e) => setBuscarFila(e.target.value)} aria-label="Filtrar los resultados" />
              <span className="suave">{q ? `${visibles.length} de ${filas.length}` : filas.length} {filas.length === 1 ? "fila" : "filas"}</span>
            </div>
          )}
          <Tabla
            filas={visibles}
            clave={(_, i) => String(i)}
            vacio={filas.length ? "Ninguna fila coincide con el filtro" : def.fechas ? "No hay datos en este período. Pruebe con otras fechas u otra sucursal." : "No hay datos para mostrar."}
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
