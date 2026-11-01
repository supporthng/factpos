import { useEffect, useState } from "react";
import { api } from "../api";
import { Aviso, Encabezado, Kpi, Tabla, useDatos } from "../ui";

/**
 * Portal de FactPOS: la facturación electrónica como complemento por cliente.
 * Rangos de comprobantes/mes (costo del proveedor vs. precio al cliente, en USD), plan de cada cliente,
 * uso del mes (lo reporta la nube de cada cliente sola) y margen. El cliente no configura nada.
 */
interface PlanEcf { id: string; codigo: string; nombre: string; maxMes: number; costoUsd: number; precioUsd: number; activo: boolean; orden: number; clientes: number }
interface FilaCliente {
  clienteId: string; slug: string; cliente: string; planId: string | null; plan: string | null; maxMes: number | null; precioEspecial: number | null;
  precioUsd: number; costoUsd: number; margenUsd: number; actual: number; anterior: number; pct: number | null;
  estado: "sin-plan" | "ok" | "cerca" | "excedido" | "sin-datos"; dosMesesExcedido: boolean; sugerido: { id: string; nombre: string } | null; ultimoReporte: string | null;
}
interface Resumen {
  mes: string; tasaDop: number | null; clientes: FilaCliente[];
  totales: { conPlan: number; ingresoUsd: number; costoUsd: number; margenUsd: number; excedidos: number; cerca: number; sinPlan: number };
}

const usd = (n: number) => "US$ " + n.toLocaleString("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (n: number) => n.toLocaleString("es-DO");
const ESTADO = {
  "sin-plan": { t: "Usa e-CF sin plan", c: "alerta" }, ok: { t: "Dentro del rango", c: "ok" }, cerca: { t: "Cerca del límite", c: "" },
  excedido: { t: "Pasado del rango", c: "alerta" }, "sin-datos": { t: "Sin e-CF", c: "" },
} as const;

function Planes({ planes, recargar }: { planes: PlanEcf[]; recargar: () => void }) {
  const [filas, setFilas] = useState<PlanEcf[]>(planes);
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" } | null>(null);
  useEffect(() => setFilas(planes), [planes]);
  const cambiar = (id: string, x: Partial<PlanEcf>) => setFilas(filas.map((f) => (f.id === id ? { ...f, ...x } : f)));
  const cuerpo = (f: PlanEcf) => ({ codigo: f.codigo, nombre: f.nombre, maxMes: f.maxMes, costoUsd: f.costoUsd, precioUsd: f.precioUsd, activo: f.activo, orden: f.orden });
  const guardar = async (f: PlanEcf) => {
    setMsg(null);
    try { await api(`/central/portal/ecf-planes/${f.id}`, { metodo: "PUT", cuerpo: cuerpo(f) }); setMsg({ t: `«${f.nombre}» guardado.`, tipo: "ok" }); recargar(); }
    catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
  };
  const agregar = async () => {
    setMsg(null);
    const n = filas.length + 1;
    try {
      await api("/central/portal/ecf-planes", { metodo: "POST", cuerpo: { codigo: `rango-${Date.now().toString(36)}`, nombre: `Rango ${n}`, maxMes: 100, costoUsd: 0, precioUsd: 0, activo: true, orden: n } });
      recargar();
    } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
  };
  const campo = (f: PlanEcf, k: "maxMes" | "costoUsd" | "precioUsd" | "orden", ancho = 90) => (
    <input type="number" min={0} step={k === "maxMes" || k === "orden" ? 1 : 0.01} style={{ width: ancho }} value={f[k]} onChange={(e) => cambiar(f.id, { [k]: Number(e.target.value) } as Partial<PlanEcf>)} />
  );
  return (
    <div className="panel">
      <div className="fila-acciones" style={{ marginTop: 0 }}>
        <h3 style={{ margin: 0 }}>Rangos de facturación electrónica</h3><span className="flex" />
        <button className="boton" onClick={agregar}>Agregar rango</button>
      </div>
      <p className="suave pequeno" style={{ marginTop: 4 }}>Costo = lo que te cobra el proveedor por mes. Precio = lo que cobras al cliente por mes. Ambos en dólares.</p>
      {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}
      <Tabla filas={filas} clave={(f) => f.id} columnas={[
        { titulo: "Nombre", valor: (f) => <input style={{ width: 150 }} value={f.nombre} onChange={(e) => cambiar(f.id, { nombre: e.target.value })} /> },
        { titulo: "Comprobantes/mes", valor: (f) => campo(f, "maxMes") },
        { titulo: "Costo US$/mes", valor: (f) => campo(f, "costoUsd") },
        { titulo: "Precio US$/mes", valor: (f) => campo(f, "precioUsd") },
        { titulo: "Margen", valor: (f) => <b>{usd(f.precioUsd - f.costoUsd)}</b>, der: true },
        { titulo: "Clientes", valor: (f) => f.clientes, der: true },
        { titulo: "Orden", valor: (f) => campo(f, "orden", 60) },
        { titulo: "Activo", valor: (f) => <input type="checkbox" checked={f.activo} onChange={(e) => cambiar(f.id, { activo: e.target.checked })} /> },
        { titulo: "", valor: (f) => <button className="boton" onClick={() => guardar(f)}>Guardar</button> },
      ]} />
    </div>
  );
}

export function FacturacionElectronica() {
  const [n, setN] = useState(0);
  const resumen = useDatos<Resumen>("/central/portal/ecf-resumen", [n]);
  const planes = useDatos<PlanEcf[]>("/central/portal/ecf-planes", [n]);
  const [tasa, setTasa] = useState("");
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" } | null>(null);
  const r = resumen.datos;
  useEffect(() => { if (r) setTasa(r.tasaDop ? String(r.tasaDop) : ""); }, [r?.tasaDop]);
  const recargar = () => setN((x) => x + 1);

  const asignar = async (c: FilaCliente, planId: string | null, precio: number | null) => {
    setMsg(null);
    try { await api(`/central/portal/clientes/${c.clienteId}/ecf`, { metodo: "PUT", cuerpo: { planId, precioUsd: precio } }); recargar(); }
    catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
  };
  const guardarTasa = async () => {
    setMsg(null);
    try { await api("/central/portal/ecf-tasa", { metodo: "PUT", cuerpo: { tasa: tasa.trim() ? Number(tasa) : null } }); setMsg({ t: "Tasa guardada.", tipo: "ok" }); recargar(); }
    catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
  };
  const dop = (v: number) => (r?.tasaDop ? ` · RD$ ${num(Math.round(v * r.tasaDop))}` : "");
  const t = r?.totales;

  return (
    <>
      <Encabezado titulo="Facturación electrónica" descripcion="Complemento por cliente: rango de comprobantes al mes, lo que cuesta, lo que se cobra y cuánto usa cada uno. El cliente no configura nada; el sistema de cada cliente reporta su conteo solo.">
        <button className="boton" onClick={recargar}>Actualizar</button>
      </Encabezado>
      <Aviso texto={resumen.error || planes.error} />
      {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}
      {t && (
        <div className="tres-col" style={{ marginBottom: 12 }}>
          <Kpi titulo="Ingreso al mes" valor={usd(t.ingresoUsd)} detalle={`${t.conPlan} cliente(s) con plan${dop(t.ingresoUsd)}`} />
          <Kpi titulo="Costo del proveedor" valor={usd(t.costoUsd)} detalle={dop(t.costoUsd).replace(/^ · /, "") || undefined} />
          <Kpi titulo="Margen" valor={usd(t.margenUsd)} tono={t.margenUsd >= 0 ? "ok" : "alerta"} detalle={dop(t.margenUsd).replace(/^ · /, "") || undefined} />
        </div>
      )}
      {t && (t.excedidos > 0 || t.cerca > 0 || t.sinPlan > 0) && (
        <Aviso tipo="info" texto={[
          t.excedidos ? `${t.excedidos} cliente(s) pasado(s) de su rango` : "",
          t.cerca ? `${t.cerca} cerca del límite (80% o más)` : "",
          t.sinPlan ? `${t.sinPlan} emite(n) e-CF sin plan asignado` : "",
        ].filter(Boolean).join(" · ")} />
      )}

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Clientes · {r?.mes ?? ""}</h3>
        <Tabla filas={r?.clientes ?? []} clave={(c) => c.clienteId} vacio="Aún no hay clientes con licencia" columnas={[
          { titulo: "Cliente", valor: (c) => <b>{c.cliente}</b> },
          { titulo: "Rango", valor: (c) => (
            <select value={c.planId ?? ""} onChange={(e) => asignar(c, e.target.value || null, null)}>
              <option value="">Sin facturación electrónica</option>
              {(planes.datos ?? []).filter((p) => p.activo || p.id === c.planId).map((p) => <option key={p.id} value={p.id}>{p.nombre} · {usd(p.precioUsd)}</option>)}
            </select>) },
          { titulo: "Precio especial", valor: (c) => c.planId ? (
            <input type="number" min={0} step={0.01} style={{ width: 90 }} placeholder="del rango" defaultValue={c.precioEspecial ?? ""}
              onBlur={(e) => { const v = e.target.value.trim() === "" ? null : Number(e.target.value); if (v !== c.precioEspecial) asignar(c, c.planId, v); }} />) : "—" },
          { titulo: "Este mes", valor: (c) => c.maxMes ? `${num(c.actual)} de ${num(c.maxMes)} (${c.pct}%)` : num(c.actual), der: true },
          { titulo: "Mes anterior", valor: (c) => num(c.anterior), der: true },
          { titulo: "Estado", valor: (c) => (
            <>
              <span className={"pastilla " + ESTADO[c.estado].c}>{ESTADO[c.estado].t}</span>
              {c.sugerido && <div className="suave pequeno">{c.dosMesesExcedido ? "Dos meses seguidos pasado. " : ""}Sugerido: {c.sugerido.nombre}{" "}
                <button className="boton" onClick={() => asignar(c, c.sugerido!.id, null)}>Pasar</button></div>}
            </>) },
          { titulo: "Margen", valor: (c) => c.planId ? usd(c.margenUsd) : "—", der: true },
        ]} />
        <p className="suave pequeno" style={{ marginBottom: 0 }}>El conteo se actualiza cuando el sistema del cliente renueva su licencia (cada vez que se conecta al portal). Cuenta los e-CF enviados o aceptados, no los rechazados.</p>
      </div>

      <Planes planes={planes.datos ?? []} recargar={recargar} />

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Tasa del dólar</h3>
        <p className="suave pequeno">Solo sirve para mostrar el ingreso, el costo y el margen también en pesos.</p>
        <div className="fila-acciones" style={{ marginTop: 0 }}>
          <label className="campo" style={{ maxWidth: 200, margin: 0 }}><span>RD$ por US$ 1</span><input type="number" min={0} step={0.01} value={tasa} onChange={(e) => setTasa(e.target.value)} /></label>
          <button className="boton" onClick={guardarTasa}>Guardar tasa</button>
        </div>
      </div>
    </>
  );
}
