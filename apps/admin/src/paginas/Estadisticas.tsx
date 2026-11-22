import { useState } from "react";
import { hoy, num, puede, rd } from "../api";
import { Aviso, Encabezado, useDatos } from "../ui";
import { SelectorPeriodo, rangoPeriodo } from "../periodos";

/**
 * Estadísticas: cómo va el negocio, comparado con lo normal, y qué merece atención.
 * Pestañas: Resumen (hoy contra el mismo día de la semana pasada), Ventas (cualquier período contra el anterior), Productos y Clientes y cobros.
 * Cada cifra sale de las facturas reales; las notas de crédito restan.
 */
interface KpiPar<T = number> { hoy: T; antes: T }
interface Resumen {
  fecha: { f: string; hora: string };
  kpis: { venta: KpiPar; facturas: KpiPar; ticket: KpiPar; margen: KpiPar<number | null> };
  porHora: { hora: number; hoy: number; antes: number }[];
  porSucursal: { id: string; nombre: string; venta: number }[];
  formasPago: { forma: string; monto: number }[];
  masVendidos: { nombre: string; sku: string; unidades: number; venta: number }[];
  hallazgos: { tono: "grave" | "aviso"; titulo: string; detalle: string; ir: string; accion: string }[];
}
interface Ventas {
  desde: string; hasta: string; dias: number;
  total: { venta: number; facturas: number; ticket: number };
  anterior: { venta: number; facturas: number };
  serie: { fecha: string; venta: number; facturas: number }[];
  porDiaSemana: { dia: number; promedio: number; dias: number }[];
  porCajero: { nombre: string; venta: number; facturas: number }[];
  porSucursal: { nombre: string; venta: number; facturas: number }[];
  formasPago: { forma: string; monto: number }[];
}

interface FilaProducto { nombre: string; sku: string; unidades: number; venta: number; utilidad: number; margen: number | null }
interface Productos {
  desde: string; hasta: string;
  resumen: { productos: number; unidades: number; venta: number; utilidad: number; margen: number | null };
  masVendidos: FilaProducto[];
  pocoMargen: FilaProducto[];
  porCategoria: { nombre: string; venta: number; utilidad: number; margen: number | null }[];
  abc: { clase: string; productos: number; venta: number }[];
  stockMuerto: { nombre: string; sku: string; existencia: number; valor: number; dias: number | null }[];
}

const NOMBRE_PAGO: Record<string, string> = { EFECTIVO: "Efectivo", TARJETA: "Tarjeta", TRANSFERENCIA: "Transferencia", CREDITO: "Crédito", CHEQUE: "Cheque" };
const COLOR_PAGO = ["#1d4ed8", "#0e7490", "#c2570c", "#64748b", "#7c3aed"];
const DIAS = ["", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const horaTexto = (h: number) => (h === 0 ? "12 a. m." : h < 12 ? `${h} a. m.` : h === 12 ? "12 p. m." : `${h - 12} p. m.`);
const fechaCorta = (f: string) => new Date(`${f}T12:00:00`).toLocaleDateString("es-DO", { day: "numeric", month: "short" });
const ir = (seccion: string) => { location.hash = seccion; };

/** Cambio contra el período de comparación: flecha y porcentaje (en puntos si la cifra ya es un porcentaje). */
function Delta({ ahora, antes, puntos, bueno = "sube", fmt }: { ahora: number | null; antes: number | null; puntos?: boolean; bueno?: "sube" | "baja"; fmt?: (v: number) => string }) {
  if (ahora === null || antes === null) return <span className="es-delta suave">Sin datos para comparar</span>;
  const dif = puntos ? ahora - antes : antes === 0 ? null : ((ahora - antes) / antes) * 100;
  const ref = <span className="suave"> vs {fmt ? fmt(antes) : num(antes)}</span>;
  if (dif === null) return <span className="es-delta suave">Sin ventas con qué comparar</span>;
  if (Math.abs(dif) < 0.05) return <span className="es-delta suave">Igual{ref}</span>;
  const sube = dif > 0, mejor = (bueno === "sube") === sube;
  return <span className={"es-delta " + (mejor ? "bien" : "mal")}><span aria-hidden="true">{sube ? "▲" : "▼"}</span> {num(Math.abs(dif), 1)} {puntos ? "pts" : "%"}{ref}</span>;
}

function Tarjeta({ titulo, valor, children }: { titulo: string; valor: string; children: React.ReactNode }) {
  return <div className="es-kpi"><span className="suave">{titulo}</span><b>{valor}</b>{children}</div>;
}

/** Barras con una línea de comparación opcional. Los valores van en el mismo orden que las etiquetas. */
function Barras({ etiquetas, valores, linea, resaltar, titulo, alto = 220 }: { etiquetas: string[]; valores: number[]; linea?: number[]; resaltar?: number; titulo: string; alto?: number }) {
  const W = 700, base = alto - 36, max = Math.max(1, ...valores, ...(linea ?? [])), paso = W / Math.max(1, valores.length);
  const ancho = Math.min(32, paso * 0.66), y = (v: number) => base - (Math.max(0, v) / max) * (base - 14);
  const cada = Math.ceil(valores.length / 16);
  return (
    <svg viewBox={`0 0 ${W} ${alto}`} width="100%" role="img" aria-label={titulo} className="es-svg">
      {[0, 0.25, 0.5, 0.75, 1].map((t) => <line key={t} x1="0" x2={W} y1={y(max * t)} y2={y(max * t)} className="es-rejilla" />)}
      {valores.map((v, i) => (
        <rect key={i} x={i * paso + (paso - ancho) / 2} y={y(v)} width={ancho} height={Math.max(0, base - y(v))} rx="3" className={i === resaltar ? "es-barra mejor" : "es-barra"}><title>{`${etiquetas[i]}: ${rd(v)}`}</title></rect>
      ))}
      {linea && <polyline points={linea.map((v, i) => `${i * paso + paso / 2},${y(v)}`).join(" ")} className="es-linea" />}
      {etiquetas.map((e, i) => (i % cada === 0 ? <text key={i} x={i * paso + paso / 2} y={base + 18} textAnchor="middle" className="es-eje">{e}</text> : null))}
    </svg>
  );
}

function FormasPago({ formas }: { formas: { forma: string; monto: number }[] }) {
  const total = formas.reduce((a, f) => a + f.monto, 0);
  if (total <= 0) return <p className="suave">Sin cobros en este período.</p>;
  return (
    <>
      <div className="es-apilada" role="img" aria-label="Reparto por forma de pago">
        {formas.map((f, i) => <span key={f.forma} style={{ width: `${(f.monto / total) * 100}%`, background: COLOR_PAGO[i % COLOR_PAGO.length] }} title={`${NOMBRE_PAGO[f.forma] ?? f.forma}: ${rd(f.monto)}`} />)}
      </div>
      <ul className="es-leyenda">
        {formas.map((f, i) => (
          <li key={f.forma}><i style={{ background: COLOR_PAGO[i % COLOR_PAGO.length] }} />{NOMBRE_PAGO[f.forma] ?? f.forma}<span className="suave">{rd(f.monto)}</span><b>{num((f.monto / total) * 100)} %</b></li>
        ))}
      </ul>
    </>
  );
}

function PorNombre({ filas, vacio }: { filas: { nombre: string; venta: number; facturas?: number }[]; vacio: string }) {
  const total = filas.reduce((a, f) => a + f.venta, 0), max = Math.max(1, ...filas.map((f) => f.venta));
  if (!filas.length) return <p className="suave">{vacio}</p>;
  return (
    <div className="es-lista">
      {filas.map((f) => (
        <div key={f.nombre}>
          <div className="es-fila"><b>{f.nombre}</b><span>{rd(f.venta)} <span className="suave">· {total > 0 ? num((f.venta / total) * 100) : 0} %{f.facturas !== undefined ? ` · ${num(f.facturas)} fact.` : ""}</span></span></div>
          <div className="es-pista"><span style={{ width: `${Math.max(0, (f.venta / max) * 100)}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

function PestanaResumen({ sucursalId }: { sucursalId: string }) {
  const { datos: d, error } = useDatos<Resumen>(`/central/estadisticas/resumen${sucursalId ? `?sucursalId=${sucursalId}` : ""}`, [sucursalId]);
  if (error) return <Aviso texto={error} />;
  if (!d) return <p className="suave">Cargando…</p>;
  const horas = d.porHora.filter((h) => h.hoy || h.antes).map((h) => h.hora);
  const desde = Math.min(8, ...horas), hasta = Math.max(21, ...horas);
  const cols = d.porHora.filter((h) => h.hora >= desde && h.hora <= hasta);
  const pico = cols.reduce((m, c) => (c.hoy > m.hoy ? c : m), { hora: -1, hoy: 0, antes: 0 });
  const k = d.kpis;
  return (
    <>
      <div className="es-kpis">
        <Tarjeta titulo="Ventas de hoy" valor={rd(k.venta.hoy)}><Delta ahora={k.venta.hoy} antes={k.venta.antes} fmt={rd} /></Tarjeta>
        <Tarjeta titulo="Facturas" valor={num(k.facturas.hoy)}><Delta ahora={k.facturas.hoy} antes={k.facturas.antes} /></Tarjeta>
        <Tarjeta titulo="Ticket promedio" valor={rd(k.ticket.hoy)}><Delta ahora={k.ticket.hoy} antes={k.ticket.antes} fmt={rd} /></Tarjeta>
        <Tarjeta titulo="Margen bruto" valor={k.margen.hoy === null ? "—" : `${num(k.margen.hoy, 1)} %`}><Delta ahora={k.margen.hoy} antes={k.margen.antes} puntos fmt={(v) => `${num(v, 1)} %`} /></Tarjeta>
      </div>
      <p className="suave es-nota">Comparado con el mismo día de la semana pasada, hasta las {d.fecha.hora}.</p>

      <div className="es-dos">
        <section className="pn-tarjeta">
          <div className="pn-cab"><h2>Ventas por hora</h2>{pico.hoy > 0 && <span className="suave">Hora pico: {horaTexto(pico.hora)} · {rd(pico.hoy)}</span>}</div>
          <div className="es-leyenda-linea"><span><i className="cuadro" />Hoy</span><span><i className="raya" />Semana pasada</span></div>
          <Barras titulo="Ventas por hora de hoy comparadas con la semana pasada" etiquetas={cols.map((c) => String(c.hora))} valores={cols.map((c) => c.hoy)} linea={cols.map((c) => c.antes)} resaltar={cols.findIndex((c) => c.hora === pico.hora)} alto={260} />
        </section>
        <section className="pn-tarjeta">
          <div className="pn-cab"><h2>Merece atención</h2>{d.hallazgos.length > 0 && <span className="pastilla con_diferencia">{d.hallazgos.length}</span>}</div>
          {d.hallazgos.length === 0 ? <p className="suave">Sin hallazgos hoy: ningún producto bajo el costo, anulaciones normales y sucursales al día.</p> : (
            <ul className="es-hallazgos">
              {d.hallazgos.map((h, i) => (
                <li key={i} className={h.tono}>
                  <div><b>{h.titulo}</b><span className="suave">{h.detalle}</span></div>
                  <button className="secundario" onClick={() => ir(h.ir)}>{h.accion}</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="es-dos">
        <section className="pn-tarjeta"><h2>Por sucursal</h2><PorNombre filas={d.porSucursal.map((s) => ({ nombre: s.nombre, venta: s.venta }))} vacio="Sin ventas hoy." /></section>
        <section className="pn-tarjeta"><h2>Formas de pago</h2><FormasPago formas={d.formasPago} /></section>
      </div>

      <section className="pn-tarjeta">
        <div className="pn-cab"><h2>Lo más vendido hoy</h2><button className="enlace" onClick={() => ir("reportes")}>Ver todo</button></div>
        {d.masVendidos.length === 0 ? <p className="suave">Todavía no hay ventas hoy.</p> : (
          <table className="es-tabla">
            <thead><tr><th>Producto</th><th className="der">Unid.</th><th className="der">Venta</th></tr></thead>
            <tbody>{d.masVendidos.map((p) => <tr key={p.sku}><td>{p.nombre}</td><td className="der">{num(p.unidades)}</td><td className="der"><b>{rd(p.venta)}</b></td></tr>)}</tbody>
          </table>
        )}
      </section>
    </>
  );
}

const pct = (v: number | null) => (v === null ? "—" : `${num(v, 1)} %`);

function TablaProductos({ filas, vacio }: { filas: FilaProducto[]; vacio: string }) {
  if (!filas.length) return <p className="suave">{vacio}</p>;
  return (
    <table className="es-tabla">
      <thead><tr><th>Producto</th><th className="der">Unid.</th><th className="der">Venta</th><th className="der">Margen</th></tr></thead>
      <tbody>{filas.map((p) => <tr key={p.sku}><td>{p.nombre}</td><td className="der">{num(p.unidades)}</td><td className="der"><b>{rd(p.venta)}</b></td><td className={"der " + (p.utilidad < 0 ? "texto-alerta" : "")}>{pct(p.margen)}</td></tr>)}</tbody>
    </table>
  );
}

function SelectorRango({ desde, hasta, setRango }: { desde: string; hasta: string; setRango: (r: [string, string]) => void }) {
  const [maxFecha] = useState(hoy);
  return (
    <div className="es-filtros">
      <SelectorPeriodo desde={desde} hasta={hasta} onCambio={(a, b) => setRango([a, b])} />
      <label>Desde <input type="date" value={desde} max={maxFecha} onChange={(e) => setRango([e.target.value, hasta])} /></label>
      <label>Hasta <input type="date" value={hasta} max={maxFecha} onChange={(e) => setRango([desde, e.target.value])} /></label>
    </div>
  );
}

function PestanaProductos({ sucursalId }: { sucursalId: string }) {
  const [[desde, hasta], setRango] = useState<[string, string]>(() => rangoPeriodo("ult30"));
  const { datos: d, error } = useDatos<Productos>(desde && hasta && desde <= hasta ? `/central/estadisticas/productos?desde=${desde}&hasta=${hasta}${sucursalId ? `&sucursalId=${sucursalId}` : ""}` : null, [desde, hasta, sucursalId]);
  const totalAbc = d?.abc.reduce((a, x) => a + x.venta, 0) ?? 0;
  const valorMuerto = d?.stockMuerto.reduce((a, x) => a + x.valor, 0) ?? 0;
  return (
    <>
      <SelectorRango desde={desde} hasta={hasta} setRango={setRango} />
      <Aviso texto={error} />
      {!d ? (error ? null : <p className="suave">Cargando…</p>) : (
        <>
          <div className="es-kpis">
            <Tarjeta titulo="Productos vendidos" valor={num(d.resumen.productos)}><span className="es-delta suave">{num(d.resumen.unidades)} unidades</span></Tarjeta>
            <Tarjeta titulo="Venta sin ITBIS" valor={rd(d.resumen.venta)}><span className="es-delta suave">Del período elegido</span></Tarjeta>
            <Tarjeta titulo="Utilidad" valor={rd(d.resumen.utilidad)}><span className="es-delta suave">Venta menos costo</span></Tarjeta>
            <Tarjeta titulo="Margen bruto" valor={pct(d.resumen.margen)}><span className="es-delta suave">Utilidad sobre venta</span></Tarjeta>
          </div>
          <div className="es-dos">
            <section className="pn-tarjeta"><h2>Los 10 que más venden</h2><TablaProductos filas={d.masVendidos} vacio="No hay ventas en este período." /></section>
            <section className="pn-tarjeta">
              <h2>Dejan poco margen</h2>
              <p className="suave es-nota">Vendidos (5 unidades o más) con margen menor de 5 % o con pérdida.</p>
              <TablaProductos filas={d.pocoMargen} vacio="Ninguno: todo lo que se vendió deja más de 5 %." />
            </section>
          </div>
          <div className="es-dos">
            <section className="pn-tarjeta">
              <h2>Por categoría</h2>
              {d.porCategoria.length === 0 ? <p className="suave">Sin ventas.</p> : (
                <table className="es-tabla">
                  <thead><tr><th>Categoría</th><th className="der">Venta</th><th className="der">Utilidad</th><th className="der">Margen</th></tr></thead>
                  <tbody>{d.porCategoria.map((c) => <tr key={c.nombre}><td>{c.nombre}</td><td className="der">{rd(c.venta)}</td><td className="der">{rd(c.utilidad)}</td><td className="der"><b>{pct(c.margen)}</b></td></tr>)}</tbody>
                </table>
              )}
            </section>
            <section className="pn-tarjeta">
              <h2>Clasificación ABC (últimos 90 días)</h2>
              <p className="suave es-nota">A: el 80 % de la venta · B: el siguiente 15 % · C: el resto.</p>
              {d.abc.length === 0 ? <p className="suave">Todavía no hay ventas suficientes.</p> : (
                <div className="es-lista">
                  {d.abc.map((a) => (
                    <div key={a.clase}>
                      <div className="es-fila"><b>Clase {a.clase}</b><span>{num(a.productos)} producto(s) <span className="suave">· {totalAbc > 0 ? num((a.venta / totalAbc) * 100) : 0} % de la venta</span></span></div>
                      <div className="es-pista"><span style={{ width: `${totalAbc > 0 ? (a.venta / totalAbc) * 100 : 0}%` }} /></div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
          <section className="pn-tarjeta">
            <div className="pn-cab"><h2>Dinero parado: sin venderse en más de 60 días</h2>{valorMuerto > 0 && <span className="suave">{rd(valorMuerto)} al costo (los 8 mayores)</span>}</div>
            {d.stockMuerto.length === 0 ? <p className="suave">No hay existencias paradas.</p> : (
              <table className="es-tabla">
                <thead><tr><th>Producto</th><th className="der">Existencia</th><th className="der">Sin venderse</th><th className="der">Valor al costo</th></tr></thead>
                <tbody>{d.stockMuerto.map((m) => <tr key={m.sku}><td>{m.nombre}</td><td className="der">{num(m.existencia, 0)}</td><td className="der">{m.dias === null ? "Nunca se ha vendido" : `${num(m.dias)} días`}</td><td className="der"><b>{rd(m.valor)}</b></td></tr>)}</tbody>
              </table>
            )}
          </section>
        </>
      )}
    </>
  );
}

interface ClientesCobros {
  desde: string; hasta: string;
  deuda: { clientes: number; saldo: number; alDia: number; vencido30: number; vencido60: number; vencidoMas: number; enMora: number };
  cobros: { recibos: number; total: number; iniciales: number; abonos: number };
  formasCobro: { forma: string; monto: number }[];
  deudores: { nombre: string; telefono: string | null; saldo: number; vencido: number; diasDeuda: number; ultimoAbono: string | null }[];
  compradores: { nombre: string; venta: number; facturas: number }[];
  gestiones: { resultado: string; n: number }[];
}
const RESULTADO_GESTION: Record<string, string> = { PROMESA: "Prometieron pagar", PAGO: "Pagaron", NO_LOCALIZADO: "No localizados", SIN_PAGO: "Sin pago", OTRO: "Otro" };
const FORMA_COBRO: Record<string, string> = { EFECTIVO: "Efectivo", TARJETA: "Tarjeta", TRANSFERENCIA: "Transferencia", MIXTO: "Mixto" };

function PestanaClientes({ sucursalId }: { sucursalId: string }) {
  const [[desde, hasta], setRango] = useState<[string, string]>(() => rangoPeriodo("ult30"));
  const { datos: d, error } = useDatos<ClientesCobros>(desde && hasta && desde <= hasta ? `/central/estadisticas/clientes?desde=${desde}&hasta=${hasta}${sucursalId ? `&sucursalId=${sucursalId}` : ""}` : null, [desde, hasta, sucursalId]);
  const vencidoTotal = d ? d.deuda.vencido30 + d.deuda.vencido60 + d.deuda.vencidoMas : 0;
  const tramos = d ? [["Al día", d.deuda.alDia], ["Vencido hasta 30 días", d.deuda.vencido30], ["Vencido 31 a 60 días", d.deuda.vencido60], ["Vencido más de 60 días", d.deuda.vencidoMas]] as const : [];
  return (
    <>
      <SelectorRango desde={desde} hasta={hasta} setRango={setRango} />
      <Aviso texto={error} />
      {!d ? (error ? null : <p className="suave">Cargando…</p>) : (
        <>
          <div className="es-kpis">
            <Tarjeta titulo="Por cobrar" valor={rd(d.deuda.saldo)}><span className="es-delta suave">{num(d.deuda.clientes)} clientes con saldo</span></Tarjeta>
            <Tarjeta titulo="Vencido" valor={rd(vencidoTotal)}><span className="es-delta suave">{num(d.deuda.enMora)} clientes atrasados · {d.deuda.saldo > 0 ? num((vencidoTotal / d.deuda.saldo) * 100) : 0} % de lo que se debe</span></Tarjeta>
            <Tarjeta titulo="Cobrado en el período" valor={rd(d.cobros.total)}><span className="es-delta suave">{num(d.cobros.recibos)} recibos · iniciales {rd(d.cobros.iniciales)} · abonos {rd(d.cobros.abonos)}</span></Tarjeta>
            <Tarjeta titulo="Gestiones de cobranza" valor={num(d.gestiones.reduce((a, g) => a + g.n, 0))}><span className="es-delta suave">Llamadas, visitas y mensajes del período</span></Tarjeta>
          </div>
          <div className="es-dos">
            <section className="pn-tarjeta">
              <h2>Qué tan atrasado está lo que se debe</h2>
              <p className="suave es-nota">Por la antigüedad de cada deuda contra los días de crédito del cliente. Es la situación de hoy.</p>
              {d.deuda.saldo <= 0 ? <p className="suave">Nadie debe nada.</p> : (
                <div className="es-lista">
                  {tramos.map(([t, v]) => (
                    <div key={t}>
                      <div className="es-fila"><b>{t}</b><span>{rd(v)} <span className="suave">· {num((v / d.deuda.saldo) * 100)} %</span></span></div>
                      <div className="es-pista"><span style={{ width: `${(v / d.deuda.saldo) * 100}%` }} /></div>
                    </div>
                  ))}
                </div>
              )}
            </section>
            <section className="pn-tarjeta">
              <h2>Cómo cobraron</h2>
              {d.formasCobro.length === 0 ? <p className="suave">No hubo cobros de crédito en este período.</p> : (
                <table className="es-tabla">
                  <thead><tr><th>Forma</th><th className="der">Monto</th></tr></thead>
                  <tbody>{d.formasCobro.map((f) => <tr key={f.forma}><td>{FORMA_COBRO[f.forma] ?? f.forma}</td><td className="der">{rd(f.monto)}</td></tr>)}</tbody>
                </table>
              )}
              {d.gestiones.length > 0 && <>
                <h2 style={{ marginTop: 14 }}>Resultado de las gestiones</h2>
                <table className="es-tabla">
                  <tbody>{d.gestiones.map((g) => <tr key={g.resultado}><td>{RESULTADO_GESTION[g.resultado] ?? g.resultado}</td><td className="der">{num(g.n)}</td></tr>)}</tbody>
                </table></>}
            </section>
          </div>
          <div className="es-dos">
            <section className="pn-tarjeta">
              <h2>Los que más deben</h2>
              <p className="suave es-nota">Primero los más atrasados.</p>
              {d.deudores.length === 0 ? <p className="suave">Nadie con saldo.</p> : (
                <table className="es-tabla">
                  <thead><tr><th>Cliente</th><th className="der">Saldo</th><th className="der">Vencido</th><th className="der">Último abono</th></tr></thead>
                  <tbody>{d.deudores.map((c) => (
                    <tr key={c.nombre + c.saldo}><td>{c.nombre}{c.telefono && <div className="suave">{c.telefono}</div>}</td><td className="der">{rd(c.saldo)}</td><td className="der"><b>{c.vencido > 0 ? rd(c.vencido) : "—"}</b></td>
                      <td className="der">{c.ultimoAbono ? new Date(c.ultimoAbono).toLocaleDateString("es-DO", { timeZone: "America/Santo_Domingo", day: "2-digit", month: "short" }) : <span className="suave">Nunca</span>}</td></tr>
                  ))}</tbody>
                </table>
              )}
            </section>
            <section className="pn-tarjeta">
              <h2>Los que más compran</h2>
              <p className="suave es-nota">Venta sin ITBIS en el período, restando notas de crédito.</p>
              {d.compradores.length === 0 ? <p className="suave">No hay ventas a clientes registrados en este período.</p> : (
                <table className="es-tabla">
                  <thead><tr><th>Cliente</th><th className="der">Facturas</th><th className="der">Venta</th></tr></thead>
                  <tbody>{d.compradores.map((c) => <tr key={c.nombre}><td>{c.nombre}</td><td className="der">{num(c.facturas)}</td><td className="der"><b>{rd(c.venta)}</b></td></tr>)}</tbody>
                </table>
              )}
            </section>
          </div>
        </>
      )}
    </>
  );
}

function PestanaVentas({ sucursalId }: { sucursalId: string }) {
  const [[desde, hasta], setRango] = useState<[string, string]>(() => rangoPeriodo("ult30"));
  const { datos: d, error } = useDatos<Ventas>(desde && hasta && desde <= hasta ? `/central/estadisticas/ventas?desde=${desde}&hasta=${hasta}${sucursalId ? `&sucursalId=${sucursalId}` : ""}` : null, [desde, hasta, sucursalId]);
  const mejorDia = d?.serie.reduce((m, s) => (s.venta > m.venta ? s : m), { fecha: "", venta: 0, facturas: 0 });
  return (
    <>
      <SelectorRango desde={desde} hasta={hasta} setRango={setRango} />
      <Aviso texto={error} />
      {!d ? (error ? null : <p className="suave">Cargando…</p>) : (
        <>
          <div className="es-kpis es-kpis-3">
            <Tarjeta titulo="Ventas del período" valor={rd(d.total.venta)}><Delta ahora={d.total.venta} antes={d.anterior.venta} fmt={rd} /></Tarjeta>
            <Tarjeta titulo="Facturas" valor={num(d.total.facturas)}><Delta ahora={d.total.facturas} antes={d.anterior.facturas} /></Tarjeta>
            <Tarjeta titulo="Ticket promedio" valor={rd(d.total.ticket)}><Delta ahora={d.total.ticket} antes={d.anterior.facturas ? d.anterior.venta / d.anterior.facturas : null} fmt={rd} /></Tarjeta>
          </div>
          <p className="suave es-nota">Comparado con los {d.dias} día(s) anteriores ({fechaCorta(new Date(Date.parse(d.desde) - d.dias * 86400e3).toISOString().slice(0, 10))} al {fechaCorta(new Date(Date.parse(d.desde) - 86400e3).toISOString().slice(0, 10))}).</p>
          <section className="pn-tarjeta">
            <div className="pn-cab"><h2>Ventas por día</h2>{mejorDia && mejorDia.venta > 0 && <span className="suave">Mejor día: {fechaCorta(mejorDia.fecha)} · {rd(mejorDia.venta)}</span>}</div>
            {d.serie.length === 0 ? <p className="suave">No hay ventas en este período.</p> : (
              <Barras titulo="Ventas por día" etiquetas={d.serie.map((s) => fechaCorta(s.fecha))} valores={d.serie.map((s) => s.venta)} resaltar={d.serie.findIndex((s) => s.fecha === mejorDia?.fecha)} alto={240} />
            )}
          </section>
          <div className="es-dos">
            <section className="pn-tarjeta">
              <h2>Venta promedio por día de la semana</h2>
              <PorNombre filas={d.porDiaSemana.map((s) => ({ nombre: DIAS[s.dia], venta: s.promedio }))} vacio="Sin datos." />
            </section>
            <section className="pn-tarjeta"><h2>Formas de pago</h2><FormasPago formas={d.formasPago} /></section>
          </div>
          <div className="es-dos">
            <section className="pn-tarjeta"><h2>Por sucursal</h2><PorNombre filas={d.porSucursal} vacio="Sin ventas." /></section>
            <section className="pn-tarjeta"><h2>Por cajero</h2><PorNombre filas={d.porCajero} vacio="Sin ventas." /></section>
          </div>
        </>
      )}
    </>
  );
}

export function Estadisticas() {
  const [pestana, setPestana] = useState<"resumen" | "ventas" | "productos" | "clientes">("resumen");
  const [sucursalId, setSucursalId] = useState("");
  const { datos: sucs } = useDatos<{ sucursal_id: string; sucursal: string }[]>(puede("admin.reportes") ? "/central/sucursales" : null);
  const hoyTexto = new Date().toLocaleDateString("es-DO", { weekday: "long", day: "numeric", month: "long" });
  return (
    <>
      <Encabezado titulo="Estadísticas" descripcion={`Hoy, ${hoyTexto}`}>
        {(sucs?.length ?? 0) > 1 && (
          <select value={sucursalId} onChange={(e) => setSucursalId(e.target.value)} aria-label="Sucursal">
            <option value="">Todas las sucursales ({sucs!.length})</option>
            {sucs!.map((s) => <option key={s.sucursal_id} value={s.sucursal_id}>{s.sucursal}</option>)}
          </select>
        )}
      </Encabezado>
      <div className="pestanas" role="tablist">
        <button role="tab" aria-selected={pestana === "resumen"} className={pestana === "resumen" ? "activa" : ""} onClick={() => setPestana("resumen")}>Resumen</button>
        <button role="tab" aria-selected={pestana === "ventas"} className={pestana === "ventas" ? "activa" : ""} onClick={() => setPestana("ventas")}>Ventas</button>
        <button role="tab" aria-selected={pestana === "productos"} className={pestana === "productos" ? "activa" : ""} onClick={() => setPestana("productos")}>Productos</button>
        <button role="tab" aria-selected={pestana === "clientes"} className={pestana === "clientes" ? "activa" : ""} onClick={() => setPestana("clientes")}>Clientes y cobros</button>
      </div>
      {pestana === "resumen" ? <PestanaResumen sucursalId={sucursalId} /> : pestana === "ventas" ? <PestanaVentas sucursalId={sucursalId} /> : pestana === "clientes" ? <PestanaClientes sucursalId={sucursalId} /> : <PestanaProductos sucursalId={sucursalId} />}
    </>
  );
}
