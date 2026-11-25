import { useState } from "react";
import { api, rd } from "../api";
import { Aviso, useDatos } from "../ui";

export interface MiTurnoCaja {
  cajaId: string; caja: string; sucursalId: string; sucursal: string;
  turno: { id: string; abiertoEn: string; fondoInicial: string; usuarioId: string; usuario: string; esMio: boolean } | null;
}
const DENOM = [2000, 1000, 500, 200, 100, 50, 25, 10, 5, 1];
const hora = (iso: string) => new Date(iso).toLocaleString("es-DO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

/**
 * Modo «una sola persona factura y cobra»: abrir y cerrar el turno sin salir de la administración.
 * El efectivo de lo que se cobra entra a este turno y al cerrarlo se cuadra igual que en la caja (cierre ciego).
 * Si el modo no está activo no se muestra nada.
 */
export function MiTurno({ onCambio }: { onCambio?: () => void }) {
  const d = useDatos<{ modo: boolean; cajas: MiTurnoCaja[] }>("/central/mi-turno");
  const [cajaId, setCajaId] = useState("");
  const [fondo, setFondo] = useState("0");
  const [cerrando, setCerrando] = useState(false);
  const [conteo, setConteo] = useState<Record<number, string>>({});
  const [tarjeta, setTarjeta] = useState("0");
  const [transf, setTransf] = useState("0");
  const [notas, setNotas] = useState("");
  const [msg, setMsg] = useState("");
  const [resultado, setResultado] = useState("");
  const [ocupado, setOcupado] = useState(false);

  if (!d.datos?.modo) return null;
  const cajas = d.datos.cajas;
  const mia = cajas.find((c) => c.turno?.esMio);
  const libres = cajas.filter((c) => !c.turno);
  const elegida = cajaId || libres[0]?.cajaId || "";
  const recargar = () => { void d.recargar(); onCambio?.(); };

  const abrir = async () => {
    setOcupado(true); setMsg(""); setResultado("");
    try {
      await api("/central/mi-turno/abrir", { cuerpo: { cajaId: elegida, fondoInicial: Number(fondo || 0).toFixed(2) } });
      setFondo("0"); recargar();
    } catch (e) { setMsg((e as Error).message); }
    setOcupado(false);
  };
  const cerrar = async () => {
    if (!mia) return;
    setOcupado(true); setMsg("");
    try {
      const cont: Record<string, number> = {};
      for (const [k, v] of Object.entries(conteo)) if (Number(v) > 0) cont[k] = Math.floor(Number(v));
      const r = await api<{ diferencia?: string; totales?: { diferencia?: string } }>(`/central/mi-turno/${mia.cajaId}/cerrar`, {
        cuerpo: { conteo: cont, tarjeta: Number(tarjeta || 0).toFixed(2), transferencia: Number(transf || 0).toFixed(2), notas: notas.trim() || null } });
      const dif = Number(r.diferencia ?? r.totales?.diferencia ?? 0);
      setResultado(Math.abs(dif) < 0.005 ? "Turno cerrado: la caja cuadra." : `Turno cerrado con una diferencia de ${rd(dif)} (${dif > 0 ? "sobrante" : "faltante"}).`);
      setCerrando(false); setConteo({}); setTarjeta("0"); setTransf("0"); setNotas(""); recargar();
    } catch (e) { setMsg((e as Error).message); }
    setOcupado(false);
  };
  const efectivo = DENOM.reduce((a, x) => a + x * Math.floor(Number(conteo[x] || 0)), 0);

  return (
    <div className="panel">
      <h3 style={{ marginTop: 0 }}>Mi turno</h3>
      <Aviso texto={msg} />
      {resultado && <Aviso tipo="info" texto={resultado} />}
      {mia ? (
        <>
          <p style={{ margin: "0 0 8px" }}>
            Turno abierto en <b>{mia.sucursal} · {mia.caja}</b> desde {hora(mia.turno!.abiertoEn)} · fondo {rd(Number(mia.turno!.fondoInicial))}.
            Lo que cobre en efectivo entra a este turno.
          </p>
          {!cerrando && <button className="btn" onClick={() => { setCerrando(true); setResultado(""); }}>Cerrar mi turno</button>}
          {cerrando && (
            <div>
              <p className="suave" style={{ margin: "0 0 8px" }}>Cuente el efectivo que hay en la gaveta: el sistema compara con lo cobrado al cerrar.</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(120px,1fr))", gap: 8 }}>
                {DENOM.map((x) => (
                  <label key={x} className="campo"><span>{x} ×</span>
                    <input inputMode="numeric" value={conteo[x] ?? ""} onChange={(e) => setConteo({ ...conteo, [x]: e.target.value.replace(/\D/g, "") })} /></label>
                ))}
              </div>
              <p style={{ margin: "8px 0" }}>Efectivo contado: <b>{rd(efectivo)}</b></p>
              <div className="dos-col">
                <label className="campo"><span>Total en tarjeta (vouchers)</span><input inputMode="decimal" value={tarjeta} onChange={(e) => setTarjeta(e.target.value)} /></label>
                <label className="campo"><span>Total en transferencias</span><input inputMode="decimal" value={transf} onChange={(e) => setTransf(e.target.value)} /></label>
              </div>
              <label className="campo"><span>Notas (opcional)</span><input value={notas} maxLength={300} onChange={(e) => setNotas(e.target.value)} /></label>
              <div className="fila-acciones">
                <button className="btn primario" disabled={ocupado} onClick={() => void cerrar()}>Confirmar cierre</button>
                <button className="btn" disabled={ocupado} onClick={() => setCerrando(false)}>Cancelar</button>
              </div>
            </div>
          )}
        </>
      ) : libres.length ? (
        <>
          <p className="suave" style={{ margin: "0 0 8px" }}>Abra su turno para empezar a facturar y cobrar. El dinero que reciba queda en el turno y se cuadra al cerrar.</p>
          <div className="dos-col">
            <label className="campo"><span>Caja</span>
              <select value={elegida} onChange={(e) => setCajaId(e.target.value)}>
                {libres.map((c) => <option key={c.cajaId} value={c.cajaId}>{c.sucursal} · {c.caja}</option>)}
              </select></label>
            <label className="campo"><span>Efectivo con que abre (fondo)</span><input inputMode="decimal" value={fondo} onChange={(e) => setFondo(e.target.value)} /></label>
          </div>
          <button className="btn primario" disabled={ocupado || !elegida} onClick={() => void abrir()}>Abrir mi turno</button>
        </>
      ) : (
        <p className="suave" style={{ margin: 0 }}>Todas las cajas tienen turno abierto por otra persona.</p>
      )}
    </div>
  );
}
