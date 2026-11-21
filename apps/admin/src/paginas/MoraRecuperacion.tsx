import { useState } from "react";
import { api, num, puede, rd } from "../api";
import { Aviso, Encabezado, useDatos } from "../ui";

/**
 * Mora y recuperación de mercancía (mueblería):
 *  · Mora: clientes con cuotas vencidas. Desde aquí se abre el acta de recuperación.
 *  · Actas: lo que se recoge al cliente que no paga, con su valoración. Un supervisor la aplica: lo valorado se descuenta de la deuda
 *    y la mercancía entra al almacén «Recuperada».
 *  · Mercancía recuperada: revisión, reparación y precio de usado.
 */
interface FilaMora { planId: string; clienteId: string; cliente: string; telefono: string | null; documento: string | null; plan: string; garante: string | null; garanteTelefono: string | null;
  factura: number | null; saldo: string; cuotasVencidas: number; cuotas: number; diasAtraso: number; vencido: string; moraPorCobrar: string }
interface Acta { id: string; acta: string; estado: "ABIERTA" | "APLICADA" | "CANCELADA"; motivo: string; fechaRecogida: string; valorTotal: string; saldoAntes: string | null; saldoDespues: string | null;
  cliente: string; clienteId: string; factura: number | null; sucursal: string; creadaPor: string | null; aplicadaPor: string | null; items: { id: string; descripcion: string; serie: string | null; cantidad: string; estadoFisico: string; valoracion: string }[] | null }
interface Recuperada { id: string; descripcion: string; serie: string | null; cantidad: string; estadoFisico: string; valoracion: string; costoReparacion: string; precioUsado: string | null;
  proceso: "EN_REVISION" | "EN_REPARACION" | "LISTA" | "VENDIDA"; acta: string; fechaRecogida: string; cliente: string }
interface Recuperables { planId: string | null; ventaId: string | null; lineas: { itemId: string; presentacionId: string; descripcion: string; cantidad: string; factor: string; total: string; usaSeries: boolean; series: string[] }[] }
interface Pieza { clave: string; presentacionId: string; descripcion: string; serie: string; estadoFisico: "BUENO" | "REGULAR" | "DANADO"; valoracion: string }

const ESTADO: Record<string, string> = { BUENO: "Bueno", REGULAR: "Regular", DANADO: "Dañado" };
const PROCESO: Record<string, string> = { EN_REVISION: "En revisión", EN_REPARACION: "En reparación", LISTA: "Lista para la venta", VENDIDA: "Vendida" };
const decimal = (v: string) => v.replace(/[^\d.]/g, "");
const fecha = (s: string) => s.split("-").reverse().join("/");

export function MoraRecuperacion() {
  const [pestana, setPestana] = useState<"mora" | "actas" | "recuperada">("mora");
  const mora = useDatos<FilaMora[]>("/central/cxc/mora");
  const actas = useDatos<Acta[]>("/central/cxc/recuperaciones");
  const rec = useDatos<Recuperada[]>("/central/cxc/recuperada");
  const [nueva, setNueva] = useState<FilaMora | null>(null);
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" } | null>(null);
  const supervisor = puede("venta.anular");
  const recargarTodo = () => { mora.recargar(); actas.recargar(); rec.recargar(); };

  const aplicar = async (a: Acta) => {
    if (!confirm(`Se descontarán RD$ ${num(Number(a.valorTotal), 2)} de la deuda de ${a.cliente} y la mercancía pasará al almacén «Recuperada».\n\n¿Aplicar el acta ${a.acta}?`)) return;
    try {
      const r = await api<{ saldoDespues: string; planSaldado: boolean }>(`/central/cxc/recuperaciones/${a.id}/aplicar`, { cuerpo: {} });
      setMsg({ t: `Acta ${a.acta} aplicada. Saldo del cliente: ${rd(r.saldoDespues)}${r.planSaldado ? " (el plan quedó saldado)" : ""}.`, tipo: "ok" }); recargarTodo();
    } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
  };
  const cancelar = async (a: Acta) => {
    if (!confirm(`¿Cancelar el acta ${a.acta}?`)) return;
    try { await api(`/central/cxc/recuperaciones/${a.id}/cancelar`, { cuerpo: {} }); recargarTodo(); } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
  };
  const actualizar = async (id: string, cuerpo: Record<string, unknown>) => {
    try { await api(`/central/cxc/recuperada/${id}`, { metodo: "PUT", cuerpo }); rec.recargar(); } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
  };

  return (
    <>
      <Encabezado titulo="Mora y recuperación" descripcion="Clientes atrasados, mercancía que se recoge por falta de pago y su vuelta a la venta." />
      {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}
      <Aviso texto={mora.error || actas.error || rec.error} />
      <div className="fila-acciones no-imprimir" style={{ marginBottom: 10 }}>
        {([["mora", `Mora (${mora.datos?.length ?? 0})`], ["actas", "Actas de recuperación"], ["recuperada", "Mercancía recuperada"]] as const).map(([id, t]) =>
          <button key={id} className={"boton" + (pestana === id ? " primario" : "")} onClick={() => { setPestana(id); setNueva(null); }}>{t}</button>)}
      </div>

      {pestana === "mora" && !nueva && (
        <div className="tarjeta" style={{ overflowX: "auto" }}>
          <table className="tabla">
            <thead><tr><th>Cliente</th><th>Plan / factura</th><th className="der">Cuotas vencidas</th><th className="der">Atraso</th><th className="der">Vencido</th><th className="der">Mora</th><th className="der">Debe en total</th><th>Garante</th><th /></tr></thead>
            <tbody>
              {(mora.datos ?? []).length === 0 && <tr><td colSpan={9} className="suave">{mora.cargando ? "Cargando…" : "No hay clientes con cuotas vencidas."}</td></tr>}
              {(mora.datos ?? []).map((m) => (
                <tr key={m.planId}>
                  <td><b>{m.cliente}</b><div className="suave pequeno">{m.telefono ?? "sin teléfono"}</div></td>
                  <td>{m.plan}{m.factura ? <span className="suave"> · #{m.factura}</span> : ""}</td>
                  <td className="der">{m.cuotasVencidas} de {m.cuotas}</td>
                  <td className="der"><b className={m.diasAtraso > 30 ? "texto-alerta" : ""}>{m.diasAtraso} días</b></td>
                  <td className="der">{rd(m.vencido)}</td>
                  <td className="der">{Number(m.moraPorCobrar) > 0 ? rd(m.moraPorCobrar) : "—"}</td>
                  <td className="der"><b>{rd(m.saldo)}</b></td>
                  <td>{m.garante ?? "—"}{m.garanteTelefono && <div className="suave pequeno">{m.garanteTelefono}</div>}</td>
                  <td className="der">{puede("admin.cxc") && <button className="boton chico" onClick={() => setNueva(m)}>Recuperar mercancía</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="suave pequeno" style={{ marginBottom: 0 }}>La mora se carga al estado de cuenta desde Cuentas por cobrar › plan de cuotas del cliente.</p>
        </div>
      )}
      {pestana === "mora" && nueva && <NuevaActa fila={nueva} onCerrar={() => setNueva(null)} onListo={(t) => { setMsg({ t, tipo: "ok" }); setNueva(null); setPestana("actas"); recargarTodo(); }} onError={(t) => setMsg({ t, tipo: "error" })} />}

      {pestana === "actas" && (
        <div className="tarjeta" style={{ overflowX: "auto" }}>
          <table className="tabla">
            <thead><tr><th>Acta</th><th>Fecha</th><th>Cliente</th><th>Artículos</th><th className="der">Valorado</th><th>Estado</th><th /></tr></thead>
            <tbody>
              {(actas.datos ?? []).length === 0 && <tr><td colSpan={7} className="suave">No hay actas. Se crean desde la pestaña Mora.</td></tr>}
              {(actas.datos ?? []).map((a) => (
                <tr key={a.id} style={a.estado === "CANCELADA" ? { opacity: 0.5 } : undefined}>
                  <td><b>{a.acta}</b></td>
                  <td>{fecha(a.fechaRecogida)}</td>
                  <td>{a.cliente}{a.factura ? <span className="suave"> · factura #{a.factura}</span> : ""}<div className="suave pequeno">{a.motivo}</div></td>
                  <td>{(a.items ?? []).map((i) => <div key={i.id}>{i.descripcion}{i.serie ? <span className="suave"> · {i.serie}</span> : ""} <span className="suave">({ESTADO[i.estadoFisico]})</span></div>)}</td>
                  <td className="der"><b>{rd(a.valorTotal)}</b>{a.saldoDespues !== null && <div className="suave pequeno">debía {rd(a.saldoAntes)} → {rd(a.saldoDespues)}</div>}</td>
                  <td><span className={"pastilla" + (a.estado === "APLICADA" ? " recibida" : "")}>{a.estado === "ABIERTA" ? "Pendiente de aplicar" : a.estado === "APLICADA" ? "Aplicada" : "Cancelada"}</span></td>
                  <td className="der">{a.estado === "ABIERTA" && <>
                    <button className="boton chico primario" disabled={!supervisor} title={supervisor ? "" : "Solo un supervisor (permiso de anular ventas)"} onClick={() => aplicar(a)}>Aplicar</button>{" "}
                    <button className="boton chico" onClick={() => cancelar(a)}>Cancelar</button></>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!supervisor && <p className="suave pequeno" style={{ marginBottom: 0 }}>Aplicar un acta (descontar la deuda y recibir la mercancía) lo decide un supervisor.</p>}
        </div>
      )}

      {pestana === "recuperada" && (
        <div className="tarjeta" style={{ overflowX: "auto" }}>
          <table className="tabla">
            <thead><tr><th>Artículo</th><th>Origen</th><th>Estado</th><th className="der">Costo</th><th className="der">Reparación</th><th className="der">Precio de usado</th><th>Proceso</th></tr></thead>
            <tbody>
              {(rec.datos ?? []).length === 0 && <tr><td colSpan={7} className="suave">Todavía no hay mercancía recuperada.</td></tr>}
              {(rec.datos ?? []).map((r) => <FilaRecuperada key={r.id} r={r} onGuardar={actualizar} />)}
            </tbody>
          </table>
          <p className="suave pequeno" style={{ marginBottom: 0 }}>La mercancía está en el almacén «Recuperada», aparte del piso de venta. La reventa como USADO con su etiqueta y garantía reducida se activa en la siguiente entrega.</p>
        </div>
      )}
    </>
  );
}

function FilaRecuperada({ r, onGuardar }: { r: Recuperada; onGuardar: (id: string, c: Record<string, unknown>) => void }) {
  const [rep, setRep] = useState(r.costoReparacion);
  const [precio, setPrecio] = useState(r.precioUsado ?? "");
  const vendida = r.proceso === "VENDIDA";
  return (
    <tr>
      <td><b>{r.descripcion}</b>{r.serie && <div className="suave pequeno">{r.serie}</div>}</td>
      <td>{r.cliente}<div className="suave pequeno">{r.acta} · {fecha(r.fechaRecogida)}</div></td>
      <td>{ESTADO[r.estadoFisico]}</td>
      <td className="der">{rd(r.valoracion)}</td>
      <td className="der"><input className="numero" style={{ width: 90 }} disabled={vendida} inputMode="decimal" value={rep} onChange={(e) => setRep(decimal(e.target.value))} onBlur={() => rep !== r.costoReparacion && onGuardar(r.id, { costoReparacion: rep || "0" })} /></td>
      <td className="der"><input className="numero" style={{ width: 100 }} disabled={vendida} inputMode="decimal" value={precio} placeholder="Sin precio" onChange={(e) => setPrecio(decimal(e.target.value))} onBlur={() => precio !== (r.precioUsado ?? "") && precio && onGuardar(r.id, { precioUsado: precio })} /></td>
      <td>{vendida ? <span className="pastilla">Vendida</span> : (
        <select value={r.proceso} onChange={(e) => onGuardar(r.id, { proceso: e.target.value, ...(precio ? { precioUsado: precio } : {}) })}>
          {(["EN_REVISION", "EN_REPARACION", "LISTA"] as const).map((p) => <option key={p} value={p}>{PROCESO[p]}</option>)}
        </select>)}</td>
    </tr>
  );
}

function NuevaActa({ fila, onCerrar, onListo, onError }: { fila: FilaMora; onCerrar: () => void; onListo: (t: string) => void; onError: (t: string) => void }) {
  const rec = useDatos<Recuperables>(`/central/cxc/${fila.clienteId}/recuperables`);
  const [piezas, setPiezas] = useState<Pieza[]>([]);
  const [motivo, setMotivo] = useState(`Atraso de ${fila.diasAtraso} días con ${fila.cuotasVencidas} cuota(s) vencida(s)`);
  const [guardando, setGuardando] = useState(false);
  const total = piezas.reduce((a, p) => a + Number(p.valoracion || 0), 0);
  const saldo = Number(fila.saldo);
  const quitar = (clave: string) => setPiezas((ps) => ps.filter((p) => p.clave !== clave));
  const agregar = (presentacionId: string, descripcion: string, serie: string) => {
    const clave = `${presentacionId}|${serie}`;
    setPiezas((ps) => ps.some((p) => p.clave === clave && serie) ? ps : [...ps, { clave: serie ? clave : `${clave}${crypto.randomUUID()}`, presentacionId, descripcion, serie, estadoFisico: "REGULAR", valoracion: "" }]);
  };
  const cambiar = (clave: string, c: Partial<Pieza>) => setPiezas((ps) => ps.map((p) => (p.clave === clave ? { ...p, ...c } : p)));
  const problema = !piezas.length ? "Elija lo que se recoge." : piezas.some((p) => !(Number(p.valoracion) > 0)) ? "Ponga la valoración de cada artículo." : total > saldo ? `Lo valorado (${rd(total)}) pasa de lo que debe (${rd(saldo)}).` : motivo.trim().length < 5 ? "Escriba el motivo." : "";
  const guardar = async () => {
    setGuardando(true);
    try {
      const r = await api<{ numero: string }>(`/central/cxc/${fila.clienteId}/recuperaciones`, { cuerpo: {
        planId: fila.planId, motivo: motivo.trim(),
        items: piezas.map((p) => ({ presentacionId: p.presentacionId, ...(p.serie ? { serie: p.serie } : {}), estadoFisico: p.estadoFisico, valoracion: Number(p.valoracion).toFixed(2) })),
      } });
      onListo(`Acta RM-${String(r.numero).padStart(6, "0")} creada. Un supervisor debe aplicarla para descontar la deuda y recibir la mercancía.`);
    } catch (e) { onError((e as Error).message); setGuardando(false); }
  };
  return (
    <div className="tarjeta" style={{ maxWidth: 860 }}>
      <h3 style={{ marginTop: 0 }}>Acta de recuperación · {fila.cliente}</h3>
      <p className="suave">Debe {rd(fila.saldo)} · {fila.cuotasVencidas} cuota(s) vencida(s) · {fila.diasAtraso} días de atraso. Valorar lo que se recoge es lo que se le descuenta de la deuda; no se le devuelve dinero.</p>
      <Aviso texto={rec.error} />
      <h4 style={{ margin: "8px 0 4px" }}>Lo que compró (toque para agregarlo al acta)</h4>
      <div className="fila-acciones" style={{ flexWrap: "wrap" }}>
        {(rec.datos?.lineas ?? []).length === 0 && <span className="suave">{rec.cargando ? "Cargando…" : "Este plan no está ligado a una factura con artículos."}</span>}
        {(rec.datos?.lineas ?? []).flatMap((l) => l.usaSeries
          ? l.series.map((s) => <button key={s} className="boton chico" onClick={() => agregar(l.presentacionId, l.descripcion, s)}>{l.descripcion} · {s}</button>)
          : [<button key={l.itemId} className="boton chico" onClick={() => agregar(l.presentacionId, l.descripcion, "")}>{l.descripcion}</button>])}
      </div>
      {piezas.length > 0 && (
        <table className="tabla" style={{ marginTop: 10 }}>
          <thead><tr><th>Artículo</th><th>Estado</th><th className="der">Valoración (RD$)</th><th /></tr></thead>
          <tbody>{piezas.map((p) => (
            <tr key={p.clave}>
              <td><b>{p.descripcion}</b>{p.serie && <div className="suave pequeno">{p.serie}</div>}</td>
              <td><select value={p.estadoFisico} onChange={(e) => cambiar(p.clave, { estadoFisico: e.target.value as Pieza["estadoFisico"] })}>{Object.entries(ESTADO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></td>
              <td className="der"><input className="numero" style={{ width: 120 }} inputMode="decimal" value={p.valoracion} onChange={(e) => cambiar(p.clave, { valoracion: decimal(e.target.value) })} /></td>
              <td><button className="boton fantasma" aria-label="Quitar" onClick={() => quitar(p.clave)}>✕</button></td>
            </tr>))}
          </tbody>
          <tfoot><tr><td colSpan={2} className="der"><b>Se descuenta de la deuda</b></td><td className="der"><b>{rd(total)}</b></td><td /></tr>
            <tr><td colSpan={2} className="der suave">Quedaría debiendo</td><td className="der">{rd(Math.max(0, saldo - total))}</td><td /></tr></tfoot>
        </table>
      )}
      <label className="campo" style={{ marginTop: 10 }}><span>Motivo</span><input value={motivo} maxLength={300} onChange={(e) => setMotivo(e.target.value)} /></label>
      {problema && piezas.length > 0 && <p className="suave pequeno">{problema}</p>}
      <div className="fila-acciones">
        <button className="boton primario" disabled={!!problema || guardando} onClick={guardar}>{guardando ? "Guardando…" : "Crear acta"}</button>
        <button className="boton" onClick={onCerrar}>Cancelar</button>
      </div>
      <p className="suave pequeno">Antes de recoger la mercancía, revise con su abogado el texto legal de la recogida y con su contador la nota de crédito que corresponda.</p>
    </div>
  );
}
