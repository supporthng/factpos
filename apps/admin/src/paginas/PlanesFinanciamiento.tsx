import { useState } from "react";
import { api, num, puede, rd } from "../api";
import { Aviso, Encabezado, useDatos } from "../ui";

/**
 * Planes de financiamiento: los plazos que ofrece el negocio (6, 12, 24, 36 meses…) con su interés, la inicial mínima
 * y el monto mínimo a financiar. Más la mora por atraso. Es el mismo catálogo que usa Cuentas por cobrar.
 * El interés es fijo sobre el monto financiado y se reparte en cuotas iguales.
 */
interface Plan { id: string; nombre: string; cuotas: number; frecuencia: "SEMANAL" | "QUINCENAL" | "MENSUAL"; interesPct: string; inicialMinPct: string; montoMinimo: string; activo: boolean }
interface Borrador { id: string | null; nombre: string; cuotas: string; frecuencia: Plan["frecuencia"]; interesPct: string; inicialMinPct: string; montoMinimo: string; activo: boolean }

const FREC: Record<Plan["frecuencia"], string> = { SEMANAL: "Semanal", QUINCENAL: "Quincenal", MENSUAL: "Mensual" };
const POR_ANIO: Record<Plan["frecuencia"], number> = { SEMANAL: 52, QUINCENAL: 24, MENSUAL: 12 };
const VACIO: Borrador = { id: null, nombre: "", cuotas: "", frecuencia: "MENSUAL", interesPct: "", inicialMinPct: "", montoMinimo: "", activo: true };
const decimal = (v: string) => v.replace(/[^\d.]/g, "");
const redondeo = (v: number) => Math.round(v * 100) / 100;
const duracion = (p: { cuotas: number; frecuencia: Plan["frecuencia"] }) => {
  if (p.frecuencia === "MENSUAL") return p.cuotas === 1 ? "1 mes" : `${p.cuotas} meses`;
  return `${p.cuotas} cuotas`;
};

export function PlanesFinanciamiento() {
  const editar = puede("admin.cxc");
  const cat = useDatos<Plan[]>("/central/cxc/config/planes");
  const cfg = useDatos<{ moraPct: string; diasGracia: number }>("/central/cxc/config/credito");
  const [b, setB] = useState<Borrador | null>(null);
  const [mora, setMora] = useState<string | null>(null);
  const [gracia, setGracia] = useState<string | null>(null);
  const [monto, setMonto] = useState("100000");
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" } | null>(null);

  const cuerpo = (x: Borrador) => ({
    nombre: x.nombre.trim(), cuotas: Number(x.cuotas), frecuencia: x.frecuencia, interesPct: Number(x.interesPct || 0),
    inicialMinPct: Number(x.inicialMinPct || 0), montoMinimo: Number(x.montoMinimo || 0), activo: x.activo,
  });
  const guardar = async () => {
    if (!b) return;
    try {
      if (b.id) await api(`/central/cxc/config/planes/${b.id}`, { metodo: "PUT", cuerpo: cuerpo(b) });
      else await api("/central/cxc/config/planes", { cuerpo: cuerpo(b) });
      setMsg({ t: "Plan guardado.", tipo: "ok" }); setB(null); cat.recargar();
    } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
  };
  const alternar = async (p: Plan) => {
    try {
      await api(`/central/cxc/config/planes/${p.id}`, { metodo: "PUT", cuerpo: { nombre: p.nombre, cuotas: p.cuotas, frecuencia: p.frecuencia, interesPct: Number(p.interesPct), inicialMinPct: Number(p.inicialMinPct), montoMinimo: Number(p.montoMinimo), activo: !p.activo } });
      cat.recargar();
    } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
  };
  const guardarMora = async () => {
    try {
      await api("/central/cxc/config/credito", { metodo: "PUT", cuerpo: { moraPct: Number(mora ?? cfg.datos?.moraPct ?? 0), diasGracia: Number(gracia ?? cfg.datos?.diasGracia ?? 0) } });
      setMsg({ t: "Mora guardada. Aplica a los planes nuevos.", tipo: "ok" }); cfg.recargar();
    } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
  };

  const planes = cat.datos ?? [];
  const valido = !!b && b.nombre.trim().length >= 2 && Number(b.cuotas) >= 1 && Number(b.cuotas) <= 60 && Number(b.interesPct || 0) <= 300 && Number(b.inicialMinPct || 0) <= 100;
  // Simulador: cuánto paga el cliente por el monto elegido en cada plan activo
  const m = Number(monto) || 0;
  const simulados = planes.filter((p) => p.activo).map((p) => {
    const total = redondeo(m * (1 + Number(p.interesPct) / 100));
    return { p, total, cuota: p.cuotas > 0 ? redondeo(total / p.cuotas) : 0 };
  });

  return (
    <>
      <Encabezado titulo="Planes de financiamiento" descripcion="Los plazos que ofrece el negocio y el interés de cada uno. El vendedor los elige al vender a crédito.">
        {editar && <button className="boton primario" onClick={() => setB({ ...VACIO })}>Nuevo plan</button>}
      </Encabezado>
      {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}
      <Aviso texto={cat.error} />

      <div className="tarjeta" style={{ overflowX: "auto" }}>
        <table className="tabla">
          <thead><tr><th>Plan</th><th className="der">Plazo</th><th>Frecuencia</th><th className="der">Interés total</th><th className="der">Inicial mínima</th><th className="der">Monto mínimo</th><th>Estado</th><th /></tr></thead>
          <tbody>
            {planes.length === 0 && <tr><td colSpan={8} className="suave">Todavía no hay planes. Cree el primero, por ejemplo «12 meses» con 12 % de interés.</td></tr>}
            {planes.map((p) => (
              <tr key={p.id} style={p.activo ? undefined : { opacity: 0.55 }}>
                <td><b>{p.nombre}</b></td>
                <td className="der">{duracion(p)}</td>
                <td>{FREC[p.frecuencia]}</td>
                <td className="der"><b>{num(p.interesPct, 2)} %</b></td>
                <td className="der">{num(p.inicialMinPct, 2)} %</td>
                <td className="der">{Number(p.montoMinimo) > 0 ? rd(p.montoMinimo) : "—"}</td>
                <td>{p.activo ? <span className="pastilla recibida">Activo</span> : <span className="pastilla">Inactivo</span>}</td>
                <td className="der">{editar && <>
                  <button className="boton chico" onClick={() => setB({ id: p.id, nombre: p.nombre, cuotas: String(p.cuotas), frecuencia: p.frecuencia, interesPct: String(Number(p.interesPct)), inicialMinPct: String(Number(p.inicialMinPct)), montoMinimo: String(Number(p.montoMinimo)), activo: p.activo })}>Editar</button>{" "}
                  <button className="boton chico" onClick={() => alternar(p)}>{p.activo ? "Desactivar" : "Activar"}</button>
                </>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="suave pequeno" style={{ marginBottom: 0 }}>El interés es fijo sobre el monto financiado y se reparte en cuotas iguales. Un plan desactivado deja de ofrecerse; los clientes que ya lo tienen no cambian.</p>
      </div>

      {b && (
        <div className="tarjeta" style={{ marginTop: 14, maxWidth: 760 }}>
          <h3 style={{ marginTop: 0 }}>{b.id ? "Editar plan" : "Nuevo plan"}</h3>
          <div className="fila-acciones" style={{ alignItems: "end", flexWrap: "wrap" }}>
            <label className="campo"><span>Nombre</span><input value={b.nombre} onChange={(e) => setB({ ...b, nombre: e.target.value })} placeholder="Ej. 12 meses" /></label>
            <label className="campo"><span>Número de cuotas</span><input inputMode="numeric" value={b.cuotas} onChange={(e) => setB({ ...b, cuotas: e.target.value.replace(/\D/g, "") })} style={{ width: 100 }} /></label>
            <label className="campo"><span>Frecuencia</span>
              <select value={b.frecuencia} onChange={(e) => setB({ ...b, frecuencia: e.target.value as Plan["frecuencia"] })}><option value="MENSUAL">Mensual</option><option value="QUINCENAL">Quincenal</option><option value="SEMANAL">Semanal</option></select></label>
          </div>
          <div className="fila-acciones" style={{ alignItems: "end", flexWrap: "wrap" }}>
            <label className="campo"><span>Interés total (%)</span><input inputMode="decimal" value={b.interesPct} onChange={(e) => setB({ ...b, interesPct: decimal(e.target.value) })} style={{ width: 110 }} /></label>
            <label className="campo"><span>Inicial mínima (%)</span><input inputMode="decimal" value={b.inicialMinPct} onChange={(e) => setB({ ...b, inicialMinPct: decimal(e.target.value) })} style={{ width: 110 }} /></label>
            <label className="campo"><span>Monto mínimo a financiar</span><input inputMode="decimal" value={b.montoMinimo} onChange={(e) => setB({ ...b, montoMinimo: decimal(e.target.value) })} style={{ width: 150 }} /></label>
          </div>
          {Number(b.cuotas) > 0 && Number(b.interesPct) > 0 && (
            <p className="suave pequeno">Equivale a {num(Number(b.interesPct) / Number(b.cuotas), 2)} % por cuota, unos {num((Number(b.interesPct) / Number(b.cuotas)) * POR_ANIO[b.frecuencia], 1)} % al año sobre el monto financiado. Financiar {rd(100000)} costaría {rd(100000 * (1 + Number(b.interesPct) / 100))} en total.</p>
          )}
          <div className="fila-acciones">
            <button className="boton primario" disabled={!valido} onClick={guardar}>Guardar plan</button>
            <button className="boton" onClick={() => setB(null)}>Cancelar</button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 14, alignItems: "flex-start" }}>
        <div className="tarjeta" style={{ flex: "1 1 340px" }}>
          <h3 style={{ marginTop: 0 }}>Simulador</h3>
          <label className="campo"><span>Monto a financiar</span><input inputMode="decimal" value={monto} onChange={(e) => setMonto(decimal(e.target.value))} style={{ width: 160 }} /></label>
          <table className="tabla" style={{ marginTop: 8 }}>
            <thead><tr><th>Plan</th><th className="der">Cuota</th><th className="der">Total</th></tr></thead>
            <tbody>
              {simulados.length === 0 && <tr><td colSpan={3} className="suave">No hay planes activos.</td></tr>}
              {simulados.map(({ p, cuota, total }) => <tr key={p.id}><td>{p.nombre}</td><td className="der">{rd(cuota)}</td><td className="der">{rd(total)}</td></tr>)}
            </tbody>
          </table>
        </div>
        <div className="tarjeta" style={{ flex: "1 1 340px" }}>
          <h3 style={{ marginTop: 0 }}>Mora por atraso</h3>
          <div className="fila-acciones" style={{ alignItems: "end", flexWrap: "wrap" }}>
            <label className="campo"><span>% mensual sobre lo vencido</span><input inputMode="decimal" value={mora ?? cfg.datos?.moraPct ?? ""} onChange={(e) => setMora(decimal(e.target.value))} style={{ width: 120 }} /></label>
            <label className="campo"><span>Días de gracia</span><input inputMode="numeric" value={gracia ?? String(cfg.datos?.diasGracia ?? "")} onChange={(e) => setGracia(e.target.value.replace(/\D/g, ""))} style={{ width: 90 }} /></label>
            {editar && <button className="boton primario" onClick={guardarMora}>Guardar</button>}
          </div>
          <p className="suave pequeno">0 = no cobrar mora. Se calcula por día sobre la cuota vencida y se carga al estado de cuenta. Aplica a los planes nuevos.</p>
        </div>
      </div>
    </>
  );
}
