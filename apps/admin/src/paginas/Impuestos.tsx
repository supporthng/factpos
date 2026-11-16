import { useState } from "react";
import { api } from "../api";
import { Aviso, Encabezado, useDatos } from "../ui";

/** Planilla de impuestos (Fiscal): la tasa de cada impuesto (ITBIS, ISC, otros) y la propina legal. */
interface Imp { id: string; nombre: string; tipo: "ITBIS" | "ISC" | "PROPINA" | "OTRO"; porcentaje: number; activo: boolean; productos: number }
const TIPO: Record<Imp["tipo"], string> = { ITBIS: "ITBIS", ISC: "Selectivo al consumo (ISC)", PROPINA: "Propina legal", OTRO: "Otro" };

function Fila({ i, alGuardar }: { i: Imp; alGuardar: (t: string, tipo: "ok" | "error") => void }) {
  const [nombre, setNombre] = useState(i.nombre);
  const [pct, setPct] = useState(String(i.porcentaje));
  const [activo, setActivo] = useState(i.activo);
  const cambio = nombre !== i.nombre || Number(pct) !== i.porcentaje || activo !== i.activo;
  const guardar = async () => {
    try { await api(`/central/impuestos/${i.id}`, { metodo: "PUT", cuerpo: { nombre, tipo: i.tipo, porcentaje: Number(pct), activo } }); alGuardar(`«${nombre}» guardado.`, "ok"); }
    catch (e) { alGuardar((e as Error).message, "error"); }
  };
  return (
    <tr style={activo ? undefined : { opacity: 0.55 }}>
      <td><input value={nombre} maxLength={60} onChange={(e) => setNombre(e.target.value)} aria-label="Nombre" /></td>
      <td>{TIPO[i.tipo]}</td>
      <td className="der" style={{ width: 130 }}><span className="en-linea"><input className="numero" inputMode="decimal" value={pct} aria-label="Porcentaje" onChange={(e) => setPct(e.target.value.replace(/[^\d.]/g, ""))} /> %</span></td>
      <td className="der">{i.tipo === "PROPINA" ? <span className="suave">—</span> : i.productos}</td>
      <td><label className="interruptor"><input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} /><span>{activo ? "Activo" : "Inactivo"}</span></label></td>
      <td className="der"><button className="boton primario chico" disabled={!cambio || !nombre.trim() || pct === ""} onClick={guardar}>Guardar</button></td>
    </tr>
  );
}

export function Impuestos() {
  const r = useDatos<Imp[]>("/central/impuestos");
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" } | null>(null);
  const [nuevo, setNuevo] = useState({ nombre: "", tipo: "ITBIS" as Imp["tipo"], porcentaje: "" });
  const avisar = (t: string, tipo: "ok" | "error") => { setMsg({ t, tipo }); if (tipo === "ok") void r.recargar(); };
  const agregar = async () => {
    try { await api("/central/impuestos", { cuerpo: { nombre: nuevo.nombre, tipo: nuevo.tipo, porcentaje: Number(nuevo.porcentaje) } }); setNuevo({ nombre: "", tipo: "ITBIS", porcentaje: "" }); avisar("Impuesto agregado.", "ok"); }
    catch (e) { avisar((e as Error).message, "error"); }
  };
  const propina = r.datos?.find((x) => x.tipo === "PROPINA" && x.activo);
  return (
    <>
      <Encabezado titulo="Planilla de impuestos" descripcion="La tasa de cada impuesto que usa el sistema. Aplica a todas las sucursales." />
      {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}
      <Aviso texto={r.error} />
      <div className="panel">
        <table className="tabla tabla-edicion">
          <thead><tr><th>Nombre</th><th>Tipo</th><th className="der">Tasa</th><th className="der">Productos</th><th>Estado</th><th /></tr></thead>
          <tbody>{(r.datos ?? []).map((i) => <Fila key={i.id + i.porcentaje + i.nombre + i.activo} i={i} alGuardar={avisar} />)}</tbody>
        </table>
        <p className="suave pequeno" style={{ marginBottom: 0 }}>
          El ITBIS vigente en el país es 18 % (16 % para algunos productos y 0 % exento). Cambiar una tasa afecta las ventas nuevas, no las ya emitidas.
          {propina ? ` La propina legal de ${propina.porcentaje} % se calcula sobre el consumo sin ITBIS en restaurantes, bares y discotecas.` : ""}
        </p>
      </div>
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Agregar impuesto</h3>
        <div className="fila-acciones" style={{ alignItems: "end", flexWrap: "wrap", marginTop: 0 }}>
          <label className="campo"><span>Nombre</span><input value={nuevo.nombre} placeholder="Ej. ITBIS 16%" maxLength={60} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} /></label>
          <label className="campo"><span>Tipo</span>
            <select value={nuevo.tipo} onChange={(e) => setNuevo({ ...nuevo, tipo: e.target.value as Imp["tipo"] })}>
              {(Object.keys(TIPO) as Imp["tipo"][]).filter((t) => t !== "PROPINA" || !propina).map((t) => <option key={t} value={t}>{TIPO[t]}</option>)}
            </select></label>
          <label className="campo"><span>Tasa %</span><input className="numero" inputMode="decimal" value={nuevo.porcentaje} onChange={(e) => setNuevo({ ...nuevo, porcentaje: e.target.value.replace(/[^\d.]/g, "") })} style={{ width: 90 }} /></label>
          <button className="boton primario" disabled={nuevo.nombre.trim().length < 2 || nuevo.porcentaje === ""} onClick={agregar}>Agregar</button>
        </div>
      </div>
    </>
  );
}
