import { useEffect, useMemo, useState } from "react";
import type { Catalogo } from "@factpos/compartido";
import { api, rd, type Ajustes } from "./api";
import { Modal } from "./Venta";

/**
 * Salón de restaurante: mapa de mesas, modificadores de los platos y cambio de mesa o de productos entre cuentas.
 * Lo configura un supervisor (el servidor lo exige); el mesero o cajero solo lo usa.
 */
export interface MesaC {
  id: string; nombre: string; zona: string; capacidad: number;
  cuentaId: string | null; abiertaEn: string | null; mesero: string | null; minutos: number | null; productos: number | null; total: string | null; esperando: number | null;
}
export interface Modificador { id: string; grupo: string; nombre: string; presentacionId: string | null; categoriaId: string | null; producto: string | null }
export const PASOS: [number, string][] = [[1, "Ya"], [2, "Fuertes"], [3, "Postres"]];

export const duracion = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}`);

/** Mesas agrupadas por zona; tocar una libre abre su cuenta y tocar una ocupada la retoma. */
export function MapaMesas({ mesas, onMesa }: { mesas: MesaC[]; onMesa: (m: MesaC) => void }) {
  const zonas = useMemo(() => {
    const m = new Map<string, MesaC[]>();
    for (const x of mesas) m.set(x.zona, [...(m.get(x.zona) ?? []), x]);
    return [...m];
  }, [mesas]);
  return (
    <>
      {zonas.map(([zona, lista]) => (
        <section key={zona}>
          {(zonas.length > 1 || zona) && <div className="mesas-zona">{zona || "Mesas"}</div>}
          <div className="mesas-mapa">
            {lista.map((m) => {
              const ocupada = !!m.cuentaId;
              const larga = ocupada && (m.minutos ?? 0) >= 90;
              return (
                <button key={m.id} className={"mesa " + (ocupada ? (larga ? "ocupada larga" : "ocupada") : "libre")} onClick={() => onMesa(m)}
                  aria-label={`${m.nombre}, ${ocupada ? "ocupada" : "libre"}`}>
                  <b>{m.nombre}</b>
                  {ocupada
                    ? <><small>{m.mesero ?? ""}{m.mesero ? " · " : ""}{duracion(m.minutos ?? 0)}</small>
                      {!!m.esperando && <span className="mesa-espera">{m.esperando} sin enviar</span>}
                      <span className="mesa-total">{rd(m.total ?? "0")}</span></>
                    : <small>Libre · {m.capacidad} personas</small>}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}

/** Crear y ordenar las mesas por zona (solo supervisor). */
export function ConfigMesas({ ajustes, mesas, onGuardado, onCerrar }: { ajustes: Ajustes; mesas: MesaC[]; onGuardado: () => void; onCerrar: () => void }) {
  const [lista, setLista] = useState<{ id?: string; nombre: string; zona: string; capacidad: number }[]>(mesas.map((m) => ({ id: m.id, nombre: m.nombre, zona: m.zona, capacidad: m.capacidad })));
  const [lote, setLote] = useState({ cuantas: "10", prefijo: "Mesa", zona: "Salón", capacidad: "4" });
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const cambiar = (i: number, c: Partial<(typeof lista)[number]>) => setLista((l) => l.map((x, j) => (j === i ? { ...x, ...c } : x)));
  const agregarLote = () => {
    const n = Math.max(1, Math.min(100, Number(lote.cuantas) || 0));
    const usados = new Set(lista.map((m) => m.nombre.toLowerCase()));
    const nuevas: typeof lista = [];
    for (let k = 1; nuevas.length < n && k < 1000; k++) {
      const nombre = `${lote.prefijo.trim() || "Mesa"} ${k}`;
      if (!usados.has(nombre.toLowerCase())) nuevas.push({ nombre, zona: lote.zona.trim(), capacidad: Math.max(1, Math.min(60, Number(lote.capacidad) || 4)) });
    }
    setLista((l) => [...l, ...nuevas]);
  };
  const guardar = async () => {
    setGuardando(true);
    try { await api(ajustes.servidor, `/cajas/${ajustes.cajaId}/mesas`, { metodo: "PUT", cuerpo: { mesas: lista } }); onGuardado(); }
    catch (e) { setError((e as Error).message); }
    setGuardando(false);
  };
  return (
    <Modal titulo="Mesas del salón" onCerrar={onCerrar} ancho>
      <p className="suave">Cree las mesas por zona (Salón, Terraza, Barra…). Una mesa con cuenta abierta se ve ocupada en el mapa.</p>
      {error && <p className="error">{error}</p>}
      <div className="cobro2-bloque" style={{ marginBottom: 10 }}>
        <b>Crear varias de una vez</b>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr) auto", gap: 8, alignItems: "end" }}>
          <label className="campo"><span>Cuántas</span><input inputMode="numeric" value={lote.cuantas} onChange={(e) => setLote({ ...lote, cuantas: e.target.value.replace(/\D/g, "").slice(0, 3) })} /></label>
          <label className="campo"><span>Nombre</span><input value={lote.prefijo} maxLength={20} onChange={(e) => setLote({ ...lote, prefijo: e.target.value })} /></label>
          <label className="campo"><span>Zona</span><input value={lote.zona} maxLength={30} onChange={(e) => setLote({ ...lote, zona: e.target.value })} /></label>
          <label className="campo"><span>Personas</span><input inputMode="numeric" value={lote.capacidad} onChange={(e) => setLote({ ...lote, capacidad: e.target.value.replace(/\D/g, "").slice(0, 2) })} /></label>
          <button className="boton" onClick={agregarLote}>Crear</button>
        </div>
      </div>
      <div className="resultados" style={{ maxHeight: "40vh", overflow: "auto" }}>
        {lista.map((m, i) => (
          <div key={m.id ?? `n${i}`} style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 80px auto", gap: 8, alignItems: "center", marginBottom: 6 }}>
            <input aria-label="Nombre" value={m.nombre} maxLength={30} onChange={(e) => cambiar(i, { nombre: e.target.value })} />
            <input aria-label="Zona" value={m.zona} maxLength={30} placeholder="Zona" onChange={(e) => cambiar(i, { zona: e.target.value })} />
            <input aria-label="Personas" inputMode="numeric" value={String(m.capacidad)} onChange={(e) => cambiar(i, { capacidad: Math.max(1, Math.min(60, Number(e.target.value.replace(/\D/g, "")) || 1)) })} />
            <button className="enlace" onClick={() => setLista((l) => l.filter((_, j) => j !== i))}>Quitar</button>
          </div>
        ))}
        {!lista.length && <p className="suave">Todavía no hay mesas.</p>}
      </div>
      <button className="boton primario ancho" style={{ marginTop: 10 }} disabled={guardando || lista.some((m) => !m.nombre.trim())} onClick={guardar}>Guardar mesas</button>
    </Modal>
  );
}

/** Crear los modificadores: de nota (término, sin cebolla) o extras con cargo (un producto del catálogo). Solo supervisor. */
export function ConfigModificadores({ ajustes, catalogo, actuales, onGuardado, onCerrar }: {
  ajustes: Ajustes; catalogo: Catalogo; actuales: Modificador[]; onGuardado: () => void; onCerrar: () => void;
}) {
  const [lista, setLista] = useState<Modificador[]>(actuales);
  const [buscar, setBuscar] = useState<{ i: number; texto: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const categorias = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of catalogo.productos) if (p.categoriaId && p.categoria) m.set(p.categoriaId, p.categoria);
    return [...m].sort((a, b) => a[1].localeCompare(b[1]));
  }, [catalogo.productos]);
  const cambiar = (i: number, c: Partial<Modificador>) => setLista((l) => l.map((x, j) => (j === i ? { ...x, ...c } : x)));
  const resultados = buscar && buscar.texto.trim().length >= 2
    ? catalogo.productos.filter((p) => p.nombre.toLowerCase().includes(buscar.texto.trim().toLowerCase())).slice(0, 6) : [];
  const guardar = async () => {
    setGuardando(true);
    try {
      await api(ajustes.servidor, `/cajas/${ajustes.cajaId}/modificadores`, {
        metodo: "PUT", cuerpo: { modificadores: lista.map((m) => ({ id: m.id || undefined, grupo: m.grupo, nombre: m.nombre, presentacionId: m.presentacionId, categoriaId: m.categoriaId })) },
      });
      onGuardado();
    } catch (e) { setError((e as Error).message); }
    setGuardando(false);
  };
  return (
    <Modal titulo="Modificadores de los platos" onCerrar={onCerrar} ancho>
      <p className="suave">Un modificador <b>sin cargo</b> (término medio, sin cebolla, aderezo aparte) sale en la comanda. Uno <b>con cargo</b> (extra queso) es un producto del catálogo: se cobra y descuenta del inventario.</p>
      {error && <p className="error">{error}</p>}
      <div style={{ maxHeight: "48vh", overflow: "auto" }}>
        {lista.map((m, i) => (
          <div key={m.id || `n${i}`} className="cobro2-bloque" style={{ marginBottom: 8 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, alignItems: "end" }}>
              <label className="campo"><span>Grupo</span><input value={m.grupo} maxLength={30} placeholder="Término, Quitar, Extras…" onChange={(e) => cambiar(i, { grupo: e.target.value })} /></label>
              <label className="campo"><span>Nombre</span><input value={m.nombre} maxLength={40} placeholder="Término medio" onChange={(e) => cambiar(i, { nombre: e.target.value })} /></label>
              <button className="enlace" onClick={() => setLista((l) => l.filter((_, j) => j !== i))}>Quitar</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 6 }}>
              <label className="campo"><span>Aplica a</span>
                <select value={m.categoriaId ?? ""} onChange={(e) => cambiar(i, { categoriaId: e.target.value || null })}>
                  <option value="">Todos los platos</option>
                  {categorias.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
                </select></label>
              <label className="campo"><span>Cargo</span>
                <select value={m.presentacionId ? "con" : "sin"} onChange={(e) => { if (e.target.value === "sin") cambiar(i, { presentacionId: null, producto: null }); else setBuscar({ i, texto: "" }); }}>
                  <option value="sin">Sin cargo (solo nota)</option>
                  <option value="con">Con cargo (un producto)</option>
                </select></label>
            </div>
            {m.presentacionId && <p className="suave" style={{ margin: "6px 0 0" }}>Producto del extra: <b>{m.producto}</b> <button className="enlace" onClick={() => setBuscar({ i, texto: "" })}>cambiar</button></p>}
            {buscar?.i === i && (
              <div style={{ marginTop: 6 }}>
                <input autoFocus placeholder="Buscar el producto del extra…" value={buscar.texto} onChange={(e) => setBuscar({ i, texto: e.target.value })} />
                {resultados.map((p) => (
                  <button key={p.presentacionId} className="boton fantasma ancho" style={{ justifyContent: "space-between", marginTop: 4 }}
                    onClick={() => { cambiar(i, { presentacionId: p.presentacionId, producto: p.nombre }); setBuscar(null); }}>{p.nombre}</button>
                ))}
                <button className="enlace" onClick={() => setBuscar(null)}>Cancelar</button>
              </div>
            )}
          </div>
        ))}
        {!lista.length && <p className="suave">Todavía no hay modificadores.</p>}
      </div>
      <button className="boton fantasma" onClick={() => setLista((l) => [...l, { id: "", grupo: "", nombre: "", presentacionId: null, categoriaId: null, producto: null }])}>+ Agregar modificador</button>
      <button className="boton primario ancho" style={{ marginTop: 10 }}
        disabled={guardando || lista.some((m) => !m.nombre.trim())} onClick={guardar}>Guardar</button>
    </Modal>
  );
}

/** Al tocar un plato con modificadores: elegir cuáles lleva (y en qué tiempo sale). */
export function ElegirModificadores({ titulo, mods, tiempos, pasoInicial, onListo, onCerrar }: {
  titulo: string; mods: Modificador[]; tiempos: boolean; pasoInicial: number;
  onListo: (r: { mods: string[]; nota: string; paso: number }) => void; onCerrar: () => void;
}) {
  const [sel, setSel] = useState<string[]>([]);
  const [nota, setNota] = useState("");
  const [paso, setPaso] = useState(pasoInicial);
  const grupos = useMemo(() => {
    const m = new Map<string, Modificador[]>();
    for (const x of mods) m.set(x.grupo, [...(m.get(x.grupo) ?? []), x]);
    return [...m];
  }, [mods]);
  const alternar = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  return (
    <Modal titulo={titulo} onCerrar={onCerrar}>
      {grupos.map(([g, lista]) => (
        <div key={g} style={{ marginBottom: 8 }}>
          {g && <div className="mesas-zona" style={{ margin: "4px 0" }}>{g}</div>}
          <div className="pasos">
            {lista.map((m) => <button key={m.id} className={sel.includes(m.id) ? "activa" : ""} onClick={() => alternar(m.id)}>{m.nombre}{m.presentacionId ? " (+)" : ""}</button>)}
          </div>
        </div>
      ))}
      <label>Otra indicación <span className="suave">(opcional)</span><input value={nota} maxLength={150} placeholder="Sin sal, alergia a…" onChange={(e) => setNota(e.target.value)} /></label>
      {tiempos && (
        <div style={{ margin: "8px 0" }}>
          <span className="suave">Sale en: </span>
          <span className="pasos">{PASOS.map(([n, t]) => <button key={n} className={paso === n ? "activa" : ""} onClick={() => setPaso(n)}>{t}</button>)}</span>
        </div>
      )}
      <p className="suave">«(+)» tiene cargo y se suma a la cuenta.</p>
      <button className="boton primario ancho" onClick={() => onListo({ mods: sel, nota: nota.trim(), paso })}>Agregar</button>
    </Modal>
  );
}

interface CuentaResumen { id: string; nombre: string; mesa: string | null; lineas: number }
interface LineaMover { id: string; descripcion: string; cantidad: string; total: string }

/** Cambiar la cuenta de mesa, o pasar productos sueltos a otra cuenta (de la barra a una mesa, de una mesa a otra). */
export function MoverCuenta({ ajustes, base, cuentaId, lineas, accion, onCerrar }: {
  ajustes: Ajustes; base: string; cuentaId: string; lineas: LineaMover[];
  accion: (ruta: string, cuerpo?: unknown, metodo?: string) => Promise<unknown>; onCerrar: () => void;
}) {
  const [modo, setModo] = useState<"MESA" | "PRODUCTOS">("MESA");
  const [mesas, setMesas] = useState<MesaC[]>([]);
  const [cuentas, setCuentas] = useState<CuentaResumen[]>([]);
  const [marcadas, setMarcadas] = useState<string[]>([]);
  const [destino, setDestino] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<MesaC[]>(ajustes.servidor, `/cajas/${ajustes.cajaId}/mesas`).then(setMesas).catch(() => undefined);
    api<CuentaResumen[]>(ajustes.servidor, base).then((l) => setCuentas(l.filter((c) => c.id !== cuentaId))).catch((e) => setError((e as Error).message));
  }, [ajustes.servidor, ajustes.cajaId, base, cuentaId]);
  const url = `${base}/${cuentaId}`;
  const hecho = async (ruta: string, cuerpo: unknown) => { if (await accion(ruta, cuerpo)) onCerrar(); };
  return (
    <Modal titulo="Mover" onCerrar={onCerrar} ancho>
      <div className="pestanas">
        <button className={modo === "MESA" ? "activa" : ""} onClick={() => setModo("MESA")}>Cambiar de mesa</button>
        <button className={modo === "PRODUCTOS" ? "activa" : ""} onClick={() => setModo("PRODUCTOS")}>Pasar productos a otra cuenta</button>
      </div>
      {error && <p className="error">{error}</p>}
      {modo === "MESA" ? (
        <>
          <p className="suave">Toda la cuenta pasa a la mesa que elija. Si la mesa está ocupada, use «Pasar productos» para juntarlos con esa cuenta.</p>
          {!mesas.length && <p className="suave">No hay mesas creadas: un supervisor las crea en «Mesas».</p>}
          <div className="mesas-mapa">
            {mesas.map((m) => (
              <button key={m.id} className={"mesa " + (m.cuentaId ? "ocupada" : "libre")} disabled={!!m.cuentaId} onClick={() => void hecho(`${url}/mesa`, { mesa: m.nombre })}>
                <b>{m.nombre}</b><small>{m.cuentaId ? "Ocupada" : `Libre · ${m.zona || m.capacidad + " personas"}`}</small>
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <p className="suave">Marque lo que pasa y elija la cuenta de destino (otra mesa, o la barra). Los extras van con su plato.</p>
          <div className="resultados" style={{ maxHeight: "30vh", overflow: "auto" }}>
            {lineas.map((l) => (
              <label key={l.id} className="factura" style={{ cursor: "pointer" }}>
                <span><input type="checkbox" checked={marcadas.includes(l.id)} onChange={() => setMarcadas((m) => (m.includes(l.id) ? m.filter((x) => x !== l.id) : [...m, l.id]))} /> {Number(l.cantidad)} × {l.descripcion}</span>
                <b>{rd(l.total)}</b>
              </label>
            ))}
          </div>
          <label>Pasar a
            <select value={destino} onChange={(e) => setDestino(e.target.value)}>
              <option value="">Elija una cuenta…</option>
              {cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select></label>
          <button className="boton primario ancho" disabled={!marcadas.length || !destino} onClick={() => void hecho(`${url}/mover-lineas`, { destinoId: destino, lineaIds: marcadas })}>
            Pasar {marcadas.length || ""} producto(s)
          </button>
        </>
      )}
      <button className="enlace" onClick={onCerrar}>Cancelar</button>
    </Modal>
  );
}
