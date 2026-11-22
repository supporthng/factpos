import { useState } from "react";
import { api, hoy, num, rd } from "../api";
import { Aviso, Encabezado, useDatos } from "../ui";

/**
 * Cobranza en ruta: a quién cobrar hoy (cuotas vencidas y las que vencen en pocos días), el cobrador de cada plan
 * y el registro de cada gestión con su promesa de pago. El dinero que se recibe se registra en Cuentas por cobrar (abono con recibo).
 */
interface Fila {
  planId: string; clienteId: string; cliente: string; telefono: string | null; documento: string | null; direccion: string | null; plan: string; factura: number | null;
  garante: string | null; garanteTelefono: string | null; saldo: string; cobradorId: string | null; cobrador: string | null;
  estado: "VENCIDO" | "POR_VENCER"; cuotasVencidas: number; diasAtraso: number; vencido: string;
  proxima: { numero: number; vence: string; pendiente: string } | null;
  ultimaGestion: { fecha: string; tipo: string; resultado: string; nota: string | null; por: string | null } | null;
  promesa: { fecha: string; monto: string | null; incumplida: boolean } | null; proximaGestion: string | null;
}
interface Gestion { id: string; fecha: string; tipo: string; resultado: string; nota: string | null; promesaFecha: string | null; promesaMonto: string | null; proximaFecha: string | null; por: string | null }
const TIPO: Record<string, string> = { LLAMADA: "Llamada", VISITA: "Visita", MENSAJE: "Mensaje", OTRO: "Otro" };
const RESULTADO: Record<string, string> = { PROMESA: "Prometió pagar", PAGO: "Pagó", NO_LOCALIZADO: "No localizado", SIN_PAGO: "Sin pago", OTRO: "Otro" };
const fechaCorta = (s: string) => s.slice(0, 10).split("-").reverse().join("/");
const fechaHora = (iso: string) => new Date(iso).toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", day: "2-digit", month: "short", hour: "numeric", minute: "2-digit" });
const decimal = (v: string) => v.replace(/[^\d.]/g, "");
const soloTel = (t: string) => { const d = t.replace(/\D/g, ""); return d.length === 10 ? "1" + d : d; };

export function Cobranza() {
  const [dias, setDias] = useState("3");
  const [cobrador, setCobrador] = useState("");
  const params = new URLSearchParams({ dias, ...(cobrador ? { cobradorId: cobrador } : {}) }).toString();
  const ruta = useDatos<Fila[]>(`/central/cobranza/ruta?${params}`, [params]);
  const cobradores = useDatos<{ id: string; nombre: string }[]>("/central/cobranza/cobradores");
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" } | null>(null);
  const [gest, setGest] = useState<Fila | null>(null);
  const filas = ruta.datos ?? [];
  const vencido = filas.reduce((a, f) => a + Number(f.vencido), 0);

  const asignar = async (f: Fila, cobradorId: string) => {
    try { await api("/central/cobranza/asignacion", { metodo: "PUT", cuerpo: { planId: f.planId, cobradorId: cobradorId || null } }); ruta.recargar(); } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
  };
  const recordatorio = (f: Fila) => {
    if (!f.telefono) return;
    const cuota = f.estado === "VENCIDO" ? `tiene ${f.cuotasVencidas} cuota(s) vencida(s) por ${rd(f.vencido)}` : `su próxima cuota de ${rd(f.proxima?.pendiente ?? 0)} vence el ${fechaCorta(f.proxima?.vence ?? hoy())}`;
    const texto = `Buen día ${f.cliente.split(" ")[0]}, le recordamos que ${cuota}. Gracias por su atención.`;
    window.open(`https://wa.me/${soloTel(f.telefono)}?text=${encodeURIComponent(texto)}`, "_blank", "noopener");
  };

  return (
    <>
      <style>{`.solo-imprimir{display:none}@media print{.solo-imprimir{display:table-cell}.no-imprimir{display:none!important}}`}</style>
      <Encabezado titulo="Cobranza en ruta" descripcion="A quién cobrar hoy: cuotas vencidas y las que vencen pronto, con el cobrador de cada cliente y lo que prometió pagar.">
        <button className="boton no-imprimir" onClick={() => window.print()}>Imprimir hoja de cobro</button>
      </Encabezado>
      {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}
      <Aviso texto={ruta.error || cobradores.error} />
      <div className="panel cab-compra no-imprimir">
        <label className="campo"><span>Cobrador</span>
          <select value={cobrador} onChange={(e) => setCobrador(e.target.value)}>
            <option value="">Todos</option><option value="SIN">Sin asignar</option>
            {(cobradores.datos ?? []).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select></label>
        <label className="campo"><span>Mostrar lo que vence en los próximos</span>
          <select value={dias} onChange={(e) => setDias(e.target.value)}>{["0", "3", "7", "15"].map((d) => <option key={d} value={d}>{d === "0" ? "Solo lo vencido" : `${d} días`}</option>)}</select></label>
      </div>

      <div className="tarjeta" style={{ overflowX: "auto" }}>
        <table className="tabla">
          <thead><tr><th>Cliente</th><th>Contacto</th><th>Situación</th><th className="der">Vencido</th><th>Promesa / última gestión</th><th className="no-imprimir">Cobrador</th><th className="no-imprimir" /><th className="solo-imprimir">Cobrado / firma</th></tr></thead>
          <tbody>
            {filas.length === 0 && <tr><td colSpan={8} className="suave">{ruta.cargando ? "Cargando…" : "Nadie por cobrar con ese filtro."}</td></tr>}
            {filas.map((f) => (
              <tr key={f.planId}>
                <td><b>{f.cliente}</b>{f.factura && <span className="suave"> · Fact. #{f.factura}</span>}<div className="suave">{f.plan}</div></td>
                <td>{f.telefono ?? <span className="suave">Sin teléfono</span>}{f.direccion && <div className="suave">{f.direccion}</div>}{f.garante && <div className="suave">Garante: {f.garante}{f.garanteTelefono ? ` · ${f.garanteTelefono}` : ""}</div>}</td>
                <td>{f.estado === "VENCIDO"
                  ? <b style={{ color: "var(--peligro, #b3261e)" }}>{f.cuotasVencidas} vencida(s) · {num(f.diasAtraso)} días</b>
                  : <span>Vence {fechaCorta(f.proxima?.vence ?? "")}: {rd(f.proxima?.pendiente ?? 0)}</span>}</td>
                <td className="der">{f.estado === "VENCIDO" ? <b>{rd(f.vencido)}</b> : "—"}</td>
                <td>
                  {f.promesa && <div style={f.promesa.incumplida ? { color: "var(--peligro, #b3261e)" } : undefined}>
                    {f.promesa.incumplida ? "Promesa incumplida: " : "Prometió: "}{fechaCorta(f.promesa.fecha)}{f.promesa.monto ? ` · ${rd(f.promesa.monto)}` : ""}</div>}
                  {f.ultimaGestion ? <div className="suave">{TIPO[f.ultimaGestion.tipo]} · {RESULTADO[f.ultimaGestion.resultado]} · {fechaHora(f.ultimaGestion.fecha)}{f.ultimaGestion.nota ? ` · ${f.ultimaGestion.nota}` : ""}</div> : <span className="suave">Sin gestiones</span>}
                </td>
                <td className="no-imprimir">
                  <select value={f.cobradorId ?? ""} onChange={(e) => asignar(f, e.target.value)}>
                    <option value="">Sin asignar</option>{(cobradores.datos ?? []).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </select></td>
                <td className="no-imprimir der" style={{ whiteSpace: "nowrap" }}>
                  <button className="boton chico primario" onClick={() => setGest(f)}>Gestión</button>{" "}
                  {f.telefono && <button className="boton chico" onClick={() => recordatorio(f)}>WhatsApp</button>}
                </td>
                <td className="solo-imprimir" style={{ minWidth: 120 }}>{f.cobrador ?? ""}<br />_____________</td>
              </tr>
            ))}
          </tbody>
          {filas.length > 0 && <tfoot><tr><td colSpan={3} className="suave">{num(filas.length)} clientes · {cobrador === "" ? "todos los cobradores" : "filtrado"}</td><td className="der"><b>{rd(vencido)}</b></td><td colSpan={4} /></tr></tfoot>}
        </table>
        <p className="suave no-imprimir" style={{ margin: "8px 0 0" }}>Lo que el cliente paga se registra en Cuentas por cobrar (abono con recibo numerado). Aquí se anota la gestión.</p>
      </div>

      {gest && <FormGestion fila={gest} onCerrar={() => setGest(null)} onListo={() => { setGest(null); setMsg({ t: "Gestión registrada.", tipo: "ok" }); ruta.recargar(); }} onError={(t) => setMsg({ t, tipo: "error" })} />}
    </>
  );
}

function FormGestion({ fila, onCerrar, onListo, onError }: { fila: Fila; onCerrar: () => void; onListo: () => void; onError: (t: string) => void }) {
  const [tipo, setTipo] = useState("LLAMADA");
  const [resultado, setResultado] = useState("PROMESA");
  const [nota, setNota] = useState("");
  const [pFecha, setPFecha] = useState("");
  const [pMonto, setPMonto] = useState("");
  const [proxima, setProxima] = useState("");
  const hist = useDatos<Gestion[]>(`/central/cobranza/gestiones?planId=${fila.planId}`);
  const guardar = async () => {
    try {
      await api("/central/cobranza/gestiones", { cuerpo: {
        planId: fila.planId, tipo, resultado, ...(nota.trim() ? { nota: nota.trim() } : {}),
        ...(resultado === "PROMESA" ? { promesaFecha: pFecha, ...(pMonto ? { promesaMonto: Number(pMonto) } : {}) } : {}), ...(proxima ? { proximaFecha: proxima } : {}),
      } });
      onListo();
    } catch (e) { onError((e as Error).message); }
  };
  return (
    <div className="tarjeta no-imprimir" style={{ marginTop: 12, maxWidth: 640 }}>
      <b>Gestión · {fila.cliente}</b>
      <div className="panel cab-compra">
        <label className="campo"><span>Cómo</span><select value={tipo} onChange={(e) => setTipo(e.target.value)}>{Object.entries(TIPO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="campo"><span>Resultado</span><select value={resultado} onChange={(e) => setResultado(e.target.value)}>{Object.entries(RESULTADO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        {resultado === "PROMESA" && <>
          <label className="campo"><span>Prometió pagar el</span><input type="date" value={pFecha} min={hoy()} onChange={(e) => setPFecha(e.target.value)} /></label>
          <label className="campo"><span>Monto prometido (opcional)</span><input inputMode="decimal" value={pMonto} onChange={(e) => setPMonto(decimal(e.target.value))} /></label>
        </>}
        <label className="campo"><span>Volver a gestionar el</span><input type="date" value={proxima} min={hoy()} onChange={(e) => setProxima(e.target.value)} /></label>
      </div>
      <label className="campo"><span>Nota</span><input value={nota} maxLength={500} onChange={(e) => setNota(e.target.value)} placeholder="Qué dijo el cliente, quién contestó…" /></label>
      <div className="fila-acciones" style={{ marginTop: 8 }}>
        <button className="boton primario" onClick={guardar} disabled={resultado === "PROMESA" && !pFecha}>Guardar gestión</button>
        <button className="boton" onClick={onCerrar}>Cerrar</button>
      </div>
      {(hist.datos ?? []).length > 0 && <>
        <hr /><b>Historial</b>
        <ul style={{ margin: "4px 0 0 18px", padding: 0 }}>
          {(hist.datos ?? []).map((g) => <li key={g.id}>{fechaHora(g.fecha)} · {TIPO[g.tipo]} · {RESULTADO[g.resultado]}{g.promesaFecha ? ` (para el ${fechaCorta(g.promesaFecha)}${g.promesaMonto ? `, ${rd(g.promesaMonto)}` : ""})` : ""}{g.nota ? ` · ${g.nota}` : ""}{g.por ? ` — ${g.por}` : ""}</li>)}
        </ul></>}
    </div>
  );
}
