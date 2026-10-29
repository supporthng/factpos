import { useEffect, useState } from "react";
import { api, rd, type Ajustes } from "./api";
import type { ConfigCaja } from "./App";
import { Modal } from "./Venta";
import { PinSupervisor, type Aprobacion } from "./Operaciones";

/**
 * Dinero que entra o sale de la gaveta fuera de las ventas:
 *  - Retiro (para el banco o la oficina) y gasto (hielo, transporte…): con PIN del supervisor.
 *  - Sencillo: entra cambio a la gaveta.
 *  - Abono de un cliente a crédito (desde Cliente, F4).
 * Cada uno sale impreso con firmas.
 */
const fechaHora = (iso: string) => new Date(iso).toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", hour12: false, dateStyle: "short", timeStyle: "short" });
const NOMBRE: Record<string, string> = { RETIRO: "Retiro", GASTO: "Gasto", DEPOSITO: "Entrada de sencillo", ABONO_CLIENTE: "Abono de cliente", LIQUIDACION_DELIVERY: "Liquidación delivery" };
const soloMonto = (v: string) => v.replace(/[^\d.]/g, "");

interface Movimiento {
  id: string; tipo: string; monto: string; formaPago: string; concepto: string; categoria: string | null; comprobante: string | null;
  beneficiario: string | null; creadoEn: string; usuario: string; autorizadoPor: string | null; cliente: string | null; caja: string; sucursal: string;
}

/* ---------- Pestaña "Entradas y salidas" del turno ---------- */
export function MovimientosCaja({ ajustes, config }: { ajustes: Ajustes; config: ConfigCaja }) {
  const [datos, setDatos] = useState<{ categorias: string[]; movimientos: Movimiento[] } | null>(null);
  const [nuevo, setNuevo] = useState<"RETIRO" | "GASTO" | "DEPOSITO" | null>(null);
  const [impreso, setImpreso] = useState<Movimiento | null>(null);
  const [msg, setMsg] = useState("");
  const cargar = () => api<typeof datos>(ajustes.servidor, `/cajas/${ajustes.cajaId}/movimientos`).then(setDatos).catch((e) => setMsg(e.message));
  useEffect(() => { cargar(); }, [ajustes]);

  if (impreso) return <Comprobante m={impreso} config={config} onCerrar={() => { setImpreso(null); cargar(); }} />;
  if (nuevo && datos) return <NuevoMovimiento ajustes={ajustes} tipo={nuevo} categorias={datos.categorias} onListo={(m) => { setNuevo(null); setImpreso(m); }} onVolver={() => setNuevo(null)} />;

  const total = (t: string) => (datos?.movimientos ?? []).filter((m) => m.tipo === t).reduce((a, m) => a + Number(m.monto), 0);
  return (
    <>
      <div className="botones-movimiento">
        <button className="boton grande-mov" onClick={() => setNuevo("RETIRO")}><b>Retiro</b><small>Sacar efectivo · con PIN</small></button>
        <button className="boton grande-mov" onClick={() => setNuevo("GASTO")}><b>Gasto</b><small>Pagar algo con la gaveta · con PIN</small></button>
        <button className="boton grande-mov" onClick={() => setNuevo("DEPOSITO")}><b>Sencillo</b><small>Meter cambio a la gaveta</small></button>
      </div>
      {msg && <p className="error">{msg}</p>}
      <div className="cuadre-resumen">
        <div><span>Retiros</span><b>{rd(total("RETIRO"))}</b></div>
        <div><span>Gastos</span><b>{rd(total("GASTO"))}</b></div>
        <div><span>Sencillo</span><b>{rd(total("DEPOSITO"))}</b></div>
        <div><span>Abonos</span><b>{rd(total("ABONO_CLIENTE"))}</b></div>
      </div>
      <table className="tabla-cuadre">
        <thead><tr><th>Hora</th><th>Tipo</th><th>Detalle</th><th>Aprobó</th><th className="der">Monto</th><th></th></tr></thead>
        <tbody>
          {(datos?.movimientos ?? []).map((m) => (
            <tr key={m.id}>
              <td>{fechaHora(m.creadoEn).split(" ").pop()}</td>
              <td>{NOMBRE[m.tipo] ?? m.tipo}</td>
              <td>{m.concepto}{m.categoria ? ` · ${m.categoria}` : ""}{m.formaPago !== "EFECTIVO" ? ` · ${m.formaPago.toLowerCase()}` : ""}</td>
              <td>{m.autorizadoPor ?? "—"}</td>
              <td className={"der " + (["RETIRO", "GASTO"].includes(m.tipo) ? "negativo" : "")}>{["RETIRO", "GASTO"].includes(m.tipo) ? "−" : ""}{rd(m.monto)}</td>
              <td><button className="enlace" onClick={() => setImpreso(m)}>Reimprimir</button></td>
            </tr>
          ))}
          {datos && !datos.movimientos.length && <tr><td colSpan={6} className="suave">Todavía no hay entradas ni salidas en este turno.</td></tr>}
        </tbody>
      </table>
    </>
  );
}

function NuevoMovimiento({ ajustes, tipo, categorias, onListo, onVolver }: {
  ajustes: Ajustes; tipo: "RETIRO" | "GASTO" | "DEPOSITO"; categorias: string[]; onListo: (m: Movimiento) => void; onVolver: () => void;
}) {
  const [monto, setMonto] = useState("");
  const [concepto, setConcepto] = useState(tipo === "RETIRO" ? "Depósito al banco" : tipo === "DEPOSITO" ? "Sencillo para la caja" : "");
  const [categoria, setCategoria] = useState("");
  const [comprobante, setComprobante] = useState("");
  const [beneficiario, setBeneficiario] = useState("");
  const [msg, setMsg] = useState("");
  const listo = Number(monto) > 0 && concepto.trim().length >= 3 && (tipo !== "GASTO" || categoria);

  const enviar = async (a?: Aprobacion) => {
    setMsg("");
    try {
      const m = await api<Movimiento>(ajustes.servidor, `/cajas/${ajustes.cajaId}/movimientos`, {
        cuerpo: {
          tipo, monto: Number(monto).toFixed(2), concepto, categoria: categoria || undefined,
          comprobante: comprobante || undefined, beneficiario: beneficiario || undefined, autorizacion: a?.token,
        },
      });
      onListo(m);
    } catch (e) { setMsg((e as Error).message); }
  };

  return (
    <div className="nuevo-movimiento">
      <h3>{NOMBRE[tipo]}</h3>
      <div className="dos-columnas">
        <label className="campo"><span>Monto</span>
          <input autoFocus className="entrada-media" inputMode="decimal" value={monto} onChange={(e) => setMonto(soloMonto(e.target.value))} placeholder="0.00" />
        </label>
        <label className="campo"><span>{tipo === "GASTO" ? "¿Qué se pagó?" : "Motivo"}</span>
          <input value={concepto} onChange={(e) => setConcepto(e.target.value)} placeholder={tipo === "GASTO" ? "Ej. funda de hielo" : ""} />
        </label>
      </div>
      {tipo === "GASTO" && (
        <>
          <div className="chips-categoria">
            {categorias.map((c) => <button key={c} className={"chip" + (categoria === c ? " activo" : "")} onClick={() => setCategoria(c)}>{c}</button>)}
          </div>
          <div className="dos-columnas">
            <label className="campo"><span>NCF de la factura (si trae)</span><input value={comprobante} onChange={(e) => setComprobante(e.target.value.toUpperCase())} placeholder="B0200000123" /></label>
            <label className="campo"><span>¿A quién se le pagó?</span><input value={beneficiario} onChange={(e) => setBeneficiario(e.target.value)} /></label>
          </div>
        </>
      )}
      {tipo === "RETIRO" && <label className="campo"><span>¿Quién se lleva el dinero?</span><input value={beneficiario} onChange={(e) => setBeneficiario(e.target.value)} /></label>}
      <p className="suave">Monto: <b>{rd(monto || 0)}</b></p>
      {msg && <p className="error">{msg}</p>}
      {tipo === "DEPOSITO"
        ? <button className="boton primario ancho" disabled={!listo} onClick={() => enviar()}>Registrar entrada</button>
        : listo
          ? <PinSupervisor ajustes={ajustes} permiso={tipo === "RETIRO" ? "caja.retiro" : "caja.gasto"} onAprobado={enviar} textoBoton={`Aprobar ${NOMBRE[tipo].toLowerCase()} de ${rd(monto)}`} />
          : <p className="suave">Complete {tipo === "GASTO" ? "el monto, qué se pagó y la categoría" : "el monto y el motivo"} para pedir la aprobación.</p>}
      <button className="enlace" onClick={onVolver}>← Volver</button>
    </div>
  );
}

/** Comprobante impreso del retiro / gasto / entrada (80 mm), con firmas. */
function Comprobante({ m, config, onCerrar }: { m: Movimiento; config: ConfigCaja; onCerrar: () => void }) {
  useImprimirConEnter();
  return (
    <div className="ticket-en-modal">
      <div className="ticket" id="ticket">
        <div className="t-centro"><b className="t-grande">{config.empresa}</b><div>{m.sucursal} · {m.caja}</div></div>
        <div className="t-linea" />
        <div className="t-centro"><b>{(NOMBRE[m.tipo] ?? m.tipo).toUpperCase()} DE CAJA</b></div>
        <div className="t-fila"><span>Fecha</span><span>{fechaHora(m.creadoEn)}</span></div>
        <div className="t-fila"><span>No.</span><span>{m.id.slice(-8).toUpperCase()}</span></div>
        <div className="t-linea" />
        <div>{m.concepto}</div>
        {m.categoria && <div className="t-fila"><span>Categoría</span><span>{m.categoria}</span></div>}
        {m.comprobante && <div className="t-fila"><span>NCF</span><span>{m.comprobante}</span></div>}
        {m.beneficiario && <div className="t-fila"><span>{m.tipo === "GASTO" ? "Pagado a" : "Recibe"}</span><span>{m.beneficiario}</span></div>}
        <div className="t-fila t-total"><span>MONTO</span><span>{rd(m.monto)}</span></div>
        <div className="t-linea" />
        <div className="t-fila"><span>Cajero</span><span>{m.usuario}</span></div>
        {m.autorizadoPor && <div className="t-fila"><span>Aprobó</span><span>{m.autorizadoPor}</span></div>}
        <div className="t-firma">Firma cajero</div>
        {m.tipo !== "DEPOSITO" && <div className="t-firma">{m.tipo === "RETIRO" ? "Firma de quien recibe" : "Firma supervisor"}</div>}
      </div>
      <div className="dos-columnas acciones-ticket">
        <button className="boton primario" onClick={() => window.print()}>Imprimir (Enter)</button>
        <button className="boton" onClick={onCerrar}>Listo</button>
      </div>
    </div>
  );
}

function useImprimirConEnter() {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Enter" && !(e.target instanceof HTMLInputElement)) { e.preventDefault(); window.print(); } };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
}

/* ---------- Abono de un cliente a crédito ---------- */
interface Cuenta {
  id: string; nombre: string; saldo: string; limiteCredito?: string; diasCredito?: number; alDia?: string; vencido?: string; deudaDesde?: string | null;
  movimientos: { tipo: string; monto: string; fecha: string; factura: string | null; sucursal: string; formaPago: string | null }[];
}
interface Recibo {
  recibo: string; cliente: { nombre: string; documento: string | null }; saldoAnterior: string; abono: string; saldoNuevo: string;
  formaPago: string; referencia: string | null; cambio: string; cajero: string; fecha: string;
}

export function AbonoCliente({ ajustes, config, cliente, onVolver, onCerrar }: {
  ajustes: Ajustes; config?: ConfigCaja; cliente: { id: string; nombre: string }; onVolver: () => void; onCerrar: () => void;
}) {
  const [cuenta, setCuenta] = useState<Cuenta | null>(null);
  const [monto, setMonto] = useState("");
  const [forma, setForma] = useState<"EFECTIVO" | "TARJETA" | "TRANSFERENCIA">("EFECTIVO");
  const [recibido, setRecibido] = useState("");
  const [referencia, setReferencia] = useState("");
  const [recibo, setRecibo] = useState<Recibo | null>(null);
  const [msg, setMsg] = useState("");
  const [enviando, setEnviando] = useState(false);
  useEffect(() => { api<Cuenta>(ajustes.servidor, `/cajas/${ajustes.cajaId}/clientes/${cliente.id}/cuenta`).then(setCuenta).catch((e) => setMsg(e.message)); }, [cliente.id]);

  const valor = Number(monto) || 0;
  const cambio = forma === "EFECTIVO" && Number(recibido) > valor ? Number(recibido) - valor : 0;
  const valido = valor > 0 && valor <= Number(cuenta?.saldo ?? 0) && (forma !== "TARJETA" || /^[A-Za-z0-9-]{4,}$/.test(referencia))
    && (forma !== "EFECTIVO" || !recibido || Number(recibido) >= valor);

  const cobrar = async () => {
    setEnviando(true); setMsg("");
    try {
      setRecibo(await api<Recibo>(ajustes.servidor, `/cajas/${ajustes.cajaId}/clientes/${cliente.id}/abonos`, {
        cuerpo: { monto: valor.toFixed(2), formaPago: forma, referencia: referencia || undefined, recibido: forma === "EFECTIVO" && recibido ? Number(recibido).toFixed(2) : undefined },
      }));
    } catch (e) { setMsg((e as Error).message); } finally { setEnviando(false); }
  };

  if (recibo) {
    return (
      <Modal titulo="Recibo de abono" onCerrar={onCerrar}>
        {Number(recibo.cambio) > 0 && <div className="resultado-cierre cuadrado">Cambio: {rd(recibo.cambio)}</div>}
        <ReciboImpreso r={recibo} empresa={config?.empresa ?? ""} onCerrar={onCerrar} />
      </Modal>
    );
  }
  return (
    <Modal titulo={`Abono · ${cliente.nombre}`} onCerrar={onCerrar}>
      {!cuenta ? <p className="suave">{msg || "Cargando la cuenta…"}</p> : (
        <>
          <div className="cuadre-resumen">
            <div><span>Debe</span><b>{rd(cuenta.saldo)}</b></div>
            <div><span>Vencido</span><b className={Number(cuenta.vencido) > 0 ? "negativo" : ""}>{rd(cuenta.vencido ?? 0)}</b></div>
            <div><span>Límite</span><b>{rd(cuenta.limiteCredito ?? 0)}</b></div>
            <div><span>Días de crédito</span><b>{cuenta.diasCredito ?? "—"}</b></div>
          </div>
          {cuenta.movimientos.length > 0 && (
            <table className="tabla-cuadre compacta">
              <tbody>
                {cuenta.movimientos.slice(0, 5).map((m, i) => (
                  <tr key={i}><td>{fechaHora(m.fecha).split(" ")[0].replace(",", "")}</td>
                    <td>{m.tipo === "CARGO" ? `Factura${m.factura ? ` #${m.factura}` : ""}` : m.tipo === "ABONO" ? "Abono" : "Ajuste"} · {m.sucursal}</td>
                    <td className={"der " + (Number(m.monto) < 0 ? "positivo" : "")}>{Number(m.monto) < 0 ? "−" + rd(-Number(m.monto)) : rd(m.monto)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
          {Number(cuenta.saldo) <= 0 ? <p className="suave">Este cliente no debe nada.</p> : (
            <>
              <div className="dos-columnas">
                <label className="campo"><span>Monto del abono</span>
                  <input autoFocus className="entrada-media" inputMode="decimal" value={monto} onChange={(e) => setMonto(soloMonto(e.target.value))} placeholder="0.00" aria-label="Monto del abono" />
                </label>
                <div className="campo"><span>&nbsp;</span><button className="boton" onClick={() => setMonto(Number(cuenta.saldo).toFixed(2))}>Paga todo ({rd(cuenta.saldo)})</button></div>
              </div>
              <div className="chips-categoria">
                {(["EFECTIVO", "TARJETA", "TRANSFERENCIA"] as const).map((f) => (
                  <button key={f} className={"chip" + (forma === f ? " activo" : "")} onClick={() => setForma(f)}>{f[0] + f.slice(1).toLowerCase()}</button>
                ))}
              </div>
              {forma === "EFECTIVO" && <label className="campo"><span>Recibido (para el cambio)</span><input className="entrada-media" inputMode="decimal" value={recibido} onChange={(e) => setRecibido(soloMonto(e.target.value))} placeholder={monto || "0.00"} /></label>}
              {forma !== "EFECTIVO" && <label className="campo"><span>{forma === "TARJETA" ? "Número de aprobación" : "Referencia de la transferencia"}</span><input value={referencia} onChange={(e) => setReferencia(e.target.value)} /></label>}
              {cambio > 0 && <p>Cambio: <b>{rd(cambio)}</b></p>}
              {valor > Number(cuenta.saldo) && <p className="error">El abono no puede ser mayor que lo que debe.</p>}
              {msg && <p className="error">{msg}</p>}
              <button className="boton cobrar" disabled={!valido || enviando} onClick={cobrar}>{enviando ? "Cobrando…" : `Cobrar abono ${rd(valor)}`}</button>
            </>
          )}
          <button className="enlace" onClick={onVolver}>← Volver a clientes</button>
        </>
      )}
    </Modal>
  );
}

function ReciboImpreso({ r, empresa, onCerrar }: { r: Recibo; empresa: string; onCerrar: () => void }) {
  useImprimirConEnter();
  return (
    <>
      <div className="ticket" id="ticket">
        <div className="t-centro"><b className="t-grande">{empresa}</b></div>
        <div className="t-linea" />
        <div className="t-centro"><b>RECIBO DE ABONO</b><div>No. {r.recibo}</div></div>
        <div className="t-fila"><span>Fecha</span><span>{fechaHora(r.fecha)}</span></div>
        <div className="t-fila"><span>Cliente</span><span>{r.cliente.nombre}</span></div>
        {r.cliente.documento && <div className="t-fila"><span>Documento</span><span>{r.cliente.documento}</span></div>}
        <div className="t-linea" />
        <div className="t-fila"><span>Saldo anterior</span><span>{rd(r.saldoAnterior)}</span></div>
        <div className="t-fila t-total"><span>ABONO</span><span>{rd(r.abono)}</span></div>
        <div className="t-fila"><span>Saldo pendiente</span><span>{rd(r.saldoNuevo)}</span></div>
        <div className="t-linea" />
        <div className="t-fila"><span>Forma de pago</span><span>{r.formaPago[0] + r.formaPago.slice(1).toLowerCase()}{r.referencia ? ` ${r.referencia}` : ""}</span></div>
        {Number(r.cambio) > 0 && <div className="t-fila"><span>Cambio</span><span>{rd(r.cambio)}</span></div>}
        <div className="t-fila"><span>Cajero</span><span>{r.cajero}</span></div>
        <div className="t-centro t-pie">Documento no fiscal · Gracias por su pago</div>
      </div>
      <div className="dos-columnas acciones-ticket">
        <button className="boton primario" onClick={() => window.print()}>Imprimir (Enter)</button>
        <button className="boton" onClick={onCerrar}>Listo</button>
      </div>
    </>
  );
}
