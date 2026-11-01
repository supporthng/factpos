import { useEffect, useMemo, useState } from "react";
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
}

/** Lo que devuelve el lector de facturas (borrador por revisar) */
interface Sugerido { presentacionId: string; nombre: string; presentacion: string; factor: string }
interface ItemLeido {
  codigo: string | null; descripcion: string; cantidad: number; costo: number; presentacionId: string | null;
  confianza: "CODIGO" | "NOMBRE" | "NINGUNA"; sugeridos: Sugerido[];
}
interface FacturaLeida {
  cupo: number; usadas: number; proveedor: { id: string | null; nombreLeido: string | null; rncLeido: string | null };
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

  if (nueva) return <NuevaCompra onCerrar={() => setNueva(false)} onRegistrada={() => { setNueva(false); recargar(); }} />;

  const total = (datos ?? []).reduce((a, f) => a + n(f.total), 0);
  const ahorro = (datos ?? []).reduce((a, f) => a + n(f.ahorro), 0);
  return (
    <>
      <Encabezado titulo="Compras" descripcion="Entrada de mercancía con la factura del proveedor. Suma al inventario de la sucursal y actualiza el costo.">
        <button className="boton primario" onClick={() => setNueva(true)}>Registrar compra</button>
      </Encabezado>
      <div className="filtros">
        <SelectorSucursal valor={sucursal} onCambio={setSucursal} />
        <label className="en-linea-campo"><span className="suave">Desde</span><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
        <label className="en-linea-campo"><span className="suave">Hasta</span><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
        {datos && datos.length > 0 && <span className="suave pequeno">{datos.length} compra(s) · {rd(total)}{ahorro > 0 ? ` · ahorro en ofertas ${rd(ahorro)}` : ""}</span>}
      </div>
      <Aviso texto={error} />
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

/* ---------- Nueva compra ---------- */
function NuevaCompra({ onCerrar, onRegistrada }: { onCerrar: () => void; onRegistrada: () => void }) {
  const { sucursales, productos } = useCatalogo();
  const aux = useDatos<{ proveedores: { id: string; nombre: string; rnc: string | null }[] }>("/central/productos-auxiliares");
  const [cab, setCab] = useState({
    sucursalId: sucursales[0]?.id ?? "", almacenId: "", proveedorId: "", numeroFactura: "", ncfProveedor: "",
    fechaFactura: hoy(), condicion: "CONTADO" as "CONTADO" | "CREDITO", venceEn: "", notas: "",
  });
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [prodElegido, setProdElegido] = useState("");
  const [msg, setMsg] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [provNuevo, setProvNuevo] = useState<string | null>(null);
  const lector = useDatos<{ cupo: number; usadas: number; disponible: boolean; error?: string }>("/central/compras/lector/estado");
  const [leyendo, setLeyendo] = useState(false);
  const [pend, setPend] = useState<ItemLeido[]>([]);
  const [leidaInfo, setLeidaInfo] = useState<string>("");

  /** Agrega varias líneas de una vez (de la factura leída); si la presentación ya está, suma la cantidad */
  const agregarLeidas = (items: { presentacionId: string; cantidad: number; costo: number }[]) => {
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
          cantidad: String(it.cantidad), costo: String(Math.round(it.costo * 100) / 100), enOferta: false, costoRegular: "", ref: null, lote: "", vence: "" };
        sig.push(l); nuevas.push(l);
      }
      return sig;
    });
    // Referencia de compras anteriores (para comparar el costo), sin frenar la pantalla
    setTimeout(() => nuevas.forEach(async (l) => {
      try { const ref = await api<Referencia>(`/central/ofertas/referencia/${l.presentacionId}`); setLineas((ls) => ls.map((x) => (x.clave === l.clave ? { ...x, ref } : x))); } catch { /* sin referencia */ }
    }), 0);
  };

  const leerFactura = async (archivo: File | undefined) => {
    if (!archivo) return;
    setLeyendo(true); setMsg(""); setLeidaInfo("");
    try {
      const { tipo, datos } = await prepararArchivo(archivo);
      const r = await api<FacturaLeida>("/central/compras/leer-factura", { cuerpo: { tipo, datos } });
      setCab((c) => ({
        ...c, proveedorId: r.proveedor.id ?? c.proveedorId, numeroFactura: r.numeroFactura ?? c.numeroFactura, ncfProveedor: r.ncf ?? c.ncfProveedor,
        fechaFactura: r.fecha && r.fecha <= hoy() ? r.fecha : c.fechaFactura,
        condicion: r.condicion ?? c.condicion, venceEn: r.vence ?? c.venceEn,
      }));
      if (!r.proveedor.id && r.proveedor.nombreLeido) setProvNuevo(r.proveedor.nombreLeido);
      agregarLeidas(r.items.filter((i) => i.presentacionId).map((i) => ({ presentacionId: i.presentacionId!, cantidad: i.cantidad, costo: i.costo })));
      setPend(r.items.filter((i) => !i.presentacionId));
      setLeidaInfo(`Factura leída: ${r.items.length} líneas${r.total ? ` · total ${rd(r.total)}` : ""}. Revise cada dato antes de registrar. Facturas leídas este mes: ${r.usadas} de ${r.cupo}.`);
      lector.recargar();
    } catch (e) { setMsg((e as Error).message); }
    finally { setLeyendo(false); }
  };

  // Al elegir un producto: si tiene una sola presentación se agrega directo; si no, se elige
  const producto = productos.find((p) => p.id === prodElegido);
  useEffect(() => {
    if (producto && producto.presentaciones.length === 1) agregar(producto.presentaciones[0].id);
  }, [prodElegido]); // eslint-disable-line react-hooks/exhaustive-deps

  const agregar = async (presentacionId: string) => {
    const p = productos.find((x) => x.presentaciones.some((pr) => pr.id === presentacionId))!;
    const pr = p.presentaciones.find((x) => x.id === presentacionId)!;
    setProdElegido("");
    if (lineas.some((l) => l.presentacionId === presentacionId)) return setMsg(`${p.nombre} ${pr.nombre} ya está en la compra.`);
    setMsg("");
    const clave = crypto.randomUUID();
    setLineas((ls) => [...ls, { clave, presentacionId, nombre: p.nombre, presentacion: pr.nombre, factor: pr.factor, cantidad: "", costo: "", enOferta: false, costoRegular: "", ref: null, lote: "", vence: "" }]);
    try {
      const ref = await api<Referencia>(`/central/ofertas/referencia/${presentacionId}`);
      // Se propone el último costo normal (por presentación) como punto de partida
      const ultimo = ref.ultimaCompraNormal ? (n(ref.ultimaCompraNormal.costoUnidad) * n(pr.factor)).toFixed(2) : "";
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
            numeroLote: l.lote.trim() || null, loteVence: l.vence || null,
          })),
        },
      });
      onRegistrada();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <>
      <div className="migas"><button className="enlace" onClick={() => (!lineas.length || confirm("La compra no se ha registrado. ¿Salir?")) && onCerrar()}>Compras</button><span>/</span><span>Registrar compra</span></div>
      <Encabezado titulo="Registrar compra" descripcion="Copie la factura del proveedor. Marque las líneas que el proveedor le dio en oferta para saber luego a cuánto las compró.">
        <label className={"boton" + (!lector.datos?.disponible || leyendo ? " desactivado" : "")}
          title={lector.datos?.disponible ? `Facturas leídas este mes: ${lector.datos.usadas} de ${lector.datos.cupo}` : "El lector de facturas no está activo en su plan. Pídalo a su proveedor de FactPOS."}>
          {leyendo ? "Leyendo la factura…" : "📷 Leer factura"}
          <input type="file" accept="image/*,application/pdf" style={{ display: "none" }} disabled={!lector.datos?.disponible || leyendo}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; void leerFactura(f); }} />
        </label>
        <button className="boton primario" disabled={!completa || guardando} onClick={registrar}>{guardando ? "Registrando…" : `Registrar · ${rd(sub + itb)}`}</button>
      </Encabezado>
      <Aviso texto={msg} />
      {leidaInfo && <p className="texto-ok">{leidaInfo}</p>}
      {pend.length > 0 && (
        <div className="panel">
          <h3>Líneas de la factura sin emparejar ({pend.length})</h3>
          <p className="suave">No se encontró el producto en su inventario. Elija el que corresponde (o créelo primero en Productos y vuelva a leer la factura).</p>
          {pend.map((it, i) => (
            <div key={i} className="en-linea" style={{ flexWrap: "wrap", gap: 8, margin: "8px 0" }}>
              <span><b>{it.descripcion}</b> <span className="suave">{it.codigo ? `${it.codigo} · ` : ""}{it.cantidad} × {rd(it.costo)}</span></span>
              {it.sugeridos.map((sg) => (
                <button key={sg.presentacionId} className="chip" onClick={() => { agregarLeidas([{ presentacionId: sg.presentacionId, cantidad: it.cantidad, costo: it.costo }]); setPend((p) => p.filter((_, j) => j !== i)); }}>
                  {sg.nombre}{sg.presentacion !== "Unidad" ? ` · ${sg.presentacion}` : ""}
                </button>
              ))}
              <SelectorProducto valor="" placeholder="Buscar otro producto…" onCambio={(id) => {
                const p = productos.find((x) => x.id === id);
                const pr = p?.presentaciones[0];
                if (!pr) return;
                agregarLeidas([{ presentacionId: pr.id, cantidad: it.cantidad, costo: it.costo }]);
                setPend((q) => q.filter((_, j) => j !== i));
              }} />
              <button className="boton fantasma" onClick={() => setPend((p) => p.filter((_, j) => j !== i))}>Descartar</button>
            </div>
          ))}
        </div>
      )}

      <div className="panel">
        <div className="tres-col">
          <label className="campo"><span>Sucursal que recibe</span><SelectorSucursal valor={cab.sucursalId} onCambio={(v) => setCab({ ...cab, sucursalId: v, almacenId: "" })} todas={false} /></label>
          <label className="campo"><span>Almacén donde entra</span><SelectorAlmacen sucursalId={cab.sucursalId} valor={cab.almacenId} onCambio={(v) => setCab({ ...cab, almacenId: v })} /></label>
          <label className="campo"><span>Proveedor</span>
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
          <label className="campo"><span>Fecha de la factura</span><input type="date" value={cab.fechaFactura} max={hoy()} onChange={(e) => setCab({ ...cab, fechaFactura: e.target.value })} /></label>
        </div>
        <div className="cuatro-col">
          <label className="campo"><span>Número de factura</span><input value={cab.numeroFactura} onChange={(e) => setCab({ ...cab, numeroFactura: e.target.value })} /></label>
          <label className="campo"><span>NCF del proveedor</span><input value={cab.ncfProveedor} onChange={(e) => setCab({ ...cab, ncfProveedor: e.target.value.toUpperCase().replace(/\s/g, "") })} placeholder="B0100000001" className="mono" /></label>
          <label className="campo"><span>Condición</span>
            <select value={cab.condicion} onChange={(e) => setCab({ ...cab, condicion: e.target.value as "CONTADO" | "CREDITO" })}><option value="CONTADO">Contado</option><option value="CREDITO">Crédito</option></select>
          </label>
          {cab.condicion === "CREDITO"
            ? <label className="campo"><span>Vence</span><input type="date" value={cab.venceEn} min={cab.fechaFactura} onChange={(e) => setCab({ ...cab, venceEn: e.target.value })} /></label>
            : <div />}
        </div>
      </div>

      <div className="panel">
        <div className="encabezado-sub">
          <h3>Productos</h3>
          <div className="agregar-linea">
            <SelectorProducto valor={prodElegido} onCambio={setProdElegido} placeholder="Agregar producto…" />
            {producto && producto.presentaciones.length > 1 && (
              <div className="chips">{producto.presentaciones.map((pr) => (
                <button key={pr.id} className="chip" onClick={() => agregar(pr.id)}>{pr.nombre}{n(pr.factor) > 1 ? ` (${num(pr.factor)})` : ""}</button>
              ))}</div>
            )}
          </div>
        </div>
        {lineas.length === 0 ? <p className="suave">Agregue los productos de la factura.</p> : (
          <div className="tabla-contenedor">
            <table className="tabla tabla-edicion tabla-compra">
              <thead><tr><th>Producto</th><th className="der">Cantidad</th><th className="der">Costo sin ITBIS</th><th>En oferta del proveedor</th><th>Lote y vencimiento</th><th>Compras anteriores</th><th className="der">Total</th><th /></tr></thead>
              <tbody>
                {lineas.map((l, i) => {
                  const f = n(l.factor);
                  const ultNormal = l.ref?.ultimaCompraNormal ? n(l.ref.ultimaCompraNormal.costoUnidad) * f : null;
                  const ultOferta = l.ref?.ultimaCompraOferta ? n(l.ref.ultimaCompraOferta.costoUnidad) * f : null;
                  const comparado = l.enOferta ? null : ultNormal;
                  const dif = comparado && n(l.costo) ? ((n(l.costo) - comparado) / comparado) * 100 : null;
                  return (
                    <tr key={l.clave} className={l.enOferta ? "fila-oferta" : ""}>
                      <td><b>{l.nombre}</b> <span className="suave">{l.presentacion}{f > 1 ? ` · ${num(f)} u.` : ""}</span></td>
                      <td className="der" style={{ width: 100 }}><input className="numero" inputMode="decimal" value={l.cantidad} autoFocus={i === lineas.length - 1}
                        onChange={(e) => fijar(l.clave, { cantidad: e.target.value.replace(/[^\d.]/g, "") })} /></td>
                      <td className="der" style={{ width: 130 }}>
                        <input className="numero" inputMode="decimal" value={l.costo} onChange={(e) => fijar(l.clave, { costo: e.target.value.replace(/[^\d.]/g, "") })} />
                        {dif !== null && Math.abs(dif) >= 0.5 && <small className={"bloque " + (dif > 0 ? "texto-alerta" : "texto-ok")}>{dif > 0 ? "▲" : "▼"} {Math.abs(dif).toFixed(1)} % vs. última</small>}
                      </td>
                      <td style={{ width: 210 }}>
                        <label className="check"><input type="checkbox" checked={l.enOferta} onChange={(e) => fijar(l.clave, {
                          enOferta: e.target.checked,
                          costoRegular: e.target.checked && !l.costoRegular && ultNormal ? ultNormal.toFixed(2) : l.costoRegular,
                        })} /> En oferta</label>
                        {l.enOferta && (
                          <span className="costo-normal"><span className="suave pequeno">Costo normal</span>
                            <input className="numero" inputMode="decimal" value={l.costoRegular} placeholder="Sin oferta"
                              onChange={(e) => fijar(l.clave, { costoRegular: e.target.value.replace(/[^\d.]/g, "") })} /></span>
                        )}
                      </td>
                      <td style={{ width: 170 }}>
                        <span className="lote-linea">
                          <input value={l.lote} placeholder="Lote (opcional)" maxLength={40} aria-label="Número de lote"
                            onChange={(e) => fijar(l.clave, { lote: e.target.value })} />
                          <input type="date" value={l.vence} min={hoy()} aria-label="Fecha de vencimiento" title="Vence"
                            onChange={(e) => fijar(l.clave, { vence: e.target.value })} />
                        </span>
                      </td>
                      <td className="pequeno referencia-linea">
                        {!l.ref ? <span className="suave">…</span> : (
                          <>
                            <span>Normal: <b>{ultNormal !== null ? rd(ultNormal) : "—"}</b>{l.ref.ultimaCompraNormal && <span className="suave"> · {fechaCorta(l.ref.ultimaCompraNormal.fecha)}</span>}</span>
                            <span>En oferta: <b className={ultOferta !== null ? "texto-oferta" : ""}>{ultOferta !== null ? rd(ultOferta) : "—"}</b>{l.ref.ultimaCompraOferta && <span className="suave"> · {fechaCorta(l.ref.ultimaCompraOferta.fecha)}</span>}</span>
                          </>
                        )}
                      </td>
                      <td className="der">{rd(calc[i]?.total ?? 0)}{calc[i]?.ahorro > 0 && <small className="bloque texto-ok">ahorro {rd(calc[i].ahorro)}</small>}</td>
                      <td><button className="boton fantasma" aria-label="Quitar" onClick={() => setLineas((ls) => ls.filter((x) => x.clave !== l.clave))}>✕</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="totales-compra">
          <span>Subtotal {rd(sub)}</span><span>ITBIS {rd(itb)}</span><b>Total {rd(sub + itb)}</b>
          {ahorro > 0 && <span className="texto-ok">Ahorro por ofertas {rd(ahorro)}</span>}
        </div>
        <label className="campo"><span>Notas (opcional)</span><input value={cab.notas} onChange={(e) => setCab({ ...cab, notas: e.target.value })} /></label>
      </div>
    </>
  );
}
