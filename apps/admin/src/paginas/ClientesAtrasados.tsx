import { useState } from "react";
import { num, rd } from "../api";
import { Aviso, Encabezado, useDatos } from "../ui";

/**
 * Clientes atrasados por antigüedad: 1 a 30, 31 a 60, 61 a 90 y más de 90 días de atraso.
 * Con plan de cuotas el atraso se cuenta por cada cuota vencida; con crédito corriente, desde la fecha de cada deuda más los días de crédito del cliente.
 */
interface Fila {
  clienteId: string; cliente: string; documento: string | null; telefono: string | null; tipo: "PLAN" | "CREDITO";
  saldo: string; alDia: string; d30: string; d60: string; d90: string; dMas: string; vencido: string; diasMax: number; ultimoAbono: string | null;
}
interface Datos { filas: Fila[]; totales: { clientes: number; saldo: string; vencido: string; d30: string; d60: string; d90: string; dMas: string } }
const DESDE = [["1", "Todos los atrasados"], ["31", "Más de 30 días"], ["61", "Más de 60 días"], ["91", "Más de 90 días"]] as const;
const celda = (v: string, alerta = false) => (Number(v) ? (alerta ? <b className="texto-alerta">{rd(v)}</b> : rd(v)) : <span className="suave">—</span>);
const hoyTexto = () => new Date().toLocaleDateString("es-DO", { timeZone: "America/Santo_Domingo", day: "numeric", month: "long", year: "numeric" });

export function ClientesAtrasados() {
  const [desde, setDesde] = useState<"1" | "31" | "61" | "91">("1");
  const d = useDatos<Datos>(`/central/cxc/atrasados?desde=${desde}`, [desde]);
  const filas = d.datos?.filas ?? [];
  const t = d.datos?.totales;
  return (
    <>
      <style>{`@media print{.no-imprimir{display:none!important}}`}</style>
      <Encabezado titulo="Clientes atrasados" descripcion="Cuánto debe cada cliente atrasado, según los días que lleva sin pagar: 1 a 30, 31 a 60, 61 a 90 y más de 90.">
        <button className="boton no-imprimir" onClick={() => window.print()}>Imprimir</button>
      </Encabezado>
      <Aviso texto={d.error} />
      <div className="panel cab-compra no-imprimir">
        <label className="campo"><span>Mostrar</span>
          <select value={desde} onChange={(e) => setDesde(e.target.value as typeof desde)}>{DESDE.map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select></label>
      </div>
      <p className="suave" style={{ margin: "0 0 8px" }}>Al {hoyTexto()}</p>
      <div className="tarjeta" style={{ overflowX: "auto" }}>
        <table className="tabla">
          <thead><tr><th>Cliente</th><th>Teléfono</th><th className="der">Saldo</th><th className="der">1 a 30</th><th className="der">31 a 60</th><th className="der">61 a 90</th><th className="der">Más de 90</th><th className="der">Total vencido</th><th className="der">Días</th><th>Último abono</th></tr></thead>
          <tbody>
            {filas.length === 0 && <tr><td colSpan={10} className="suave">{d.cargando ? "Cargando…" : "No hay clientes atrasados con ese filtro."}</td></tr>}
            {filas.map((f) => (
              <tr key={f.clienteId}>
                <td><b>{f.cliente}</b>{f.documento && <span className="suave"> · {f.documento}</span>}<div className="suave">{f.tipo === "PLAN" ? "Plan de cuotas" : "Crédito"}</div></td>
                <td>{f.telefono ?? <span className="suave">—</span>}</td>
                <td className="der">{rd(f.saldo)}</td>
                <td className="der">{celda(f.d30)}</td>
                <td className="der">{celda(f.d60)}</td>
                <td className="der">{celda(f.d90, true)}</td>
                <td className="der">{celda(f.dMas, true)}</td>
                <td className="der"><b>{rd(f.vencido)}</b></td>
                <td className="der">{num(f.diasMax)}</td>
                <td>{f.ultimoAbono ? new Date(f.ultimoAbono).toLocaleDateString("es-DO", { timeZone: "America/Santo_Domingo", day: "2-digit", month: "short", year: "numeric" }) : <span className="suave">Nunca</span>}</td>
              </tr>
            ))}
          </tbody>
          {t && filas.length > 0 && (
            <tfoot><tr><td colSpan={2}><b>{num(t.clientes)} clientes</b></td><td className="der"><b>{rd(t.saldo)}</b></td><td className="der"><b>{rd(t.d30)}</b></td><td className="der"><b>{rd(t.d60)}</b></td>
              <td className="der"><b>{rd(t.d90)}</b></td><td className="der"><b>{rd(t.dMas)}</b></td><td className="der"><b>{rd(t.vencido)}</b></td><td colSpan={2} /></tr></tfoot>
          )}
        </table>
      </div>
      <p className="suave no-imprimir" style={{ margin: "8px 0 0" }}>Para gestionar el cobro use «Cobranza en ruta»; para recoger mercancía, «Mora y recuperación».</p>
    </>
  );
}
