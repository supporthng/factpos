import { useEffect, useState } from "react";
import { api, rd, type Ajustes } from "./api";
import type { ConfigCaja, Turno, Usuario } from "./App";
import { Modal, TamanoPantalla } from "./Venta";
import { MovimientosCaja } from "./Caja";
import { useConexion } from "./contingencia";

/**
 * Turno de la caja registradora (F10):
 *  - Cuadre del turno (reporte X): cómo va, sin cerrar.
 *  - Cerrar turno (reporte Z): conteo CIEGO de billetes y monedas, más lo de
 *    tarjeta y transferencia. Lo esperado se muestra solo DESPUÉS de cerrar.
 *  - Cuadre de caja del día: todos los turnos de esta caja hoy.
 */
const DENOMINACIONES = [2000, 1000, 500, 200, 100, 50, 25, 10, 5, 1];
const PAGO: Record<string, string> = { EFECTIVO: "Efectivo", TARJETA: "Tarjeta", TRANSFERENCIA: "Transferencia", CREDITO: "Crédito", DELIVERY: "Delivery", OTRO: "Otro" };
const hora = (iso: string | null) => (iso ? new Date(iso).toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", hour12: false, dateStyle: "short", timeStyle: "short" }) : "—");

interface Reporte {
  turno: { id: string; estado: string; abiertoEn: string; cerradoEn: string | null; fondoInicial: string; cajero: string; cerradoPor: string | null;
    caja: string; sucursal: string; declarado: Record<string, string> | null; diferencia: string | null; conteo: Record<string, number> | null; notas: string | null };
  ventas: { facturas: string; creditoFiscal: string; total: string; itbis: string; descuentos: string; primeraFactura: string | null; ultimaFactura: string | null };
  formasPago: { formaPago: string; monto: string; operaciones: number }[];
  anulaciones: { cantidad: number; monto: string };
  efectivo: { fondo: string; ventas: string; entradas: string; salidas: string; esperado: string };
  resumenMovimientos?: { retiros: string; gastos: string; sencillo: string; abonos: string; delivery: string };
  esperado: Record<string, string>;
}

export function TurnoCaja({ ajustes, config, usuario, turno, pausadas, onCerrado, onCerrar }: {
  ajustes: Ajustes; config: ConfigCaja; usuario: Usuario; turno: Turno; pausadas: number;
  onCerrado: () => void; onCerrar: () => void;
}) {
  const [pestana, setPestana] = useState<"x" | "mov" | "z" | "dia">("x");
  const [z, setZ] = useState<Reporte | null>(null);

  // Después de cerrar: el reporte Z, para imprimir y salir
  if (z) return <ReporteImpreso r={z} config={config} titulo="CIERRE DE TURNO (Z)" onCerrar={onCerrado} textoCerrar="Terminar" />;

  return (
    <Modal titulo="Turno y cuadre" onCerrar={onCerrar} ancho>
      <p className="suave">Turno de {turno.usuario} · abierto {hora(turno.abiertoEn)}</p>
      <div className="pestanas-caja">
        <button className={pestana === "x" ? "activa" : ""} onClick={() => setPestana("x")}>Cuadre del turno</button>
        <button className={pestana === "mov" ? "activa" : ""} onClick={() => setPestana("mov")}>Retiros y gastos</button>
        <button className={pestana === "z" ? "activa" : ""} onClick={() => setPestana("z")}>Cerrar turno</button>
        <button className={pestana === "dia" ? "activa" : ""} onClick={() => setPestana("dia")}>Cuadre de caja del día</button>
      </div>
      {pestana === "x" && <CuadreX ajustes={ajustes} config={config} />}
      {pestana === "mov" && <MovimientosCaja ajustes={ajustes} config={config} />}
      {pestana === "z" && <CerrarTurno ajustes={ajustes} usuario={usuario} pausadas={pausadas} onCerrado={setZ} />}
      {pestana === "dia" && <CuadreDia ajustes={ajustes} />}
    </Modal>
  );
}

/* ---------- Reporte X ---------- */
function CuadreX({ ajustes, config }: { ajustes: Ajustes; config: ConfigCaja }) {
  const [r, setR] = useState<Reporte | null>(null);
  const [msg, setMsg] = useState("");
  const [imprimir, setImprimir] = useState(false);
  useEffect(() => { api<Reporte>(ajustes.servidor, `/cajas/${ajustes.cajaId}/turno/cuadre`).then(setR).catch((e) => setMsg(e.message)); }, [ajustes]);
  if (msg) return <p className="error">{msg}</p>;
  if (!r) return <p className="suave">Cargando…</p>;
  if (imprimir) return <ReporteImpreso r={r} config={config} titulo="CUADRE DE TURNO (X)" onCerrar={() => setImprimir(false)} textoCerrar="Volver" />;
  return (
    <>
      <div className="cuadre-resumen">
        <div><span>Facturas</span><b>{r.ventas.facturas}</b></div>
        <div><span>Vendido</span><b>{rd(r.ventas.total)}</b></div>
        <div><span>Anuladas</span><b>{r.anulaciones.cantidad}{r.anulaciones.cantidad > 0 && <small> · {rd(r.anulaciones.monto)}</small>}</b></div>
        <div><span>Descuentos</span><b>{rd(r.ventas.descuentos)}</b></div>
      </div>
      <div className="totales compacto">
        {r.formasPago.map((f) => <div key={f.formaPago}><span>{PAGO[f.formaPago] ?? f.formaPago} ({f.operaciones})</span><span>{rd(f.monto)}</span></div>)}
        <div><span>Fondo inicial</span><span>{rd(r.efectivo.fondo)}</span></div>
        {Number(r.efectivo.entradas) > 0 && <div><span>Entradas en efectivo (abonos, sencillo, delivery)</span><span>{rd(r.efectivo.entradas)}</span></div>}
        {Number(r.resumenMovimientos?.retiros) > 0 && <div><span>Retiros</span><span>−{rd(r.resumenMovimientos!.retiros)}</span></div>}
        {Number(r.resumenMovimientos?.gastos) > 0 && <div><span>Gastos</span><span>−{rd(r.resumenMovimientos!.gastos)}</span></div>}
        <div className="gran-total"><span>Efectivo que debe haber</span><span>{rd(r.efectivo.esperado)}</span></div>
      </div>
      <div className="dos-columnas acciones-cuadre">
        <button className="boton" onClick={() => setImprimir(true)}>Imprimir cuadre (X)</button>
        <span />
      </div>
      <TamanoPantalla />
    </>
  );
}

/* ---------- Cierre Z ---------- */
function CerrarTurno({ ajustes, usuario, pausadas, onCerrado }: { ajustes: Ajustes; usuario: Usuario; pausadas: number; onCerrado: (r: Reporte) => void }) {
  const [conteo, setConteo] = useState<Record<string, string>>({});
  const [tarjeta, setTarjeta] = useState("");
  const [transferencia, setTransferencia] = useState("");
  const [notas, setNotas] = useState("");
  const [confirmar, setConfirmar] = useState(false);
  const [msg, setMsg] = useState("");
  const [enviando, setEnviando] = useState(false);
  const efectivo = DENOMINACIONES.reduce((a, d) => a + d * (Number(conteo[d]) || 0), 0);

  const cerrar = async () => {
    setEnviando(true);
    setMsg("");
    try {
      const r = await api<Reporte>(ajustes.servidor, `/cajas/${ajustes.cajaId}/turno/cerrar`, {
        cuerpo: {
          usuarioId: usuario.id,
          conteo: Object.fromEntries(Object.entries(conteo).filter(([, v]) => Number(v) > 0).map(([k, v]) => [k, Number(v)])),
          tarjeta: (Number(tarjeta) || 0).toFixed(2), transferencia: (Number(transferencia) || 0).toFixed(2), notas: notas || null,
        },
      });
      onCerrado(r);
    } catch (e) {
      setMsg((e as Error).message);
      setEnviando(false);
      setConfirmar(false);
    }
  };

  const conexion = useConexion();
  if (!conexion.enLinea) return <p className="error">Sin conexión con el servidor no se puede cerrar el turno. Siga vendiendo; cierre cuando vuelva el servidor.</p>;
  if (conexion.pendientes > 0) return <p className="error">Antes de cerrar deben enviarse {conexion.pendientes} venta(s) guardadas en esta caja{conexion.errores ? " (algunas tienen error: llame al servicio técnico)" : ""}.</p>;
  return (
    <div className="cierre">
      <p className="suave">Cuente el dinero de la gaveta. Lo que el sistema espera se muestra después de cerrar.</p>
      {pausadas > 0 && <p className="aviso-pausadas">Hay {pausadas} venta(s) en pausa. Quedarán guardadas para el próximo turno.</p>}
      <div className="cierre-columnas">
        <div className="conteo">
          <div className="conteo-titulo"><span>Billetes y monedas</span><span>Cantidad</span><span>Total</span></div>
          {DENOMINACIONES.map((d) => (
            <label key={d} className="conteo-fila">
              <span className={d >= 50 ? "billete" : "moneda"}>{rd(d).replace(".00", "")}</span>
              <input inputMode="numeric" value={conteo[d] ?? ""} placeholder="0" aria-label={`Cantidad de ${d}`}
                onChange={(e) => { setConteo({ ...conteo, [d]: e.target.value.replace(/\D/g, "") }); setConfirmar(false); }} />
              <span className="conteo-total">{Number(conteo[d]) ? rd(d * Number(conteo[d])) : ""}</span>
            </label>
          ))}
          <div className="conteo-suma"><span>Efectivo contado</span><b>{rd(efectivo)}</b></div>
        </div>
        <div className="otros-cierre">
          <label className="campo"><span>Total de vouchers de tarjeta</span>
            <input className="entrada-media" inputMode="decimal" value={tarjeta} placeholder="0.00" onChange={(e) => { setTarjeta(e.target.value.replace(/[^\d.]/g, "")); setConfirmar(false); }} />
          </label>
          <label className="campo"><span>Total de transferencias</span>
            <input className="entrada-media" inputMode="decimal" value={transferencia} placeholder="0.00" onChange={(e) => { setTransferencia(e.target.value.replace(/[^\d.]/g, "")); setConfirmar(false); }} />
          </label>
          <label className="campo"><span>Notas (opcional)</span><input value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Ej. billete de 500 roto" /></label>
          <div className="declarado-total"><span>Total declarado</span><b>{rd(efectivo + (Number(tarjeta) || 0) + (Number(transferencia) || 0))}</b></div>
          {msg && <p className="error">{msg}</p>}
          {!confirmar
            ? <button className="boton cobrar" onClick={() => setConfirmar(true)}>Cerrar turno</button>
            : (
              <div className="confirmar-cierre">
                <p>¿Cerrar el turno? Después de cerrar no se puede facturar en este turno.</p>
                <div className="dos-columnas">
                  <button className="boton fantasma" onClick={() => setConfirmar(false)}>Seguir contando</button>
                  <button className="boton primario" disabled={enviando} onClick={cerrar}>{enviando ? "Cerrando…" : "Sí, cerrar"}</button>
                </div>
              </div>
            )}
        </div>
      </div>
    </div>
  );
}

/* ---------- Cuadre del día ---------- */
function CuadreDia({ ajustes }: { ajustes: Ajustes }) {
  const [d, setD] = useState<any>(null);
  const [msg, setMsg] = useState("");
  useEffect(() => { api(ajustes.servidor, `/cajas/${ajustes.cajaId}/cuadre-dia`).then(setD).catch((e) => setMsg(e.message)); }, [ajustes]);
  if (msg) return <p className="error">{msg}</p>;
  if (!d) return <p className="suave">Cargando…</p>;
  return (
    <>
      <div className="cuadre-resumen">
        <div><span>Turnos</span><b>{d.turnos.length}</b></div>
        <div><span>Facturas</span><b>{d.totales.facturas}</b></div>
        <div><span>Vendido</span><b>{rd(d.totales.ventas)}</b></div>
        <div><span>Diferencia</span><b className={Number(d.totales.diferencia) < 0 ? "negativo" : Number(d.totales.diferencia) > 0 ? "positivo" : ""}>{rd(d.totales.diferencia)}</b></div>
      </div>
      <table className="tabla-cuadre">
        <thead><tr><th>Cajero</th><th>Abierto</th><th>Cerrado</th><th className="der">Vendido</th><th className="der">Diferencia</th></tr></thead>
        <tbody>
          {d.turnos.map((t: any) => (
            <tr key={t.id}>
              <td>{t.cajero}</td><td>{hora(t.abiertoEn)}</td><td>{t.estado === "ABIERTO" ? <span className="pastilla-abierto">Abierto</span> : hora(t.cerradoEn)}</td>
              <td className="der">{rd(t.ventas)}</td>
              <td className={"der " + (Number(t.diferencia) < 0 ? "negativo" : Number(t.diferencia) > 0 ? "positivo" : "")}>{t.diferencia === null ? "—" : rd(t.diferencia)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="totales compacto">
        {d.formasPago.map((f: any) => <div key={f.formaPago}><span>{PAGO[f.formaPago] ?? f.formaPago}</span><span>{rd(f.monto)}</span></div>)}
      </div>
    </>
  );
}

/* ---------- Reporte impreso (X o Z), ticket de 80 mm ---------- */
function ReporteImpreso({ r, config, titulo, onCerrar, textoCerrar }: { r: Reporte; config: ConfigCaja; titulo: string; onCerrar: () => void; textoCerrar: string }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); window.print(); } };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  const cerrado = r.turno.estado === "CERRADO";
  const dif = Number(r.turno.diferencia ?? 0);
  return (
    <div className="fondo-modal">
      <div className="modal ticket-modal">
        {cerrado && (
          <div className={"resultado-cierre " + (dif < 0 ? "faltante" : dif > 0 ? "sobrante" : "cuadrado")}>
            {dif === 0 ? "Turno cuadrado" : dif < 0 ? `Faltan ${rd(-dif)}` : `Sobran ${rd(dif)}`}
          </div>
        )}
        <div className="ticket" id="ticket">
          <div className="t-centro"><b className="t-grande">{config.empresa}</b><div>{r.turno.sucursal} · {r.turno.caja}</div></div>
          <div className="t-linea" />
          <div className="t-centro"><b>{titulo}</b></div>
          <div className="t-fila"><span>Cajero</span><span>{r.turno.cajero}</span></div>
          <div className="t-fila"><span>Abierto</span><span>{hora(r.turno.abiertoEn)}</span></div>
          {cerrado && <div className="t-fila"><span>Cerrado</span><span>{hora(r.turno.cerradoEn)}</span></div>}
          {r.ventas.primeraFactura && <div className="t-fila"><span>Facturas</span><span>#{r.ventas.primeraFactura} a #{r.ventas.ultimaFactura}</span></div>}
          <div className="t-linea" />
          <div className="t-fila"><span>Facturas emitidas</span><span>{r.ventas.facturas}</span></div>
          <div className="t-fila"><span>Anulaciones</span><span>{r.anulaciones.cantidad} · {rd(r.anulaciones.monto)}</span></div>
          <div className="t-fila"><span>Descuentos</span><span>{rd(r.ventas.descuentos)}</span></div>
          <div className="t-fila"><span>ITBIS</span><span>{rd(r.ventas.itbis)}</span></div>
          <div className="t-fila t-total"><span>VENTA NETA</span><span>{rd(r.ventas.total)}</span></div>
          <div className="t-linea" />
          {r.formasPago.map((f) => <div key={f.formaPago} className="t-fila"><span>{PAGO[f.formaPago] ?? f.formaPago} ({f.operaciones})</span><span>{rd(f.monto)}</span></div>)}
          <div className="t-linea" />
          <div className="t-fila"><span>Fondo inicial</span><span>{rd(r.efectivo.fondo)}</span></div>
          {r.resumenMovimientos && (["abonos", "sencillo", "delivery", "retiros", "gastos"] as const).filter((k) => Number(r.resumenMovimientos![k]) > 0).map((k) => (
            <div key={k} className="t-fila"><span>{{ abonos: "Abonos de clientes", sencillo: "Entrada de sencillo", delivery: "Liquidación delivery", retiros: "Retiros", gastos: "Gastos" }[k]}</span>
              <span>{k === "retiros" || k === "gastos" ? "−" : ""}{rd(r.resumenMovimientos![k])}</span></div>
          ))}
          {cerrado && r.turno.declarado ? (
            <>
              <div className="t-fila t-cab"><span>Cuadre</span><span>Esperado / Contado</span></div>
              {["EFECTIVO", "TARJETA", "TRANSFERENCIA"].map((f) => (
                <div key={f} className="t-fila"><span>{PAGO[f]}</span><span>{rd(r.esperado[f])} / {rd(r.turno.declarado![f])}</span></div>
              ))}
              <div className="t-fila t-total"><span>DIFERENCIA</span><span>{rd(r.turno.diferencia ?? 0)}</span></div>
              {r.turno.conteo && Object.keys(r.turno.conteo).length > 0 && (
                <>
                  <div className="t-linea" />
                  {Object.entries(r.turno.conteo).sort((a, b) => Number(b[0]) - Number(a[0])).map(([d, n]) => (
                    <div key={d} className="t-fila"><span>{n} x {rd(d).replace(".00", "")}</span><span>{rd(Number(d) * n)}</span></div>
                  ))}
                </>
              )}
              {r.turno.notas && <div>Nota: {r.turno.notas}</div>}
              <div className="t-linea" />
              <div className="t-firma">Firma cajero</div>
              <div className="t-firma">Firma supervisor</div>
            </>
          ) : (
            <div className="t-fila t-total"><span>EFECTIVO ESPERADO</span><span>{rd(r.efectivo.esperado)}</span></div>
          )}
        </div>
        <div className="dos-columnas">
          <button className="boton primario" onClick={() => window.print()}>Imprimir (Enter)</button>
          <button className="boton" onClick={onCerrar}>{textoCerrar}</button>
        </div>
      </div>
    </div>
  );
}
