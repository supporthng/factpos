import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { api, rd, num, hoy } from "../api";
import { Aviso, Encabezado, SelectorAlmacen, SelectorProducto, SelectorSucursal, Tabla, useCatalogo, useDatos } from "../ui";

/* ---------- Tipos ---------- */
interface FilaCompra {
  id: string; fecha: string; numeroFactura: string | null; ncf: string | null; condicion: string; total: string; itbis: string;
  sucursal: string; almacen?: string; proveedor: string; usuario: string; lineas: string; lineasEnOferta: string; ahorro: string;
}
interface Referencia {
  factor: string; tasaItbis: string; costoPromedioUnidad: string | null;
  ultimaCompraNormal: { costoUnidad: string; fecha: string; proveedor: string } | null;
  ultimaCompraOferta: { costoUnidad: string; costoRegularUnidad: string | null; fecha: string; proveedor: string; unidades: string } | null;
}
interface Linea {
  clave: string; presentacionId: string; nombre: string; presentacion: string; factor: string;
  cantidad: string; costo: string; enOferta: boolean; costoRegular: string; ref: Referencia | null;
  /** Lote y vencimiento de lo recibido (obligatorio si el producto controla lotes) */
  lote: string; vence: string;
  /** Descripción de la factura del proveedor (la lectora la aprende al registrar) */
  alias?: string;
}

/** Lo que devuelve el lector de facturas (borrador por revisar) */
interface Sugerido { presentacionId: string; nombre: string; presentacion: string; factor: string }
interface ItemLeido {
  codigo: string | null; codigoBarras?: string | null; descripcion: string; cantidad: number; costo: number; presentacionId: string | null;
  confianza: "CODIGO" | "NOMBRE" | "NINGUNA"; sugeridos: Sugerido[];
  /** true: cantidad y costo vienen por UNIDAD (la factura trae cajas de N); empaque = cómo se interpretó */
  porUnidad?: boolean; empaque?: string | null;
}
interface FacturaLeida {
  cupo: number; usadas: number; aviso?: string | null; proveedor: { id: string | null; nombreLeido: string | null; rncLeido: string | null };
  numeroFactura: string | null; ncf: string | null; fecha: string | null; vence: string | null; condicion: "CONTADO" | "CREDITO" | null;
  total: number | null; items: ItemLeido[];
}
const aBase64 = (b: Blob) => new Promise<string>((ok, mal) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).split(",")[1] ?? "");
  r.onerror = () => mal(new Error("No se pudo leer el archivo."));
  r.readAsDataURL(b);
});
/** Foto → se reduce (lado mayor 1800 px, JPEG) para que suba rápido y cueste menos; PDF → tal cual (máx. 3 MB) */
async function prepararArchivo(f: File): Promise<{ tipo: string; datos: string }> {
  if (f.type === "application/pdf") {
    if (f.size > 3 * 1024 * 1024) throw new Error("El PDF pesa más de 3 MB. Tome una foto de la factura o reduzca el archivo.");
    return { tipo: f.type, datos: await aBase64(f) };
  }
  if (!f.type.startsWith("image/")) throw new Error("Use una foto (JPG, PNG) o un PDF.");
  const img = await createImageBitmap(f);
  const k = Math.min(1, 1800 / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/jpeg", 0.85));
  if (!blob) throw new Error("No se pudo procesar la imagen.");
  return { tipo: "image/jpeg", datos: await aBase64(blob) };
}

/** Cantidad y costo de una línea leída, expresados en la presentación elegida (si la factura venía en cajas, ya están por unidad) */
const enPresentacion = (it: { cantidad: number; costo: number; porUnidad?: boolean }, factor: string) => {
  const f = Number(factor) || 1;
  return it.porUnidad ? { cantidad: Math.round((it.cantidad / f) * 10000) / 10000, costo: Math.round(it.costo * f * 100) / 100 } : { cantidad: it.cantidad, costo: it.costo };
};
const n = (v: string | number | null | undefined) => Number(v ?? 0) || 0;
const fechaCorta = (f: string) => new Date(f.slice(0, 10) + "T12:00:00").toLocaleDateString("es-DO");

export function Compras() {
  const [nueva, setNueva] = useState(false);
  const [detalle, setDetalle] = useState<string | null>(null);
  const [sucursal, setSucursal] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const ruta = `/central/compras?${new URLSearchParams({ ...(sucursal ? { sucursalId: sucursal } : {}), ...(desde ? { desde } : {}), ...(hasta ? { hasta } : {}) })}`;
  const { datos, error, recargar } = useDatos<FilaCompra[]>(ruta);
  const borr = useDatos<{ id: string; titulo: string; actualizadoEn: string; usuario: string; lineas: number }[]>("/central/compras/borradores");
  const [borrador, setBorrador] = useState<{ id: string; datos: any } | null>(null);
  const [errBorr, setErrBorr] = useState("");
  const continuar = async (id: string) => {
    setErrBorr("");
    try { const b = await api<{ id: string; datos: any }>(`/central/compras/borradores/${id}`); setBorrador(b); setNueva(true); }
    catch (e) { setErrBorr((e as Error).message); borr.recargar(); }
  };
  const quitarBorrador = async (id: string) => {
    if (!confirm("¿Eliminar este borrador? No se ha registrado nada.")) return;
    try { await api(`/central/compras/borradores/${id}`, { metodo: "DELETE" }); } catch (e) { setErrBorr((e as Error).message); }
    borr.recargar();
  };

  if (nueva) return <NuevaCompra key={borrador?.id ?? "nueva"} borrador={borrador} onCerrar={() => { setNueva(false); setBorrador(null); borr.recargar(); }}
    onRegistrada={() => { setNueva(false); setBorrador(null); recargar(); borr.recargar(); }} />;

  const total = (datos ?? []).reduce((a, f) => a + n(f.total), 0);
  const ahorro = (datos ?? []).reduce((a, f) => a + n(f.ahorro), 0);
  return (
    <>
      <Encabezado titulo="Compras" descripcion="Entrada de mercancía con la factura del proveedor. Suma al inventario de la sucursal y actualiza el costo.">
        <button className="boton primario" onClick={() => { setBorrador(null); setNueva(true); }}>Registrar compra</button>
      </Encabezado>
      <div className="filtros">
        <SelectorSucursal valor={sucursal} onCambio={setSucursal} />
        <label className="en-linea-campo"><span className="suave">Desde</span><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
        <label className="en-linea-campo"><span className="suave">Hasta</span><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
        {datos && datos.length > 0 && <span className="suave pequeno">{datos.length} compra(s) · {rd(total)}{ahorro > 0 ? ` · ahorro en ofertas ${rd(ahorro)}` : ""}</span>}
      </div>
      <Aviso texto={error || errBorr} />
      {borr.datos && borr.datos.length > 0 && (
        <div className="panel">
          <h3>Compras en borrador ({borr.datos.length})</h3>
          <p className="suave pequeno">Facturas que empezó (por ejemplo, con la foto desde el celular) y falta terminar. No han movido inventario.</p>
          {borr.datos.map((b) => (
            <div key={b.id} className="en-linea" style={{ flexWrap: "wrap", gap: 10, margin: "8px 0" }}>
              <span><b>{b.titulo || "Compra sin título"}</b> <span className="suave pequeno">{b.lineas} línea(s){b.usuario ? ` · ${b.usuario}` : ""} · {new Date(b.actualizadoEn).toLocaleString("es-DO", { dateStyle: "short", timeStyle: "short" })}</span></span>
              <button className="boton primario" onClick={() => continuar(b.id)}>Continuar</button>
              <button className="boton fantasma" onClick={() => quitarBorrador(b.id)}>Eliminar</button>
            </div>
          ))}
        </div>
      )}
      {datos && (
        <Tabla
          filas={datos}
          clave={(f) => f.id}
          vacio="No hay compras registradas en este período."
          columnas={[
            { titulo: "Fecha", valor: (f) => fechaCorta(f.fecha) },
            { titulo: "Proveedor", valor: (f) => <button className="fila-producto" onClick={() => setDetalle(f.id)}><span><b>{f.proveedor}</b><small className="suave">{[f.numeroFactura && `Factura ${f.numeroFactura}`, f.ncf].filter(Boolean).join(" · ") || "Sin número"}</small></span></button> },
            { titulo: "Sucursal", valor: (f) => <>{f.sucursal}{f.almacen ? <span className="suave pequeno"> › {f.almacen}</span> : null}</> },
            { titulo: "Líneas", der: true, valor: (f) => <>{f.lineas}{n(f.lineasEnOferta) > 0 && <span className="pastilla en-oferta" title="Líneas compradas en oferta del proveedor">{f.lineasEnOferta} en oferta</span>}</> },
            { titulo: "Condición", valor: (f) => (f.condicion === "CREDITO" ? "Crédito" : "Contado") },
            { titulo: "Total", der: true, valor: (f) => <b>{rd(f.total)}</b> },
            { titulo: "Ahorro", der: true, valor: (f) => (n(f.ahorro) > 0 ? <span className="texto-ok">{rd(f.ahorro)}</span> : <span className="suave">—</span>) },
          ]}
        />
      )}
      {detalle && <DetalleCompra id={detalle} onCerrar={() => setDetalle(null)} />}
    </>
  );
}

/* ---------- Detalle ---------- */
function DetalleCompra({ id, onCerrar }: { id: string; onCerrar: () => void }) {
  const { datos } = useDatos<any>(`/central/compras/${id}`);
  return (
    <div className="fondo-modal" onMouseDown={onCerrar}>
      <div className="modal ancho" onMouseDown={(e) => e.stopPropagation()}>
        {!datos ? <p className="suave">Cargando…</p> : (
          <>
            <div className="encabezado-sub"><h3>{datos.proveedor}</h3><span className="suave">{fechaCorta(datos.fecha_factura)} · {datos.sucursal}{datos.almacen ? ` › ${datos.almacen}` : ""}</span></div>
            <p className="suave pequeno">{[datos.numero_factura && `Factura ${datos.numero_factura}`, datos.ncf_proveedor && `NCF ${datos.ncf_proveedor}`, datos.condicion === "CREDITO" ? `Crédito, vence ${fechaCorta(datos.vence_en)}` : "Contado"].filter(Boolean).join(" · ")}</p>
            <Tabla filas={datos.items} clave={(i: any) => String(i.linea)} columnas={[
              { titulo: "Producto", valor: (i: any) => <>{i.nombre} <span className="suave">{i.presentacion}</span>{i.enOferta && <span className="pastilla en-oferta">En oferta</span>}</> },
              { titulo: "Cant.", der: true, valor: (i: any) => num(i.cantidad, n(i.cantidad) % 1 ? 2 : 0) },
              { titulo: "Costo", der: true, valor: (i: any) => <>{rd(i.costoUnitario)}{i.enOferta && i.costoRegular && <small className="suave bloque tachado">{rd(i.costoRegular)}</small>}</> },
              { titulo: "Lote", valor: (i: any) => (i.numeroLote || i.loteVence ? <>{i.numeroLote ?? "—"}{i.loteVence && <small className="suave bloque">vence {fechaCorta(i.loteVence)}</small>}</> : <span className="suave">—</span>) },
              { titulo: "ITBIS", der: true, valor: (i: any) => rd(i.itbis) },
              { titulo: "Total", der: true, valor: (i: any) => <b>{rd(i.total)}</b> },
            ]} />
            <div className="totales-compra"><span>Subtotal {rd(datos.subtotal)}</span><span>ITBIS {rd(datos.itbis)}</span><b>Total {rd(datos.total)}</b></div>
            {datos.notas && <p className="suave">{datos.notas}</p>}
            <div className="acciones-modal"><button className="boton" onClick={onCerrar}>Cerrar</button></div>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------- Crear producto nuevo desde una línea de la factura ---------- */
interface AuxProducto { impuestos: { id: string; nombre: string; tasa: number }[]; categorias: { id: string; nombre: string }[] }
function CrearProductoCompra({ item, proveedorId, onCerrar, onCreado }: {
  item: ItemLeido; proveedorId: string; onCerrar: () => void; onCreado: (productoId: string) => void;
}) {
  const { sucursales } = useCatalogo();
  const aux = useDatos<AuxProducto>("/central/productos-auxiliares");
  const [nombre, setNombre] = useState(item.descripcion.trim());
  const [categoriaId, setCategoriaId] = useState("");
  const [impuestoId, setImpuestoId] = useState("");
  const [precio, setPrecio] = useState("");
  const [msg, setMsg] = useState("");
  const [guardando, setGuardando] = useState(false);
  const impuesto = aux.datos?.impuestos.find((i) => i.id === (impuestoId || aux.datos?.impuestos.find((x) => x.tasa === 0.18)?.id || aux.datos?.impuestos[0]?.id));
  const costoCon = item.costo * (1 + (impuesto?.tasa ?? 0.18));
  const crear = async () => {
    if (nombre.trim().length < 2) return setMsg("Escriba el nombre del producto.");
    if (n(precio) <= 0) return setMsg("Escriba el precio de venta (con ITBIS): es el que se cobra en caja.");
    if (!impuesto) return setMsg("No hay ITBIS configurado.");
    setGuardando(true); setMsg("");
    try {
      const cod = (item.codigo ?? "").trim();
      const barras = /^\d{8,14}$/.test(item.codigoBarras ?? "") ? item.codigoBarras! : "";
      const r = await api<{ id: string }>("/central/productos", { metodo: "POST", cuerpo: {
        sku: (cod || barras) ? (cod || barras).slice(0, 30).toUpperCase() : "P" + Date.now().toString(36).slice(-6).toUpperCase(),
        nombre: nombre.trim(), categoriaId: categoriaId || null, tipo: "INVENTARIABLE", impuestoId: impuesto.id, precioIncluyeItbis: true,
        costoReferencia: String(Math.round(item.costo * 100) / 100),
        presentaciones: [{ nombre: "Unidad", factor: "1", codigos: barras ? [barras] : [], precios: { "1": n(precio).toFixed(2) }, porcentajes: {}, bases: {} }],
        sucursales: sucursales.map((s) => ({ sucursalId: s.id, stockMinimo: "0", stockMaximo: null, ubicacion: null, activo: true })),
        // Con el código del proveedor guardado, la próxima factura de este proveedor empareja este producto sola
        proveedores: proveedorId ? [{ proveedorId, codigoProveedor: cod ? cod.slice(0, 40) : null, ultimoCosto: String(Math.round(item.costo * 100) / 100), principal: true }] : [],
      } });
      window.dispatchEvent(new Event("factpos:catalogo"));
      onCreado(r.id);
    } catch (e) { setMsg((e as Error).message); setGuardando(false); }
  };
  return (
    <div className="fondo-modal" onMouseDown={onCerrar}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Crear producto nuevo</h3>
        <p className="suave pequeno">De la factura: <b>{item.descripcion}</b>{item.codigoBarras ? ` · código de barras ${item.codigoBarras}` : item.codigo ? ` · código ${item.codigo}` : ""} · {item.cantidad} × {rd(item.costo)} (sin ITBIS)</p>
        <label className="campo"><span>Nombre</span><input autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} /></label>
        <label className="campo"><span>Categoría</span>
          <select value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}>
            <option value="">Sin categoría</option>
            {aux.datos?.categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </label>
        <label className="campo"><span>ITBIS</span>
          <select value={impuesto?.id ?? ""} onChange={(e) => setImpuestoId(e.target.value)}>
            {aux.datos?.impuestos.map((i) => <option key={i.id} value={i.id}>{i.nombre}</option>)}
          </select>
        </label>
        <label className="campo"><span>Precio de venta (con ITBIS)</span>
          <input className="numero" inputMode="decimal" value={precio} placeholder={`Su costo con ITBIS es ${rd(costoCon)}`}
            onChange={(e) => setPrecio(e.target.value.replace(/[^\d.]/g, ""))} onKeyDown={(e) => e.key === "Enter" && crear()} />
        </label>
        {n(precio) > 0 && costoCon > 0 && <p className="suave pequeno">Ganancia sobre el costo: {(((n(precio) - costoCon) / costoCon) * 100).toFixed(1)} %</p>}
        <Aviso texto={msg} />
        <div className="acciones-modal">
          <button className="boton fantasma" onClick={onCerrar}>Cancelar</button>
          <button className="boton primario" disabled={guardando} onClick={crear}>{guardando ? "Creando…" : "Crear y agregar a la compra"}</button>
        </div>
        <p className="suave pequeno">Los demás datos (códigos de barra, otros precios, presentaciones) se completan después en Productos.</p>
      </div>
    </div>
  );
}

/* ---------- Buscador rápido de líneas ---------- */
/** Escribe nombre o SKU → flechas ↑↓ y Enter agregan la presentación (cada presentación es una fila: no hay que elegir dos veces). */
export function BuscadorLinea({ onElegir, inputRef }: { onElegir: (presentacionId: string) => void; inputRef: React.RefObject<HTMLInputElement> }) {
  const { productos } = useCatalogo();
  const [q, setQ] = useState("");
  const [abierto, setAbierto] = useState(false);
  const [activo, setActivo] = useState(0);
  const filas = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    const palabras = t.split(/\s+/);
    const out: { id: string; nombre: string; sku: string; presentacion: string; factor: string }[] = [];
    for (const p of productos) {
      const h = `${p.nombre} ${p.sku}`.toLowerCase();
      if (!palabras.every((w) => h.includes(w))) continue;
      for (const pr of p.presentaciones) out.push({ id: pr.id, nombre: p.nombre, sku: p.sku, presentacion: pr.nombre, factor: pr.factor });
      if (out.length >= 14) break;
    }
    return out.slice(0, 14);
  }, [q, productos]);
  const elegir = (id: string) => { onElegir(id); setQ(""); setActivo(0); setAbierto(false); };
  return (
    <div className="selector-producto buscador-linea">
      <input ref={inputRef} value={q} placeholder="Buscar producto por nombre o SKU y presionar Enter…" autoComplete="off"
        onFocus={() => setAbierto(true)} onBlur={() => setTimeout(() => setAbierto(false), 150)}
        onChange={(e) => { setQ(e.target.value); setActivo(0); setAbierto(true); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setActivo((a) => Math.min(a + 1, filas.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActivo((a) => Math.max(a - 1, 0)); }
          else if (e.key === "Enter" && filas[activo]) { e.preventDefault(); elegir(filas[activo].id); }
          else if (e.key === "Escape") { setQ(""); setAbierto(false); }
        }} />
      {abierto && q.trim() && (
        <div className="desplegable">
          {filas.map((f, i) => (
            <button key={f.id} className={i === activo ? "activo" : ""} onMouseEnter={() => setActivo(i)} onMouseDown={(e) => { e.preventDefault(); elegir(f.id); }}>
              <b>{f.nombre}</b> <span className="suave">{f.presentacion}{n(f.factor) > 1 ? ` (${num(f.factor)} u.)` : ""} · {f.sku}</span>
            </button>
          ))}
          {!filas.length && <span className="suave relleno">Sin resultados</span>}
        </div>
      )}
    </div>
  );
}

/* ---------- Nueva compra ---------- */
function NuevaCompra({ onCerrar, onRegistrada, borrador }: { onCerrar: () => void; onRegistrada: () => void; borrador: { id: string; datos: any } | null }) {
  const { sucursales, productos } = useCatalogo();
  const aux = useDatos<{ proveedores: { id: string; nombre: string; rnc: string | null }[] }>("/central/productos-auxiliares");
  const baseCab = {
    sucursalId: sucursales[0]?.id ?? "", almacenId: "", proveedorId: "", numeroFactura: "", ncfProveedor: "",
    fechaFactura: hoy(), condicion: "CONTADO" as "CONTADO" | "CREDITO", venceEn: "", notas: "",
  };
  const [cab, setCab] = useState<typeof baseCab>({ ...baseCab, ...(borrador?.datos?.cab as Partial<typeof baseCab> | undefined) });
  const [lineas, setLineas] = useState<Linea[]>(() => ((borrador?.datos?.lineas as Linea[] | undefined) ?? []).map((l) => ({ ...l, ref: null })));
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set());
  const [foco, setFoco] = useState<string | null>(null);
  const [creando, setCreando] = useState<{ i: number; item: ItemLeido } | null>(null);
  // Producto recién creado: se espera a que el catálogo lo traiga y entonces se agrega a la compra
  const [porAgregar, setPorAgregar] = useState<{ productoId: string; item: ItemLeido } | null>(null);
  const buscarRef = useRef<HTMLInputElement>(null);
  const cantRefs = useRef(new Map<string, HTMLInputElement>());
  const costoRefs = useRef(new Map<string, HTMLInputElement>());
  const alternar = (clave: string) => setAbiertas((a) => { const x = new Set(a); if (x.has(clave)) x.delete(clave); else x.add(clave); return x; });
  const [msg, setMsg] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [provNuevo, setProvNuevo] = useState<string | null>(null);
  const lector = useDatos<{ cupo: number; usadas: number; disponible: boolean; error?: string }>("/central/compras/lector/estado");
  const [leyendo, setLeyendo] = useState(false);
  const [progreso, setProgreso] = useState("");
  const [pend, setPend] = useState<ItemLeido[]>(() => (borrador?.datos?.pend as ItemLeido[] | undefined) ?? []);
  const [leidaInfo, setLeidaInfo] = useState<string>("");

  /** Agrega varias líneas de una vez (de la factura leída); si la presentación ya está, suma la cantidad */
  const agregarLeidas = (items: { presentacionId: string; cantidad: number; costo: number; alias?: string }[]) => {
    const nuevas: Linea[] = [];
    setLineas((ls) => {
      const sig = [...ls];
      for (const it of items) {
        const p = productos.find((x) => x.presentaciones.some((pr) => pr.id === it.presentacionId));
        const pr = p?.presentaciones.find((x) => x.id === it.presentacionId);
        if (!p || !pr) continue;
        const ya = sig.findIndex((l) => l.presentacionId === it.presentacionId);
        if (ya >= 0) { sig[ya] = { ...sig[ya], cantidad: String(n(sig[ya].cantidad) + it.cantidad) }; continue; }
        const l: Linea = { clave: crypto.randomUUID(), presentacionId: it.presentacionId, nombre: p.nombre, presentacion: pr.nombre, factor: pr.factor,
          cantidad: String(it.cantidad), costo: String(Math.round(it.costo * 100) / 100), enOferta: false, costoRegular: "", ref: null, lote: "", vence: "", alias: it.alias };
        sig.push(l); nuevas.push(l);
      }
      return sig;
    });
    // Referencia de compras anteriores (para comparar el costo), sin frenar la pantalla
    setTimeout(() => nuevas.forEach(async (l) => {
      try { const ref = await api<Referencia>(`/central/ofertas/referencia/${l.presentacionId}`); setLineas((ls) => ls.map((x) => {
        if (x.clave !== l.clave) return x;
        // Si la factura no trajo costo, se propone el de la última compra o el registrado en el sistema
        const porUnidad = n(ref.ultimaCompraNormal?.costoUnidad) || n(ref.ultimaCompraOferta?.costoRegularUnidad) || n(ref.ultimaCompraOferta?.costoUnidad) || n(ref.costoPromedioUnidad);
        return { ...x, ref, costo: n(x.costo) > 0 ? x.costo : porUnidad > 0 ? (porUnidad * n(x.factor)).toFixed(2) : x.costo };
      })); } catch { /* sin referencia */ }
    }), 0);
  };

  // Por qué está apagado el lector (para decirlo en pantalla en vez de dejar los botones deshabilitados sin explicación)
  const motivoLector = lector.datos?.disponible
    ? `Facturas leídas este mes: ${lector.datos.usadas} de ${lector.datos.cupo}`
    : (lector.datos as { error?: string } | undefined)?.error
      ? `no se pudo consultar al portal (${(lector.datos as { error?: string }).error}).`
      : "el portal de FactPOS todavía no tiene activada la lectura con IA (falta la llave ANTHROPIC_API_KEY en el portal).";
  /** Lee un archivo con la IA: el servidor trabaja en segundo plano y aquí se consulta cada 3 s (hasta 3 min) */
  const leerUno = async (archivo: File): Promise<FacturaLeida> => {
    const { tipo, datos } = await prepararArchivo(archivo);
    const { trabajoId } = await api<{ trabajoId: string }>("/central/compras/leer-factura", { cuerpo: { tipo, datos } });
    for (let i = 0; i < 60; i++) {
      await new Promise((ok) => setTimeout(ok, 3000));
      let est: { estado: string; resultado?: FacturaLeida; error?: string };
      try { est = await api(`/central/compras/leer-factura/${trabajoId}`); }
      catch (e) { if (/conexi/i.test((e as Error).message)) continue; throw e; } // un corte breve del celular no cancela la lectura
      if (est.estado === "ERROR") throw new Error(est.error ?? "No se pudo leer la factura");
      if (est.estado === "LISTO" && est.resultado) return est.resultado;
    }
    throw new Error("La lectura tardó demasiado. Intente de nuevo con una foto más liviana.");
  };

  /** Una o varias fotos/PDF (las páginas de una misma factura): cada una se lee y se suma a la compra */
  const leerFactura = async (archivos: File[]) => {
    if (!archivos.length) return;
    setLeyendo(true); setMsg(""); setLeidaInfo(""); setPend([]);
    let lineasLeidas = 0, ultima: FacturaLeida | undefined;
    try {
      for (let k = 0; k < archivos.length; k++) {
        setProgreso(archivos.length > 1 ? `Leyendo la página ${k + 1} de ${archivos.length}…` : "");
        const r = await leerUno(archivos[k]);
        ultima = r; lineasLeidas += r.items.length;
        setCab((c) => ({
          ...c, proveedorId: r.proveedor.id ?? c.proveedorId, numeroFactura: r.numeroFactura ?? c.numeroFactura, ncfProveedor: r.ncf ?? c.ncfProveedor,
          fechaFactura: r.fecha && r.fecha <= hoy() ? r.fecha : c.fechaFactura,
          condicion: r.condicion ?? c.condicion, venceEn: r.vence ?? c.venceEn,
        }));
        if (!r.proveedor.id && r.proveedor.nombreLeido) setProvNuevo((x) => x ?? r.proveedor.nombreLeido);
        agregarLeidas(r.items.filter((i) => i.presentacionId).map((i) => ({ presentacionId: i.presentacionId!, cantidad: i.cantidad, costo: i.costo, alias: i.descripcion })));
        setPend((p) => [...p, ...r.items.filter((i) => !i.presentacionId)]);
        if (archivos.length === 1 && r.aviso) setMsg(r.aviso);
      }
      setLeidaInfo(`Factura leída: ${lineasLeidas} líneas${archivos.length > 1 ? ` en ${archivos.length} páginas` : ultima?.total ? ` · total ${rd(ultima.total)}` : ""}. Revise cada dato antes de registrar.${ultima ? ` Facturas leídas este mes: ${ultima.usadas} de ${ultima.cupo}.` : ""}`);
      lector.recargar();
    } catch (e) {
      setMsg(`${(e as Error).message}${lineasLeidas ? ` (Ya se cargaron ${lineasLeidas} líneas de las páginas anteriores.)` : ""}`);
    } finally { setLeyendo(false); setProgreso(""); }
  };

  useEffect(() => {
    if (!porAgregar) return;
    const p = productos.find((x) => x.id === porAgregar.productoId);
    const pr = p?.presentaciones[0];
    if (!pr) return;
    agregarLeidas([{ presentacionId: pr.id, cantidad: porAgregar.item.cantidad, costo: porAgregar.item.costo, alias: porAgregar.item.descripcion }]);
    setPorAgregar(null);
  }, [porAgregar, productos]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cuando se agrega una línea, el cursor va directo a su cantidad (Enter → costo → Enter → vuelve al buscador)
  useEffect(() => {
    if (!foco) return;
    const el = cantRefs.current.get(foco);
    if (el) { el.focus(); el.select(); setFoco(null); }
  }, [foco, lineas]);

  const agregar = async (presentacionId: string) => {
    const p = productos.find((x) => x.presentaciones.some((pr) => pr.id === presentacionId))!;
    const pr = p.presentaciones.find((x) => x.id === presentacionId)!;
    setMsg("");
    const ya = lineas.find((l) => l.presentacionId === presentacionId);
    if (ya) { setFoco(ya.clave); return; } // ya está: se va a su cantidad para corregirla
    const clave = crypto.randomUUID();
    setLineas((ls) => [...ls, { clave, presentacionId, nombre: p.nombre, presentacion: pr.nombre, factor: pr.factor, cantidad: "", costo: "", enOferta: false, costoRegular: "", ref: null, lote: "", vence: "" }]);
    setFoco(clave);
    try {
      const ref = await api<Referencia>(`/central/ofertas/referencia/${presentacionId}`);
      // Se propone el último costo normal (por presentación) como punto de partida
      // Última compra a precio normal; si no hay, el costo normal de la última en oferta; si tampoco, el costo registrado en el sistema (promedio)
      const porUnidad = n(ref.ultimaCompraNormal?.costoUnidad) || n(ref.ultimaCompraOferta?.costoRegularUnidad) || n(ref.ultimaCompraOferta?.costoUnidad) || n(ref.costoPromedioUnidad);
      const ultimo = porUnidad > 0 ? (porUnidad * n(pr.factor)).toFixed(2) : "";
      setLineas((ls) => ls.map((l) => (l.clave === clave ? { ...l, ref, costo: l.costo || ultimo } : l)));
    } catch { /* sin referencia: se escribe el costo a mano */ }
  };
  const fijar = (clave: string, cambio: Partial<Linea>) => setLineas((ls) => ls.map((l) => (l.clave === clave ? { ...l, ...cambio } : l)));

  const calc = useMemo(() => lineas.map((l) => {
    const tasa = n(l.ref?.tasaItbis ?? 0.18);
    const base = n(l.cantidad) * n(l.costo);
    const itbis = Math.round(base * tasa * 100) / 100;
    const ahorro = l.enOferta && l.costoRegular ? (n(l.costoRegular) - n(l.costo)) * n(l.cantidad) : 0;
    return { base, itbis, total: base + itbis, ahorro };
  }), [lineas]);
  const sub = calc.reduce((a, c) => a + c.base, 0);
  const itb = calc.reduce((a, c) => a + c.itbis, 0);
  const ahorro = calc.reduce((a, c) => a + c.ahorro, 0);
  const completa = cab.sucursalId && cab.proveedorId && lineas.length > 0 && lineas.every((l) => n(l.cantidad) > 0 && n(l.costo) > 0)
    && (cab.condicion === "CONTADO" || cab.venceEn);

  const crearProveedor = async () => {
    if (!provNuevo || provNuevo.trim().length < 2) return;
    try {
      const r = await api<{ id: string }>("/central/proveedores", { cuerpo: { nombre: provNuevo.trim() } });
      await aux.recargar();
      setCab({ ...cab, proveedorId: r.id });
      setProvNuevo(null);
    } catch (e) { setMsg((e as Error).message); }
  };

  const registrar = async () => {
    setGuardando(true);
    setMsg("");
    try {
      await api("/central/compras", {
        cuerpo: {
          ...cab,
          almacenId: cab.almacenId || null,
          numeroFactura: cab.numeroFactura || null, ncfProveedor: cab.ncfProveedor.toUpperCase() || null,
          venceEn: cab.condicion === "CREDITO" ? cab.venceEn : null, notas: cab.notas || null,
          items: lineas.map((l) => ({
            presentacionId: l.presentacionId, cantidad: String(n(l.cantidad)), costoUnitario: String(n(l.costo)),
            enOferta: l.enOferta, costoRegular: l.enOferta && l.costoRegular ? String(n(l.costoRegular)) : null,
            numeroLote: l.lote.trim() || null, loteVence: l.vence || null, descripcionFactura: l.alias ?? null,
          })),
        },
      });
      terminada.current = true;
      try { await api(`/central/compras/borradores/${borradorId.current}`, { metodo: "DELETE" }); } catch { /* sin borrador */ }
      onRegistrada();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setGuardando(false);
    }
  };

  useEffect(() => {
    const t = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && completa && !guardando) { e.preventDefault(); void registrar(); } };
    window.addEventListener("keydown", t);
    return () => window.removeEventListener("keydown", t);
  });

  // ---- Borrador: lo escrito se guarda solo en el servidor para poder seguir en otro equipo
  const borradorId = useRef(borrador?.id ?? crypto.randomUUID());
  const terminada = useRef(false);
  const [guardado, setGuardado] = useState(!!borrador);
  useEffect(() => {
    if (!borrador) return;
    for (const l of lineas) {
      api<Referencia>(`/central/ofertas/referencia/${l.presentacionId}`)
        .then((ref) => setLineas((ls) => ls.map((x) => (x.clave === l.clave ? { ...x, ref } : x)))).catch(() => {});
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (terminada.current || (!lineas.length && !pend.length)) return;
    const t = setTimeout(async () => {
      const prov = aux.datos?.proveedores.find((p) => p.id === cab.proveedorId)?.nombre ?? "Sin proveedor";
      try {
        await api(`/central/compras/borradores/${borradorId.current}`, { metodo: "PUT", cuerpo: {
          titulo: `${prov} · ${cab.numeroFactura || "sin número"}`,
          datos: { cab, pend, lineas: lineas.map((l) => ({ ...l, ref: null })) },
        } });
        if (!terminada.current) setGuardado(true);
      } catch { /* sin conexión: se reintenta con el próximo cambio */ }
    }, 1200);
    return () => clearTimeout(t);
  }, [cab, lineas, pend, aux.datos]);
  const descartarBorrador = async () => {
    if (!confirm("¿Descartar esta compra? Se borra el borrador y no se registra nada.")) return;
    terminada.current = true;
    try { await api(`/central/compras/borradores/${borradorId.current}`, { metodo: "DELETE" }); } catch { /* ya no existía */ }
    onCerrar();
  };

  useEffect(() => { if (!cab.sucursalId && sucursales[0]) setCab((c) => ({ ...c, sucursalId: sucursales[0].id })); }, [sucursales, cab.sucursalId]);
  const variasSuc = sucursales.length > 1;
  const almacenes = sucursales.find((x) => x.id === cab.sucursalId)?.almacenes ?? [];
  const lectorOk = !!lector.datos?.disponible && !leyendo;
  return (
    <>
      <div className="migas"><button className="enlace" onClick={onCerrar}>Compras</button><span>/</span><span>Registrar compra</span></div>
      <Encabezado titulo="Registrar compra" descripcion="Busque cada producto, escriba cantidad y costo, y Enter. También puede leer la factura con IA.">
        <label className={"boton" + (!lectorOk ? " desactivado" : "")} title={motivoLector}>
          {leyendo ? (progreso || "Leyendo la factura…") : "📷 Leer factura"}
          <input type="file" accept="image/*" capture="environment" style={{ display: "none" }} disabled={!lectorOk}
            onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; void leerFactura(f); }} />
        </label>
        <label className={"boton" + (!lectorOk ? " desactivado" : "")} title={motivoLector}>
          📄 Cargar factura (una o varias páginas)
          <input type="file" accept="image/*,application/pdf" multiple style={{ display: "none" }} disabled={!lectorOk}
            onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; void leerFactura(f); }} />
        </label>
      </Encabezado>
      {lector.datos && !lector.datos.disponible && <Aviso tipo="info" texto={`El lector de facturas no está disponible: ${motivoLector}`} />}
      {leyendo && <Aviso tipo="info" texto="Leyendo la factura con IA… tarda entre 15 y 40 segundos. Puede ir llenando los datos mientras tanto." />}
      <Aviso texto={msg} />
      {leidaInfo && <p className="texto-ok">{leidaInfo}</p>}
      {guardado && <p className="suave pequeno">Esta compra se guarda sola como borrador: puede seguirla desde la PC u otro equipo en Compras › «Compras en borrador».</p>}
      {pend.length > 0 && (
        <div className="panel">
          <h3>Líneas de la factura sin emparejar ({pend.length})</h3>
          <p className="suave">No se encontró el producto en su inventario. Elija el que corresponde o créelo aquí mismo con «Crear producto nuevo».</p>
          {pend.map((it, i) => (
            <div key={i} className="en-linea" style={{ flexWrap: "wrap", gap: 8, margin: "8px 0" }}>
              <span><b>{it.descripcion}</b> <span className="suave">{it.codigo ? `${it.codigo} · ` : ""}{it.cantidad} × {rd(it.costo)}{it.porUnidad ? " por unidad" : ""}</span>{it.empaque && <small className="suave bloque">{it.empaque}</small>}</span>
              {it.sugeridos.map((sg) => (
                <button key={sg.presentacionId} className="chip" onClick={() => { agregarLeidas([{ presentacionId: sg.presentacionId, alias: it.descripcion, ...enPresentacion(it, sg.factor) }]); setPend((p) => p.filter((_, j) => j !== i)); }}>
                  {sg.nombre}{sg.presentacion !== "Unidad" ? ` · ${sg.presentacion}` : ""}
                </button>
              ))}
              <SelectorProducto valor="" placeholder="Buscar otro producto…" onCambio={(id) => {
                const p = productos.find((x) => x.id === id);
                const pr = p?.presentaciones[0];
                if (!pr) return;
                agregarLeidas([{ presentacionId: pr.id, alias: it.descripcion, ...enPresentacion(it, pr.factor) }]);
                setPend((q) => q.filter((_, j) => j !== i));
              }} />
              <button className="boton" onClick={() => setCreando({ i, item: it })}>＋ Crear producto nuevo</button>
              <button className="boton fantasma" onClick={() => setPend((p) => p.filter((_, j) => j !== i))}>Descartar</button>
            </div>
          ))}
        </div>
      )}

      {/* Datos de la factura: una sola fila; lo que casi nunca cambia (sucursal, almacén) solo aparece si hace falta */}
      <div className="panel cab-compra">
        <label className="campo campo-prov"><span>Proveedor</span>
          {provNuevo === null ? (
            <select value={cab.proveedorId} onChange={(e) => (e.target.value === "+" ? setProvNuevo("") : setCab({ ...cab, proveedorId: e.target.value }))}>
              <option value="">Elija el proveedor…</option>
              {aux.datos?.proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              <option value="+">+ Proveedor nuevo…</option>
            </select>
          ) : (
            <span className="en-linea"><input autoFocus value={provNuevo} onChange={(e) => setProvNuevo(e.target.value)} onKeyDown={(e) => e.key === "Enter" && crearProveedor()} placeholder="Nombre del proveedor" />
              <button className="boton" onClick={crearProveedor}>Crear</button><button className="boton fantasma" onClick={() => setProvNuevo(null)}>✕</button></span>
          )}
        </label>
        <label className="campo"><span>N.º de factura</span><input value={cab.numeroFactura} onChange={(e) => setCab({ ...cab, numeroFactura: e.target.value })} /></label>
        <label className="campo"><span>NCF del proveedor</span><input value={cab.ncfProveedor} onChange={(e) => setCab({ ...cab, ncfProveedor: e.target.value.toUpperCase().replace(/\s/g, "") })} placeholder="B0100000001" className="mono" /></label>
        <label className="campo"><span>Fecha</span><input type="date" value={cab.fechaFactura} max={hoy()} onChange={(e) => setCab({ ...cab, fechaFactura: e.target.value })} /></label>
        <label className="campo"><span>Condición</span>
          <span className="segmentos">
            <button type="button" className={cab.condicion === "CONTADO" ? "activo" : ""} onClick={() => setCab({ ...cab, condicion: "CONTADO" })}>Contado</button>
            <button type="button" className={cab.condicion === "CREDITO" ? "activo" : ""} onClick={() => setCab({ ...cab, condicion: "CREDITO" })}>Crédito</button>
          </span>
        </label>
        {cab.condicion === "CREDITO" && <label className="campo"><span>Vence</span><input type="date" value={cab.venceEn} min={cab.fechaFactura} onChange={(e) => setCab({ ...cab, venceEn: e.target.value })} /></label>}
        {variasSuc && <label className="campo"><span>Sucursal que recibe</span><SelectorSucursal valor={cab.sucursalId} onCambio={(v) => setCab({ ...cab, sucursalId: v, almacenId: "" })} todas={false} /></label>}
        {almacenes.length > 1 && <label className="campo"><span>Almacén donde entra</span><SelectorAlmacen sucursalId={cab.sucursalId} valor={cab.almacenId} onCambio={(v) => setCab({ ...cab, almacenId: v })} /></label>}
      </div>

      <div className="panel">
        <BuscadorLinea inputRef={buscarRef} onElegir={agregar} />
        {lineas.length === 0 ? (
          <p className="suave vacio-compra">Agregue los productos de la factura con el buscador, o lea la factura con 📷 / 📄.</p>
        ) : (
          <div className="tabla-contenedor">
            <table className="tabla tabla-edicion tabla-compra">
              <thead><tr><th>#</th><th>Producto</th><th className="der">Cantidad</th><th className="der">Costo sin ITBIS</th><th className="der">Total</th><th /></tr></thead>
              <tbody>
                {lineas.map((l, i) => {
                  const f = n(l.factor);
                  const ultNormal = l.ref?.ultimaCompraNormal ? n(l.ref.ultimaCompraNormal.costoUnidad) * f : null;
                  const ultOferta = l.ref?.ultimaCompraOferta ? n(l.ref.ultimaCompraOferta.costoUnidad) * f : null;
                  const comparado = l.enOferta ? null : ultNormal;
                  const dif = comparado && n(l.costo) ? ((n(l.costo) - comparado) / comparado) * 100 : null;
                  const abierta = abiertas.has(l.clave);
                  const conExtras = l.enOferta || !!l.lote.trim() || !!l.vence;
                  return (
                    <Fragment key={l.clave}>
                      <tr className={l.enOferta ? "fila-oferta" : ""}>
                        <td className="suave">{i + 1}</td>
                        <td><b>{l.nombre}</b> <span className="suave">{l.presentacion}{f > 1 ? ` · ${num(f)} u.` : ""}</span>
                          {l.enOferta && <span className="pastilla en-oferta">En oferta</span>}
                          {l.ref && (ultNormal !== null) && <small className="suave bloque">Última compra: {rd(ultNormal)} · {fechaCorta(l.ref.ultimaCompraNormal!.fecha)}</small>}
                        </td>
                        <td className="der" style={{ width: 110 }}><input className="numero" inputMode="decimal" value={l.cantidad} aria-label="Cantidad"
                          ref={(el) => { if (el) cantRefs.current.set(l.clave, el); else cantRefs.current.delete(l.clave); }}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); const c = costoRefs.current.get(l.clave); c?.focus(); c?.select(); } }}
                          onChange={(e) => fijar(l.clave, { cantidad: e.target.value.replace(/[^\d.]/g, "") })} /></td>
                        <td className="der" style={{ width: 140 }}>
                          <input className="numero" inputMode="decimal" value={l.costo} aria-label="Costo sin ITBIS"
                            ref={(el) => { if (el) costoRefs.current.set(l.clave, el); else costoRefs.current.delete(l.clave); }}
                            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); buscarRef.current?.focus(); } }}
                            onChange={(e) => fijar(l.clave, { costo: e.target.value.replace(/[^\d.]/g, "") })} />
                          {dif !== null && Math.abs(dif) >= 0.5 && <small className={"bloque " + (dif > 0 ? "texto-alerta" : "texto-ok")}>{dif > 0 ? "▲" : "▼"} {Math.abs(dif).toFixed(1)} % vs. última</small>}
                        </td>
                        <td className="der">{rd(calc[i]?.total ?? 0)}{calc[i]?.ahorro > 0 && <small className="bloque texto-ok">ahorro {rd(calc[i].ahorro)}</small>}</td>
                        <td className="acciones-linea">
                          <button className={"boton fantasma" + (conExtras ? " con-extras" : "")} title="Oferta, lote y vencimiento, compras anteriores" aria-expanded={abierta} onClick={() => alternar(l.clave)}>{abierta ? "▴" : "▾"} Detalle{conExtras && !abierta ? " •" : ""}</button>
                          <button className="boton fantasma" aria-label="Quitar" onClick={() => setLineas((ls) => ls.filter((x) => x.clave !== l.clave))}>✕</button>
                        </td>
                      </tr>
                      {abierta && (
                        <tr className="detalle-linea"><td />
                          <td colSpan={5}>
                            <div className="detalle-linea-grid">
                              <div>
                                <label className="check"><input type="checkbox" checked={l.enOferta} onChange={(e) => fijar(l.clave, {
                                  enOferta: e.target.checked,
                                  costoRegular: e.target.checked && !l.costoRegular && ultNormal ? ultNormal.toFixed(2) : l.costoRegular,
                                })} /> El proveedor lo dio en oferta</label>
                                {l.enOferta && (
                                  <span className="costo-normal"><span className="suave pequeno">Costo normal</span>
                                    <input className="numero" inputMode="decimal" value={l.costoRegular} placeholder="Sin oferta"
                                      onChange={(e) => fijar(l.clave, { costoRegular: e.target.value.replace(/[^\d.]/g, "") })} /></span>
                                )}
                              </div>
                              <div className="lote-linea">
                                <input value={l.lote} placeholder="Lote (opcional)" maxLength={40} aria-label="Número de lote" onChange={(e) => fijar(l.clave, { lote: e.target.value })} />
                                <input type="date" value={l.vence} min={hoy()} aria-label="Fecha de vencimiento" title="Vence" onChange={(e) => fijar(l.clave, { vence: e.target.value })} />
                              </div>
                              <div className="pequeno referencia-linea">
                                {!l.ref ? <span className="suave">…</span> : (
                                  <>
                                    <span>Normal: <b>{ultNormal !== null ? rd(ultNormal) : "—"}</b>{l.ref.ultimaCompraNormal && <span className="suave"> · {l.ref.ultimaCompraNormal.proveedor} · {fechaCorta(l.ref.ultimaCompraNormal.fecha)}</span>}</span>
                                    <span>En oferta: <b className={ultOferta !== null ? "texto-oferta" : ""}>{ultOferta !== null ? rd(ultOferta) : "—"}</b>{l.ref.ultimaCompraOferta && <span className="suave"> · {fechaCorta(l.ref.ultimaCompraOferta.fecha)}</span>}</span>
                                  </>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <label className="campo"><span>Notas (opcional)</span><input value={cab.notas} onChange={(e) => setCab({ ...cab, notas: e.target.value })} /></label>
      </div>

      {creando && (
        <CrearProductoCompra item={creando.item} proveedorId={cab.proveedorId} onCerrar={() => setCreando(null)}
          onCreado={(productoId) => { setPorAgregar({ productoId, item: creando.item }); setPend((q) => q.filter((_, j) => j !== creando.i)); setCreando(null); }} />
      )}

      {/* Barra fija: el total y el botón siempre a la vista, sin subir la pantalla */}
      <div className="barra-compra">
        <span className="suave">{lineas.length} línea(s){guardado ? " · borrador guardado" : ""}</span>
        {guardado && <button className="boton fantasma" onClick={descartarBorrador} title="Borra el borrador sin registrar la compra">Descartar</button>}
        <span>Subtotal {rd(sub)}</span><span>ITBIS {rd(itb)}</span>
        {ahorro > 0 && <span className="texto-ok">Ahorro por ofertas {rd(ahorro)}</span>}
        <b className="total-compra">Total {rd(sub + itb)}</b>
        <button className="boton primario" disabled={!completa || guardando} onClick={registrar} title="Ctrl + Enter">{guardando ? "Registrando…" : "Registrar compra"}</button>
      </div>
      {!completa && lineas.length > 0 && (
        <p className="suave pequeno">Falta: {[!cab.proveedorId && "proveedor", cab.condicion === "CREDITO" && !cab.venceEn && "fecha de vencimiento", lineas.some((l) => !(n(l.cantidad) > 0)) && "cantidad en alguna línea", lineas.some((l) => !(n(l.costo) > 0)) && "costo en alguna línea"].filter(Boolean).join(", ")}.</p>
      )}
    </>
  );
}
