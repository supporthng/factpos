import { useEffect, useMemo, useState } from "react";
import { api, rd, num } from "../api";
import { Aviso, Encabezado, SelectorProducto, Tabla, useCatalogo, useDatos } from "../ui";

/* ---------- Tipos ---------- */
type Tipo = "INVENTARIABLE" | "SERVICIO" | "COMBO";
interface Presentacion {
  id?: string; nombre: string; factor: string; codigos: string[];
  precios: Partial<Record<"1" | "2" | "3", string | null>>;
  /** % de ganancia sobre el costo; si existe, ese nivel se define por % y el precio se calcula */
  porcentajes?: Partial<Record<"1" | "2" | "3", string | number | null>>;
}
interface Ficha {
  id?: string;
  sku: string; nombre: string; nombreCorto: string | null; marca: string | null; categoriaId: string | null; tipo: Tipo;
  impuestoId: string; precioIncluyeItbis: boolean; esPesable: boolean; costoReferencia: string;
  permiteSinExistencia: boolean; precioVariable: boolean; precioVariableMin: string | null; precioVariableMax: string | null;
  controlaLotes: boolean; volumenMl: number | null; gradoAlcohol: number | null; imagen: string | null; activo: boolean;
  presentaciones: Presentacion[];
  sucursales: { sucursalId: string; sucursal?: string; existencia?: string; stockMinimo: string; stockMaximo: string | null; ubicacion: string | null; activo: boolean }[];
  proveedores: { proveedorId: string; nombre?: string; codigoProveedor: string | null; ultimoCosto: string | null; principal: boolean }[];
  componentes: { productoId: string; nombre?: string; sku?: string; cantidad: string }[];
  historialPrecios?: { fecha: string; presentacion: string; nivel: number; anterior: string | null; nuevo: string | null; usuario: string | null }[];
}
interface Auxiliares {
  impuestos: { id: string; nombre: string; tasa: number }[];
  categorias: { id: string; nombre: string; color: string; icono: string | null }[];
  proveedores: { id: string; nombre: string; rnc: string | null }[];
  listas: { nivel: number; nombre: string }[];
  preciosPorSucursal: boolean;
}
interface FilaLista { id: string; sku: string; nombre: string; marca: string | null; tipo: Tipo; activo: boolean; categoria: string | null; categoriaColor: string | null; precio: string | null; existencia: string; costo: string; presentaciones: string }

const NIVELES = ["1", "2", "3"] as const;
const NOMBRE_NIVEL: Record<string, string> = { "1": "Detalle", "2": "Mayorista", "3": "Distribuidor" };
const TIPOS: { v: Tipo; t: string; d: string }[] = [
  { v: "INVENTARIABLE", t: "Inventariable", d: "Lleva existencia y kardex" },
  { v: "SERVICIO", t: "Servicio", d: "Sin inventario (envío, recarga…)" },
  { v: "COMBO", t: "Combo", d: "Descuenta sus componentes" },
];

/* ---------- Cálculos de precio ---------- */
const n = (v: string | number | null | undefined) => Number(v ?? 0) || 0;
/** Precio de venta sin ITBIS. */
const base = (precio: number, tasa: number, incluye: boolean) => (incluye ? precio / (1 + tasa) : precio);
/** Margen sobre la venta (sin ITBIS). */
const margen = (precio: number, costo: number, tasa: number, incluye: boolean) => {
  const b = base(precio, tasa, incluye);
  return b > 0 && costo > 0 ? ((b - costo) / b) * 100 : null;
};
/** Precio desde el % de ganancia sobre el costo: costo + %, más ITBIS si el precio lo incluye. */
const desdePorcentaje = (costo: number, pct: number, tasa: number, incluye: boolean, redondeo: number) => {
  const b = costo * (1 + pct / 100);
  const p = incluye ? b * (1 + tasa) : b;
  return redondeo ? Math.ceil(p / redondeo - 1e-9) * redondeo : Math.round(p * 100) / 100;
};
/** % de ganancia sobre el costo que da un precio. */
const sobreCosto = (precio: number, costo: number, tasa: number, incluye: boolean) => {
  const b = base(precio, tasa, incluye);
  return b > 0 && costo > 0 ? ((b - costo) / costo) * 100 : null;
};
const esPct = (p: Presentacion, k: string) => p.porcentajes?.[k as "1"] != null;

function fichaNueva(aux: Auxiliares, sucursales: { id: string; nombre: string }[]): Ficha {
  return {
    sku: "", nombre: "", nombreCorto: null, marca: null, categoriaId: null, tipo: "INVENTARIABLE",
    impuestoId: aux.impuestos.find((i) => i.tasa === 0.18)?.id ?? aux.impuestos[0]?.id ?? "", precioIncluyeItbis: true, esPesable: false,
    costoReferencia: "0", permiteSinExistencia: true, precioVariable: false, precioVariableMin: null, precioVariableMax: null,
    controlaLotes: false, volumenMl: null, gradoAlcohol: null, imagen: null, activo: true,
    presentaciones: [{ nombre: "Unidad", factor: "1", codigos: [], precios: {} }],
    sucursales: sucursales.map((s) => ({ sucursalId: s.id, sucursal: s.nombre, existencia: "0", stockMinimo: "0", stockMaximo: null, ubicacion: null, activo: true })),
    proveedores: [], componentes: [],
  };
}

/* =================================================================== */
export function Productos() {
  const [editando, setEditando] = useState<string | "nuevo" | null>(null);
  const aux = useDatos<Auxiliares>("/central/productos-auxiliares");
  if (!aux.datos) return <div className="cargando">Cargando…</div>;
  return editando
    ? <Editor id={editando === "nuevo" ? null : editando} aux={aux.datos} recargarAux={aux.recargar}
        onCerrar={() => setEditando(null)} onAbrir={(id) => setEditando(id)} />
    : <Listado onAbrir={setEditando} aux={aux.datos} />;
}

/* ---------- Listado ---------- */
function Listado({ onAbrir, aux }: { onAbrir: (id: string | "nuevo") => void; aux: Auxiliares }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [estado, setEstado] = useState("activos");
  const [buscar, setBuscar] = useState("");
  useEffect(() => { const t = setTimeout(() => setBuscar(q), 250); return () => clearTimeout(t); }, [q]);
  const ruta = `/central/productos?estado=${estado}${buscar ? `&q=${encodeURIComponent(buscar)}` : ""}${cat ? `&categoriaId=${cat}` : ""}`;
  const { datos, error } = useDatos<FilaLista[]>(ruta);

  return (
    <>
      <Encabezado titulo="Productos" descripcion="Ficha, códigos, los 3 niveles de precio, proveedores y combos. La existencia de cada sucursal se ve aquí y se corrige con un ajuste.">
        <button className="boton primario" onClick={() => onAbrir("nuevo")}>Nuevo producto</button>
      </Encabezado>
      <div className="filtros">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre, SKU, marca o código de barras" style={{ width: 320 }} />
        <select value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">Todas las categorías</option>
          {aux.categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        <select value={estado} onChange={(e) => setEstado(e.target.value)}>
          <option value="activos">Activos</option><option value="inactivos">Inactivos</option><option value="todos">Todos</option>
        </select>
        <span className="suave pequeno">{datos ? `${datos.length} producto(s)` : ""}</span>
      </div>
      <Aviso texto={error} />
      {datos && (
        <Tabla
          filas={datos}
          clave={(f) => f.id}
          vacio={buscar ? `Ningún producto coincide con “${buscar}”.` : "Todavía no hay productos. Cree el primero con “Nuevo producto”."}
          columnas={[
            { titulo: "Producto", valor: (f) => (
              <button className="fila-producto" onClick={() => onAbrir(f.id)}>
                <i style={{ background: f.categoriaColor ?? "var(--borde-fuerte)" }} />
                <span><b>{f.nombre}</b><small className="suave">{[f.sku, f.marca, f.categoria].filter(Boolean).join("  ·  ")}</small></span>
              </button>
            ) },
            { titulo: "Tipo", valor: (f) => <span className={"pastilla t-" + f.tipo.toLowerCase()}>{TIPOS.find((t) => t.v === f.tipo)?.t}</span> },
            { titulo: "Precio detalle", der: true, valor: (f) => (f.precio ? rd(f.precio) : <span className="texto-alerta">Sin precio</span>) },
            { titulo: "Costo", der: true, valor: (f) => rd(f.costo) },
            { titulo: "Existencia total", der: true, valor: (f) => (f.tipo === "INVENTARIABLE" ? num(f.existencia, Number(f.existencia) % 1 ? 2 : 0) : <span className="suave">—</span>) },
            { titulo: "Estado", valor: (f) => (f.activo ? <span className="texto-ok">Activo</span> : <span className="suave">Inactivo</span>) },
          ]}
        />
      )}
    </>
  );
}

/* ---------- Editor ---------- */
type Pestana = "general" | "precios" | "inventario" | "proveedores" | "combo";

function Editor({ id, aux, recargarAux, onCerrar, onAbrir }: { id: string | null; aux: Auxiliares; recargarAux: () => void; onCerrar: () => void; onAbrir: (id: string) => void }) {
  const { sucursales, productos } = useCatalogo();
  const [f, setF] = useState<Ficha | null>(id ? null : fichaNueva(aux, sucursales));
  const [pestana, setPestana] = useState<Pestana>("general");
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" | "info" } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [sucio, setSucio] = useState(false);

  useEffect(() => {
    if (!id) return;
    api<Ficha>(`/central/productos/${id}`).then((d) => { setF({ ...d, costoReferencia: String(Number(d.costoReferencia).toFixed(2)) }); setSucio(false); }).catch((e) => setMsg({ t: e.message, tipo: "error" }));
  }, [id]);
  if (!f) return <div className="cargando">Cargando…</div>;

  const cambiar = (p: Partial<Ficha>) => { setF({ ...f, ...p }); setSucio(true); };
  const tasa = aux.impuestos.find((i) => i.id === f.impuestoId)?.tasa ?? 0;
  const costoUnidad = n(f.costoReferencia);

  const guardar = async () => {
    setGuardando(true);
    setMsg(null);
    try {
      const cuerpo = {
        ...f,
        nombreCorto: f.nombreCorto || null, marca: f.marca || null,
        precioVariableMin: f.precioVariable ? f.precioVariableMin : null,
        precioVariableMax: f.precioVariable ? f.precioVariableMax : null,
        presentaciones: f.presentaciones.map((p) => ({
          ...p,
          precios: Object.fromEntries(NIVELES.map((k) => [k, p.precios[k] ? String(n(p.precios[k]).toFixed(2)) : null])),
          porcentajes: Object.fromEntries(NIVELES.map((k) => [k, esPct(p, k) && p.precios[k] && p.porcentajes![k] !== "" ? n(p.porcentajes![k]) : null])),
        })),
        sucursales: f.sucursales.map(({ sucursalId, stockMinimo, stockMaximo, ubicacion, activo }) => ({ sucursalId, stockMinimo: stockMinimo || "0", stockMaximo: stockMaximo || null, ubicacion: ubicacion || null, activo })),
        proveedores: f.proveedores.map(({ proveedorId, codigoProveedor, ultimoCosto, principal }) => ({ proveedorId, codigoProveedor: codigoProveedor || null, ultimoCosto: ultimoCosto || null, principal })),
        componentes: f.componentes.map(({ productoId, cantidad }) => ({ productoId, cantidad })),
        costoReferencia: String(n(f.costoReferencia)),
      };
      delete (cuerpo as any).historialPrecios;
      const r = await api<{ id: string }>(id ? `/central/productos/${id}` : "/central/productos", { metodo: id ? "PUT" : "POST", cuerpo });
      setSucio(false);
      if (!id) onAbrir(r.id);
      else { const d = await api<Ficha>(`/central/productos/${id}`); setF({ ...d, costoReferencia: String(Number(d.costoReferencia).toFixed(2)) }); }
      setMsg({ t: "Producto guardado. Las terminales lo reciben en la próxima sincronización.", tipo: "ok" });
    } catch (e) {
      setMsg({ t: (e as Error).message, tipo: "error" });
    } finally {
      setGuardando(false);
    }
  };

  const duplicar = async () => {
    if (!id) return;
    try {
      const r = await api<{ id: string }>(`/central/productos/${id}/duplicar`, { metodo: "POST", cuerpo: {} });
      onAbrir(r.id);
      setMsg({ t: "Copia creada. Cambie el nombre, el SKU y los códigos de barra.", tipo: "info" });
    } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
  };

  const pestanas: { id: Pestana; t: string }[] = [
    { id: "general", t: "General" }, { id: "precios", t: "Precios" },
    ...(f.tipo === "INVENTARIABLE" ? [{ id: "inventario" as const, t: "Inventario" }] : []),
    { id: "proveedores", t: "Proveedores" },
    ...(f.tipo === "COMBO" ? [{ id: "combo" as const, t: "Componentes" }] : []),
  ];

  return (
    <>
      <div className="migas"><button className="enlace" onClick={() => (!sucio || confirm("Hay cambios sin guardar. ¿Salir?")) && onCerrar()}>Productos</button><span>/</span><span>{id ? f.nombre || "Producto" : "Nuevo producto"}</span></div>
      <Encabezado titulo={id ? f.nombre : "Nuevo producto"} descripcion={id ? `SKU ${f.sku}` : "Escanee el código para buscarlo, o complete la ficha."}>
        {id && <button className="boton" onClick={duplicar} title="Para variantes: otro sabor, otro tamaño">Duplicar</button>}
        <button className="boton primario" disabled={guardando || !sucio} onClick={guardar}>{guardando ? "Guardando…" : id ? "Guardar cambios" : "Crear producto"}</button>
      </Encabezado>
      {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}

      <div className="editor-producto">
        <div>
          <div className="pestanas">
            {pestanas.map((p) => <button key={p.id} className={pestana === p.id ? "activa" : ""} onClick={() => setPestana(p.id)}>{p.t}</button>)}
          </div>
          {pestana === "general" && <General f={f} cambiar={cambiar} aux={aux} recargarAux={recargarAux} nuevo={!id} setMsg={setMsg} />}
          {pestana === "precios" && <PreciosFicha f={f} cambiar={cambiar} tasa={tasa} costo={costoUnidad} aux={aux} />}
          {pestana === "inventario" && <InventarioFicha f={f} cambiar={cambiar} />}
          {pestana === "proveedores" && <ProveedoresFicha f={f} cambiar={cambiar} aux={aux} recargarAux={recargarAux} />}
          {pestana === "combo" && <ComboFicha f={f} cambiar={cambiar} productos={productos} id={id} />}
        </div>
        <Vista f={f} aux={aux} tasa={tasa} cambiar={cambiar} />
      </div>
    </>
  );
}

/* ---------- General ---------- */
function General({ f, cambiar, aux, recargarAux, nuevo, setMsg }: {
  f: Ficha; cambiar: (p: Partial<Ficha>) => void; aux: Auxiliares; recargarAux: () => void; nuevo: boolean;
  setMsg: (m: { t: string; tipo: "ok" | "error" | "info" } | null) => void;
}) {
  const [codigo, setCodigo] = useState("");
  const [nuevaCat, setNuevaCat] = useState<string | null>(null);
  const esLicor = /licor|ron|whisky|vino|cerveza|vodka|alcohol/i.test(aux.categorias.find((c) => c.id === f.categoriaId)?.nombre ?? "");

  const buscarCodigo = async () => {
    const c = codigo.trim();
    if (!/^\d{6,14}$/.test(c)) return setMsg({ t: "El código debe tener de 6 a 14 dígitos.", tipo: "error" });
    try {
      const r = await api<{ existe: boolean; producto?: { nombre: string }; sugerencia?: { nombre: string | null; marca: string | null; imagen: string | null; fuente: string } | null; sinConexion?: boolean }>(`/central/productos/codigo/${c}`);
      const pres = [...f.presentaciones];
      if (r.existe) return setMsg({ t: `Ese código ya pertenece a “${r.producto!.nombre}”.`, tipo: "error" });
      pres[0] = { ...pres[0], codigos: [...new Set([...pres[0].codigos, c])] };
      const s = r.sugerencia;
      cambiar({
        presentaciones: pres,
        sku: f.sku || c,
        ...(s ? { nombre: f.nombre || s.nombre || "", marca: f.marca || s.marca, imagen: f.imagen || s.imagen } : {}),
      });
      setCodigo("");
      setMsg(s ? { t: `Datos sugeridos por ${s.fuente}. Revíselos antes de guardar.`, tipo: "info" }
        : { t: r.sinConexion ? "Sin internet para buscar el código. Se agregó a la ficha; complete los datos." : "Código nuevo agregado. No hay datos públicos para él; complete la ficha.", tipo: "info" });
    } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
  };

  const crearCategoria = async () => {
    if (!nuevaCat?.trim()) return;
    try {
      const r = await api<{ id: string }>("/central/categorias", { cuerpo: { nombre: nuevaCat.trim() } });
      recargarAux();
      cambiar({ categoriaId: r.id });
      setNuevaCat(null);
    } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
  };

  return (
    <>
      {nuevo && (
        <div className="panel alta-rapida">
          <label className="campo flex"><span>Alta rápida por código de barras</span>
            <input value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))} placeholder="Escanee o escriba el código" inputMode="numeric"
              onKeyDown={(e) => e.key === "Enter" && buscarCodigo()} autoFocus />
          </label>
          <button className="boton" onClick={buscarCodigo} disabled={!codigo}>Buscar</button>
        </div>
      )}
      <div className="panel">
        <div className="tipos-producto">
          {TIPOS.map((t) => (
            <button key={t.v} className={f.tipo === t.v ? "activo" : ""} onClick={() => cambiar({ tipo: t.v })}>
              <b>{t.t}</b><small>{t.d}</small>
            </button>
          ))}
        </div>
        <div className="dos-col">
          <label className="campo"><span>Nombre</span><input value={f.nombre} onChange={(e) => cambiar({ nombre: e.target.value })} placeholder="Ron Brugal Extra Viejo 700 ml" /></label>
          <label className="campo"><span>Nombre en el ticket <em className="suave">({(f.nombreCorto || f.nombre).length}/32)</em></span>
            <input value={f.nombreCorto ?? ""} maxLength={32} onChange={(e) => cambiar({ nombreCorto: e.target.value })} placeholder={f.nombre.slice(0, 32) || "Corto, para el papel de 80 mm"} /></label>
        </div>
        <div className="tres-col">
          <label className="campo"><span>SKU / código interno</span><input value={f.sku} onChange={(e) => cambiar({ sku: e.target.value.toUpperCase() })} /></label>
          <label className="campo"><span>Marca</span><input value={f.marca ?? ""} onChange={(e) => cambiar({ marca: e.target.value })} /></label>
          <label className="campo"><span>Categoría</span>
            {nuevaCat === null ? (
              <select value={f.categoriaId ?? ""} onChange={(e) => (e.target.value === "+" ? setNuevaCat("") : cambiar({ categoriaId: e.target.value || null }))}>
                <option value="">Sin categoría</option>
                {aux.categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                <option value="+">+ Nueva categoría…</option>
              </select>
            ) : (
              <span className="en-linea"><input autoFocus value={nuevaCat} onChange={(e) => setNuevaCat(e.target.value)} onKeyDown={(e) => e.key === "Enter" && crearCategoria()} placeholder="Nombre" />
                <button className="boton" onClick={crearCategoria}>Crear</button><button className="boton fantasma" onClick={() => setNuevaCat(null)}>✕</button></span>
            )}
          </label>
        </div>
        <div className="tres-col">
          <label className="campo"><span>ITBIS</span>
            <select value={f.impuestoId} onChange={(e) => cambiar({ impuestoId: e.target.value })}>
              {aux.impuestos.map((i) => <option key={i.id} value={i.id}>{i.nombre}</option>)}
            </select>
          </label>
          <label className="campo"><span>Costo de referencia (unidad, sin ITBIS)</span>
            <input className="numero" inputMode="decimal" value={f.costoReferencia} disabled={f.tipo === "COMBO"} onChange={(e) => cambiar({ costoReferencia: e.target.value.replace(/[^\d.]/g, "") })} />
            <small className="suave">{f.tipo === "COMBO" ? "Suma del costo de sus componentes." : "Con existencia, el costo real lo calcula el kardex (promedio ponderado)."}</small>
          </label>
          <label className="campo"><span>Estado</span>
            <select value={f.activo ? "1" : "0"} onChange={(e) => cambiar({ activo: e.target.value === "1" })}><option value="1">Activo</option><option value="0">Inactivo (no se vende)</option></select>
          </label>
        </div>
      </div>

      <div className="panel">
        <div className="encabezado-sub"><h3>En la caja</h3></div>
        <div className="reglas">
          <Regla v={f.esPesable} on={(v) => cambiar({ esPesable: v })} t="Se vende por peso" d="Balanza o etiqueta de peso; precio por libra." />
          <Regla v={f.precioVariable} on={(v) => cambiar({ precioVariable: v })} t="Precio variable" d="La cajera escribe el precio dentro de un rango (varios, recargas)." />
          {f.precioVariable && (
            <div className="dos-col sub-regla">
              <label className="campo"><span>Mínimo</span><input className="numero" inputMode="decimal" value={f.precioVariableMin ?? ""} onChange={(e) => cambiar({ precioVariableMin: e.target.value.replace(/[^\d.]/g, "") })} /></label>
              <label className="campo"><span>Máximo</span><input className="numero" inputMode="decimal" value={f.precioVariableMax ?? ""} onChange={(e) => cambiar({ precioVariableMax: e.target.value.replace(/[^\d.]/g, "") })} /></label>
            </div>
          )}
          {f.tipo !== "SERVICIO" && (
            <Regla v={!f.permiteSinExistencia} on={(v) => cambiar({ permiteSinExistencia: !v })} t="Bloquear venta sin existencia" d="Si el sistema dice 0, la caja no lo deja vender. Apagado: vende y avisa." />
          )}
          {f.tipo === "INVENTARIABLE" && (
            <Regla v={f.controlaLotes} on={(v) => cambiar({ controlaLotes: v })} t="Controla lotes y vencimiento" d="Lácteos, embutidos, medicinas." />
          )}
        </div>
        {(esLicor || f.volumenMl || f.gradoAlcohol) && (
          <div className="dos-col">
            <label className="campo"><span>Contenido (ml)</span><input className="numero" inputMode="numeric" value={f.volumenMl ?? ""} onChange={(e) => cambiar({ volumenMl: e.target.value ? Number(e.target.value.replace(/\D/g, "")) : null })} /></label>
            <label className="campo"><span>Grado alcohólico (%)</span><input className="numero" inputMode="decimal" value={f.gradoAlcohol ?? ""} onChange={(e) => cambiar({ gradoAlcohol: e.target.value ? Number(e.target.value.replace(/[^\d.]/g, "")) : null })} /></label>
          </div>
        )}
      </div>

      <div className="panel">
        <div className="encabezado-sub">
          <h3>Presentaciones y códigos de barra</h3>
          <button className="boton" onClick={() => cambiar({ presentaciones: [...f.presentaciones, { nombre: "Caja", factor: "12", codigos: [], precios: {} }] })}>Agregar presentación</button>
        </div>
        {f.presentaciones.map((p, i) => (
          <div key={p.id ?? i} className="presentacion">
            <label className="campo"><span>{i === 0 ? "Principal" : "Presentación"}</span><input value={p.nombre} onChange={(e) => cambiar({ presentaciones: f.presentaciones.map((x, j) => (j === i ? { ...x, nombre: e.target.value } : x)) })} /></label>
            <label className="campo"><span>Unidades</span><input className="numero" inputMode="decimal" value={p.factor} disabled={i === 0 && !f.esPesable}
              onChange={(e) => cambiar({ presentaciones: f.presentaciones.map((x, j) => (j === i ? { ...x, factor: e.target.value.replace(/[^\d.]/g, "") } : x)) })} /></label>
            <div className="campo codigos"><span>Códigos de barra</span>
              <Codigos valores={p.codigos} onCambio={(codigos) => cambiar({ presentaciones: f.presentaciones.map((x, j) => (j === i ? { ...x, codigos } : x)) })} />
            </div>
            {i > 0 && <button className="boton fantasma quitar" title="Quitar presentación" onClick={() => cambiar({ presentaciones: f.presentaciones.filter((_, j) => j !== i) })}>✕</button>}
          </div>
        ))}
      </div>
    </>
  );
}

function Regla({ v, on, t, d, aviso }: { v: boolean; on: (v: boolean) => void; t: string; d: string; aviso?: string }) {
  return (
    <label className={"regla" + (v ? " activa" : "")}>
      <input type="checkbox" checked={v} onChange={(e) => on(e.target.checked)} />
      <span><b>{t}</b><small>{d}</small>{aviso && <em>{aviso}</em>}</span>
    </label>
  );
}

function Codigos({ valores, onCambio }: { valores: string[]; onCambio: (v: string[]) => void }) {
  const [t, setT] = useState("");
  const agregar = () => { const c = t.trim(); if (c && !valores.includes(c)) onCambio([...valores, c]); setT(""); };
  return (
    <div className="codigos-caja">
      {valores.map((c) => <span key={c} className="chip-codigo mono">{c}<button onClick={() => onCambio(valores.filter((x) => x !== c))} aria-label={`Quitar ${c}`}>×</button></span>)}
      <input value={t} onChange={(e) => setT(e.target.value)} placeholder={valores.length ? "Otro código" : "Escanee aquí"}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Tab" || e.key === ",") { if (t.trim()) { e.preventDefault(); agregar(); } } }} onBlur={agregar} />
    </div>
  );
}

/* ---------- Precios ---------- */
/**
 * Cada nivel se define por monto (RD$) o por % de ganancia sobre el costo.
 * Con %, el precio se calcula y se guarda ya hecho: la caja siempre lee un monto.
 */
function PreciosFicha({ f, cambiar, tasa, costo, aux }: { f: Ficha; cambiar: (p: Partial<Ficha>) => void; tasa: number; costo: number; aux: Auxiliares }) {
  const [porNivel, setPorNivel] = useState<Record<string, string>>({ "1": "40", "2": "30", "3": "25" });
  const [redondeo, setRedondeo] = useState(5);
  const calc = (costoP: number, pct: number) => desdePorcentaje(costoP, pct, tasa, f.precioIncluyeItbis, redondeo).toFixed(2);

  const cambiarNivel = (i: number, k: string, cambio: { precio?: string | null; pct?: string | number | null }) =>
    cambiar({
      presentaciones: f.presentaciones.map((x, j) => (j !== i ? x : {
        ...x,
        precios: "precio" in cambio ? { ...x.precios, [k]: cambio.precio } : x.precios,
        porcentajes: "pct" in cambio ? { ...x.porcentajes, [k]: cambio.pct } : x.porcentajes,
      })),
    });

  const alternar = (i: number, k: string, aPct: boolean) => {
    const p = f.presentaciones[i];
    if (!aPct) return cambiarNivel(i, k, { pct: null });
    // Al pasar a %, se parte del % que ya da el precio actual
    const actual = sobreCosto(n(p.precios[k as "1"]), costo * n(p.factor), tasa, f.precioIncluyeItbis);
    cambiarNivel(i, k, { pct: actual === null ? "" : String(Math.round(actual * 10) / 10) });
  };

  const aplicarATodas = () => {
    if (!costo) return;
    cambiar({
      presentaciones: f.presentaciones.map((p) => ({
        ...p,
        precios: Object.fromEntries(NIVELES.map((k) => [k, porNivel[k] ? calc(costo * n(p.factor), n(porNivel[k])) : p.precios[k] ?? null])),
        porcentajes: Object.fromEntries(NIVELES.map((k) => [k, porNivel[k] ? porNivel[k] : p.porcentajes?.[k] ?? null])),
      })),
    });
  };

  const recalcularTodo = () =>
    cambiar({
      presentaciones: f.presentaciones.map((p) => ({
        ...p,
        precios: Object.fromEntries(NIVELES.map((k) => [k, esPct(p, k) && p.porcentajes![k] !== "" ? calc(costo * n(p.factor), n(p.porcentajes![k])) : p.precios[k] ?? null])),
      })),
    });
  // Precios por % que ya no coinciden con el costo actual (subió o bajó el costo)
  const desfasados = costo > 0 && f.presentaciones.some((p) => NIVELES.some((k) =>
    esPct(p, k) && p.porcentajes![k] !== "" && p.precios[k] && (() => {
      // Exacto en centavos; el guardado puede estar redondeado hacia arriba hasta RD$10
      const exacto = desdePorcentaje(costo * n(p.factor), n(p.porcentajes![k]), tasa, f.precioIncluyeItbis, 0);
      const guardado = n(p.precios[k]);
      return guardado < exacto - 0.01 || guardado > exacto + 10;
    })()));

  return (
    <>
      <div className="panel">
        <div className="encabezado-sub">
          <h3>Precio de venta</h3>
          <div className="fila-ajustes-precio">
            <label className="en-linea-campo"><span className="suave">Redondear a</span>
              <select value={redondeo} onChange={(e) => setRedondeo(Number(e.target.value))}>
                <option value={0}>Centavos</option><option value={1}>RD$1</option><option value={5}>RD$5</option><option value={10}>RD$10</option>
              </select>
            </label>
            <label className="interruptor pequeno"><input type="checkbox" checked={f.precioIncluyeItbis} onChange={(e) => cambiar({ precioIncluyeItbis: e.target.checked })} />Incluye ITBIS ({Math.round(tasa * 100)} %)</label>
          </div>
        </div>
        <p className="suave pequeno">Defina cada precio por <b>monto</b> o por <b>% de ganancia sobre el costo</b>. Con %, el precio se calcula solo y se puede recalcular cuando cambie el costo.</p>
        {f.precioVariable && <Aviso tipo="info" texto={`Precio variable: la cajera lo escribe entre ${rd(f.precioVariableMin)} y ${rd(f.precioVariableMax)}. El precio de aquí se propone por defecto.`} />}
        {desfasados && (
          <div className="aviso-linea info fila-aviso">
            <span>El costo cambió: hay precios por % que ya no dan la ganancia indicada.</span>
            <button className="boton" onClick={recalcularTodo}>Recalcular con el costo actual</button>
          </div>
        )}
        {f.presentaciones.map((p, i) => {
          const costoP = costo * n(p.factor);
          return (
            <div key={p.id ?? i} className="bloque-precios">
              <div className="bloque-titulo"><b>{p.nombre}</b>{n(p.factor) !== 1 && <span className="suave"> · {num(p.factor)} unidades</span>}<span className="suave flex der">Costo {rd(costoP)}</span></div>
              <table className="tabla tabla-edicion tabla-precios">
                <thead><tr><th>Nivel</th><th>Definir por</th><th className="der">Valor</th><th className="der">Precio de venta</th><th className="der">Ganancia</th><th className="der">Margen s/venta</th></tr></thead>
                <tbody>
                  {NIVELES.map((k) => {
                    const pct = esPct(p, k);
                    const v = p.precios[k] ?? "";
                    const pr = n(v);
                    const b = base(pr, tasa, f.precioIncluyeItbis);
                    const m = margen(pr, costoP, tasa, f.precioIncluyeItbis);
                    const sc = sobreCosto(pr, costoP, tasa, f.precioIncluyeItbis);
                    const bajo = pr > 0 && costoP > 0 && b < costoP;
                    const nombreNivel = (aux.listas.find((l) => String(l.nivel) === k)?.nombre ?? NOMBRE_NIVEL[k]).replace(/^Precio \d\s*·?\s*/, "");
                    return (
                      <tr key={k} className={bajo ? "fila-alerta" : ""}>
                        <td><b>Precio {k}</b> <span className="suave">{nombreNivel}</span></td>
                        <td>
                          <div className="segmentado" role="group" aria-label={`Precio ${k}: definir por`}>
                            <button className={!pct ? "activo" : ""} aria-pressed={!pct} onClick={() => pct && alternar(i, k, false)}>RD$</button>
                            <button className={pct ? "activo" : ""} aria-pressed={pct} onClick={() => !pct && alternar(i, k, true)} disabled={!costoP} title={costoP ? "" : "Indique el costo en General"}>%</button>
                          </div>
                        </td>
                        <td className="der" style={{ width: 140 }}>
                          {pct ? (
                            <span className="con-sufijo">
                              <input className="numero" inputMode="decimal" value={String(p.porcentajes![k] ?? "")} aria-label={`% de ganancia del precio ${k}`}
                                onChange={(e) => {
                                  const t = e.target.value.replace(/[^\d.]/g, "");
                                  cambiarNivel(i, k, { pct: t, precio: t ? calc(costoP, n(t)) : null });
                                }} />
                              <i>%</i>
                            </span>
                          ) : (
                            <input className={"numero" + (bajo ? " alerta" : "")} inputMode="decimal" value={v ?? ""} aria-label={`Precio ${k}`}
                              placeholder={k === "1" ? "Requerido" : "Usa el precio 1"}
                              onChange={(e) => cambiarNivel(i, k, { precio: e.target.value.replace(/[^\d.]/g, "") || null })} />
                          )}
                        </td>
                        <td className="der">
                          {pr ? <><b className={bajo ? "texto-alerta" : ""}>{rd(pr)}</b><small className="suave bloque">sin ITBIS {rd(b)}</small></> : <span className="suave">—</span>}
                        </td>
                        <td className="der">{pr && costoP ? <>{rd(b - costoP)}<small className="suave bloque">{sc === null ? "" : `${sc.toFixed(1)} % s/costo`}</small></> : "—"}</td>
                        <td className={"der " + (m === null ? "" : m < 0 ? "texto-alerta" : m < 10 ? "texto-aviso" : "texto-ok")}>{m === null ? "—" : `${m.toFixed(1)} %`}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {NIVELES.some((k) => { const pr = n(p.precios[k]); return pr && costoP && base(pr, tasa, f.precioIncluyeItbis) < costoP; }) &&
                <p className="texto-alerta pequeno">Hay precios por debajo del costo.</p>}
            </div>
          );
        })}
      </div>

      <div className="panel">
        <div className="encabezado-sub"><h3>Mismo % para todas las presentaciones</h3><span className="suave pequeno">Ganancia sobre el costo de referencia ({rd(costo)} por unidad)</span></div>
        <div className="calculo-margen">
          {NIVELES.map((k) => (
            <label key={k} className="campo"><span>Precio {k}</span>
              <span className="con-sufijo"><input className="numero" inputMode="decimal" value={porNivel[k]} onChange={(e) => setPorNivel({ ...porNivel, [k]: e.target.value.replace(/[^\d.]/g, "") })} /><i>%</i></span>
            </label>
          ))}
          <span />
          <button className="boton" disabled={!costo} onClick={aplicarATodas} title={costo ? "" : "Indique primero el costo en General"}>Aplicar a todas</button>
        </div>
      </div>

      {aux.preciosPorSucursal
        ? <p className="suave pequeno">Precios por sucursal activados: los precios propios de cada sucursal se editan en Comercial › Precios. Aquí se edita el precio general.</p>
        : <p className="suave pequeno">Todas las sucursales usan estos precios. Si alguna necesita precios propios, active la opción en Comercial › Precios.</p>}

      {!!f.historialPrecios?.length && (
        <div className="panel">
          <div className="encabezado-sub"><h3>Historial de precios</h3></div>
          <Tabla filas={f.historialPrecios} clave={(_, i) => String(i)} columnas={[
            { titulo: "Fecha", valor: (h) => new Date(h.fecha).toLocaleString("es-DO", { dateStyle: "short", timeStyle: "short" }) },
            { titulo: "Presentación", valor: (h) => h.presentacion },
            { titulo: "Nivel", valor: (h) => `Precio ${h.nivel}` },
            { titulo: "Antes", der: true, valor: (h) => (h.anterior ? rd(h.anterior) : "—") },
            { titulo: "Ahora", der: true, valor: (h) => (h.nuevo ? <b>{rd(h.nuevo)}</b> : "Quitado") },
            { titulo: "Usuario", valor: (h) => h.usuario ?? "—" },
          ]} />
        </div>
      )}
    </>
  );
}

/* ---------- Inventario ---------- */
function InventarioFicha({ f, cambiar }: { f: Ficha; cambiar: (p: Partial<Ficha>) => void }) {
  const fijar = (i: number, p: Partial<Ficha["sucursales"][number]>) => cambiar({ sucursales: f.sucursales.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  return (
    <div className="panel">
      <div className="encabezado-sub">
        <h3>Inventario por sucursal</h3>
        <a className="enlace" href="#ajustes" onClick={() => setTimeout(() => location.reload(), 0)}>Corregir existencia con un ajuste</a>
      </div>
      <p className="suave pequeno">Cada sucursal tiene su propio inventario. La existencia solo cambia con compras, ventas, traspasos o ajustes, para que el kardex cuadre siempre.</p>
      <table className="tabla tabla-edicion">
        <thead><tr><th>Sucursal</th><th className="der">Existencia</th><th className="der">Mínimo</th><th className="der">Máximo</th><th>Ubicación</th><th>Se vende</th></tr></thead>
        <tbody>
          {f.sucursales.map((s, i) => {
            const bajo = n(s.existencia) <= n(s.stockMinimo) && n(s.stockMinimo) > 0;
            return (
              <tr key={s.sucursalId}>
                <td><b>{s.sucursal}</b></td>
                <td className={"der " + (bajo ? "texto-alerta" : "")}><b>{num(s.existencia, n(s.existencia) % 1 ? 2 : 0)}</b>{bajo && <small className="suave"> bajo mínimo</small>}</td>
                <td className="der" style={{ width: 110 }}><input className="numero" inputMode="decimal" value={s.stockMinimo} onChange={(e) => fijar(i, { stockMinimo: e.target.value.replace(/[^\d.]/g, "") })} /></td>
                <td className="der" style={{ width: 110 }}><input className="numero" inputMode="decimal" value={s.stockMaximo ?? ""} onChange={(e) => fijar(i, { stockMaximo: e.target.value.replace(/[^\d.]/g, "") || null })} /></td>
                <td style={{ width: 160 }}><input value={s.ubicacion ?? ""} placeholder="Pasillo 3, góndola B" onChange={(e) => fijar(i, { ubicacion: e.target.value })} /></td>
                <td><input type="checkbox" checked={s.activo} onChange={(e) => fijar(i, { activo: e.target.checked })} aria-label={`Se vende en ${s.sucursal}`} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- Proveedores ---------- */
function ProveedoresFicha({ f, cambiar, aux, recargarAux }: { f: Ficha; cambiar: (p: Partial<Ficha>) => void; aux: Auxiliares; recargarAux: () => void }) {
  const [nuevo, setNuevo] = useState({ nombre: "", rnc: "" });
  const [err, setErr] = useState("");
  const libres = aux.proveedores.filter((p) => !f.proveedores.some((x) => x.proveedorId === p.id));
  const fijar = (i: number, p: Partial<Ficha["proveedores"][number]>) => cambiar({ proveedores: f.proveedores.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const crear = async () => {
    setErr("");
    try {
      const r = await api<{ id: string }>("/central/proveedores", { cuerpo: { nombre: nuevo.nombre, rnc: nuevo.rnc || null } });
      recargarAux();
      cambiar({ proveedores: [...f.proveedores, { proveedorId: r.id, nombre: nuevo.nombre, codigoProveedor: null, ultimoCosto: null, principal: !f.proveedores.length }] });
      setNuevo({ nombre: "", rnc: "" });
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div className="panel">
      <div className="encabezado-sub"><h3>Quién lo vende</h3>
        <select value="" onChange={(e) => { const p = aux.proveedores.find((x) => x.id === e.target.value); if (p) cambiar({ proveedores: [...f.proveedores, { proveedorId: p.id, nombre: p.nombre, codigoProveedor: null, ultimoCosto: null, principal: !f.proveedores.length }] }); }}>
          <option value="">Agregar proveedor…</option>
          {libres.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
      </div>
      {f.proveedores.length ? (
        <table className="tabla tabla-edicion">
          <thead><tr><th>Proveedor</th><th>Su código</th><th className="der">Último costo</th><th>Principal</th><th /></tr></thead>
          <tbody>
            {f.proveedores.map((p, i) => (
              <tr key={p.proveedorId}>
                <td><b>{p.nombre ?? aux.proveedores.find((x) => x.id === p.proveedorId)?.nombre}</b></td>
                <td><input value={p.codigoProveedor ?? ""} onChange={(e) => fijar(i, { codigoProveedor: e.target.value })} placeholder="Código en su factura" /></td>
                <td className="der" style={{ width: 130 }}><input className="numero" inputMode="decimal" value={p.ultimoCosto ?? ""} onChange={(e) => fijar(i, { ultimoCosto: e.target.value.replace(/[^\d.]/g, "") || null })} /></td>
                <td><input type="radio" name="principal" checked={p.principal} onChange={() => cambiar({ proveedores: f.proveedores.map((x, j) => ({ ...x, principal: j === i })) })} aria-label="Principal" /></td>
                <td><button className="boton fantasma" onClick={() => cambiar({ proveedores: f.proveedores.filter((_, j) => j !== i) })} aria-label="Quitar">✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="suave">Sin proveedores. El principal se usa para sugerir órdenes de compra.</p>}
      <div className="fila-acciones nuevo-proveedor">
        <input value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} placeholder="Proveedor nuevo" />
        <input value={nuevo.rnc} onChange={(e) => setNuevo({ ...nuevo, rnc: e.target.value.replace(/\D/g, "") })} placeholder="RNC (opcional)" style={{ width: 150 }} />
        <button className="boton" disabled={nuevo.nombre.trim().length < 2} onClick={crear}>Crear y agregar</button>
      </div>
      <Aviso texto={err} />
    </div>
  );
}

/* ---------- Combo ---------- */
function ComboFicha({ f, cambiar, productos, id }: { f: Ficha; cambiar: (p: Partial<Ficha>) => void; productos: { id: string; nombre: string; sku: string }[]; id: string | null }) {
  const [elegido, setElegido] = useState("");
  const agregar = (pid: string) => {
    const p = productos.find((x) => x.id === pid);
    if (!p || pid === id || f.componentes.some((c) => c.productoId === pid)) return;
    cambiar({ componentes: [...f.componentes, { productoId: pid, nombre: p.nombre, sku: p.sku, cantidad: "1" }] });
    setElegido("");
  };
  return (
    <div className="panel">
      <div className="encabezado-sub"><h3>Componentes del combo</h3></div>
      <p className="suave pequeno">Al vender el combo se descuenta del inventario cada componente. La existencia del combo es lo que alcanza con sus componentes, y su costo es la suma de ellos.</p>
      <div style={{ maxWidth: 420, marginBottom: 12 }}><SelectorProducto valor={elegido} onCambio={agregar} placeholder="Agregar producto al combo…" /></div>
      {f.componentes.length ? (
        <table className="tabla tabla-edicion">
          <thead><tr><th>Producto</th><th className="der">Cantidad</th><th /></tr></thead>
          <tbody>
            {f.componentes.map((c, i) => (
              <tr key={c.productoId}>
                <td><b>{c.nombre}</b> <span className="suave">{c.sku}</span></td>
                <td className="der" style={{ width: 120 }}><input className="numero" inputMode="decimal" value={c.cantidad} onChange={(e) => cambiar({ componentes: f.componentes.map((x, j) => (j === i ? { ...x, cantidad: e.target.value.replace(/[^\d.]/g, "") } : x)) })} /></td>
                <td><button className="boton fantasma" onClick={() => cambiar({ componentes: f.componentes.filter((_, j) => j !== i) })} aria-label="Quitar">✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="texto-alerta pequeno">Agregue al menos un componente.</p>}
    </div>
  );
}

/* ---------- Vista previa e imagen ---------- */
function Vista({ f, aux, tasa, cambiar }: { f: Ficha; aux: Auxiliares; tasa: number; cambiar: (p: Partial<Ficha>) => void }) {
  const cat = aux.categorias.find((c) => c.id === f.categoriaId);
  const precio = n(f.presentaciones[0]?.precios["1"]);
  const nombreTicket = (f.nombreCorto || f.nombre || "Nombre del producto").slice(0, 32);
  const [errImg, setErrImg] = useState("");

  const subir = (archivo: File) => {
    setErrImg("");
    const lector = new FileReader();
    lector.onload = () => {
      const img = new Image();
      img.onload = () => {
        // Se reduce a 320 px en WebP: liviano para sincronizar a las cajas
        const lado = 320, k = Math.min(1, lado / Math.max(img.width, img.height));
        const cv = document.createElement("canvas");
        cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
        cv.getContext("2d")!.drawImage(img, 0, 0, cv.width, cv.height);
        cambiar({ imagen: cv.toDataURL("image/webp", 0.82) });
      };
      img.onerror = () => setErrImg("No se pudo leer la imagen.");
      img.src = String(lector.result);
    };
    lector.readAsDataURL(archivo);
  };

  const etiquetaPres = useMemo(() => {
    const p = f.presentaciones[0];
    return n(p?.factor) > 1 ? `${p.nombre} · ${n(p.factor)} unidades` : f.esPesable ? "Por libra" : " ";
  }, [f.presentaciones, f.esPesable]);

  return (
    <aside className="vista-producto">
      <div className="panel">
        <div className="encabezado-sub"><h3>Imagen</h3>{f.imagen && <button className="enlace" onClick={() => cambiar({ imagen: null })}>Quitar</button>}</div>
        <label className="zona-imagen">
          {f.imagen ? <img src={f.imagen} alt="" /> : <span className="suave">Arrastre o elija una foto<br /><small>Se ajusta sola a 320 px</small></span>}
          <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && subir(e.target.files[0])} />
        </label>
        <Aviso texto={errImg} />
      </div>

      <div className="panel">
        <div className="encabezado-sub"><h3>Así se ve en la caja</h3></div>
        <div className="previa-tarjeta" style={{ "--cat": cat?.color ?? "#64748b" } as React.CSSProperties}>
          <div className="arte">
            {f.imagen ? <img src={f.imagen} alt="" /> : <span className="arte-vacio" />}
            {cat && <span className="chip-cat">{cat.nombre}</span>}
          </div>
          <div className="info">
            <b>{f.nombre || "Nombre del producto"}</b>
            <span className="suave">{etiquetaPres}</span>
            <span className="precio">{f.precioVariable ? "Precio libre" : precio ? rd(precio) : "Sin precio"}{f.esPesable && <small>/lb</small>}</span>
          </div>
        </div>
        <div className="previa-ticket mono">
          <div className="linea"><span>{nombreTicket}</span></div>
          <div className="linea"><span>  1 x {precio.toFixed(2)}</span><span>{precio.toFixed(2)}{tasa > 0 ? "" : " E"}</span></div>
          <small className="suave">Papel de 80 mm · 32 caracteres</small>
        </div>
      </div>
    </aside>
  );
}
