import { useEffect, useState } from "react";
import { api, puede, rd } from "../api";
import { Aviso, Encabezado, Kpi, Tabla, useDatos } from "../ui";

/**
 * Cuentas por cobrar: quién debe, cuánto está vencido y su estado de cuenta.
 * Un solo saldo por cliente aunque compre en varias tiendas.
 */
interface FilaCxc {
  clienteId: string; nombre: string; documento: string | null; telefono: string | null; limiteCredito: string; diasCredito: number;
  saldo: string; alDia: string; vencido30: string; vencido60: string; vencidoMas: string; deudaDesde: string | null; ultimoAbono: string | null; excedido: boolean;
}
interface FacturaPend { ventaId: string; factura: number; documento: string | null; sucursal: string; fecha: string; vence: string; cargo: string; pagado: string; pendiente: string }
const fecha = (v: string | null) => (v ? new Date(v).toLocaleDateString("es-DO") : "—");
const nada = (v: string | number) => (Number(v) ? rd(v) : <span className="suave">—</span>);

export function Cxc() {
  const [q, setQ] = useState("");
  const [vencidos, setVencidos] = useState(false);
  const [ver, setVer] = useState<string | null>(null);
  const [nuevoCredito, setNuevoCredito] = useState(false);
  const [recarga, setRecarga] = useState(0);
  const lista = useDatos<{ clientes: FilaCxc[]; totales: { saldo: string; alDia: string; vencido: string; clientes: number } }>(
    `/central/cxc?${new URLSearchParams({ ...(q.trim().length >= 2 ? { q: q.trim() } : {}), ...(vencidos ? { vencidos: "1" } : {}) })}`, [recarga]);
  const t = lista.datos?.totales;

  return (
    <>
      <Encabezado titulo="Cuentas por cobrar" descripcion="Clientes a crédito: lo que deben, lo vencido y cada factura y abono.">
        {puede("admin.cxc") && <button className="boton" onClick={() => setNuevoCredito(true)}>Dar crédito a un cliente</button>}
      </Encabezado>
      <div className="kpis">
        <Kpi titulo="Por cobrar" valor={rd(t?.saldo ?? 0)} detalle={`${t?.clientes ?? 0} ${t?.clientes === 1 ? "cliente" : "clientes"}`} />
        <Kpi titulo="Al día" valor={rd(t?.alDia ?? 0)} tono="ok" />
        <Kpi titulo="Vencido" valor={rd(t?.vencido ?? 0)} tono={Number(t?.vencido) > 0 ? "alerta" : undefined} />
      </div>
      <div className="fila-acciones" style={{ marginBottom: 12 }}>
        <input placeholder="Buscar cliente o documento" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 320 }} />
        <label className="interruptor"><input type="checkbox" checked={vencidos} onChange={(e) => setVencidos(e.target.checked)} /><span>Solo con deuda vencida</span></label>
      </div>
      <Tabla
        filas={lista.datos?.clientes ?? []}
        clave={(f) => f.clienteId}
        vacio="Nadie debe nada"
        columnas={[
          { titulo: "Cliente", valor: (f) => <button className="enlace" onClick={() => setVer(f.clienteId)}><b>{f.nombre}</b></button> },
          { titulo: "Debe", valor: (f) => <b className={f.excedido ? "texto-alerta" : ""} title={f.excedido ? "Pasó su límite de crédito" : ""}>{rd(f.saldo)}</b>, der: true },
          { titulo: "Al día", valor: (f) => nada(f.alDia), der: true },
          { titulo: "1-30 días vencido", valor: (f) => nada(f.vencido30), der: true },
          { titulo: "31-60", valor: (f) => nada(f.vencido60), der: true },
          { titulo: "Más de 60", valor: (f) => (Number(f.vencidoMas) ? <span className="texto-alerta">{rd(f.vencidoMas)}</span> : nada(0)), der: true },
          { titulo: "Límite", valor: (f) => rd(f.limiteCredito), der: true },
          { titulo: "Último abono", valor: (f) => fecha(f.ultimoAbono) },
        ]}
      />
      {ver && <EstadoCuenta clienteId={ver} onCerrar={() => setVer(null)} onCambio={() => setRecarga((x) => x + 1)} />}
      {nuevoCredito && <DarCredito onCerrar={() => setNuevoCredito(false)} onListo={(id) => { setNuevoCredito(false); setRecarga((x) => x + 1); setVer(id); }} />}
    </>
  );
}

function EstadoCuenta({ clienteId, onCerrar, onCambio }: { clienteId: string; onCerrar: () => void; onCambio: () => void }) {
  const { datos: d, recargar } = useDatos<any>(`/central/cxc/${clienteId}`);
  const fac = useDatos<FacturaPend[]>(`/central/cxc/${clienteId}/facturas`);
  const [accion, setAccion] = useState<"abono" | "ajuste" | "credito" | null>(null);
  const [facturaElegida, setFacturaElegida] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" } | null>(null);
  const listo = (t: string) => { setAccion(null); setFacturaElegida(null); setMsg({ t, tipo: "ok" }); recargar(); fac.recargar(); onCambio(); };
  const TIPO: Record<string, string> = { CARGO: "Factura a crédito", ABONO: "Abono", AJUSTE: "Ajuste" };
  return (
    <div className="fondo-modal" onMouseDown={onCerrar}>
      <div className="modal ancho" onMouseDown={(e) => e.stopPropagation()}>
        <div className="fila-acciones no-imprimir" style={{ marginTop: 0, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>Estado de cuenta</h2>
          <span className="flex" />
          {puede("admin.cxc") && d && <>
            <button className="boton primario chico" onClick={() => setAccion("abono")}>Registrar abono</button>
            <button className="boton chico" onClick={() => setAccion("ajuste")}>Ajuste</button>
            <button className="boton chico" onClick={() => setAccion("credito")}>Límite</button>
          </>}
          <button className="boton chico" disabled={!d} onClick={() => window.print()}>Imprimir</button>
          <button className="boton chico" onClick={onCerrar}>Cerrar</button>
        </div>
        {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}
        {accion && d && (
          <div className="panel no-imprimir" style={{ marginTop: 12 }}>
            {accion === "abono" && <FormAbono key={facturaElegida ?? "cuenta"} clienteId={clienteId} saldo={d.saldo} facturas={fac.datos ?? []} inicial={facturaElegida} onListo={listo} />}
            {accion === "ajuste" && <FormAjuste clienteId={clienteId} onListo={listo} />}
            {accion === "credito" && <FormCredito clienteId={clienteId} limite={d.limiteCredito} dias={d.diasCredito} onListo={listo} />}
          </div>
        )}
        {d && (
          <div className="estado-cuenta imprimible">
            <div className="encabezado-sub">
              <div>
                <div className="conduce-empresa">{d.empresa}</div>
                <div className="suave pequeno">RNC {d.rncEmpresa} · Estado de cuenta al {new Date().toLocaleDateString("es-DO")}</div>
              </div>
            </div>
            <div className="ec-cliente">
              <div><b>{d.nombre}</b><div className="suave pequeno">{[d.documento, d.telefono].filter(Boolean).join(" · ")}</div></div>
              <div className="ec-saldo"><span>Saldo</span><b>{rd(d.saldo)}</b></div>
            </div>
            <div className="ec-antiguedad">
              <div><span>Al día</span><b>{rd(d.alDia ?? 0)}</b></div>
              <div><span>1-30 vencido</span><b>{rd(d.vencido30 ?? 0)}</b></div>
              <div><span>31-60</span><b>{rd(d.vencido60 ?? 0)}</b></div>
              <div><span>Más de 60</span><b>{rd(d.vencidoMas ?? 0)}</b></div>
              <div><span>Límite · días</span><b>{rd(d.limiteCredito)} · {d.diasCredito}</b></div>
            </div>
            <h3 style={{ margin: "16px 0 6px" }}>Facturas pendientes</h3>
            {(fac.datos ?? []).length === 0 ? <p className="suave pequeno">No hay facturas a crédito pendientes.</p> : (
              <table className="tabla">
                <thead><tr><th>Factura</th><th>Fecha</th><th>Vence</th><th className="der">Total</th><th className="der">Pagado</th><th className="der">Debe</th><th className="no-imprimir" /></tr></thead>
                <tbody>
                  {(fac.datos ?? []).map((f) => (
                    <tr key={f.ventaId}>
                      <td>{f.documento ?? `#${f.factura}`}<div className="suave pequeno">{f.sucursal}</div></td>
                      <td>{fecha(f.fecha)}</td>
                      <td className={new Date(f.vence) < new Date() ? "texto-alerta" : ""}>{fecha(f.vence)}{new Date(f.vence) < new Date() ? " · vencida" : ""}</td>
                      <td className="der">{rd(f.cargo)}</td>
                      <td className="der">{Number(f.pagado) ? rd(f.pagado) : <span className="suave">—</span>}</td>
                      <td className="der"><b>{rd(f.pendiente)}</b></td>
                      <td className="der no-imprimir">{puede("admin.cxc") && <button className="boton chico" onClick={() => { setFacturaElegida(f.ventaId); setAccion("abono"); }}>Pagar</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <h3 style={{ margin: "16px 0 6px" }}>Movimientos</h3>
            <table className="tabla">
              <thead><tr><th>Fecha</th><th>Concepto</th><th>Sucursal</th><th className="der">Cargo</th><th className="der">Abono</th><th className="der">Saldo</th></tr></thead>
              <tbody>
                {d.movimientos.map((m: any) => (
                  <tr key={m.id}>
                    <td>{fecha(m.fecha)}</td>
                    <td>{TIPO[m.tipo] ?? m.tipo}{m.encf ? ` ${m.encf}` : m.factura ? ` #${m.factura}` : ""}{m.formaPago ? ` · ${m.formaPago.toLowerCase()}` : ""}{m.referencia ? ` ${m.referencia}` : ""}{m.notas ? <div className="suave pequeno">{m.notas}</div> : null}</td>
                    <td>{m.sucursal}</td>
                    <td className="der">{Number(m.monto) > 0 ? rd(m.monto) : ""}</td>
                    <td className="der">{Number(m.monto) < 0 ? rd(-m.monto) : ""}</td>
                    <td className="der"><b>{rd(m.saldo)}</b></td>
                  </tr>
                ))}
                {!d.movimientos.length && <tr><td colSpan={6} className="suave">Sin movimientos todavía.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function FormAbono({ clienteId, saldo, facturas, inicial, onListo }: { clienteId: string; saldo: string; facturas: FacturaPend[]; inicial: string | null; onListo: (t: string) => void }) {
  const [aplicar, setAplicar] = useState<"CUENTA" | "FACTURA">(inicial ? "FACTURA" : "CUENTA");
  const [ventaId, setVentaId] = useState(inicial ?? "");
  const elegida = facturas.find((f) => f.ventaId === ventaId);
  const [monto, setMonto] = useState(inicial ? (facturas.find((f) => f.ventaId === inicial)?.pendiente ?? "") : "");
  const [forma, setForma] = useState("TRANSFERENCIA");
  const [referencia, setReferencia] = useState("");
  const [error, setError] = useState("");
  const ok = async () => {
    try {
      const r = await api(`/central/cxc/${clienteId}/abonos`, { cuerpo: { monto: Number(monto).toFixed(2), formaPago: forma, referencia: referencia || undefined, modo: aplicar, ...(aplicar === "FACTURA" ? { ventaId } : {}) } });
      onListo(`Abono registrado. Ahora debe ${rd(r.saldoNuevo)}.`);
    } catch (e) { setError((e as Error).message); }
  };
  return (
    <>
      <div className="campo"><span>Aplicar el pago a</span>
        <div className="rp-chips" role="radiogroup">
          <button type="button" className={aplicar === "CUENTA" ? "activo" : ""} onClick={() => setAplicar("CUENTA")}>La cuenta (la factura más antigua primero)</button>
          <button type="button" className={aplicar === "FACTURA" ? "activo" : ""} onClick={() => setAplicar("FACTURA")} disabled={!facturas.length}>Una factura</button>
        </div>
        <small className="suave">{aplicar === "CUENTA" ? "Si el pago cubre la factura más antigua, lo que sobre se aplica a la siguiente. Si no alcanza, queda como abono a esa factura." : "El pago se aplica solo a la factura elegida."}</small>
      </div>
      {aplicar === "FACTURA" && (
        <label className="campo"><span>Factura</span>
          <select value={ventaId} onChange={(e) => { setVentaId(e.target.value); const f = facturas.find((x) => x.ventaId === e.target.value); if (f) setMonto(f.pendiente); }}>
            <option value="">Elija la factura…</option>
            {facturas.map((f) => <option key={f.ventaId} value={f.ventaId}>{f.documento ?? `#${f.factura}`} · {fecha(f.fecha)} · debe {rd(f.pendiente)}</option>)}
          </select></label>
      )}
      <div className="tres-col">
        <label className="campo"><span>Monto ({aplicar === "FACTURA" && elegida ? `la factura debe ${rd(elegida.pendiente)}` : `debe ${rd(saldo)}`})</span><input className="numero" autoFocus inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value.replace(/[^\d.]/g, ""))} /></label>
        <label className="campo"><span>Forma de pago</span>
          <select value={forma} onChange={(e) => setForma(e.target.value)}>
            <option value="TRANSFERENCIA">Transferencia</option><option value="CHEQUE">Cheque</option><option value="EFECTIVO">Efectivo en la oficina</option><option value="TARJETA">Tarjeta</option>
          </select>
        </label>
        <label className="campo"><span>Referencia</span><input value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder="No. de transferencia o cheque" /></label>
      </div>
      {error && <Aviso texto={error} />}
      <button className="boton primario" disabled={!(Number(monto) > 0) || (aplicar === "FACTURA" && !ventaId)} onClick={ok}>Registrar abono de {rd(monto || 0)}</button>
    </>
  );
}

function FormAjuste({ clienteId, onListo }: { clienteId: string; onListo: (t: string) => void }) {
  const [signo, setSigno] = useState<"-" | "+">("-");
  const [monto, setMonto] = useState("");
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState("");
  const ok = async () => {
    try {
      await api(`/central/cxc/${clienteId}/ajustes`, { cuerpo: { monto: `${signo === "-" ? "-" : ""}${Number(monto).toFixed(2)}`, motivo } });
      onListo("Ajuste registrado.");
    } catch (e) { setError((e as Error).message); }
  };
  return (
    <>
      <div className="tres-col">
        <label className="campo"><span>Tipo</span>
          <select value={signo} onChange={(e) => setSigno(e.target.value as "-" | "+")}><option value="-">Rebajar la deuda</option><option value="+">Aumentar la deuda</option></select>
        </label>
        <label className="campo"><span>Monto</span><input className="numero" inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value.replace(/[^\d.]/g, ""))} /></label>
        <label className="campo"><span>Motivo</span><input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej. descuento por pronto pago" /></label>
      </div>
      {error && <Aviso texto={error} />}
      <button className="boton primario" disabled={!(Number(monto) > 0) || motivo.trim().length < 5} onClick={ok}>Registrar ajuste</button>
    </>
  );
}

function FormCredito({ clienteId, limite, dias, onListo }: { clienteId: string; limite: string; dias: number; onListo: (t: string) => void }) {
  const [l, setL] = useState(String(Number(limite)));
  const [d, setD] = useState(String(dias));
  const [error, setError] = useState("");
  const ok = async () => {
    try {
      await api(`/central/cxc/${clienteId}/credito`, { metodo: "PUT", cuerpo: { limiteCredito: Number(l || 0).toFixed(2), diasCredito: Number(d || 0) } });
      onListo("Crédito actualizado. Llega a las cajas de todas las sucursales en la próxima sincronización.");
    } catch (e) { setError((e as Error).message); }
  };
  return (
    <>
      <div className="dos-col">
        <label className="campo"><span>Límite de crédito (RD$)</span><input className="numero" inputMode="decimal" value={l} onChange={(e) => setL(e.target.value.replace(/[^\d.]/g, ""))} /></label>
        <label className="campo"><span>Días para pagar</span><input className="numero" inputMode="numeric" value={d} onChange={(e) => setD(e.target.value.replace(/\D/g, ""))} /></label>
      </div>
      {error && <Aviso texto={error} />}
      <button className="boton primario" onClick={ok}>Guardar</button>
    </>
  );
}

function DarCredito({ onCerrar, onListo }: { onCerrar: () => void; onListo: (clienteId: string) => void }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<any[]>([]);
  const [elegido, setElegido] = useState<any | null>(null);
  useEffect(() => {
    if (q.trim().length < 2) return setRes([]);
    const t = setTimeout(() => api<any[]>(`/central/cxc/buscar?q=${encodeURIComponent(q.trim())}`).then(setRes).catch(() => setRes([])), 200);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="fondo-modal" onMouseDown={onCerrar}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>Dar crédito a un cliente</h2>
        {!elegido ? (
          <>
            <input autoFocus placeholder="Nombre, cédula o RNC" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: "100%" }} />
            <div className="lista" style={{ marginTop: 10 }}>
              {res.map((c) => <button key={c.clienteId} className="opcion" onClick={() => setElegido(c)}>{c.nombre} <span className="suave">{c.documento ?? ""} · límite {rd(c.limiteCredito)}</span></button>)}
            </div>
          </>
        ) : (
          <>
            <p><b>{elegido.nombre}</b></p>
            <FormCredito clienteId={elegido.clienteId} limite={elegido.limiteCredito} dias={elegido.diasCredito} onListo={() => onListo(elegido.clienteId)} />
          </>
        )}
        <div className="acciones-modal"><button className="boton" onClick={onCerrar}>Cerrar</button></div>
      </div>
    </div>
  );
}
