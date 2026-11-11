import { useCallback, useEffect, useMemo, useState } from "react";
import { precioPara, type Catalogo, type ProductoCatalogo } from "@factpos/compartido";
import { VistaCatalogo } from "./Catalogo";
import { api, ErrorApi, rd, type Ajustes } from "./api";
import { Modal } from "./Venta";
import { PinSupervisor } from "./Operaciones";
import { ComandaPapel, type Comanda } from "./Comandas";
import { ConfigMesas, ConfigModificadores, ElegirModificadores, MapaMesas, MoverCuenta, PASOS, type MesaC, type Modificador } from "./Salon";

/**
 * Cuentas abiertas (restaurantes, bares, discotecas): mesas o clientes con varias personas («asientos»).
 * Se ordena a una persona o a toda la mesa, y la cuenta se divide ANTES de ordenar (cada quien con lo suyo)
 * o DESPUÉS (partes iguales, por monto o por producto). El cobro lo hace la venta normal de la caja.
 */
interface LineaC { id: string; asientoId: string | null; descripcion: string; cantidad: string; total: string; nota: string | null; enviadaEn: string | null; anulada: boolean; ventaId: string | null; presentacionId: string; padreId: string | null; paso: number }
interface AsientoC { id: string; nombre: string; total: string }
interface CortesiaC { descripcion: string; cantidad: string; motivoTipo: string; motivo: string | null; valor: string }
interface CuentaC { cortesias?: CortesiaC[]; pasoLiberado: number; id: string; nombre: string; mesa: string | null; numero: string; estado: string; total: string; sinAsiento: string; propinaLegal: string; asientos: AsientoC[]; lineas: LineaC[] }
interface Resumen { id: string; nombre: string; mesa: string | null; numero: string; lineas: number; asientos: number; abiertaEn: string; total?: string }
interface Parte { indice: number; nombre: string; consumo: string; propina: string; totalConPropina: string; lineas: string[] | null }
interface Division { cuentaId: string; modo: string; total: string; partes: Parte[] }

/** Lo que la caja carga en la venta para cobrar (una parte, o toda la cuenta con pagos mixtos). */
export interface PlanCobro {
  cuentaId: string; titulo: string; items: { presentacionId: string; cantidad: string }[]; lineaIds: string[];
  /** cuántas partes se cobran por separado y cuál es esta (1 si es una sola venta) */
  parte: number; partes: number; propina: string;
}

const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-DO", { hour: "2-digit", minute: "2-digit" });

export function Cuentas({ ajustes, catalogo, nivel, onCobrar, onCerrar }: {
  ajustes: Ajustes; catalogo: Catalogo; nivel: number;
  onCobrar: (plan: PlanCobro) => void; onCerrar: () => void;
}) {
  const base = `/cajas/${ajustes.cajaId}/cuentas`;
  const [lista, setLista] = useState<Resumen[] | null>(null);
  const [cuenta, setCuenta] = useState<CuentaC | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [nueva, setNueva] = useState<{ nombre: string; asientos: string } | null>(null);
  /** Comandas que salen por la impresora de esta caja, y el aviso de adónde fue lo enviado */
  const [papeles, setPapeles] = useState<Comanda[]>([]);
  const [aviso, setAviso] = useState<string | null>(null);
  const [mesas, setMesas] = useState<MesaC[]>([]);
  const [modificadores, setModificadores] = useState<Modificador[]>([]);
  const [config, setConfig] = useState<"MESAS" | "MODS" | null>(null);

  const cargarLista = useCallback(async () => {
    try { setLista(await api<Resumen[]>(ajustes.servidor, base)); setError(null); } catch (e) { setError((e as Error).message); }
    // El mapa y los modificadores son opcionales: sin mesas creadas todo funciona como la lista de cuentas
    api<MesaC[]>(ajustes.servidor, `/cajas/${ajustes.cajaId}/mesas`).then(setMesas).catch(() => setMesas([]));
    api<Modificador[]>(ajustes.servidor, `/cajas/${ajustes.cajaId}/modificadores`).then(setModificadores).catch(() => setModificadores([]));
  }, [ajustes.servidor, ajustes.cajaId, base]);
  useEffect(() => { void cargarLista(); }, [cargarLista]);
  // El mapa se mantiene al día mientras se mira (otras cajas abren y cierran mesas)
  useEffect(() => {
    if (cuenta) return;
    const t = window.setInterval(() => { void cargarLista(); }, 15000);
    return () => window.clearInterval(t);
  }, [cuenta, cargarLista]);
  const tocarMesa = async (m: MesaC) => {
    if (m.cuentaId) { await abrir(m.cuentaId); return; }
    try { setCuenta(await api<CuentaC>(ajustes.servidor, base, { cuerpo: { nombre: m.nombre, mesa: m.nombre, asientos: 0 } })); setError(null); }
    catch (e) { setError((e as Error).message); }
  };

  /** Ejecuta una acción del servidor que devuelve la cuenta actualizada. */
  const accion = async (ruta: string, cuerpo?: unknown, metodo?: string) => {
    setOcupado(true);
    try {
      const c = await api<CuentaC & { comandas?: (Comanda & { imprimeEnCaja: boolean })[] }>(ajustes.servidor, ruta, { cuerpo: cuerpo ?? {}, metodo });
      if (c.comandas) {
        setAviso(c.comandas.length ? `Enviado: ${c.comandas.map((x) => `comanda #${x.numero} → ${x.estacion}`).join(" · ")}` : "Enviado (sin estación asignada: no hay comanda)");
        setPapeles((p) => [...p, ...c.comandas!.filter((x) => x.imprimeEnCaja)]);
      }
      setCuenta(c); setError(null); return c;
    }
    catch (e) { setError((e as Error).message); return null; }
    finally { setOcupado(false); }
  };
  const abrir = async (id: string) => {
    try { setCuenta(await api<CuentaC>(ajustes.servidor, `${base}/${id}`)); setError(null); } catch (e) { setError((e as Error).message); }
  };

  const papel = papeles[0] ? <ComandaPapel key={papeles[0].id} comanda={papeles[0]} onListo={() => setPapeles((p) => p.slice(1))} /> : null;
  if (cuenta) {
    return <><DetalleCuenta ajustes={ajustes} base={base} cuenta={cuenta} catalogo={catalogo} nivel={nivel} error={error} ocupado={ocupado}
      accion={accion} modificadores={modificadores} onCobrar={onCobrar} onVolver={() => { setCuenta(null); setAviso(null); void cargarLista(); }} onCerrar={onCerrar} aviso={aviso} />{papel}</>;
  }

  if (config === "MESAS") return <ConfigMesas ajustes={ajustes} mesas={mesas} onGuardado={() => { setConfig(null); void cargarLista(); }} onCerrar={() => setConfig(null)} />;
  if (config === "MODS") return <ConfigModificadores ajustes={ajustes} catalogo={catalogo} actuales={modificadores} onGuardado={() => { setConfig(null); void cargarLista(); }} onCerrar={() => setConfig(null)} />;
  return (
    <><Modal titulo="Cuentas abiertas" onCerrar={onCerrar} ancho>
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
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <button className="boton primario" onClick={() => setNueva({ nombre: "", asientos: "0" })}>+ Nueva cuenta</button>
            <button className="boton fantasma chico" onClick={() => setConfig("MESAS")}>Mesas</button>
            <button className="boton fantasma chico" onClick={() => setConfig("MODS")}>Modificadores</button>
          </div>
          {lista === null && !error && <p className="suave">Cargando…</p>}
          {mesas.length > 0 && <MapaMesas mesas={mesas} onMesa={(m) => void tocarMesa(m)} />}
          {mesas.length === 0 && lista !== null && <p className="suave">Para ver el mapa del salón, un supervisor crea las mesas en «Mesas».</p>}
          {lista?.length === 0 && mesas.length === 0 && <p className="suave">No hay cuentas abiertas.</p>}
          {(() => {
            const nombres = new Set(mesas.map((m) => m.nombre));
            const otras = (lista ?? []).filter((c) => !c.mesa || !nombres.has(c.mesa));
            return otras.length > 0 ? (
              <>
                {mesas.length > 0 && <div className="mesas-zona">Otras cuentas (barra, clientes)</div>}
                <div className="resultados">
                  {otras.map((c) => (
                    <div key={c.id} className="factura">
                      <span><b>{c.nombre}</b> <span className="suave">· #{c.numero} · {c.lineas} producto(s){c.asientos ? ` · ${c.asientos} personas` : ""} · desde {hora(c.abiertaEn)}{c.total ? ` · ${rd(c.total)}` : ""}</span></span>
                      <span className="factura-acciones"><button className="boton primario" onClick={() => abrir(c.id)}>Abrir</button></span>
                    </div>
                  ))}
                </div>
              </>
            ) : null;
          })()}
        </>
      )}
    </Modal>{papel}</>
  );
}

function DetalleCuenta({ ajustes, base, cuenta, catalogo, nivel, error, aviso, ocupado, accion, modificadores, onCobrar, onVolver, onCerrar }: {
  ajustes: Ajustes; base: string; cuenta: CuentaC; catalogo: Catalogo; nivel: number; modificadores: Modificador[];
  error: string | null; aviso: string | null; ocupado: boolean; accion: (ruta: string, cuerpo?: unknown, metodo?: string) => Promise<CuentaC | null>;
  onCobrar: (plan: PlanCobro) => void; onVolver: () => void; onCerrar: () => void;
}) {
  const url = `${base}/${cuenta.id}`;
  /** A quién se carga lo que se pide: null = toda la mesa */
  const [destino, setDestino] = useState<string | null>(cuenta.asientos[0]?.id ?? null);
  const [dividiendo, setDividiendo] = useState(false);
  const [anulando, setAnulando] = useState<LineaC | null>(null);
  const [regalando, setRegalando] = useState<LineaC | null>(null);
  const [canjeando, setCanjeando] = useState<LineaC | null>(null);
  const [codigoVale, setCodigoVale] = useState("");
  const [infoVale, setInfoVale] = useState<string | null>(null);
  const [motivoTipo, setMotivoTipo] = useState("CASA");
  const [motivo, setMotivo] = useState("");
  const [uniendo, setUniendo] = useState(false);
  const [moviendo, setMoviendo] = useState(false);
  /** Servicio por tiempos (entradas → fuertes → postres): cada plato sale a la cocina cuando se pide su tiempo */
  const [tiempos, setTiempos] = useState(() => cuenta.pasoLiberado > 1 || cuenta.lineas.some((l) => l.paso > 1));
  const [pasoNuevo, setPasoNuevo] = useState(1);
  const [eligiendo, setEligiendo] = useState<ProductoCatalogo | null>(null);

  const vivas = cuenta.lineas.filter((l) => !l.anulada && !l.ventaId);
  const cobradas = cuenta.lineas.filter((l) => !l.anulada && l.ventaId).length;
  const grupos: { id: string | null; nombre: string; lineas: LineaC[] }[] = [
    { id: null, nombre: "Toda la mesa", lineas: vivas.filter((l) => l.asientoId === null) },
    ...cuenta.asientos.map((a) => ({ id: a.id, nombre: a.nombre, lineas: vivas.filter((l) => l.asientoId === a.id) })),
  ];

  const aplicables = (p: ProductoCatalogo) => modificadores.filter((m) => m.categoriaId === null || m.categoriaId === p.categoriaId);
  const agregar = (p: ProductoCatalogo, extra?: { mods: string[]; nota: string; paso: number }) => {
    if (precioPara(p, nivel, catalogo.nivelPredeterminado).precio === null && !p.precioVariable) return;
    // Un plato con modificadores pregunta cuáles lleva antes de cargarse
    if (!extra && aplicables(p).length) { setEligiendo(p); return; }
    void accion(`${url}/lineas`, {
      presentacionId: p.presentacionId, cantidad: "1", asientoId: destino,
      ...(extra?.mods.length ? { modificadores: extra.mods } : {}), ...(extra?.nota ? { nota: extra.nota } : {}), paso: extra?.paso ?? (tiempos ? pasoNuevo : 1),
    });
  };
  /** Lo que ya tiene la cuenta pendiente de cada producto (se ve en la tarjeta del catálogo) */
  const enCuenta = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of vivas) m.set(l.presentacionId, (m.get(l.presentacionId) ?? 0) + Number(l.cantidad));
    return m;
  }, [vivas]);
  const porCodigo = (t: string) => {
    const p = catalogo.productos.find((x) => x.codigos.includes(t.trim()));
    if (!p) return false;
    agregar(p);
    return true;
  };

  if (eligiendo) {
    return <ElegirModificadores titulo={eligiendo.nombre} mods={aplicables(eligiendo)} tiempos={tiempos} pasoInicial={pasoNuevo}
      onCerrar={() => setEligiendo(null)} onListo={(r) => { const p = eligiendo; setEligiendo(null); agregar(p, r); }} />;
  }
  if (moviendo) {
    return <MoverCuenta ajustes={ajustes} base={base} cuentaId={cuenta.id} accion={accion} onCerrar={() => setMoviendo(false)}
      lineas={vivas.filter((l) => !l.padreId).map((l) => ({ id: l.id, descripcion: l.descripcion, cantidad: l.cantidad, total: l.total }))} />;
  }
  if (dividiendo) return <DividirCuenta ajustes={ajustes} url={url} cuenta={cuenta} onCobrar={onCobrar} onVolver={() => setDividiendo(false)} />;
  if (anulando) {
    return (
      <Modal titulo="Quitar de la cuenta" onCerrar={() => { setAnulando(null); setMotivo(""); }}>
        <p><b>{anulando.descripcion}</b> ya salió a la barra o la cocina. Para quitarlo hace falta el motivo y la aprobación de un supervisor; queda en el reporte.</p>
        <label>Motivo<input autoFocus value={motivo} maxLength={200} placeholder="Se equivocó de producto, el cliente no lo quiso…" onChange={(e) => setMotivo(e.target.value)} /></label>
        <PinSupervisor ajustes={ajustes} permiso="venta.anular" textoBoton="Autorizar y quitar" deshabilitado={motivo.trim().length < 3}
          onAprobado={(a) => { const l = anulando; const m = motivo.trim(); setAnulando(null); setMotivo(""); void accion(`${url}/lineas/${l.id}`, { anulada: true, autorizacion: a.token, motivo: m }, "PATCH"); }} />
      </Modal>
    );
  }
  if (canjeando) {
    const cerrar = () => { setCanjeando(null); setCodigoVale(""); setInfoVale(null); };
    const revisar = async () => {
      try { const v = await api<{ descripcion: string; restantes: number }>(ajustes.servidor, `/cajas/${ajustes.cajaId}/vales/${encodeURIComponent(codigoVale.trim())}`); setInfoVale(`${v.descripcion}: le quedan ${v.restantes} consumo(s)`); }
      catch (e) { setInfoVale((e as Error).message); }
    };
    return (
      <Modal titulo="Canjear vale de consumo" onCerrar={cerrar}>
        <p><b>{Number(canjeando.cantidad)} × {canjeando.descripcion}</b> se paga con el vale: no se cobra y se descuenta del inventario.</p>
        <label>Código del vale<input autoFocus value={codigoVale} maxLength={12} placeholder="K7M2QX" style={{ textTransform: "uppercase", letterSpacing: 2 }}
          onChange={(e) => { setCodigoVale(e.target.value.toUpperCase()); setInfoVale(null); }} onKeyDown={(e) => e.key === "Enter" && codigoVale.trim().length >= 3 && void revisar()} /></label>
        {infoVale && <p className="suave">{infoVale}</p>}
        <button className="boton ancho" disabled={codigoVale.trim().length < 3} onClick={() => void revisar()}>Ver consumos del vale</button>
        <button className="boton primario ancho" style={{ marginTop: 8 }} disabled={codigoVale.trim().length < 3}
          onClick={() => { const l = canjeando; const c = codigoVale.trim(); cerrar(); void accion(`${url}/lineas/${l.id}/vale`, { codigo: c }); }}>Canjear</button>
      </Modal>
    );
  }
  if (regalando) {
    const motivos: [string, string][] = [["CASA", "Invitación de la casa"], ["RRPP", "Relaciones públicas"], ["CLIENTE_VIP", "Cliente VIP"], ["ERROR", "Error o producto devuelto"], ["OTRO", "Otro"]];
    return (
      <Modal titulo="Cortesía" onCerrar={() => { setRegalando(null); setMotivo(""); }}>
        <p><b>{Number(regalando.cantidad)} × {regalando.descripcion}</b> ({rd(regalando.total)}) se regala: no se cobra, se descuenta del inventario y queda en el reporte con su motivo. Requiere un supervisor.</p>
        <div className="chips-categorias">{motivos.map(([k, t]) => <button key={k} className={motivoTipo === k ? "activa" : ""} onClick={() => setMotivoTipo(k)}>{t}</button>)}</div>
        <label>Detalle {motivoTipo === "OTRO" ? "" : <span className="suave">(opcional: a quién o por qué)</span>}<input value={motivo} maxLength={200} onChange={(e) => setMotivo(e.target.value)} /></label>
        <PinSupervisor ajustes={ajustes} permiso="venta.descuento" textoBoton="Autorizar cortesía" deshabilitado={motivoTipo === "OTRO" && motivo.trim().length < 3}
          onAprobado={(a) => { const l = regalando; const m = motivo.trim(); const t = motivoTipo; setRegalando(null); setMotivo(""); setMotivoTipo("CASA"); void accion(`${url}/lineas/${l.id}/cortesia`, { motivoTipo: t, motivo: m, autorizacion: a.token }); }} />
      </Modal>
    );
  }
  if (uniendo) return <UnirCuenta ajustes={ajustes} base={base} actualId={cuenta.id} onElegir={(id) => { setUniendo(false); void accion(`${url}/unir`, { desdeId: id }); }} onVolver={() => setUniendo(false)} />;

  return (
    <Modal titulo={`${cuenta.nombre} · #${cuenta.numero}`} onCerrar={onCerrar} ancho clase="cuenta-ancha">
      <div className="cuenta-doble">
        <section className="cuenta-catalogo" aria-label="Productos">
          <VistaCatalogo servidor={ajustes.servidor} catalogo={catalogo} nivel={nivel} enCarrito={enCuenta} onAgregar={agregar} onCodigo={porCodigo} />
        </section>
        <section className="cuenta-lado" aria-label="Cuenta">
          <button className="enlace" onClick={onVolver}>← Todas las cuentas</button>
          {error && <p className="error">{error}</p>}
          {aviso && <p className="suave" style={{ margin: "4px 0", color: "var(--acento, #2dd4bf)" }}>{aviso}</p>}
          <div className="pestanas" style={{ flexWrap: "wrap" }}>
            <button className={destino === null ? "activa" : ""} onClick={() => setDestino(null)}>Toda la mesa</button>
            {cuenta.asientos.map((a) => <button key={a.id} className={destino === a.id ? "activa" : ""} onClick={() => setDestino(a.id)}>{a.nombre}</button>)}
            <button onClick={async () => { const c = await accion(`${url}/asientos`, {}); if (c) setDestino(c.asientos[c.asientos.length - 1]?.id ?? null); }}>+ Persona</button>
          </div>
          <p className="suave" style={{ margin: "0 0 4px" }}>Lo que toque en el catálogo se carga a: <b>{destino ? cuenta.asientos.find((a) => a.id === destino)?.nombre ?? "" : "toda la mesa"}</b></p>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", margin: "0 0 6px" }}>
            <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }} title="Entradas primero, luego fuertes y postres: cada tiempo sale a la cocina cuando se pide">
              <input type="checkbox" checked={tiempos} disabled={vivas.some((l) => l.paso > 1 && !l.enviadaEn)} onChange={(e) => setTiempos(e.target.checked)} /> Servir por tiempos
            </label>
            {tiempos && <span className="pasos"><span className="suave">Lo que agregue sale en:</span>{PASOS.map(([n, t]) => <button key={n} className={pasoNuevo === n ? "activa" : ""} onClick={() => setPasoNuevo(n)}>{t}</button>)}</span>}
          </div>
          <div className="cuenta-lineas">
            {grupos.filter((g) => g.id === null ? g.lineas.length > 0 : true).map((g) => (
              <div key={g.id ?? "mesa"} style={{ marginTop: 8 }}>
                <b>{g.nombre}</b> <span className="suave">{g.id ? rd(cuenta.asientos.find((a) => a.id === g.id)?.total ?? 0) : rd(cuenta.sinAsiento)}</span>
                {g.lineas.length === 0 && <p className="suave" style={{ margin: "2px 0" }}>Nada pedido todavía.</p>}
                {g.lineas.filter((l) => !l.padreId).map((l) => (
                  <div key={l.id}>
                  <div className="factura">
                    <span>{Number(l.cantidad)} × {l.descripcion}{l.enviadaEn ? <span className="suave"> · enviado</span> : null}
                      {l.nota ? <span className="suave"> · {l.nota}</span> : null}
                      {tiempos && !l.enviadaEn ? <span className="suave"> · {PASOS.find(([n]) => n === l.paso)?.[1] ?? ""}{l.paso > cuenta.pasoLiberado ? " (espera)" : ""}</span> : null}</span>
                    <span className="factura-acciones">
                      <b>{rd(l.total)}</b>
                      {cuenta.asientos.length > 0 && (
                        <select aria-label="Pasar a" value={l.asientoId ?? ""} onChange={(e) => void accion(`${url}/lineas/${l.id}`, { asientoId: e.target.value || null }, "PATCH")}>
                          <option value="">Mesa</option>
                          {cuenta.asientos.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                        </select>
                      )}
                      {tiempos && !l.enviadaEn && (
                        <select aria-label="Tiempo" value={l.paso} onChange={(e) => void accion(`${url}/lineas/${l.id}`, { paso: Number(e.target.value) }, "PATCH")}>
                          {PASOS.map(([n, t]) => <option key={n} value={n}>{t}</option>)}
                        </select>
                      )}
                      <button className="enlace" disabled={ocupado} title="Pagar este producto con un vale de consumo" onClick={() => setCanjeando(l)}>Vale</button>
                      <button className="enlace" disabled={ocupado} title="Regalar este producto (supervisor)" onClick={() => setRegalando(l)}>Cortesía</button>
                      <button className="enlace" disabled={ocupado} onClick={() => (l.enviadaEn ? setAnulando(l) : void accion(`${url}/lineas/${l.id}`, { anulada: true }, "PATCH"))}>Quitar</button>
                    </span>
                  </div>
                  {vivas.filter((h) => h.padreId === l.id).map((h) => (
                    <div key={h.id} className="factura linea-extra"><span>{h.descripcion}</span><span className="factura-acciones"><b>{rd(h.total)}</b></span></div>
                  ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
          {!!cuenta.cortesias?.length && <p className="suave" style={{ margin: "6px 0 0" }}>Cortesías: {cuenta.cortesias.map((c) => `${Number(c.cantidad)} × ${c.descripcion}`).join(", ")}</p>}
          {cobradas > 0 && <p className="suave">Ya se cobraron {cobradas} producto(s) de esta cuenta; abajo queda lo pendiente.</p>}
          <p style={{ marginTop: 10 }}><b>Pendiente {rd(cuenta.total)}</b> <span className="suave">· propina legal 10 % {rd(cuenta.propinaLegal)}</span></p>
          <div className="pv-atajos pv-atajos-min" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
            <button disabled={ocupado || !vivas.some((l) => !l.enviadaEn && l.paso <= cuenta.pasoLiberado)} onClick={() => void accion(`${url}/enviar`)}>Enviar a barra/cocina</button>
            {tiempos && (
              <button disabled={ocupado || cuenta.pasoLiberado >= 3} title="Libera y envía lo que esperaba su turno"
                onClick={() => void accion(`${url}/siguiente-tiempo`)}>Pedir {cuenta.pasoLiberado === 1 ? "fuertes" : "postres"}</button>
            )}
            <button disabled={ocupado} onClick={() => setMoviendo(true)}>Mover / cambiar mesa</button>
            <button disabled={ocupado} onClick={() => setUniendo(true)}>Unir con otra</button>
            <button className="primario" disabled={ocupado || !vivas.length} onClick={() => setDividiendo(true)}>Dividir y cobrar</button>
          </div>
        </section>
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
