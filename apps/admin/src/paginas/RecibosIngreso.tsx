import { useState } from "react";
import { api, num, rd } from "../api";
import { Aviso, Encabezado, useDatos } from "../ui";

/**
 * Recibos de ingreso: todo el dinero que entra por cobro de crédito (la inicial de una venta a plazos y los abonos),
 * con su número por sucursal, el saldo antes y después. Se puede buscar y reimprimir.
 */
interface Recibo {
  id: string; recibo: string; tipo: "INICIAL" | "ABONO"; monto: string; formaPago: string; referencia: string | null; saldoAnterior: string; saldoNuevo: string;
  aplicaciones: { ventaId: string | null; factura: number | null; documento: string | null; aplicado: string; concepto?: string }[];
  fecha: string; sucursal: string; clienteId: string; cliente: string; documento: string | null; cajero: string | null; empresa?: { nombre: string; rnc: string } | null;
}
const FORMA: Record<string, string> = { EFECTIVO: "Efectivo", TARJETA: "Tarjeta", TRANSFERENCIA: "Transferencia", MIXTO: "Mixto" };
const fechaHora = (iso: string) => new Date(iso).toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

export function RecibosIngreso() {
  const [q, setQ] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const params = new URLSearchParams({ ...(q.trim() ? { q: q.trim() } : {}), ...(desde ? { desde } : {}), ...(hasta ? { hasta } : {}) }).toString();
  const lista = useDatos<Recibo[]>(`/central/cxc/recibos-ingreso${params ? `?${params}` : ""}`, [params]);
  const [ver, setVer] = useState<Recibo | null>(null);
  const [msg, setMsg] = useState("");
  const abrir = async (id: string) => {
    try { setVer(await api<Recibo>(`/central/cxc/recibos-ingreso/${id}`)); setMsg(""); } catch (e) { setMsg((e as Error).message); }
  };
  const filas = lista.datos ?? [];
  const total = filas.reduce((a, r) => a + Number(r.monto), 0);

  return (
    <>
      <Encabezado titulo="Recibos de ingreso" descripcion="El recibo numerado de cada inicial y cada abono de crédito. Búsquelo por número, cliente o cédula y reimprímalo." />
      <Aviso texto={msg || lista.error} />
      <div className="panel cab-compra no-imprimir">
        <label className="campo"><span>Número, cliente o cédula</span><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="REC-001-000012, Juan…" /></label>
        <label className="campo"><span>Desde</span><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
        <label className="campo"><span>Hasta</span><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
      </div>

      <div className="tarjeta no-imprimir" style={{ overflowX: "auto" }}>
        <table className="tabla">
          <thead><tr><th>Recibo</th><th>Fecha</th><th>Cliente</th><th>Concepto</th><th>Forma</th><th className="der">Monto</th><th className="der">Saldo después</th><th /></tr></thead>
          <tbody>
            {filas.length === 0 && <tr><td colSpan={8} className="suave">{lista.cargando ? "Cargando…" : "No hay recibos con ese filtro."}</td></tr>}
            {filas.map((r) => (
              <tr key={r.id} style={ver?.id === r.id ? { background: "var(--fondo-suave, #eef4ff)" } : undefined}>
                <td><b>{r.recibo}</b></td>
                <td>{fechaHora(r.fecha)}</td>
                <td>{r.cliente}{r.documento && <span className="suave"> · {r.documento}</span>}</td>
                <td>{r.tipo === "INICIAL" ? "Inicial de venta a plazos" : "Abono"}</td>
                <td>{FORMA[r.formaPago] ?? r.formaPago}</td>
                <td className="der"><b>{rd(r.monto)}</b></td>
                <td className="der">{rd(r.saldoNuevo)}</td>
                <td className="der"><button className="boton chico" onClick={() => abrir(r.id)}>Ver / reimprimir</button></td>
              </tr>
            ))}
          </tbody>
          {filas.length > 0 && <tfoot><tr><td colSpan={5} className="der suave">{num(filas.length)} recibos</td><td className="der"><b>{rd(total)}</b></td><td colSpan={2} /></tr></tfoot>}
        </table>
      </div>

      {ver && (
        <div className="tarjeta" style={{ marginTop: 14, maxWidth: 520 }}>
          <div style={{ textAlign: "center" }}>
            <b style={{ fontSize: "1.2em" }}>{ver.empresa?.nombre ?? ""}</b>
            {ver.empresa?.rnc && <div className="suave">RNC {ver.empresa.rnc}</div>}
            <div style={{ margin: "8px 0 2px" }}><b>RECIBO DE INGRESO</b></div>
            <div>No. {ver.recibo}</div>
          </div>
          <hr />
          <p style={{ margin: "4px 0" }}><span className="suave">Fecha:</span> {fechaHora(ver.fecha)} · {ver.sucursal}</p>
          <p style={{ margin: "4px 0" }}><span className="suave">Recibimos de:</span> <b>{ver.cliente}</b>{ver.documento && ` · ${ver.documento}`}</p>
          <p style={{ margin: "4px 0" }}><span className="suave">Concepto:</span> {ver.tipo === "INICIAL" ? "Inicial de venta a plazos" : "Abono a su cuenta"}</p>
          {ver.aplicaciones.length > 0 && <ul style={{ margin: "4px 0 8px 18px", padding: 0 }}>{ver.aplicaciones.map((a, i) => (
            <li key={i}>{a.concepto ? `${a.concepto} · ` : ""}{a.documento ?? (a.factura ? `Factura #${a.factura}` : a.ventaId ? "Factura" : "A la cuenta")}: {rd(a.aplicado)}</li>
          ))}</ul>}
          <table className="tabla"><tbody>
            <tr><td>Saldo anterior</td><td className="der">{rd(ver.saldoAnterior)}</td></tr>
            <tr><td><b>Monto recibido</b></td><td className="der"><b>{rd(ver.monto)}</b></td></tr>
            <tr><td>Saldo pendiente</td><td className="der">{rd(ver.saldoNuevo)}</td></tr>
            <tr><td>Forma de pago</td><td className="der">{FORMA[ver.formaPago] ?? ver.formaPago}{ver.referencia ? ` · ${ver.referencia}` : ""}</td></tr>
            <tr><td>Recibido por</td><td className="der">{ver.cajero ?? "—"}</td></tr>
          </tbody></table>
          <p className="suave pequeno">Documento no fiscal.</p>
          <div className="fila-acciones no-imprimir">
            <button className="boton primario" onClick={() => window.print()}>Imprimir</button>
            <button className="boton" onClick={() => setVer(null)}>Cerrar</button>
          </div>
        </div>
      )}
    </>
  );
}
