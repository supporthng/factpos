import { useEffect, useState } from "react";
import { api, hoy, num, rd } from "../api";
import { Aviso, Encabezado, useDatos } from "../ui";

/**
 * Comisiones de vendedores: se generan sobre lo cobrado (sin ITBIS) de las facturas que el vendedor armó.
 * Aquí se fija el porcentaje (general o por vendedor), se ve lo generado por período y se liquida (paga) en bloque.
 */
interface Resumen { vendedorId: string; vendedor: string; facturas: number; cobrado: string; base: string; comision: string; pendiente: string; liquidada: string; anulada: string }
interface Detalle { id: string; fecha: string; concepto: "CONTADO" | "INICIAL" | "ABONO"; factura: number; documento: string | null; cliente: string | null; cobrado: string; base: string; porcentaje: string; monto: string; liquidacionId: string | null; anulada: boolean }
interface Config { porcentajeDefecto: string; vendedores: { usuarioId: string; nombre: string; activo: boolean; porcentaje: string | null }[] }
interface Liquidacion { id: string; numero: string; desde: string | null; hasta: string; total: string; notas: string | null; fecha: string; vendedor: string; creadaPor: string | null; lineas: number }
const CONCEPTO = { CONTADO: "Venta cobrada", INICIAL: "Inicial", ABONO: "Abono" } as const;
const fechaHora = (iso: string) => new Date(iso).toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", day: "2-digit", month: "short", year: "numeric" });
const fechaCorta = (s: string) => s.slice(0, 10).split("-").reverse().join("/");
const decimal = (v: string) => v.replace(/[^\d.]/g, "");
const primeroDeMes = () => hoy().slice(0, 8) + "01";

export function Comisiones() {
  const [pestana, setPestana] = useState<"resumen" | "config" | "liquidaciones">("resumen");
  const [desde, setDesde] = useState(primeroDeMes());
  const [hasta, setHasta] = useState(hoy());
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" } | null>(null);
  const q = new URLSearchParams({ ...(desde ? { desde } : {}), ...(hasta ? { hasta } : {}) }).toString();
  const resumen = useDatos<Resumen[]>(`/central/comisiones/resumen?${q}`, [q]);
  const config = useDatos<Config>("/central/comisiones/config");
  const liqs = useDatos<Liquidacion[]>("/central/comisiones/liquidaciones");
  const [ver, setVer] = useState<Resumen | null>(null);
  const detalle = useDatos<Detalle[]>(ver ? `/central/comisiones/detalle?vendedorId=${ver.vendedorId}&${q}` : null, [ver?.vendedorId, q]);
  const [pct, setPct] = useState("");
  const [propios, setPropios] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!config.datos) return;
    setPct(config.datos.porcentajeDefecto);
    setPropios(Object.fromEntries(config.datos.vendedores.map((v) => [v.usuarioId, v.porcentaje ?? ""])));
  }, [config.datos]);

  const guardar = async () => {
    try {
      await api("/central/comisiones/config", { metodo: "PUT", cuerpo: {
        porcentajeDefecto: Number(pct || 0),
        vendedores: (config.datos?.vendedores ?? []).map((v) => ({ usuarioId: v.usuarioId, porcentaje: propios[v.usuarioId] === "" || propios[v.usuarioId] === undefined ? null : Number(propios[v.usuarioId]) })),
      } });
      setMsg({ t: "Porcentajes guardados. Rigen para los cobros desde ahora; lo ya generado no cambia.", tipo: "ok" }); config.recargar();
    } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
  };
  const liquidar = async (r: Resumen) => {
    if (!confirm(`Se pagarán a ${r.vendedor} las comisiones pendientes hasta el ${fechaCorta(hasta)}.\n\n¿Liquidar?`)) return;
    try {
      const x = await api<{ numero: string; total: string; lineas: number }>("/central/comisiones/liquidar", { cuerpo: { vendedorId: r.vendedorId, hasta } });
      setMsg({ t: `Liquidación No. ${x.numero}: ${rd(x.total)} a ${r.vendedor} (${x.lineas} cobros).`, tipo: "ok" });
      resumen.recargar(); liqs.recargar(); detalle.recargar();
    } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
  };

  const filas = resumen.datos ?? [];
  const suma = (k: keyof Resumen) => filas.reduce((a, f) => a + Number(f[k]), 0);

  return (
    <>
      <Encabezado titulo="Comisiones" descripcion="Lo que gana cada vendedor sobre lo que el cliente realmente paga (sin ITBIS): al cobrar, en la inicial y en cada abono." />
      {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}
      <Aviso texto={resumen.error || config.error || liqs.error} />
      <div className="fila-acciones no-imprimir" style={{ marginBottom: 10 }}>
        {([["resumen", "Por vendedor"], ["config", "Porcentajes"], ["liquidaciones", "Liquidaciones"]] as const).map(([id, t]) =>
          <button key={id} className={"boton" + (pestana === id ? " primario" : "")} onClick={() => setPestana(id)}>{t}</button>)}
      </div>

      {pestana === "resumen" && (
        <>
          <div className="panel cab-compra no-imprimir">
            <label className="campo"><span>Desde</span><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
            <label className="campo"><span>Hasta</span><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
          </div>
          <div className="tarjeta" style={{ overflowX: "auto" }}>
            <table className="tabla">
              <thead><tr><th>Vendedor</th><th className="der">Facturas</th><th className="der">Cobrado</th><th className="der">Base sin ITBIS</th><th className="der">Comisión</th><th className="der">Por pagar</th><th className="der">Pagada</th><th /></tr></thead>
              <tbody>
                {filas.length === 0 && <tr><td colSpan={8} className="suave">{resumen.cargando ? "Cargando…" : "No hay comisiones en ese período. Se generan cuando se cobra una venta armada por un vendedor (y el porcentaje es mayor que 0)."}</td></tr>}
                {filas.map((f) => (
                  <tr key={f.vendedorId} style={ver?.vendedorId === f.vendedorId ? { background: "var(--fondo-suave, #eef4ff)" } : undefined}>
                    <td><b>{f.vendedor}</b></td>
                    <td className="der">{num(f.facturas)}</td>
                    <td className="der">{rd(f.cobrado)}</td>
                    <td className="der">{rd(f.base)}</td>
                    <td className="der"><b>{rd(f.comision)}</b></td>
                    <td className="der"><b>{rd(f.pendiente)}</b></td>
                    <td className="der">{rd(f.liquidada)}</td>
                    <td className="der">
                      <button className="boton chico" onClick={() => setVer(ver?.vendedorId === f.vendedorId ? null : f)}>{ver?.vendedorId === f.vendedorId ? "Ocultar" : "Ver cobros"}</button>{" "}
                      {Number(f.pendiente) > 0 && <button className="boton chico primario" onClick={() => liquidar(f)}>Liquidar</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
              {filas.length > 0 && <tfoot><tr><td>Total</td><td /><td className="der">{rd(suma("cobrado"))}</td><td className="der">{rd(suma("base"))}</td><td className="der"><b>{rd(suma("comision"))}</b></td><td className="der"><b>{rd(suma("pendiente"))}</b></td><td className="der">{rd(suma("liquidada"))}</td><td /></tr></tfoot>}
            </table>
            <p className="suave" style={{ margin: "8px 0 0" }}>«Liquidar» paga todo lo pendiente del vendedor hasta la fecha «Hasta». Las comisiones de facturas anuladas no se pagan.</p>
          </div>

          {ver && (
            <div className="tarjeta" style={{ marginTop: 12, overflowX: "auto" }}>
              <b>Cobros de {ver.vendedor}</b>
              <table className="tabla">
                <thead><tr><th>Fecha</th><th>Factura</th><th>Cliente</th><th>Concepto</th><th className="der">Cobrado</th><th className="der">Base</th><th className="der">%</th><th className="der">Comisión</th><th>Estado</th></tr></thead>
                <tbody>
                  {(detalle.datos ?? []).length === 0 && <tr><td colSpan={9} className="suave">{detalle.cargando ? "Cargando…" : "Sin cobros en el período."}</td></tr>}
                  {(detalle.datos ?? []).map((d) => (
                    <tr key={d.id} style={d.anulada ? { opacity: 0.55 } : undefined}>
                      <td>{fechaHora(d.fecha)}</td>
                      <td>{d.documento ?? `#${d.factura}`}</td>
                      <td>{d.cliente ?? <span className="suave">Sin cliente</span>}</td>
                      <td>{CONCEPTO[d.concepto]}</td>
                      <td className="der">{rd(d.cobrado)}</td>
                      <td className="der">{rd(d.base)}</td>
                      <td className="der">{num(Number(d.porcentaje), 2)}</td>
                      <td className="der"><b>{rd(d.monto)}</b></td>
                      <td>{d.anulada ? "Factura anulada" : d.liquidacionId ? "Pagada" : "Por pagar"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {pestana === "config" && (
        <div className="tarjeta" style={{ maxWidth: 640 }}>
          <label className="campo"><span>Porcentaje general de comisión</span>
            <input inputMode="decimal" value={pct} onChange={(e) => setPct(decimal(e.target.value))} placeholder="Ej. 3" style={{ maxWidth: 120 }} /></label>
          <p className="suave">Se aplica a todo vendedor que no tenga uno propio. Con 0 no se genera comisión.</p>
          <table className="tabla">
            <thead><tr><th>Vendedor</th><th className="der">% propio</th></tr></thead>
            <tbody>
              {(config.datos?.vendedores ?? []).length === 0 && <tr><td colSpan={2} className="suave">Aún no hay vendedores: son los usuarios con permiso de vender en Administración.</td></tr>}
              {(config.datos?.vendedores ?? []).map((v) => (
                <tr key={v.usuarioId}>
                  <td>{v.nombre}{!v.activo && <span className="suave"> · inactivo</span>}</td>
                  <td className="der"><input inputMode="decimal" style={{ width: 90, textAlign: "right" }} value={propios[v.usuarioId] ?? ""} placeholder={pct || "0"}
                    onChange={(e) => setPropios({ ...propios, [v.usuarioId]: decimal(e.target.value) })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="suave">Déjelo vacío para usar el porcentaje general. Los cambios rigen desde el próximo cobro; lo ya generado no se modifica.</p>
          <button className="boton primario" onClick={guardar}>Guardar porcentajes</button>
        </div>
      )}

      {pestana === "liquidaciones" && (
        <div className="tarjeta" style={{ overflowX: "auto" }}>
          <table className="tabla">
            <thead><tr><th>No.</th><th>Fecha</th><th>Vendedor</th><th>Período</th><th className="der">Cobros</th><th className="der">Total pagado</th><th>Hecha por</th></tr></thead>
            <tbody>
              {(liqs.datos ?? []).length === 0 && <tr><td colSpan={7} className="suave">{liqs.cargando ? "Cargando…" : "Aún no se ha liquidado ninguna comisión."}</td></tr>}
              {(liqs.datos ?? []).map((l) => (
                <tr key={l.id}>
                  <td><b>{l.numero}</b></td>
                  <td>{fechaHora(l.fecha)}</td>
                  <td>{l.vendedor}</td>
                  <td>{l.desde ? `${fechaCorta(l.desde)} – ` : "hasta "}{fechaCorta(l.hasta)}</td>
                  <td className="der">{num(l.lineas)}</td>
                  <td className="der"><b>{rd(l.total)}</b></td>
                  <td>{l.creadaPor ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
