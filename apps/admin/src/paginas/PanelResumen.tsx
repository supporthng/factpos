import { useEffect, useState } from "react";
import { num, puede, rd } from "../api";
import { useDatos } from "../ui";

/**
 * Panel del Resumen: ventas por hora, formas de pago, más vendidos, cajas abiertas y productos agotados.
 * Sigue el periodo y la sucursal elegidos en las cifras de arriba (InicioCifras los guarda y avisa con un evento).
 */
interface Panel {
  porHora: { hora: number; total: string; ventas: number }[];
  formasPago: { forma: string; monto: string }[];
  masVendidos: { nombre: string; sku: string; unidades: string; ventaNeta: string }[];
  cajasAbiertas: { id: string; caja: string; sucursal: string; cajero: string; abiertoEn: string; ventas: string }[];
  sinStock: number | null;
  porSucursal?: { id: string; nombre: string; venta: string; transacciones: string }[];
}
const leer = (k: string, def: string) => { try { return localStorage.getItem(k) ?? def; } catch { return def; } };
const NOMBRE_PAGO: Record<string, string> = { EFECTIVO: "Efectivo", TARJETA: "Tarjeta", TRANSFERENCIA: "Transferencia", CREDITO: "Crédito", CHEQUE: "Cheque" };
const COLOR_PAGO = ["var(--primario)", "#3b5bdb", "#e8a23a", "#8b5cf6", "#64748b"];
const horaTexto = (h: number) => (h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`);

export function PanelResumen({ irA }: { irA: (seccion: string) => void }) {
  const conPermiso = puede("admin.reportes");
  const [filtro, setFiltro] = useState(() => ({ periodo: leer("factpos.inicio.periodo", "hoy"), sucursal: leer("factpos.inicio.sucursal", "") }));
  useEffect(() => {
    const f = () => setFiltro({ periodo: leer("factpos.inicio.periodo", "hoy"), sucursal: leer("factpos.inicio.sucursal", "") });
    window.addEventListener("factpos:inicio-filtro", f);
    return () => window.removeEventListener("factpos:inicio-filtro", f);
  }, []);
  const { datos, error } = useDatos<Panel>(conPermiso ? `/central/resumen/panel?periodo=${filtro.periodo}${filtro.sucursal ? `&sucursalId=${filtro.sucursal}` : ""}` : null, [filtro.periodo, filtro.sucursal]);
  if (!conPermiso || error || !datos) return null;

  // Horas del día a mostrar: de 7 a 21 como mínimo, ampliadas si hay ventas fuera de ese rango
  const horas = datos.porHora.map((h) => h.hora);
  const desde = Math.min(7, ...horas), hasta = Math.max(21, ...horas);
  const porHora = new Map(datos.porHora.map((h) => [h.hora, Number(h.total)]));
  const columnas = Array.from({ length: hasta - desde + 1 }, (_, i) => ({ hora: desde + i, total: Math.max(0, porHora.get(desde + i) ?? 0) }));
  const maxHora = Math.max(1, ...columnas.map((c) => c.total));
  const mejor = columnas.reduce((m, c) => (c.total > m.total ? c : m), { hora: -1, total: 0 });
  const totalPago = datos.formasPago.reduce((a, f) => a + Number(f.monto), 0);
  const maxTop = Math.max(1, ...datos.masVendidos.map((t) => Number(t.unidades)));
  // Monto de cada forma de pago (las cuatro principales siempre, aunque estén en cero; las demás solo si hubo)
  const montoDe = new Map(datos.formasPago.map((f) => [f.forma, Number(f.monto)]));
  const formasMostrar = [...["EFECTIVO", "TARJETA", "TRANSFERENCIA", "CREDITO"], ...datos.formasPago.map((f) => f.forma).filter((f) => !["EFECTIVO", "TARJETA", "TRANSFERENCIA", "CREDITO"].includes(f))];
  const sucursales = datos.porSucursal ?? [];
  const totalSuc = sucursales.reduce((a, s) => a + Number(s.venta), 0);
  const maxSuc = Math.max(1, ...sucursales.map((s) => Number(s.venta)));

  // Anillo de formas de pago: cada tramo es un trazo con su porcentaje (circunferencia 100)
  let acum = 0;
  const tramos = datos.formasPago.map((f, i) => {
    const pct = totalPago > 0 ? (Number(f.monto) / totalPago) * 100 : 0;
    const t = { f, pct, ini: acum, color: COLOR_PAGO[i % COLOR_PAGO.length] };
    acum += pct;
    return t;
  });

  return (
    <div className="pn-panel">
      <div className="pn-fila pn-fila-a">
        <section className="pn-tarjeta" aria-label="Ventas por hora">
          <div className="pn-cab"><h2>Ventas por hora</h2>{mejor.total > 0 && <span className="suave">Hora más fuerte: <b>{horaTexto(mejor.hora)}</b></span>}</div>
          {mejor.total > 0 ? (
            <div className="pn-barras" role="img" aria-label="Ventas por hora del día">
              {columnas.map((c) => (
                <div key={c.hora} className="pn-col" title={`${horaTexto(c.hora)}: ${rd(c.total)}`}>
                  <b className={c.hora === mejor.hora ? "mejor" : ""} style={{ height: `${Math.max(c.total > 0 ? 4 : 0, (c.total / maxHora) * 100)}%` }} />
                  <span>{horaTexto(c.hora)}</span>
                </div>
              ))}
            </div>
          ) : <p className="suave pn-vacio">Todavía no hay ventas en este período.</p>}
        </section>

        <section className="pn-tarjeta" aria-label="Formas de pago">
          <div className="pn-cab"><h2>Formas de pago</h2></div>
          {totalPago > 0 ? (
            <div className="pn-pago">
              <svg width="120" height="120" viewBox="0 0 42 42" role="img" aria-label="Distribución de las formas de pago">
                <circle cx="21" cy="21" r="15.9" fill="none" stroke="var(--borde)" strokeWidth="6" />
                {tramos.map((t) => (
                  <circle key={t.f.forma} cx="21" cy="21" r="15.9" fill="none" stroke={t.color} strokeWidth="6" strokeDasharray={`${t.pct} ${100 - t.pct}`} strokeDashoffset={-t.ini} transform="rotate(-90 21 21)" />
                ))}
              </svg>
              <ul>
                {tramos.map((t) => (
                  <li key={t.f.forma}><i style={{ background: t.color }} /><span>{NOMBRE_PAGO[t.f.forma] ?? t.f.forma}</span><b>{t.pct.toFixed(0)} %</b><small className="suave">{rd(t.f.monto)}</small></li>
                ))}
              </ul>
            </div>
          ) : <p className="suave pn-vacio">Sin cobros en este período.</p>}
          <dl className="pn-montos">
            {formasMostrar.map((f) => <div key={f}><dt>{NOMBRE_PAGO[f] ?? f}</dt><dd>{rd(montoDe.get(f) ?? 0)}</dd></div>)}
            <div className="total"><dt>Total cobrado</dt><dd>{rd(totalPago)}</dd></div>
          </dl>
        </section>
      </div>

      {sucursales.length > 1 && (
        <section className="pn-tarjeta" aria-label="Comparativo por sucursal">
          <div className="pn-cab"><h2>Todas las sucursales</h2><span className="suave">Total <b>{rd(totalSuc)}</b></span></div>
          <ul className="pn-sucursales">
            {sucursales.map((s) => (
              <li key={s.id}>
                <div><b>{s.nombre}</b><span className="suave">{num(s.transacciones, 0)} ventas · {totalSuc > 0 ? ((Number(s.venta) / totalSuc) * 100).toFixed(0) : 0} % del total</span></div>
                <b>{rd(s.venta)}</b>
                <div className="pn-meter"><i style={{ width: `${(Number(s.venta) / maxSuc) * 100}%` }} /></div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="pn-fila pn-fila-b">
        <section className="pn-tarjeta" aria-label="Más vendidos">
          <div className="pn-cab"><h2>Más vendidos</h2><button className="enlace" onClick={() => irA("reportes")}>Ver todos</button></div>
          {datos.masVendidos.length ? (
            <ol className="pn-top">
              {datos.masVendidos.map((t, i) => (
                <li key={t.sku + i}>
                  <div><span>{i + 1} · {t.nombre}</span><b>{num(t.unidades, Number(t.unidades) % 1 ? 1 : 0)} u</b></div>
                  <div className="pn-meter"><i style={{ width: `${(Number(t.unidades) / maxTop) * 100}%` }} /></div>
                </li>
              ))}
            </ol>
          ) : <p className="suave pn-vacio">Sin ventas en este período.</p>}
        </section>

        <section className="pn-tarjeta" aria-label="Cajas abiertas">
          <div className="pn-cab"><h2>Cajas abiertas</h2><button className="enlace" onClick={() => irA("reportes")}>Ver cierres</button></div>
          {datos.cajasAbiertas.length ? (
            <ul className="pn-cajas">
              {datos.cajasAbiertas.map((c) => (
                <li key={c.id}>
                  <i className="pn-punto" />
                  <div><b>{c.caja}</b><span className="suave">Desde {new Date(c.abiertoEn).toLocaleTimeString("es-DO", { hour: "numeric", minute: "2-digit" })} · {c.cajero}</span></div>
                  <b>{rd(c.ventas)}</b>
                </li>
              ))}
            </ul>
          ) : <p className="suave pn-vacio">No hay cajas abiertas ahora.</p>}
        </section>

        <section className="pn-tarjeta pn-agotados" aria-label="Productos agotados">
          <div className="pn-cab"><h2>Productos agotados</h2></div>
          <b className={"pn-cifra" + (datos.sinStock ? " alerta" : "")}>{datos.sinStock == null ? "—" : num(datos.sinStock, 0)}</b>
          <span className="suave">{datos.sinStock == null ? "Se muestra cuando el servidor tenga la versión nueva." : datos.sinStock ? "Con existencia 0 o menos en el almacén principal" : "Nada agotado"}</span>
          {!!datos.sinStock && <button className="enlace" onClick={() => irA("reportes")}>Ver Productos sin stock</button>}
        </section>
      </div>
    </div>
  );
}
