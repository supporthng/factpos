import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Ajustes } from "./api";
import { Modal } from "./Venta";
import { imprimir } from "./imprimir";

/**
 * Comandas por estación (barra, cocina): el cajero toca «Enviar» en la cuenta y cada estación recibe lo suyo.
 * La estación lo ve en su pantalla (cola con «Listo») y/o sale impreso (en la caja que envía, o en la pantalla de la estación).
 */
export interface Comanda {
  id: string; numero: string; estacion?: string; cuenta: string; mesa: string | null; creadaEn: string;
  estado?: string; impresaEn?: string | null; listaEn?: string | null;
  /** tiempo de servicio (1 sale ya, 2 fuertes, 3 postres), segundos desde que se pidió y minutos para marcarla atrasada (los da el servidor) */
  paso?: number; segundos?: number; alertaMinutos?: number;
  lineas: { descripcion: string; cantidad: string; persona: string | null; nota: string | null }[] | null;
}
interface Estacion { id: string; nombre: string; tipo: "BARRA" | "COCINA"; imprimeEnCaja: boolean; activa: boolean; categoriaIds: string[]; alertaMinutos?: number }
export const NOMBRE_PASO: Record<number, string> = { 1: "Entradas y bebidas", 2: "Platos fuertes", 3: "Postres" };
interface Categoria { id: string; nombre: string }

const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-DO", { hour: "2-digit", minute: "2-digit", timeZone: "America/Santo_Domingo" });
/** Minutos que lleva esperando una comanda: usa el reloj del servidor (así no depende de la hora de esta pantalla) */
const minutos = (c: Comanda) => Math.max(0, Math.floor((c.segundos ?? Math.max(0, (Date.now() - new Date(c.creadaEn).getTime()) / 1000)) / 60));
const cant = (c: string) => String(Number(c));

/** Ticket de la comanda: imprime solo (por la impresora de esta caja) y se quita. */
export function ComandaPapel({ comanda, onListo }: { comanda: Comanda; onListo: () => void }) {
  const hecho = useRef(false);
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (hecho.current) return;
      hecho.current = true;
      imprimir();
      window.setTimeout(onListo, 600);
    }, 200);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comanda.id]);
  // Las personas se agrupan: a quien se le entrega cada cosa
  const grupos = new Map<string, NonNullable<Comanda["lineas"]>>();
  for (const l of comanda.lineas ?? []) grupos.set(l.persona ?? "Toda la mesa", [...(grupos.get(l.persona ?? "Toda la mesa") ?? []), l]);
  return (
    <div className="fondo-modal ticket-auto" aria-hidden>
      <div className="modal ticket-modal">
        <style>{`@media print { @page { size: 80mm auto; margin: 0; } }`}</style>
        <div className="ticket" id="ticket">
          <div className="t-centro"><b style={{ fontSize: "1.5em" }}>{comanda.estacion ?? "COMANDA"}</b></div>
          <div className="t-centro"><b>Comanda #{comanda.numero}</b></div>
          <div className="t-linea" />
          <div className="t-fila"><span>Cuenta</span><b>{comanda.cuenta}</b></div>
          {comanda.mesa && <div className="t-fila"><span>Mesa</span><b>{comanda.mesa}</b></div>}
          <div className="t-fila"><span>Hora</span><span>{hora(comanda.creadaEn)}</span></div>
          {(comanda.paso ?? 1) > 1 && <div className="t-centro"><b>TIEMPO {comanda.paso} · {(NOMBRE_PASO[comanda.paso ?? 1] ?? "").toUpperCase()}</b></div>}
          <div className="t-linea" />
          {[...grupos].map(([persona, ls]) => (
            <div key={persona} style={{ marginBottom: 6 }}>
              {grupos.size > 1 || persona !== "Toda la mesa" ? <div><b>— {persona} —</b></div> : null}
              {ls.map((l, i) => (
                <div key={i} style={{ fontSize: "1.25em", fontWeight: 700 }}>
                  {cant(l.cantidad)} × {l.descripcion}
                  {l.nota && <div style={{ fontSize: ".8em", fontWeight: 400 }}>» {l.nota}</div>}
                </div>
              ))}
            </div>
          ))}
          <div className="t-linea" />
        </div>
      </div>
    </div>
  );
}

/**
 * Pantalla de la estación: cola de comandas pendientes, «Listo» para sacarlas y, si se activa, imprime las nuevas solas.
 * Se deja abierta en la terminal de la barra o la cocina.
 */
export function Barra({ ajustes, onCerrar }: { ajustes: Ajustes; onCerrar: () => void }) {
  const base = `/cajas/${ajustes.cajaId}`;
  const [estaciones, setEstaciones] = useState<Estacion[] | null>(null);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [elegida, setElegida] = useState<string>(() => { try { return localStorage.getItem("factpos.estacion") ?? ""; } catch { return ""; } });
  const [cola, setCola] = useState<Comanda[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [autoImprimir, setAutoImprimir] = useState<boolean>(() => { try { return localStorage.getItem("factpos.estacion.imprimir") === "1"; } catch { return false; } });
  const [configurando, setConfigurando] = useState(false);
  const [porImprimir, setPorImprimir] = useState<Comanda[]>([]);
  const [, reloj] = useState(0);
  /** Las que ya se mandaron a imprimir desde esta pantalla, para no repetirlas aunque falle el aviso */
  const impresas = useRef(new Set<string>());
  const primera = useRef(true);

  const cargarEstaciones = useCallback(async () => {
    try {
      const r = await api<{ estaciones: Estacion[]; categorias: Categoria[] }>(ajustes.servidor, `${base}/estaciones`);
      setEstaciones(r.estaciones); setCategorias(r.categorias); setError(null);
    } catch (e) { setError((e as Error).message); setEstaciones([]); }
  }, [ajustes.servidor, base]);
  useEffect(() => { void cargarEstaciones(); }, [cargarEstaciones]);

  const activas = (estaciones ?? []).filter((e) => e.activa);
  const estacion = activas.find((e) => e.id === elegida) ?? null;

  useEffect(() => {
    if (!estacion) { setCola([]); return; }
    let vivo = true;
    const traer = async () => {
      try {
        const r = await api<Comanda[]>(ajustes.servidor, `${base}/comandas?estacionId=${estacion.id}`);
        if (!vivo) return;
        setCola(r); setError(null);
        if (autoImprimir) {
          // Lo pendiente que nunca se imprimió (al abrir la pantalla también se recupera lo que llegó con ella cerrada)
          const nuevas = r.filter((c) => c.estado === "PENDIENTE" && !c.impresaEn && !impresas.current.has(c.id));
          if (nuevas.length) { nuevas.forEach((c) => impresas.current.add(c.id)); setPorImprimir((x) => [...x, ...nuevas.map((c) => ({ ...c, estacion: estacion.nombre }))]); }
        }
        primera.current = false;
      } catch (e) { if (vivo) setError((e as Error).message); }
    };
    void traer();
    const t = window.setInterval(() => { void traer(); reloj((n) => n + 1); }, 4000);
    return () => { vivo = false; window.clearInterval(t); };
  }, [ajustes.servidor, base, estacion?.id, estacion?.nombre, autoImprimir]);

  const elegir = (id: string) => { setElegida(id); try { localStorage.setItem("factpos.estacion", id); } catch { /* sin almacenamiento */ } };
  const cambiarAuto = (v: boolean) => { setAutoImprimir(v); try { localStorage.setItem("factpos.estacion.imprimir", v ? "1" : "0"); } catch { /* sin almacenamiento */ } };
  const marcar = async (c: Comanda, ruta: "lista" | "pendiente") => {
    try { await api(ajustes.servidor, `${base}/comandas/${c.id}/${ruta}`, { cuerpo: {} }); setCola((x) => x.map((y) => (y.id === c.id ? { ...y, estado: ruta === "lista" ? "LISTA" : "PENDIENTE" } : y))); }
    catch (e) { setError((e as Error).message); }
  };
  const terminoImpresion = (c: Comanda) => {
    void api(ajustes.servidor, `${base}/comandas/${c.id}/impresa`, { cuerpo: {} }).catch(() => undefined);
    setPorImprimir((x) => x.filter((y) => y.id !== c.id));
  };

  if (configurando) {
    return <ConfigEstaciones ajustes={ajustes} estaciones={estaciones ?? []} categorias={categorias}
      onGuardado={() => { setConfigurando(false); void cargarEstaciones(); }} onCerrar={() => setConfigurando(false)} />;
  }

  const pendientes = cola.filter((c) => c.estado === "PENDIENTE");
  const listas = cola.filter((c) => c.estado === "LISTA");
  return (
    <Modal titulo="Barra y cocina" onCerrar={onCerrar} ancho clase="cuenta-ancha">
      <div className="barra">
        <div className="barra-cabecera">
          <div className="pestanas" style={{ flexWrap: "wrap" }}>
            {activas.map((e) => <button key={e.id} className={e.id === estacion?.id ? "activa" : ""} onClick={() => elegir(e.id)}>{e.nombre}</button>)}
          </div>
          <span style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }} title="Imprime en esta terminal cada comanda nueva de la estación">
              <input type="checkbox" checked={autoImprimir} onChange={(e) => cambiarAuto(e.target.checked)} /> Imprimir las nuevas aquí
            </label>
            <button className="boton fantasma chico" onClick={() => setConfigurando(true)}>Configurar estaciones</button>
          </span>
        </div>
        {error && <p className="error">{error}</p>}
        {estaciones && !activas.length && <p className="suave">Todavía no hay estaciones. Un supervisor las crea en «Configurar estaciones» (por ejemplo, Barra principal y Cocina) y elige qué categorías prepara cada una.</p>}
        {activas.length > 0 && !estacion && <p className="suave">Elija la estación de esta pantalla.</p>}
        {estacion && (
          <div className="barra-cola">
            {!pendientes.length && <p className="suave" style={{ gridColumn: "1 / -1" }}>No hay comandas pendientes en {estacion.nombre}.</p>}
            {pendientes.map((c) => (
              <article key={c.id} className={"comanda" + (minutos(c) >= (c.alertaMinutos ?? 10) * 1.5 ? " muy-tarde" : minutos(c) >= (c.alertaMinutos ?? 10) ? " tarde" : "")}>
                <header><b>#{c.numero} · {c.mesa ?? c.cuenta}</b><span>{minutos(c) === 0 ? "ahora" : `hace ${minutos(c)} min`}</span></header>
                {(c.paso ?? 1) > 1 && <div className="comanda-tiempo">Tiempo {c.paso} · {NOMBRE_PASO[c.paso ?? 1]}</div>}
                <ul>{c.lineas?.map((l, i) => (
                  <li key={i}><b>{cant(l.cantidad)} × {l.descripcion}</b>{l.persona && <span className="suave"> · {l.persona}</span>}{l.nota && <div className="suave">» {l.nota}</div>}</li>
                ))}</ul>
                <footer>
                  <button className="boton fantasma chico" onClick={() => setPorImprimir((x) => [...x, { ...c, estacion: estacion.nombre }])}>Imprimir</button>
                  <button className="boton primario" onClick={() => marcar(c, "lista")}>Listo</button>
                </footer>
              </article>
            ))}
            {listas.length > 0 && <h4 style={{ gridColumn: "1 / -1", margin: "8px 0 0" }}>Listas (últimos 10 minutos)</h4>}
            {listas.map((c) => (
              <article key={c.id} className="comanda lista">
                <header><b>#{c.numero} · {c.cuenta}</b><span>lista</span></header>
                <footer><button className="enlace" onClick={() => marcar(c, "pendiente")}>Devolver a la cola</button></footer>
              </article>
            ))}
          </div>
        )}
      </div>
      {porImprimir[0] && <ComandaPapel key={porImprimir[0].id + porImprimir.length} comanda={porImprimir[0]} onListo={() => terminoImpresion(porImprimir[0])} />}
    </Modal>
  );
}

/** Crear estaciones y elegir qué categorías prepara cada una (solo supervisor: el servidor lo exige). */
function ConfigEstaciones({ ajustes, estaciones, categorias, onGuardado, onCerrar }: {
  ajustes: Ajustes; estaciones: Estacion[]; categorias: Categoria[]; onGuardado: () => void; onCerrar: () => void;
}) {
  const [lista, setLista] = useState<Estacion[]>(estaciones.filter((e) => e.activa));
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const cambiar = (i: number, c: Partial<Estacion>) => setLista((l) => l.map((e, j) => (j === i ? { ...e, ...c } : e)));
  const alternar = (i: number, cat: string) => setLista((l) => l.map((e, j) => {
    // una categoría va a una sola estación: se quita de las demás
    if (j === i) return { ...e, categoriaIds: e.categoriaIds.includes(cat) ? e.categoriaIds.filter((x) => x !== cat) : [...e.categoriaIds, cat] };
    return { ...e, categoriaIds: e.categoriaIds.filter((x) => x !== cat) };
  }));
  const guardar = async () => {
    setGuardando(true);
    try {
      await api(ajustes.servidor, `/cajas/${ajustes.cajaId}/estaciones`, { metodo: "PUT", cuerpo: { estaciones: lista.map((e) => ({ id: e.id || undefined, nombre: e.nombre, tipo: e.tipo, imprimeEnCaja: e.imprimeEnCaja, alertaMinutos: e.alertaMinutos ?? 10, activa: true, categoriaIds: e.categoriaIds })) } });
      onGuardado();
    } catch (e) { setError((e as Error).message); }
    setGuardando(false);
  };
  return (
    <Modal titulo="Estaciones de barra y cocina" onCerrar={onCerrar} ancho>
      <p className="suave">Cada categoría de productos se prepara en una estación. Lo que no tenga estación se envía sin comanda (por ejemplo, el hielo).</p>
      {error && <p className="error">{error}</p>}
      {lista.map((e, i) => (
        <div key={e.id || i} className="cobro2-bloque" style={{ marginBottom: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 8, alignItems: "end" }}>
            <label className="campo"><span>Nombre</span><input value={e.nombre} maxLength={40} placeholder="Barra principal" onChange={(ev) => cambiar(i, { nombre: ev.target.value })} /></label>
            <label className="campo"><span>Tipo</span>
              <select value={e.tipo} onChange={(ev) => cambiar(i, { tipo: ev.target.value as Estacion["tipo"] })}><option value="BARRA">Barra</option><option value="COCINA">Cocina</option></select></label>
            <button className="enlace" onClick={() => setLista((l) => l.filter((_, j) => j !== i))}>Quitar</button>
          </div>
          <label className="campo" style={{ maxWidth: 260 }}><span>Marcar atrasada después de (minutos)</span>
            <input inputMode="numeric" value={String(e.alertaMinutos ?? 10)} onChange={(ev) => cambiar(i, { alertaMinutos: Math.max(1, Math.min(120, Number(ev.target.value.replace(/\D/g, "")) || 1)) })} /></label>
          <label style={{ display: "flex", gap: 6, alignItems: "center", margin: "6px 0", cursor: "pointer" }}>
            <input type="checkbox" checked={e.imprimeEnCaja} onChange={(ev) => cambiar(i, { imprimeEnCaja: ev.target.checked })} />
            Imprimir la comanda en la caja que envía <span className="suave">(si la impresora está en la caja y no en la barra)</span>
          </label>
          <div className="chips-categorias">
            {categorias.map((c) => <button key={c.id} className={e.categoriaIds.includes(c.id) ? "activa" : ""} onClick={() => alternar(i, c.id)}>{c.nombre}</button>)}
          </div>
        </div>
      ))}
      <button className="boton fantasma" onClick={() => setLista((l) => [...l, { id: "", nombre: "", tipo: "BARRA", imprimeEnCaja: false, activa: true, categoriaIds: [], alertaMinutos: 10 }])}>+ Agregar estación</button>
      <button className="boton primario ancho" style={{ marginTop: 10 }} disabled={guardando || lista.some((e) => !e.nombre.trim())} onClick={guardar}>Guardar</button>
    </Modal>
  );
}
