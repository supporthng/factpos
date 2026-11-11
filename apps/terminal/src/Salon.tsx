import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as EventoPuntero, ReactElement } from "react";
import type { Catalogo } from "@factpos/compartido";
import { api, rd, type Ajustes } from "./api";
import { Modal } from "./Venta";

/**
 * Salón de restaurante: mapa de mesas, modificadores de los platos y cambio de mesa o de productos entre cuentas.
 * Lo configura un supervisor (el servidor lo exige); el mesero o cajero solo lo usa.
 */
export interface MesaC {
  id: string; nombre: string; zona: string; capacidad: number; posX: number | null; posY: number | null; forma: "CUADRADA" | "REDONDA" | "LARGA";
  cuentaId: string | null; abiertaEn: string | null; mesero: string | null; minutos: number | null; productos: number | null; total: string | null; esperando: number | null;
}
export interface Modificador { id: string; grupo: string; nombre: string; presentacionId: string | null; categoriaId: string | null; producto: string | null }
export const PASOS: [number, string][] = [[1, "Ya"], [2, "Fuertes"], [3, "Postres"]];

export const duracion = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}`);

/** Forma de la mesa en el plano */
export type Forma = "CUADRADA" | "REDONDA" | "LARGA";
const FORMAS: [Forma, string][] = [["CUADRADA", "Cuadrada"], ["REDONDA", "Redonda"], ["LARGA", "Rectangular"]];
/** Mesas listas para agregar: la forma y para cuántos comensales */
const MODELOS: { forma: Forma; nombre: string; capacidades: number[] }[] = [
  { forma: "REDONDA", nombre: "Redonda", capacidades: [2, 4, 6, 8] },
  { forma: "CUADRADA", nombre: "Cuadrada", capacidades: [2, 4, 8] },
  { forma: "LARGA", nombre: "Rectangular", capacidades: [4, 6, 8, 10, 12] },
];

/** Dibujo de una mesa vista desde arriba, con una silla por comensal (redonda, cuadrada o rectangular). Toma el color del texto. */
export function MesaIcono({ forma, capacidad, tam = 76 }: { forma: Forma; capacidad: number; tam?: number }) {
  const n = Math.max(1, Math.min(14, capacidad));
  const sillas: { x: number; y: number; w: number; h: number; r: number }[] = [];
  let mesa: ReactElement;
  if (forma === "REDONDA") {
    mesa = <circle cx="50" cy="50" r="22" />;
    const rad = n >= 10 ? 5 : 6.5;
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n - Math.PI / 2;
      sillas.push({ x: 50 + 37 * Math.cos(a) - rad, y: 50 + 37 * Math.sin(a) - rad, w: rad * 2, h: rad * 2, r: rad });
    }
  } else if (forma === "CUADRADA") {
    mesa = <rect x="30" y="30" width="40" height="40" rx="5" />;
    // las sillas se reparten por los cuatro lados (arriba, abajo, izquierda, derecha)
    const lado = [0, 0, 0, 0];
    for (let i = 0; i < n; i++) lado[i % 4] = (lado[i % 4] ?? 0) + 1;
    const pos = (k: number, j: number) => 30 + (40 * (j + 0.5)) / k;
    for (let j = 0; j < lado[0]!; j++) sillas.push({ x: pos(lado[0]!, j) - 6, y: 17, w: 12, h: 8, r: 2.5 });
    for (let j = 0; j < lado[1]!; j++) sillas.push({ x: pos(lado[1]!, j) - 6, y: 75, w: 12, h: 8, r: 2.5 });
    for (let j = 0; j < lado[2]!; j++) sillas.push({ x: 17, y: pos(lado[2]!, j) - 6, w: 8, h: 12, r: 2.5 });
    for (let j = 0; j < lado[3]!; j++) sillas.push({ x: 75, y: pos(lado[3]!, j) - 6, w: 8, h: 12, r: 2.5 });
  } else {
    mesa = <rect x="14" y="36" width="72" height="28" rx="5" />;
    // en una rectangular las sillas van en los lados largos y, de 6 en adelante, una en cada cabecera
    const cab = n >= 6 ? 2 : 0;
    const resto = n - cab;
    const arriba = Math.ceil(resto / 2), abajo = Math.floor(resto / 2);
    const pos = (k: number, j: number) => 14 + (72 * (j + 0.5)) / k;
    for (let j = 0; j < arriba; j++) sillas.push({ x: pos(arriba, j) - 6, y: 24, w: 12, h: 8, r: 2.5 });
    for (let j = 0; j < abajo; j++) sillas.push({ x: pos(abajo, j) - 6, y: 68, w: 12, h: 8, r: 2.5 });
    if (cab) { sillas.push({ x: 3, y: 44, w: 8, h: 12, r: 2.5 }); sillas.push({ x: 89, y: 44, w: 8, h: 12, r: 2.5 }); }
  }
  return (
    <svg className="mesa-icono" viewBox="0 0 100 100" width={tam} height={tam} aria-hidden="true" focusable="false">
      <g fill="currentColor" fillOpacity=".2" stroke="currentColor" strokeWidth="2.5">{mesa}</g>
      <g fill="currentColor" fillOpacity=".6">{sillas.map((c, i) => <rect key={i} x={c.x} y={c.y} width={c.w} height={c.h} rx={c.r} />)}</g>
    </svg>
  );
}

/** Lugar de cada mesa en el plano de su zona (en %). Las que no tienen lugar se acomodan solas en cuadrícula. */
export function lugares<T extends { posX: number | null; posY: number | null }>(lista: T[]): { m: T; x: number; y: number }[] {
  let k = 0;
  return lista.map((m) => {
    if (m.posX !== null && m.posY !== null) return { m, x: m.posX, y: m.posY };
    const i = k++;
    return { m, x: 12 + (i % 5) * 19, y: 16 + Math.floor(i / 5) * 26 };
  });
}

/** Pestañas de zonas (solo si hay más de una) */
function ZonasTabs({ zonas, actual, onElegir }: { zonas: string[]; actual: string; onElegir: (z: string) => void }) {
  if (zonas.length < 2) return null;
  return <div className="pestanas" style={{ flexWrap: "wrap" }}>{zonas.map((z) => <button key={z} className={z === actual ? "activa" : ""} onClick={() => onElegir(z)}>{z || "Mesas"}</button>)}</div>;
}

/** Plano del salón: las mesas donde el supervisor las dibujó; tocar una libre abre su cuenta y tocar una ocupada la retoma. */
export function MapaMesas({ mesas, onMesa }: { mesas: MesaC[]; onMesa: (m: MesaC) => void }) {
  const zonas = useMemo(() => [...new Set(mesas.map((m) => m.zona))], [mesas]);
  const [zona, setZona] = useState(zonas[0] ?? "");
  const actual = zonas.includes(zona) ? zona : zonas[0] ?? "";
  const delaZona = mesas.filter((m) => m.zona === actual);
  return (
    <>
      <ZonasTabs zonas={zonas} actual={actual} onElegir={setZona} />
      <div className="plano" role="group" aria-label={`Plano de ${actual || "mesas"}`}>
        {lugares(delaZona).map(({ m, x, y }) => {
          const ocupada = !!m.cuentaId;
          const larga = ocupada && (m.minutos ?? 0) >= 90;
          return (
            <button key={m.id} className={`mesa con-icono ` + (ocupada ? (larga ? "ocupada larga" : "ocupada") : "libre")} style={{ left: `${x}%`, top: `${y}%` }}
              onClick={() => onMesa(m)} aria-label={`${m.nombre}, ${ocupada ? "ocupada" : "libre"}`}>
              <MesaIcono forma={m.forma} capacidad={m.capacidad} />
              <b>{m.nombre}</b>
              {ocupada
                ? <><small>{m.mesero ?? ""}{m.mesero ? " · " : ""}{duracion(m.minutos ?? 0)}</small>
                  {!!m.esperando && <span className="mesa-espera">{m.esperando} sin enviar</span>}
                  <span className="mesa-total">{rd(m.total ?? "0")}</span></>
                : <small>Libre · {m.capacidad}</small>}
            </button>
          );
        })}
      </div>
    </>
  );
}

interface MesaEd { key: string; id?: string; nombre: string; zona: string; capacidad: number; forma: Forma; posX: number | null; posY: number | null }

/** Diseñar el salón: se arrastran las mesas a su lugar en el plano de cada zona (solo supervisor). */
export function ConfigMesas({ ajustes, mesas, onGuardado, onCerrar }: { ajustes: Ajustes; mesas: MesaC[]; onGuardado: () => void; onCerrar: () => void }) {
  const [lista, setLista] = useState<MesaEd[]>(() => {
    // Lo creado antes sin lugar queda fijo donde se ve hoy, así se puede arrastrar desde ahí
    const out: MesaEd[] = [];
    for (const z of new Set(mesas.map((m) => m.zona))) {
      for (const { m, x, y } of lugares(mesas.filter((q) => q.zona === z))) out.push({ key: m.id, id: m.id, nombre: m.nombre, zona: m.zona, capacidad: m.capacidad, forma: m.forma, posX: x, posY: y });
    }
    return out;
  });
  const [zona, setZona] = useState(mesas[0]?.zona ?? "Salón");
  const [zonaNueva, setZonaNueva] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const plano = useRef<HTMLDivElement>(null);
  const arrastre = useRef<{ key: string } | null>(null);
  const contador = useRef(0);
  const zonas = useMemo(() => { const z = [...new Set(lista.map((m) => m.zona))]; return z.includes(zona) ? z : [...z, zona]; }, [lista, zona]);
  const cambiar = (key: string, c: Partial<MesaEd>) => setLista((l) => l.map((x) => (x.key === key ? { ...x, ...c } : x)));
  const elegida = lista.find((m) => m.key === sel) ?? null;

  const agregar = (forma: Forma, capacidad: number) => {
    const usados = new Set(lista.map((m) => m.nombre.toLowerCase()));
    let n = lista.filter((m) => m.zona === zona).length + 1;
    while (usados.has(`mesa ${n}`)) n++;
    const key = `n${++contador.current}`;
    // Cada mesa nueva aparece en un lugar distinto para no quedar encima de otra
    const k = lista.filter((m) => m.zona === zona).length;
    setLista((l) => [...l, { key, nombre: `Mesa ${n}`, zona, capacidad, forma, posX: 12 + (k % 5) * 19, posY: 16 + (Math.floor(k / 5) % 3) * 26 }]);
    setSel(key);
  };
  const mover = (ev: EventoPuntero) => {
    const a = arrastre.current; const el = plano.current;
    if (!a || !el) return;
    const r = el.getBoundingClientRect();
    const x = Math.max(4, Math.min(96, ((ev.clientX - r.left) / r.width) * 100));
    const y = Math.max(6, Math.min(94, ((ev.clientY - r.top) / r.height) * 100));
    // se acomoda de a 1 % para que queden alineadas con facilidad
    cambiar(a.key, { posX: Math.round(x), posY: Math.round(y) });
  };
  const guardar = async () => {
    setGuardando(true);
    try {
      await api(ajustes.servidor, `/cajas/${ajustes.cajaId}/mesas`, {
        metodo: "PUT", cuerpo: { mesas: lista.map((m) => ({ id: m.id, nombre: m.nombre, zona: m.zona, capacidad: m.capacidad, forma: m.forma, posX: m.posX, posY: m.posY })) },
      });
      onGuardado();
    } catch (e) { setError((e as Error).message); }
    setGuardando(false);
  };
  const duplicada = new Set(lista.map((m) => m.nombre.trim().toLowerCase())).size !== lista.length;
  return (
    <Modal titulo="Diseño del salón" onCerrar={onCerrar} ancho>
      <p className="suave">Arrastre cada mesa a su lugar, como está en su local. Cada zona (Salón, Terraza, Barra…) tiene su propio plano.</p>
      {error && <p className="error">{error}</p>}
      <ZonasTabs zonas={zonas} actual={zona} onElegir={(z) => { setZona(z); setSel(null); }} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "6px 0" }}>
        <span style={{ flex: 1 }} />
        {["Salón", "Terraza", "Barra"].map((t) => (
          <button key={t} className="boton fantasma chico" title={`Agregar otro plano de ${t.toLowerCase()}`}
            onClick={() => { let n = 1; let nombre = t; while (zonas.includes(nombre)) nombre = `${t} ${++n}`; setZona(nombre); setSel(null); }}>+ {t}</button>
        ))}
        <input style={{ maxWidth: 160 }} placeholder="Otra zona…" value={zonaNueva} maxLength={30} onChange={(e) => setZonaNueva(e.target.value)} />
        <button className="boton fantasma chico" disabled={!zonaNueva.trim()} onClick={() => { setZona(zonaNueva.trim()); setZonaNueva(""); setSel(null); }}>Crear zona</button>
      </div>
      <div className="modelos" role="group" aria-label="Agregar una mesa">
        {MODELOS.flatMap((mo) => mo.capacidades.map((c) => (
          <button key={`${mo.forma}${c}`} className="modelo" onClick={() => agregar(mo.forma, c)} title={`Agregar mesa ${mo.nombre.toLowerCase()} para ${c} personas`}>
            <MesaIcono forma={mo.forma} capacidad={c} tam={54} /><b>{mo.nombre}</b><small>{c} personas</small>
          </button>
        )))}
      </div>
      <div ref={plano} className="plano plano-editor" onPointerMove={mover} onPointerUp={() => { arrastre.current = null; }} onPointerLeave={() => { arrastre.current = null; }}
        onPointerDown={(e) => { if (e.target === e.currentTarget) setSel(null); }}>
        {lista.filter((m) => m.zona === zona).map((m) => (
          <div key={m.key} className={`mesa libre con-icono` + (m.key === sel ? " elegida" : "")} style={{ left: `${m.posX ?? 50}%`, top: `${m.posY ?? 50}%`, touchAction: "none" }}
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); arrastre.current = { key: m.key }; setSel(m.key); }}>
            <MesaIcono forma={m.forma} capacidad={m.capacidad} /><b>{m.nombre}</b><small>{m.capacidad} personas</small>
          </div>
        ))}
        {!lista.some((m) => m.zona === zona) && <p className="suave" style={{ margin: 16 }}>Esta zona está vacía: agregue mesas con los botones de arriba.</p>}
      </div>
      {elegida ? (
        <div className="cobro2-bloque" style={{ marginTop: 8 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr 90px 1fr auto", gap: 8, alignItems: "end" }}>
            <label className="campo"><span>Nombre</span><input value={elegida.nombre} maxLength={30} onChange={(e) => cambiar(elegida.key, { nombre: e.target.value })} /></label>
            <label className="campo"><span>Forma</span>
              <select value={elegida.forma} onChange={(e) => cambiar(elegida.key, { forma: e.target.value as Forma })}>{FORMAS.map(([f, t]) => <option key={f} value={f}>{t}</option>)}</select></label>
            <label className="campo"><span>Personas</span><input inputMode="numeric" value={String(elegida.capacidad)} onChange={(e) => cambiar(elegida.key, { capacidad: Math.max(1, Math.min(60, Number(e.target.value.replace(/\D/g, "")) || 1)) })} /></label>
            <label className="campo"><span>Zona</span>
              <select value={elegida.zona} onChange={(e) => { cambiar(elegida.key, { zona: e.target.value, posX: 50, posY: 50 }); setZona(e.target.value); }}>{zonas.map((z) => <option key={z} value={z}>{z || "Mesas"}</option>)}</select></label>
            <button className="enlace" onClick={() => { setLista((l) => l.filter((m) => m.key !== elegida.key)); setSel(null); }}>Quitar</button>
          </div>
        </div>
      ) : <p className="suave" style={{ margin: "6px 0" }}>Toque una mesa para cambiarle el nombre, la forma o las personas.</p>}
      {duplicada && <p className="error">Hay dos mesas con el mismo nombre.</p>}
      <button className="boton primario ancho" style={{ marginTop: 10 }} disabled={guardando || duplicada || lista.some((m) => !m.nombre.trim())} onClick={guardar}>Guardar diseño</button>
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
