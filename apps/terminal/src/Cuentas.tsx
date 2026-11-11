import { useCallback, useEffect, useMemo, useState } from "react";
import type { ProductoCatalogo } from "@factpos/compartido";
import { api, ErrorApi, rd, type Ajustes } from "./api";
import { Modal } from "./Venta";
import { PinSupervisor } from "./Operaciones";

/**
 * Cuentas abiertas (restaurantes, bares, discotecas): mesas o clientes con varias personas («asientos»).
 * Se ordena a una persona o a toda la mesa, y la cuenta se divide ANTES de ordenar (cada quien con lo suyo)
 * o DESPUÉS (partes iguales, por monto o por producto). El cobro lo hace la venta normal de la caja.
 */
interface LineaC { id: string; asientoId: string | null; descripcion: string; cantidad: string; total: string; nota: string | null; enviadaEn: string | null; anulada: boolean; ventaId: string | null; presentacionId: string }
interface AsientoC { id: string; nombre: string; total: string }
interface CuentaC { id: string; nombre: string; mesa: string | null; numero: string; estado: string; total: string; sinAsiento: string; propinaLegal: string; asientos: AsientoC[]; lineas: LineaC[] }
interface Resumen { id: string; nombre: string; mesa: string | null; numero: string; lineas: number; asientos: number; abiertaEn: string }
interface Parte { indice: number; nombre: string; consumo: string; propina: string; totalConPropina: string; lineas: string[] | null }
interface Division { cuentaId: string; modo: string; total: string; partes: Parte[] }

/** Lo que la caja carga en la venta para cobrar (una parte, o toda la cuenta con pagos mixtos). */
export interface PlanCobro {
  cuentaId: string; titulo: string; items: { presentacionId: string; cantidad: string }[]; lineaIds: string[];
  /** cuántas partes se cobran por separado y cuál es esta (1 si es una sola venta) */
  parte: number; partes: number; propina: string;
}

const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-DO", { hour: "2-digit", minute: "2-digit" });

export function Cuentas({ ajustes, productos, precio, onCobrar, onCerrar }: {
  ajustes: Ajustes; productos: ProductoCatalogo[]; precio: (p: ProductoCatalogo) => string | null;
  onCobrar: (plan: PlanCobro) => void; onCerrar: () => void;
}) {
  const base = `/cajas/${ajustes.cajaId}/cuentas`;
  const [lista, setLista] = useState<Resumen[] | null>(null);
  const [cuenta, setCuenta] = useState<CuentaC | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [nueva, setNueva] = useState<{ nombre: string; asientos: string } | null>(null);

  const cargarLista = useCallback(async () => {
    try { setLista(await api<Resumen[]>(ajustes.servidor, base)); setError(null); } catch (e) { setError((e as Error).message); }
  }, [ajustes.servidor, base]);
  useEffect(() => { void cargarLista(); }, [cargarLista]);

  /** Ejecuta una acción del servidor que devuelve la cuenta actualizada. */
  const accion = async (ruta: string, cuerpo?: unknown, metodo?: string) => {
    setOcupado(true);
    try { const c = await api<CuentaC>(ajustes.servidor, ruta, { cuerpo: cuerpo ?? {}, metodo }); setCuenta(c); setError(null); return c; }
    catch (e) { setError((e as Error).message); return null; }
    finally { setOcupado(false); }
  };
  const abrir = async (id: string) => {
    try { setCuenta(await api<CuentaC>(ajustes.servidor, `${base}/${id}`)); setError(null); } catch (e) { setError((e as Error).message); }
  };

  if (cuenta) {
    return <DetalleCuenta ajustes={ajustes} base={base} cuenta={cuenta} productos={productos} precio={precio} error={error} ocupado={ocupado}
      accion={accion} onCobrar={onCobrar} onVolver={() => { setCuenta(null); void cargarLista(); }} onCerrar={onCerrar} />;
  }

  return (
    <Modal titulo="Cuentas abiertas" onCerrar={onCerrar}>
      {error && <p className="error">{error}</p>}
      {nueva ? (
        <form onSubmit={async (ev) => {
          ev.preventDefault();
          if (!nueva.nombre.trim()) return;
          try {
            const c = await api<CuentaC>(ajustes.servidor, base, { cuerpo: { nombre: nueva.nombre.trim(), asientos: Math.max(0, Math.min(30, Number(nueva.asientos) || 0)) } });
            setNueva(null); setCuenta(c);
          } catch (e) { setError((e as Error).message); }
        }}>
          <label>Mesa o cliente<input autoFocus value={nueva.nombre} maxLength={60} placeholder="Mesa 4, VIP 2, Juan…" onChange={(e) => setNueva({ ...nueva, nombre: e.target.value })} /></label>
          <label>¿Cuántas personas? <span className="suave">(para cargar a cada quien; puede ser 0 y agregarlas luego)</span>
            <input inputMode="numeric" value={nueva.asientos} onChange={(e) => setNueva({ ...nueva, asientos: e.target.value.replace(/\D/g, "").slice(0, 2) })} /></label>
          <button className="boton primario ancho" type="submit">Abrir cuenta</button>
          <button className="enlace" type="button" onClick={() => setNueva(null)}>Cancelar</button>
        </form>
      ) : (
        <>
          <button className="boton primario ancho" onClick={() => setNueva({ nombre: "", asientos: "0" })}>+ Nueva cuenta</button>
          {lista === null && !error && <p className="suave">Cargando…</p>}
          {lista?.length === 0 && <p className="suave">No hay cuentas abiertas.</p>}
          <div className="resultados">
            {lista?.map((c) => (
              <div key={c.id} className="factura">
                <span><b>{c.nombre}</b> <span className="suave">· #{c.numero} · {c.lineas} producto(s){c.asientos ? ` · ${c.asientos} personas` : ""} · desde {hora(c.abiertaEn)}</span></span>
                <span className="factura-acciones"><button className="boton primario" onClick={() => abrir(c.id)}>Abrir</button></span>
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}

function DetalleCuenta({ ajustes, base, cuenta, productos, precio, error, ocupado, accion, onCobrar, onVolver, onCerrar }: {
  ajustes: Ajustes; base: string; cuenta: CuentaC; productos: ProductoCatalogo[]; precio: (p: ProductoCatalogo) => string | null;
  error: string | null; ocupado: boolean; accion: (ruta: string, cuerpo?: unknown, metodo?: string) => Promise<CuentaC | null>;
  onCobrar: (plan: PlanCobro) => void; onVolver: () => void; onCerrar: () => void;
}) {
  const url = `${base}/${cuenta.id}`;
  /** A quién se carga lo que se pide: null = toda la mesa */
  const [destino, setDestino] = useState<string | null>(cuenta.asientos[0]?.id ?? null);
  const [texto, setTexto] = useState("");
  const [dividiendo, setDividiendo] = useState(false);
  const [anulando, setAnulando] = useState<LineaC | null>(null);
  const [uniendo, setUniendo] = useState(false);

  const encontrados = useMemo(() => {
    const t = texto.trim().toLowerCase();
    if (t.length < 2) return [];
    return productos.filter((p) => p.nombre.toLowerCase().includes(t) || p.sku.toLowerCase().includes(t) || p.codigos.some((c) => c.includes(t))).slice(0, 8);
  }, [texto, productos]);

  const vivas = cuenta.lineas.filter((l) => !l.anulada && !l.ventaId);
  const cobradas = cuenta.lineas.filter((l) => !l.anulada && l.ventaId).length;
  const grupos: { id: string | null; nombre: string; lineas: LineaC[] }[] = [
    { id: null, nombre: "Toda la mesa", lineas: vivas.filter((l) => l.asientoId === null) },
    ...cuenta.asientos.map((a) => ({ id: a.id, nombre: a.nombre, lineas: vivas.filter((l) => l.asientoId === a.id) })),
  ];

  const agregar = (p: ProductoCatalogo) => {
    if (precio(p) === null && !p.precioVariable) return;
    setTexto("");
    void accion(`${url}/lineas`, { presentacionId: p.presentacionId, cantidad: "1", asientoId: destino });
  };

  if (dividiendo) return <DividirCuenta ajustes={ajustes} url={url} cuenta={cuenta} onCobrar={onCobrar} onVolver={() => setDividiendo(false)} />;
  if (anulando) {
    return (
      <Modal titulo="Quitar producto enviado" onCerrar={() => setAnulando(null)}>
        <p><b>{anulando.descripcion}</b> ya salió a la barra o la cocina. Para quitarlo hace falta la aprobación de un supervisor.</p>
        <PinSupervisor ajustes={ajustes} permiso="venta.anular" textoBoton="Autorizar y quitar" enfocar
          onAprobado={(a) => { const l = anulando; setAnulando(null); void accion(`${url}/lineas/${l.id}`, { anulada: true, autorizacion: a.token }, "PATCH"); }} />
      </Modal>
    );
  }
  if (uniendo) return <UnirCuenta ajustes={ajustes} base={base} actualId={cuenta.id} onElegir={(id) => { setUniendo(false); void accion(`${url}/unir`, { desdeId: id }); }} onVolver={() => setUniendo(false)} />;

  return (
    <Modal titulo={`${cuenta.nombre} · #${cuenta.numero}`} onCerrar={onCerrar} ancho>
      <button className="enlace" onClick={onVolver}>← Todas las cuentas</button>
      {error && <p className="error">{error}</p>}
      <div className="pestanas" style={{ flexWrap: "wrap" }}>
        <button className={destino === null ? "activa" : ""} onClick={() => setDestino(null)}>Toda la mesa</button>
        {cuenta.asientos.map((a) => <button key={a.id} className={destino === a.id ? "activa" : ""} onClick={() => setDestino(a.id)}>{a.nombre}</button>)}
        <button onClick={async () => { const c = await accion(`${url}/asientos`, {}); if (c) setDestino(c.asientos[c.asientos.length - 1]?.id ?? null); }}>+ Persona</button>
      </div>
      <input autoFocus placeholder={`Buscar producto para ${destino ? cuenta.asientos.find((a) => a.id === destino)?.nombre ?? "" : "toda la mesa"}…`} value={texto} onChange={(e) => setTexto(e.target.value)} />
      {encontrados.length > 0 && (
        <div className="resultados">
          {encontrados.map((p) => (
            <div key={p.presentacionId} className="factura" role="button" tabIndex={0} style={{ cursor: "pointer" }} onClick={() => agregar(p)}
              onKeyDown={(e) => { if (e.key === "Enter") agregar(p); }}>
              <span>{p.nombre} {p.presentacion !== "Unidad" ? p.presentacion : ""}</span><b>{precio(p) !== null ? rd(precio(p)!) : "sin precio"}</b>
            </div>
          ))}
        </div>
      )}
      {grupos.filter((g) => g.id === null ? g.lineas.length > 0 : true).map((g) => (
        <div key={g.id ?? "mesa"} style={{ marginTop: 10 }}>
          <b>{g.nombre}</b> <span className="suave">{g.id ? rd(cuenta.asientos.find((a) => a.id === g.id)?.total ?? 0) : rd(cuenta.sinAsiento)}</span>
          {g.lineas.length === 0 && <p className="suave" style={{ margin: "2px 0" }}>Nada pedido todavía.</p>}
          {g.lineas.map((l) => (
            <div key={l.id} className="factura">
              <span>{Number(l.cantidad)} × {l.descripcion}{l.enviadaEn ? <span className="suave"> · enviado</span> : null}</span>
              <span className="factura-acciones">
                <b>{rd(l.total)}</b>
                {cuenta.asientos.length > 0 && (
                  <select aria-label="Pasar a" value={l.asientoId ?? ""} onChange={(e) => void accion(`${url}/lineas/${l.id}`, { asientoId: e.target.value || null }, "PATCH")}>
                    <option value="">Mesa</option>
                    {cuenta.asientos.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                  </select>
                )}
                <button className="enlace" disabled={ocupado} onClick={() => (l.enviadaEn ? setAnulando(l) : void accion(`${url}/lineas/${l.id}`, { anulada: true }, "PATCH"))}>Quitar</button>
              </span>
            </div>
          ))}
        </div>
      ))}
      {cobradas > 0 && <p className="suave">Ya se cobraron {cobradas} producto(s) de esta cuenta; abajo queda lo pendiente.</p>}
      <p style={{ marginTop: 12 }}><b>Pendiente {rd(cuenta.total)}</b> <span className="suave">· propina legal 10 % {rd(cuenta.propinaLegal)} (referencia)</span></p>
      <div className="pv-atajos pv-atajos-min" style={{ position: "sticky", bottom: -22, background: "var(--panel)", padding: "10px 0 2px", marginTop: 8, gridTemplateColumns: "repeat(3, 1fr)" }}>
        <button disabled={ocupado || !vivas.some((l) => !l.enviadaEn)} onClick={() => void accion(`${url}/enviar`)}>Enviar a barra/cocina</button>
        <button disabled={ocupado} onClick={() => setUniendo(true)}>Unir con otra</button>
        <button className="primario" disabled={ocupado || !vivas.length} onClick={() => setDividiendo(true)}>Dividir y cobrar</button>
      </div>
    </Modal>
  );
}

function UnirCuenta({ ajustes, base, actualId, onElegir, onVolver }: { ajustes: Ajustes; base: string; actualId: string; onElegir: (id: string) => void; onVolver: () => void }) {
  const [lista, setLista] = useState<Resumen[]>([]);
  useEffect(() => { api<Resumen[]>(ajustes.servidor, base).then((l) => setLista(l.filter((c) => c.id !== actualId))).catch(() => {}); }, [ajustes.servidor, base, actualId]);
  return (
    <Modal titulo="Unir con otra cuenta" onCerrar={onVolver}>
      <p className="suave">Lo de la cuenta que elija pasa a esta, y esa queda cerrada.</p>
      {lista.length === 0 && <p className="suave">No hay otras cuentas abiertas.</p>}
      <div className="resultados">
        {lista.map((c) => (
          <div key={c.id} className="factura"><span><b>{c.nombre}</b> <span className="suave">· {c.lineas} producto(s)</span></span>
            <span className="factura-acciones"><button className="boton primario" onClick={() => onElegir(c.id)}>Unir</button></span></div>
        ))}
      </div>
      <button className="enlace" onClick={onVolver}>Cancelar</button>
    </Modal>
  );
}

type Modo = "ASIENTOS" | "IGUAL" | "MONTOS" | "PRODUCTOS";

function DividirCuenta({ ajustes, url, cuenta, onCobrar, onVolver }: { ajustes: Ajustes; url: string; cuenta: CuentaC; onCobrar: (p: PlanCobro) => void; onVolver: () => void }) {
  const vivas = cuenta.lineas.filter((l) => !l.anulada && !l.ventaId);
  const [modo, setModo] = useState<Modo>(cuenta.asientos.length ? "ASIENTOS" : "IGUAL");
  const [personas, setPersonas] = useState("2");
  const [montos, setMontos] = useState<string[]>(["", ""]);
  const [asig, setAsig] = useState<Record<string, number>>({});
  const [vista, setVista] = useState<Division | null>(null);
  const [error, setError] = useState<string | null>(null);
  const n = Math.max(1, Math.min(30, Number(personas) || 1));

  const calcular = async () => {
    setError(null); setVista(null);
    let cuerpo: Record<string, unknown>;
    if (modo === "ASIENTOS") cuerpo = { modo };
    else if (modo === "IGUAL") cuerpo = { modo, partes: n };
    else if (modo === "MONTOS") cuerpo = { modo, montos: montos.map((m) => m || "0") };
    else cuerpo = { modo, partes: n, asignacion: Object.fromEntries(vivas.map((l) => [l.id, asig[l.id] ?? 0])) };
    try { setVista(await api<Division>(ajustes.servidor, `${url}/dividir`, { cuerpo })); } catch (e) { setError(e instanceof ErrorApi ? e.message : "No se pudo calcular"); }
  };

  const lineasDe = (ids: string[] | null) => (ids ? vivas.filter((l) => ids.includes(l.id)) : vivas);
  const itemsDe = (ids: string[] | null) => lineasDe(ids).map((l) => ({ presentacionId: l.presentacionId, cantidad: String(Number(l.cantidad)) }));
  const porSeparado = modo === "ASIENTOS" || modo === "PRODUCTOS";

  return (
    <Modal titulo={`Dividir ${cuenta.nombre}`} onCerrar={onVolver} ancho>
      <button className="enlace" onClick={onVolver}>← Volver a la cuenta</button>
      <div className="pestanas" style={{ flexWrap: "wrap" }}>
        {([["ASIENTOS", "Por persona (ya ordenado)"], ["IGUAL", "Partes iguales"], ["MONTOS", "Por monto"], ["PRODUCTOS", "Por producto"]] as [Modo, string][]).map(([m, t]) => (
          <button key={m} className={modo === m ? "activa" : ""} disabled={m === "ASIENTOS" && !cuenta.asientos.length} onClick={() => { setModo(m); setVista(null); }}>{t}</button>
        ))}
      </div>
      {(modo === "IGUAL" || modo === "PRODUCTOS") && (
        <label>¿Entre cuántas personas?<input inputMode="numeric" value={personas} onChange={(e) => { setPersonas(e.target.value.replace(/\D/g, "").slice(0, 2)); setVista(null); }} /></label>
      )}
      {modo === "MONTOS" && (
        <div>
          {montos.map((m, i) => (
            <label key={i}>Persona {i + 1}<input inputMode="decimal" value={m} placeholder="0.00" onChange={(e) => { const c = [...montos]; c[i] = e.target.value.replace(/[^\d.]/g, ""); setMontos(c); setVista(null); }} /></label>
          ))}
          <button className="enlace" onClick={() => setMontos([...montos, ""])}>+ Persona</button>
          <p className="suave">Cuenta: {rd(cuenta.total)} · los montos deben sumar exactamente eso.</p>
        </div>
      )}
      {modo === "PRODUCTOS" && (
        <div className="resultados">
          {vivas.map((l) => (
            <div key={l.id} className="factura">
              <span>{Number(l.cantidad)} × {l.descripcion} <b>{rd(l.total)}</b></span>
              <select value={asig[l.id] ?? 0} onChange={(e) => { setAsig({ ...asig, [l.id]: Number(e.target.value) }); setVista(null); }}>
                {Array.from({ length: n }, (_, i) => <option key={i} value={i}>Persona {i + 1}</option>)}
              </select>
            </div>
          ))}
        </div>
      )}
      {error && <p className="error">{error}</p>}
      <button className="boton ancho" onClick={calcular}>Calcular</button>
      {vista && (
        <>
          <div className="resultados" style={{ marginTop: 10 }}>
            {vista.partes.map((p) => (
              <div key={p.indice} className="factura">
                <span><b>{p.nombre}</b> <span className="suave">· consumo {rd(p.consumo)} · propina {rd(p.propina)}</span></span>
                <span className="factura-acciones">
                  <b>{rd(p.totalConPropina)}</b>
                  {porSeparado && (
                    <button className="boton primario" disabled={Number(p.consumo) === 0 || (modo === "ASIENTOS" && (!p.lineas?.length || Number(cuenta.sinAsiento) > 0))}
                      onClick={() => onCobrar({
                        cuentaId: cuenta.id, titulo: `${cuenta.nombre} · ${p.nombre}`, items: itemsDe(p.lineas), lineaIds: lineasDe(p.lineas).map((l) => l.id), parte: p.indice + 1, partes: vista.partes.length, propina: p.propina,
                      })}>Cobrar</button>
                  )}
                </span>
              </div>
            ))}
          </div>
          {modo === "ASIENTOS" && Number(cuenta.sinAsiento) > 0 && (
            <p className="error">Hay {rd(cuenta.sinAsiento)} pedidos para toda la mesa. Para cobrar por separado, pase cada producto a una persona (en la cuenta) o divida por producto.</p>
          )}
          {porSeparado
            ? <p className="suave">Cada persona se cobra por separado, con su propio comprobante. La propina legal es de referencia: aún no sale en el comprobante.</p>
            : (
              <>
                <p className="suave">Una sola venta con varios pagos: registre el pago de cada persona como una forma de pago distinta en el cobro. La propina legal es de referencia.</p>
                <button className="boton primario ancho" onClick={() => onCobrar({ cuentaId: cuenta.id, titulo: cuenta.nombre, items: itemsDe(null), lineaIds: lineasDe(null).map((l) => l.id), parte: 1, partes: 1, propina: vista.partes.reduce((s, p) => s + Number(p.propina), 0).toFixed(2) })}>
                  Cobrar la cuenta completa ({rd(vista.total)})
                </button>
              </>
            )}
        </>
      )}
    </Modal>
  );
}
