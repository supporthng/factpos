import { useState } from "react";
import { api, hoy, rd } from "../api";
import { Aviso, Encabezado, Kpi, SelectorSucursal, useCatalogo, useDatos } from "../ui";

/**
 * Cierres de caja: todos los turnos con su cuadre (esperado, declarado y diferencia). Un supervisor revisa los
 * cierres cuya diferencia pasa del monto configurado, y se registra el depósito del efectivo.
 */
const PAGO: Record<string, string> = { EFECTIVO: "Efectivo", TARJETA: "Tarjeta", TRANSFERENCIA: "Transferencia" };
const fh = (s?: string | null) => (s ? new Date(s).toLocaleString("es-DO", { dateStyle: "short", timeStyle: "short" }) : "—");
const clase = (d: string | number | null) => (d == null || Number(d) === 0 ? "" : Number(d) < 0 ? "texto-alerta" : "texto-ok");

interface Fila {
  id: string; sucursal: string; caja: string; cajero: string; estado: "ABIERTO" | "CERRADO"; abiertoEn: string; cerradoEn: string | null;
  diferencia: string | null; ventas: string; facturas: number; revisadoEn: string | null; revisadoPor: string | null; notaRevision: string | null;
  depositoMonto: string | null; depositoEn: string | null; depositoReferencia: string | null; porRevisar: boolean;
}

export function Cierres() {
  const { usuarios } = useCatalogo();
  const [desde, setDesde] = useState(hoy().slice(0, 8) + "01");
  const [hasta, setHasta] = useState(hoy());
  const [sucursal, setSucursal] = useState("");
  const [cajero, setCajero] = useState("");
  const [estado, setEstado] = useState("todos");
  const [abierto, setAbierto] = useState<string | null>(null);
  const [verAjuste, setVerAjuste] = useState(false);
  const params = new URLSearchParams({ desde, hasta, estado, ...(sucursal ? { sucursalId: sucursal } : {}), ...(cajero ? { usuarioId: cajero } : {}) });
  const { datos, error, recargar } = useDatos<{ umbralDiferencia: number; filas: Fila[]; totales: { ventas: string; facturas: number; diferencia: string; porRevisar: number } }>(`/central/cierres?${params}`);

  return (
    <>
      <Encabezado titulo="Cierres de caja" descripcion="Cuadre de cada turno: lo esperado, lo que contó el cajero y la diferencia.">
        <button className="boton" onClick={() => setVerAjuste(true)}>Diferencia a revisar</button>
      </Encabezado>
      {error && <Aviso texto={error} />}
      <div className="fila-acciones" style={{ marginBottom: 12, flexWrap: "wrap" }}>
        <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        <SelectorSucursal valor={sucursal} onCambio={setSucursal} />
        <select value={cajero} onChange={(e) => setCajero(e.target.value)}>
          <option value="">Todos los cajeros</option>
          {usuarios.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
        </select>
        <select value={estado} onChange={(e) => setEstado(e.target.value)}>
          <option value="todos">Todos los turnos</option>
          <option value="porRevisar">Por revisar</option>
          <option value="conDiferencia">Con diferencia</option>
          <option value="abiertos">Abiertos ahora</option>
        </select>
      </div>
      <div className="kpis">
        <Kpi titulo="Turnos" valor={String(datos?.filas.length ?? 0)} />
        <Kpi titulo="Vendido" valor={rd(datos?.totales.ventas ?? 0)} detalle={`${datos?.totales.facturas ?? 0} facturas`} />
        <Kpi titulo="Diferencia neta" valor={rd(datos?.totales.diferencia ?? 0)} tono={Number(datos?.totales.diferencia ?? 0) < 0 ? "alerta" : undefined} />
        <Kpi titulo="Por revisar" valor={String(datos?.totales.porRevisar ?? 0)} tono={datos?.totales.porRevisar ? "alerta" : "ok"} detalle={datos?.umbralDiferencia ? `Diferencia mayor a ${rd(datos.umbralDiferencia)}` : "Sin monto configurado"} />
      </div>
      <div className="tabla-contenedor">
        <table className="tabla">
          <thead><tr><th>Abierto</th><th>Caja</th><th>Cajero</th><th className="der">Vendido</th><th className="der">Diferencia</th><th>Estado</th><th>Depósito</th><th /></tr></thead>
          <tbody>
            {(datos?.filas ?? []).map((f) => (
              <tr key={f.id}>
                <td>{fh(f.abiertoEn)}</td>
                <td>{f.sucursal} · {f.caja}</td>
                <td>{f.cajero}</td>
                <td className="der">{rd(f.ventas)}</td>
                <td className={"der " + clase(f.diferencia)}>{f.diferencia == null ? "—" : rd(f.diferencia)}</td>
                <td>
                  {f.estado === "ABIERTO" ? <span className="pastilla">Abierto</span>
                    : f.porRevisar ? <span className="pastilla con_diferencia">Por revisar</span>
                    : f.revisadoEn ? <span className="pastilla">Revisado</span> : <span className="pastilla">Cerrado</span>}
                </td>
                <td>{f.depositoMonto != null ? rd(f.depositoMonto) : f.estado === "CERRADO" ? <span className="suave">Pendiente</span> : "—"}</td>
                <td className="der"><button className="boton chico" onClick={() => setAbierto(f.id)}>Ver</button></td>
              </tr>
            ))}
            {!datos?.filas.length && <tr><td colSpan={8} className="suave" style={{ textAlign: "center", padding: 24 }}>No hay turnos en estas fechas</td></tr>}
          </tbody>
        </table>
      </div>
      {abierto && <Detalle id={abierto} onCerrar={() => setAbierto(null)} onCambio={recargar} />}
      {verAjuste && <Ajuste actual={datos?.umbralDiferencia ?? 0} onCerrar={() => setVerAjuste(false)} onGuardado={() => { setVerAjuste(false); recargar(); }} />}
    </>
  );
}

function Detalle({ id, onCerrar, onCambio }: { id: string; onCerrar: () => void; onCambio: () => void }) {
  const { datos: r, recargar } = useDatos<any>(`/central/cierres/${id}`);
  const [nota, setNota] = useState("");
  const [monto, setMonto] = useState("");
  const [ref, setRef] = useState("");
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  if (!r) return <div className="fondo-modal"><div className="modal"><p className="suave">Cargando…</p></div></div>;
  const t = r.turno, cerrado = t.estado === "CERRADO";
  const dif = Number(t.diferencia ?? 0);
  const requiereNota = r.umbralDiferencia > 0 && Math.abs(dif) > r.umbralDiferencia;
  const hacer = async (f: () => Promise<unknown>, ok: string) => {
    setOcupado(true); setMsg(null);
    try { await f(); setMsg({ t: ok, tipo: "ok" }); await recargar(); onCambio(); } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
    setOcupado(false);
  };
  const declarado = t.declarado ?? {};
  return (
    <div className="fondo-modal" onMouseDown={(e) => e.target === e.currentTarget && !ocupado && onCerrar()}>
      <div className="modal ancho" role="dialog" aria-modal="true">
        <div className="pr-cabecera">
          <div><h2>{t.sucursal} · {t.caja}</h2><p className="suave">{t.cajero} · {fh(t.abiertoEn)} → {cerrado ? fh(t.cerradoEn) : "abierto"}{t.cerradoPor ? ` · cerró ${t.cerradoPor}` : ""}</p></div>
          <button className="boton fantasma" onClick={onCerrar} aria-label="Cerrar">✕</button>
        </div>
        {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}
        <div className="kpis">
          <Kpi titulo="Vendido" valor={rd(r.ventas.total)} detalle={`${r.ventas.facturas} facturas`} />
          <Kpi titulo="Descuentos" valor={rd(r.ventas.descuentos)} />
          <Kpi titulo="Anulaciones" valor={String(r.anulaciones?.cantidad ?? 0)} detalle={rd(r.anulaciones?.monto ?? 0)} />
          <Kpi titulo="Diferencia" valor={cerrado ? rd(t.diferencia) : "—"} tono={dif < 0 ? "alerta" : dif > 0 ? "ok" : undefined} />
        </div>
        <table className="tabla">
          <thead><tr><th>Forma de pago</th><th className="der">Esperado</th><th className="der">Contó el cajero</th><th className="der">Diferencia</th></tr></thead>
          <tbody>
            {Object.keys(PAGO).map((k) => {
              const esp = Number(r.esperado?.[k] ?? 0), dec = declarado[k] != null ? Number(declarado[k]) : null;
              return <tr key={k}><td>{PAGO[k]}</td><td className="der">{rd(esp)}</td><td className="der">{dec == null ? "—" : rd(dec)}</td>
                <td className={"der " + clase(dec == null ? null : dec - esp)}>{dec == null ? "—" : rd(dec - esp)}</td></tr>;
            })}
          </tbody>
        </table>
        <div className="totales compacto">
          <div><span>Fondo inicial</span><span>{rd(r.efectivo.fondo)}</span></div>
          <div><span>Ventas en efectivo</span><span>{rd(r.efectivo.ventas)}</span></div>
          <div><span>Entradas (abonos, sencillo)</span><span>{rd(r.efectivo.entradas)}</span></div>
          <div><span>Salidas (retiros, gastos)</span><span>−{rd(r.efectivo.salidas)}</span></div>
        </div>
        {!!r.movimientos?.length && (
          <details style={{ margin: "8px 0" }}><summary>Movimientos del turno ({r.movimientos.length})</summary>
            <table className="tabla"><tbody>{r.movimientos.map((m: any, i: number) => (
              <tr key={i}><td>{fh(m.creadoEn)}</td><td>{m.tipo}</td><td>{m.concepto ?? ""}</td><td>{m.autorizadoPor ?? ""}</td><td className="der">{rd(m.monto)}</td></tr>
            ))}</tbody></table>
          </details>
        )}
        {cerrado && (
          <div className="panel" style={{ marginTop: 12 }}>
            <h3 style={{ marginTop: 0 }}>Revisión del supervisor</h3>
            {r.revision.revisadoEn
              ? <p>Revisado por <b>{r.revision.revisadoPor}</b> el {fh(r.revision.revisadoEn)}{r.revision.notaRevision ? <> · “{r.revision.notaRevision}”</> : null}</p>
              : <>
                {requiereNota && <p className="texto-alerta">La diferencia pasa de {rd(r.umbralDiferencia)}: escriba una nota explicándola.</p>}
                <div className="fila-acciones">
                  <input style={{ flex: 1 }} value={nota} onChange={(e) => setNota(e.target.value)} placeholder={requiereNota ? "Nota (obligatoria)" : "Nota (opcional)"} />
                  <button className="boton primario" disabled={ocupado || (requiereNota && nota.trim().length < 3)}
                    onClick={() => hacer(() => api(`/central/cierres/${id}/revision`, { metodo: "PUT", cuerpo: { nota: nota.trim() } }), "Cierre revisado")}>Marcar como revisado</button>
                </div>
              </>}
          </div>
        )}
        {cerrado && (
          <div className="panel" style={{ marginTop: 12 }}>
            <h3 style={{ marginTop: 0 }}>Depósito del efectivo</h3>
            {r.revision.depositoMonto != null && <p>Depositado <b>{rd(r.revision.depositoMonto)}</b> el {fh(r.revision.depositoEn)} por {r.revision.depositoPor}{r.revision.depositoReferencia ? ` · ref. ${r.revision.depositoReferencia}` : ""}</p>}
            <div className="fila-acciones" style={{ flexWrap: "wrap" }}>
              <input type="number" min="0" step="0.01" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder={`Monto (efectivo contado ${rd(declarado.EFECTIVO ?? 0)})`} />
              <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Referencia o Nº de depósito" />
              <button className="boton" disabled={ocupado || !(Number(monto) >= 0) || monto === ""}
                onClick={() => hacer(() => api(`/central/cierres/${id}/deposito`, { metodo: "PUT", cuerpo: { monto: Number(monto), referencia: ref.trim() } }), "Depósito registrado")}>
                {r.revision.depositoMonto != null ? "Corregir depósito" : "Registrar depósito"}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Ajuste({ actual, onCerrar, onGuardado }: { actual: number; onCerrar: () => void; onGuardado: () => void }) {
  const [v, setV] = useState(String(actual || ""));
  const [msg, setMsg] = useState("");
  return (
    <div className="fondo-modal" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <div className="modal" role="dialog" aria-modal="true">
        <h2 style={{ marginTop: 0 }}>Diferencia a revisar</h2>
        <p className="suave">Si el faltante o sobrante de un cierre pasa de este monto, queda “por revisar” y el supervisor debe escribir una nota. Con 0 no se pide revisión.</p>
        {msg && <Aviso texto={msg} />}
        <label className="campo"><span>Monto (RD$)</span><input type="number" min="0" step="1" value={v} onChange={(e) => setV(e.target.value)} /></label>
        <div className="fila-acciones"><span className="flex" />
          <button className="boton fantasma" onClick={onCerrar}>Cancelar</button>
          <button className="boton primario" onClick={async () => { try { await api("/central/cierres/config", { metodo: "PUT", cuerpo: { umbralDiferencia: Number(v) || 0 } }); onGuardado(); } catch (e) { setMsg((e as Error).message); } }}>Guardar</button>
        </div>
      </div>
    </div>
  );
}
