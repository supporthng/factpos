import { sesionActual } from "./api";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { Icono, type NombreIcono } from "./Iconos";

/** Datos comunes a todas las pantallas (sucursales, productos, usuarios). */
export interface Producto { id: string; sku: string; nombre: string; categoriaId: string | null; presentaciones: { id: string; nombre: string; factor: string }[] }
export interface CatalogoAdmin {
  sucursales: { id: string; codigo: string; nombre: string; almacenId: string; tipo?: "TIENDA" | "ALMACEN"; almacenes?: { id: string; nombre: string; principal: boolean }[] }[];
  productos: Producto[];
  categorias: { id: string; nombre: string }[];
  usuarios: { id: string; nombre: string }[];
}
export const CatalogoCtx = createContext<CatalogoAdmin>({ sucursales: [], productos: [], categorias: [], usuarios: [] });
export const useCatalogo = () => useContext(CatalogoCtx);

/** Carga datos y expone estado de carga/error/recarga. */
export function useDatos<T>(ruta: string | null, deps: unknown[] = []) {
  const [datos, setDatos] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);
  const recargar = useCallback(async () => {
    if (!ruta) return;
    setCargando(true);
    setError("");
    try {
      setDatos(await api<T>(ruta));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }, [ruta]);
  useEffect(() => { recargar(); }, [recargar, ...deps]);
  return { datos, error, cargando, recargar, setDatos };
}

export function Encabezado({ titulo, descripcion, children }: { titulo: string; descripcion?: string; children?: React.ReactNode }) {
  return (
    <div className="encabezado">
      <div>
        <h1>{titulo}</h1>
        {descripcion && <p className="suave">{descripcion}</p>}
      </div>
      <div className="encabezado-acciones">{children}</div>
    </div>
  );
}

export function SelectorSucursal({ valor, onCambio, todas = true }: { valor: string; onCambio: (v: string) => void; todas?: boolean }) {
  const { sucursales } = useCatalogo();
  return (
    <select value={valor} onChange={(e) => onCambio(e.target.value)}>
      {todas && <option value="">{sesionActual().sucursales ? "Todas mis sucursales" : "Todas las sucursales"}</option>}
      {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
    </select>
  );
}

/** Almacenes de una sucursal ("Piso de venta", "Depósito"…). Vacío = el principal. */
export function SelectorAlmacen({ sucursalId, valor, onCambio }: { sucursalId: string; valor: string; onCambio: (v: string) => void }) {
  const { sucursales } = useCatalogo();
  const lista = sucursales.find((s) => s.id === sucursalId)?.almacenes ?? [];
  return (
    <select value={valor} onChange={(e) => onCambio(e.target.value)} disabled={lista.length < 2}>
      {lista.length === 0 && <option value="">Almacén principal</option>}
      {lista.map((a) => <option key={a.id} value={a.principal ? "" : a.id}>{a.nombre}{a.principal ? " (principal)" : ""}</option>)}
    </select>
  );
}

export function SelectorProducto({ valor, onCambio, placeholder = "Buscar producto…" }: {
  valor: string; onCambio: (id: string) => void; placeholder?: string;
}) {
  const { productos } = useCatalogo();
  const [q, setQ] = useState("");
  const [abierto, setAbierto] = useState(false);
  const elegido = productos.find((p) => p.id === valor);
  const res = q.trim().length >= 1
    ? productos.filter((p) => `${p.nombre} ${p.sku}`.toLowerCase().includes(q.toLowerCase())).slice(0, 12)
    : productos.slice(0, 12);
  return (
    <div className="selector-producto">
      <input
        value={abierto ? q : elegido ? `${elegido.nombre} (${elegido.sku})` : ""}
        placeholder={placeholder}
        onFocus={() => { setAbierto(true); setQ(""); }}
        onBlur={() => setTimeout(() => setAbierto(false), 150)}
        onChange={(e) => setQ(e.target.value)}
      />
      {abierto && (
        <div className="desplegable">
          {res.map((p) => (
            <button key={p.id} onMouseDown={() => { onCambio(p.id); setAbierto(false); }}>
              {p.nombre} <span className="suave">{p.sku}</span>
            </button>
          ))}
          {!res.length && <span className="suave relleno">Sin resultados</span>}
        </div>
      )}
    </div>
  );
}

export function Aviso({ texto, tipo = "error" }: { texto: string; tipo?: "error" | "ok" | "info" }) {
  if (!texto) return null;
  return <div className={"aviso-linea " + tipo}>{texto}</div>;
}

export function Kpi({ titulo, valor, detalle, tono, icono }: { titulo: string; valor: string; detalle?: string; tono?: "alerta" | "ok"; icono?: NombreIcono }) {
  return (
    <div className={"kpi" + (icono ? " con-icono" : "") + (tono ? " " + tono : "")}>
      <span className="suave kpi-titulo">{titulo}</span>
      {icono && <span className="kpi-icono"><Icono n={icono} /></span>}
      <b>{valor}</b>
      {detalle && <span className="suave pequeno kpi-detalle">{detalle}</span>}
    </div>
  );
}

export function Vacio({ texto }: { texto: string }) {
  return <div className="vacio">{texto}</div>;
}

/** Tabla genérica a partir de filas y columnas. */
export interface Columna<T> { titulo: string; valor: (f: T) => React.ReactNode; der?: boolean; ancho?: string; /** En el celular (modo tarjetas) no se muestra */ ocultoMovil?: boolean }
/** `tarjetas`: en el celular cada fila se vuelve una tarjeta (primera columna arriba, las demás en cuadrícula) y no hay que desplazarse de lado. */
export function Tabla<T>({ filas, columnas, clave, vacio = "Sin datos", tarjetas = false }: { filas: T[]; columnas: Columna<T>[]; clave: (f: T, i: number) => string; vacio?: string; tarjetas?: boolean }) {
  if (!filas.length) return <Vacio texto={vacio} />;
  return (
    <div className="tabla-contenedor">
      <table className={"tabla" + (tarjetas ? " tabla-tarjetas" : "")}>
        <thead>
          <tr>{columnas.map((c) => <th key={c.titulo} className={(c.der ? "der" : "") + (c.ocultoMovil ? " oculto-movil" : "")} style={c.ancho ? { width: c.ancho } : undefined}>{c.titulo}</th>)}</tr>
        </thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={clave(f, i)}>{columnas.map((c) => <td key={c.titulo} data-etiqueta={c.titulo} className={(c.der ? "der" : "") + (c.ocultoMovil ? " oculto-movil" : "")}>{c.valor(f)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Inicia la descarga de un archivo desde un enlace (p. ej. el instalador firmado de GitHub).
 *  - App de escritorio (Electron): window.open → la app lo entrega al navegador del sistema, que descarga sin pedir un clic nuevo
 *    (un clic de enlace tras esperar al servidor se queda sin hacer nada en la ventana de la app).
 *  - Navegador: clic de enlace oculto.
 */
export function iniciarDescarga(url: string, nombre?: string | null) {
  if (/Electron\//.test(navigator.userAgent)) { window.open(url, "_blank", "noopener"); return; }
  const ancla = document.createElement("a");
  ancla.href = url; ancla.rel = "noopener"; ancla.download = nombre ?? ""; ancla.style.display = "none";
  document.body.appendChild(ancla); ancla.click(); ancla.remove();
}
/**
 * Etiqueta de versión para el cliente: la versión interna (25.5, 26.0, 26.1…) se muestra partiendo su parte entera
 * en dos cifras: 25.5 → 2.5.5, 26.0 → 2.6, 26.1 → 2.6.1. Es solo una etiqueta: la versión real no cambia.
 */
export function versionCliente(v: string | null | undefined): string {
  const m = /^(\d+)(?:\.(\d))?(?:\.|$)/.exec(v ?? "");
  if (!m || m[1]!.length < 2) return v ?? "—";
  const entero = Number(m[1]);
  return `${Math.floor(entero / 10)}.${entero % 10}${m[2] && m[2] !== "0" ? "." + m[2] : ""}`;
}
/** Como versionCliente, pero si la etiqueta de la nueva coincide con la actual aclara la compilación para distinguirlas. */
export function versionNueva(nueva: string | null | undefined, actual: string | null | undefined): string {
  const e = versionCliente(nueva);
  return nueva && versionCliente(actual) === e ? `${e} (compilación ${nueva})` : e;
}


/**
 * Lista desplegable propia (en vez del <select> del sistema): se dibuja con la página, así abre igual en cualquier equipo
 * (el desplegable nativo no siempre se muestra en pantallas remotas o con aceleración desactivada).
 */
export function ElegirOpcion({ valor, opciones, onCambiar, disabled = false, ariaLabel }: {
  valor: string; opciones: { id: string; texto: string }[]; onCambiar: (id: string) => void; disabled?: boolean; ariaLabel?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const [activo, setActivo] = useState(0);
  const caja = useRef<HTMLDivElement>(null);
  const actual = opciones.find((o) => o.id === valor);
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: PointerEvent) => { if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false); };
    document.addEventListener("pointerdown", fuera);
    return () => document.removeEventListener("pointerdown", fuera);
  }, [abierto]);
  const abrir = () => { if (disabled) return; setActivo(Math.max(0, opciones.findIndex((o) => o.id === valor))); setAbierto(true); };
  const elegir = (id: string) => { onCambiar(id); setAbierto(false); };
  return (
    <div className="elegir" ref={caja}>
      <button type="button" className="elegir-boton" disabled={disabled} aria-haspopup="listbox" aria-expanded={abierto} aria-label={ariaLabel}
        onClick={() => (abierto ? setAbierto(false) : abrir())}
        onKeyDown={(e) => {
          if (e.key === "Escape") setAbierto(false);
          else if (e.key === "ArrowDown") { e.preventDefault(); if (!abierto) abrir(); else setActivo((a) => Math.min(opciones.length - 1, a + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); if (!abierto) abrir(); else setActivo((a) => Math.max(0, a - 1)); }
          else if (e.key === "Enter" && abierto && opciones[activo]) { e.preventDefault(); elegir(opciones[activo]!.id); }
        }}>
        <span>{actual?.texto ?? "Elegir…"}</span><span className="elegir-flecha" aria-hidden="true">▾</span>
      </button>
      {abierto && (
        <ul className="elegir-lista" role="listbox">
          {opciones.map((o, k) => (
            <li key={o.id} role="option" aria-selected={o.id === valor} className={(o.id === valor ? "elegido " : "") + (k === activo ? "activo" : "")}
              onPointerDown={(e) => { e.preventDefault(); elegir(o.id); }} onMouseEnter={() => setActivo(k)}>{o.texto}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
