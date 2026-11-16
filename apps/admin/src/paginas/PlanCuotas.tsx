import { useState } from "react";
import { api, puede, rd } from "../api";
import { Aviso, useDatos } from "../ui";

/** Crédito a plazos: plan de cuotas de un cliente, su calendario con la mora, y la configuración de planes y mora. */
interface Cuota { numero: number; vence: string; monto: string; pagado: string; pendiente: string; estado: "PAGADA" | "PARCIAL" | "VENCIDA" | "PENDIENTE"; diasAtraso: number; moraDevengada: string; moraCobrada: string; moraPorCobrar: string }
interface Plan { id: string; nombre: string; capital: string; interesPct: string; interes: string; total: string; cuotas: number; frecuencia: string; moraPct: string; diasGracia: number; estado: "ACTIVO" | "PAGADO" | "CANCELADO"; notas: string | null; calendario: Cuota[]; pendiente: string; moraPorCobrar: string; vencidas: number }
interface Catalogo { id: string; nombre: string; cuotas: number; frecuencia: "SEMANAL" | "QUINCENAL" | "MENSUAL"; interesPct: string; activo: boolean }
const FREC = { SEMANAL: "semanal", QUINCENAL: "quincenal", MENSUAL: "mensual" } as const;
const ESTADO: Record<Cuota["estado"], [string, string]> = { PAGADA: ["Pagada", "texto-ok"], PARCIAL: ["Pagada en parte", ""], VENCIDA: ["Vencida", "texto-alerta"], PENDIENTE: ["Pendiente", "suave"] };
const dia = (f: string) => new Date(f + "T12:00:00").toLocaleDateString("es-DO");

export function PlanCuotas({ clienteId, saldo, onCambio }: { clienteId: string; saldo: string; onCambio: () => void }) {
  const r = useDatos<Plan[]>(`/central/cxc/${clienteId}/planes`);
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" } | null>(null);
  const [financiar, setFinanciar] = useState(false);
  const activo = r.datos?.find((p) => p.estado === "ACTIVO");
  const historial = (r.datos ?? []).filter((p) => p.estado !== "ACTIVO");
  const cambio = () => { r.recargar(); onCambio(); };
  const mora = async (p: Plan) => {
    try { const x = await api(`/central/cxc/${clienteId}/planes/${p.id}/mora`, { cuerpo: {} }); setMsg({ t: `Se cargaron ${rd(x.mora)} de mora al estado de cuenta.`, tipo: "ok" }); cambio(); }
    catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
  };
  const cancelar = async (p: Plan) => {
    const motivo = prompt("Motivo para cancelar el plan (la deuda se mantiene):");
    if (!motivo) return;
    try { await api(`/central/cxc/${clienteId}/planes/${p.id}/cancelar`, { cuerpo: { motivo } }); setMsg({ t: "Plan cancelado.", tipo: "ok" }); cambio(); }
    catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
  };
  if (!activo && !historial.length && !(puede("admin.cxc") && Number(saldo) > 0)) return null;
  return (
    <div>
      <h3 style={{ margin: "16px 0 6px" }}>Plan de cuotas</h3>
      {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}
      {activo ? (
        <>
          <p className="suave pequeno" style={{ margin: "0 0 6px" }}>
            {activo.nombre} · {activo.cuotas} cuotas {FREC[activo.frecuencia as keyof typeof FREC]}es · financiado {rd(activo.capital)}{Number(activo.interes) > 0 ? ` + interés ${rd(activo.interes)} (${activo.interesPct}%)` : " sin interés"} = <b>{rd(activo.total)}</b>
            {Number(activo.moraPct) > 0 && <> · mora {activo.moraPct}% mensual{activo.diasGracia ? `, ${activo.diasGracia} días de gracia` : ""}</>}
          </p>
          <table className="tabla">
            <thead><tr><th>Cuota</th><th>Vence</th><th className="der">Monto</th><th className="der">Pagado</th><th className="der">Debe</th><th>Estado</th><th className="der">Mora</th></tr></thead>
            <tbody>{activo.calendario.map((c) => (
              <tr key={c.numero}>
                <td>{c.numero}</td><td>{dia(c.vence)}</td><td className="der">{rd(c.monto)}</td><td className="der">{Number(c.pagado) ? rd(c.pagado) : <span className="suave">—</span>}</td>
                <td className="der"><b>{Number(c.pendiente) ? rd(c.pendiente) : "—"}</b></td>
                <td className={ESTADO[c.estado][1]}>{ESTADO[c.estado][0]}{c.diasAtraso > 0 && ` · ${c.diasAtraso} d`}</td>
                <td className="der">{Number(c.moraDevengada) ? <>{rd(c.moraDevengada)}{Number(c.moraCobrada) > 0 && <div className="suave pequeno">cobrada {rd(c.moraCobrada)}</div>}</> : <span className="suave">—</span>}</td>
              </tr>
            ))}</tbody>
          </table>
          {puede("admin.cxc") && (
            <div className="fila-acciones no-imprimir">
              {Number(activo.moraPorCobrar) > 0 && <button className="boton primario chico" onClick={() => mora(activo)}>Cobrar mora ({rd(activo.moraPorCobrar)})</button>}
              <button className="boton chico" onClick={() => cancelar(activo)}>Cancelar plan</button>
              <span className="suave pequeno">Los abonos del cliente se aplican a las cuotas por orden. Para perdonar mora use «Ajuste».</span>
            </div>
          )}
        </>
      ) : (
        puede("admin.cxc") && Number(saldo) > 0 && !financiar && <button className="boton chico no-imprimir" onClick={() => setFinanciar(true)}>Financiar la deuda en cuotas</button>
      )}
      {financiar && !activo && <FormFinanciar clienteId={clienteId} saldo={saldo} onCerrar={() => setFinanciar(false)} onListo={() => { setFinanciar(false); setMsg({ t: "Plan creado. El interés ya está en el estado de cuenta.", tipo: "ok" }); cambio(); }} />}
      {historial.length > 0 && <p className="suave pequeno" style={{ marginTop: 6 }}>Planes anteriores: {historial.map((p) => `${p.nombre} (${p.estado === "PAGADO" ? "pagado" : "cancelado"})`).join(", ")}</p>}
    </div>
  );
}

function FormFinanciar({ clienteId, saldo, onCerrar, onListo }: { clienteId: string; saldo: string; onCerrar: () => void; onListo: () => void }) {
  const cat = useDatos<Catalogo[]>("/central/cxc/config/planes");
  const [planId, setPlanId] = useState("");
  const [cuotas, setCuotas] = useState("");
  const [frecuencia, setFrecuencia] = useState<Catalogo["frecuencia"]>("MENSUAL");
  const [interes, setInteres] = useState("");
  const [capital, setCapital] = useState(saldo);
  const [primera, setPrimera] = useState("");
  const [vista, setVista] = useState<{ capital: string; interes: string; total: string; cuotas: { numero: number; vence: string; monto: string }[] } | null>(null);
  const [error, setError] = useState("");
  const elegido = cat.datos?.find((c) => c.id === planId);
  const cuerpo = () => ({
    ...(planId ? { planId } : {}), ...(cuotas ? { cuotas: Number(cuotas) } : {}), ...(!planId || elegido ? { frecuencia } : {}), ...(interes !== "" ? { interesPct: Number(interes) } : {}),
    capital: Number(capital).toFixed(2), ...(primera ? { primeraCuota: primera } : {}),
  });
  const elegir = (id: string) => {
    setPlanId(id); setVista(null);
    const p = cat.datos?.find((c) => c.id === id);
    if (p) { setCuotas(String(p.cuotas)); setFrecuencia(p.frecuencia); setInteres(String(p.interesPct)); }
  };
  const ver = async () => { setError(""); try { setVista(await api(`/central/cxc/${clienteId}/planes/previsualizar`, { cuerpo: cuerpo() })); } catch (e) { setVista(null); setError((e as Error).message); } };
  const crear = async () => { setError(""); try { await api(`/central/cxc/${clienteId}/planes`, { cuerpo: cuerpo() }); onListo(); } catch (e) { setError((e as Error).message); } };
  return (
    <div className="panel no-imprimir" style={{ marginTop: 8 }}>
      <b>Financiar en cuotas</b>
      <div className="fila-acciones" style={{ flexWrap: "wrap", alignItems: "end" }}>
        <label className="campo"><span>Plan</span>
          <select value={planId} onChange={(e) => elegir(e.target.value)}>
            <option value="">A medida</option>
            {(cat.datos ?? []).filter((p) => p.activo).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select></label>
        <label className="campo"><span>Cuotas</span><input inputMode="numeric" value={cuotas} onChange={(e) => { setCuotas(e.target.value.replace(/\D/g, "")); setVista(null); }} style={{ width: 80 }} /></label>
        <label className="campo"><span>Frecuencia</span>
          <select value={frecuencia} onChange={(e) => { setFrecuencia(e.target.value as Catalogo["frecuencia"]); setVista(null); }}>
            <option value="SEMANAL">Semanal</option><option value="QUINCENAL">Quincenal</option><option value="MENSUAL">Mensual</option>
          </select></label>
        <label className="campo"><span>Interés total %</span><input inputMode="decimal" value={interes} onChange={(e) => { setInteres(e.target.value.replace(/[^\d.]/g, "")); setVista(null); }} style={{ width: 90 }} /></label>
        <label className="campo"><span>Monto a financiar</span><input inputMode="decimal" value={capital} onChange={(e) => { setCapital(e.target.value.replace(/[^\d.]/g, "")); setVista(null); }} style={{ width: 130 }} /></label>
        <label className="campo"><span>Primera cuota (opcional)</span><input type="date" value={primera} onChange={(e) => { setPrimera(e.target.value); setVista(null); }} /></label>
      </div>
      <p className="suave pequeno" style={{ margin: "4px 0" }}>El interés es fijo sobre el monto financiado y se reparte en cuotas iguales. Hasta {rd(saldo)} (lo que debe hoy).</p>
      {error && <Aviso texto={error} />}
      {vista && (
        <>
          <p style={{ margin: "6px 0" }}>Financia {rd(vista.capital)} + interés {rd(vista.interes)} = <b>{rd(vista.total)}</b></p>
          <table className="tabla"><thead><tr><th>Cuota</th><th>Vence</th><th className="der">Monto</th></tr></thead>
            <tbody>{vista.cuotas.map((c) => <tr key={c.numero}><td>{c.numero}</td><td>{dia(c.vence)}</td><td className="der">{rd(c.monto)}</td></tr>)}</tbody></table>
        </>
      )}
      <div className="fila-acciones">
        <button className="boton" disabled={!(Number(capital) > 0) || !(Number(cuotas) > 0) || interes === ""} onClick={ver}>Ver cuotas</button>
        <button className="boton primario" disabled={!vista} onClick={crear}>Crear plan</button>
        <button className="boton" onClick={onCerrar}>Cancelar</button>
      </div>
    </div>
  );
}

/** Configuración de la empresa: mora y planes predefinidos */
export function ConfigCredito({ onCerrar }: { onCerrar: () => void }) {
  const cfg = useDatos<{ moraPct: string; diasGracia: number }>("/central/cxc/config/credito");
  const cat = useDatos<Catalogo[]>("/central/cxc/config/planes");
  const [mora, setMora] = useState<string | null>(null);
  const [gracia, setGracia] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState({ nombre: "", cuotas: "", frecuencia: "MENSUAL" as Catalogo["frecuencia"], interesPct: "" });
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" } | null>(null);
  const guardarMora = async () => {
    try { await api("/central/cxc/config/credito", { metodo: "PUT", cuerpo: { moraPct: Number(mora ?? cfg.datos?.moraPct ?? 0), diasGracia: Number(gracia ?? cfg.datos?.diasGracia ?? 0) } }); setMsg({ t: "Mora guardada. Aplica a los planes nuevos.", tipo: "ok" }); cfg.recargar(); }
    catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
  };
  const agregar = async () => {
    try { await api("/central/cxc/config/planes", { cuerpo: { nombre: nuevo.nombre, cuotas: Number(nuevo.cuotas), frecuencia: nuevo.frecuencia, interesPct: Number(nuevo.interesPct || 0) } }); setNuevo({ nombre: "", cuotas: "", frecuencia: "MENSUAL", interesPct: "" }); setMsg(null); cat.recargar(); }
    catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
  };
  const alternar = async (p: Catalogo) => {
    try { await api(`/central/cxc/config/planes/${p.id}`, { metodo: "PUT", cuerpo: { nombre: p.nombre, cuotas: p.cuotas, frecuencia: p.frecuencia, interesPct: Number(p.interesPct), activo: !p.activo } }); cat.recargar(); }
    catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
  };
  return (
    <div className="fondo-modal" onMouseDown={onCerrar}>
      <div className="modal ancho" onMouseDown={(e) => e.stopPropagation()}>
        <div className="fila-acciones" style={{ marginTop: 0 }}><h2 style={{ margin: 0 }}>Planes de cuotas y mora</h2><span className="flex" /><button className="boton chico" onClick={onCerrar}>Cerrar</button></div>
        {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}
        <h3 style={{ margin: "12px 0 6px" }}>Mora por atraso</h3>
        <div className="fila-acciones" style={{ alignItems: "end", flexWrap: "wrap" }}>
          <label className="campo"><span>% mensual sobre lo vencido</span><input inputMode="decimal" value={mora ?? cfg.datos?.moraPct ?? ""} onChange={(e) => setMora(e.target.value.replace(/[^\d.]/g, ""))} style={{ width: 120 }} /></label>
          <label className="campo"><span>Días de gracia</span><input inputMode="numeric" value={gracia ?? String(cfg.datos?.diasGracia ?? "")} onChange={(e) => setGracia(e.target.value.replace(/\D/g, ""))} style={{ width: 90 }} /></label>
          <button className="boton primario" onClick={guardarMora}>Guardar</button>
        </div>
        <p className="suave pequeno">0 = no cobrar mora. Se calcula por día sobre la cuota vencida y se carga al estado de cuenta con «Cobrar mora». Aplica a los planes nuevos.</p>
        <h3 style={{ margin: "12px 0 6px" }}>Planes predefinidos</h3>
        <table className="tabla">
          <thead><tr><th>Plan</th><th className="der">Cuotas</th><th>Frecuencia</th><th className="der">Interés fijo</th><th /></tr></thead>
          <tbody>{(cat.datos ?? []).map((p) => (
            <tr key={p.id} style={p.activo ? undefined : { opacity: 0.55 }}>
              <td>{p.nombre}</td><td className="der">{p.cuotas}</td><td>{FREC[p.frecuencia]}</td><td className="der">{p.interesPct}%</td>
              <td className="der"><button className="boton chico" onClick={() => alternar(p)}>{p.activo ? "Desactivar" : "Activar"}</button></td>
            </tr>
          ))}</tbody>
        </table>
        <div className="fila-acciones" style={{ alignItems: "end", flexWrap: "wrap" }}>
          <label className="campo"><span>Nombre</span><input value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} placeholder="Ej. 6 cuotas mensuales" /></label>
          <label className="campo"><span>Cuotas</span><input inputMode="numeric" value={nuevo.cuotas} onChange={(e) => setNuevo({ ...nuevo, cuotas: e.target.value.replace(/\D/g, "") })} style={{ width: 80 }} /></label>
          <label className="campo"><span>Frecuencia</span>
            <select value={nuevo.frecuencia} onChange={(e) => setNuevo({ ...nuevo, frecuencia: e.target.value as Catalogo["frecuencia"] })}><option value="SEMANAL">Semanal</option><option value="QUINCENAL">Quincenal</option><option value="MENSUAL">Mensual</option></select></label>
          <label className="campo"><span>Interés total %</span><input inputMode="decimal" value={nuevo.interesPct} onChange={(e) => setNuevo({ ...nuevo, interesPct: e.target.value.replace(/[^\d.]/g, "") })} style={{ width: 90 }} /></label>
          <button className="boton primario" disabled={nuevo.nombre.trim().length < 2 || !(Number(nuevo.cuotas) > 0)} onClick={agregar}>Agregar plan</button>
        </div>
      </div>
    </div>
  );
}
