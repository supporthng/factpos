import { sesionActual } from "./api";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "./api";

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

export function Kpi({ titulo, valor, detalle, tono }: { titulo: string; valor: string; detalle?: string; tono?: "alerta" | "ok" }) {
  return (
    <div className={"kpi" + (tono ? " " + tono : "")}>
      <span className="suave">{titulo}</span>
      <b>{valor}</b>
      {detalle && <span className="suave pequeno">{detalle}</span>}
    </div>
  );
}

export function Vacio({ texto }: { texto: string }) {
  return <div className="vacio">{texto}</div>;
}

/** Tabla genérica a partir de filas y columnas. */
export interface Columna<T> { titulo: string; valor: (f: T) => React.ReactNode; der?: boolean; ancho?: string }
export function Tabla<T>({ filas, columnas, clave, vacio = "Sin datos" }: { filas: T[]; columnas: Columna<T>[]; clave: (f: T, i: number) => string; vacio?: string }) {
  if (!filas.length) return <Vacio texto={vacio} />;
  return (
    <div className="tabla-contenedor">
      <table className="tabla">
        <thead>
          <tr>{columnas.map((c) => <th key={c.titulo} className={c.der ? "der" : ""} style={c.ancho ? { width: c.ancho } : undefined}>{c.titulo}</th>)}</tr>
        </thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={clave(f, i)}>{columnas.map((c) => <td key={c.titulo} className={c.der ? "der" : ""}>{c.valor(f)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
