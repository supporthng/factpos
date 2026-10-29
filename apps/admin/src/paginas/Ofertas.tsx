import { useEffect, useState } from "react";
import { api, rd, num, hoy } from "../api";
import { Aviso, Encabezado, SelectorProducto, SelectorSucursal, Tabla, useCatalogo, useDatos } from "../ui";

const TIPOS: Record<string, string> = {
  PORCENTAJE: "% de descuento",
  PRECIO_ESPECIAL: "Precio especial",
  LLEVA_PAGA: "Lleva X, paga Y (2x1, 3x2)",
  POR_VOLUMEN: "Precio por volumen",
};
const DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

export function Ofertas() {
  const [filtro, setFiltro] = useState("");
  const [vigentes, setVigentes] = useState(true);
  const [nueva, setNueva] = useState(false);
  const ruta = `/central/ofertas?${new URLSearchParams({ ...(filtro ? { sucursalId: filtro } : {}), ...(vigentes ? { vigentes: "1" } : {}) })}`;
  const { datos, recargar, error } = useDatos<any[]>(ruta);

  const alternar = async (id: string, activo: boolean) => {
    await api(`/central/ofertas/${id}`, { metodo: "PATCH", cuerpo: { activo } });
    recargar();
  };

  const regla = (o: any) => {
    switch (o.tipo) {
      case "PORCENTAJE": return `${num(o.valor)}% de descuento`;
      case "PRECIO_ESPECIAL": return `a ${rd(o.valor)}`;
      case "LLEVA_PAGA": return `lleva ${o.lleva}, paga ${o.paga}`;
      case "POR_VOLUMEN": return `desde ${num(o.cantidadMinima)} a ${rd(o.valor)} c/u`;
    }
  };
  const horario = (o: any) => [
    o.diasSemana?.length ? o.diasSemana.map((d: number) => DIAS[d]).join(", ") : "",
    o.horaDesde ? `${o.horaDesde.slice(0, 5)}–${o.horaHasta.slice(0, 5)}` : "",
  ].filter(Boolean).join(" · ") || "Todo el día";

  return (
    <>
      <Encabezado titulo="Ofertas" descripcion="Se aplican solas en la terminal. Cada oferta puede valer para todas las sucursales o solo para algunas.">
        <button className="boton primario" onClick={() => setNueva(true)}>Nueva oferta</button>
      </Encabezado>
      <div className="filtros">
        <SelectorSucursal valor={filtro} onCambio={setFiltro} />
        <label className="check"><input type="checkbox" checked={vigentes} onChange={(e) => setVigentes(e.target.checked)} /> Solo vigentes</label>
      </div>
      <Aviso texto={error} />
      <Tabla
        filas={datos ?? []}
        clave={(f) => f.id}
        vacio="No hay ofertas"
        columnas={[
          { titulo: "Oferta", valor: (o) => <><b>{o.nombre}</b><br /><span className="suave pequeno">{regla(o)}</span></> },
          { titulo: "Sucursales", valor: (o) => o.sucursales.join(", ") },
          { titulo: "Vigencia", valor: (o) => <>{new Date(o.iniciaEn).toLocaleDateString("es-DO")} – {new Date(o.terminaEn).toLocaleDateString("es-DO")}<br /><span className="suave pequeno">{horario(o)}</span></> },
          { titulo: "Nivel", valor: (o) => o.nivelPrecio ?? "Todos" },
          { titulo: "Tope", valor: (o) => <Tope o={o} /> },
          { titulo: "Descuento dado", valor: (o) => rd(o.descuentoOtorgado), der: true },
          { titulo: "Activa", valor: (o) => <input type="checkbox" checked={o.activo} onChange={(e) => alternar(o.id, e.target.checked)} /> },
        ]}
      />
      {nueva && <NuevaOferta onCerrar={() => setNueva(false)} onCreada={() => { setNueva(false); recargar(); }} />}
    </>
  );
}

/** Avance de una oferta con tope: unidades vendidas de las permitidas, por sucursal. */
function Tope({ o }: { o: any }) {
  if (!o.unidadesMaximas) return <span className="suave">Sin tope</span>;
  const max = Number(o.unidadesMaximas);
  const filas: { sucursal: string; vendidas: string }[] = o.vendidasPorSucursal.length ? o.vendidasPorSucursal : [{ sucursal: "", vendidas: "0" }];
  return (
    <div className="topes">
      {filas.map((f) => {
        const v = Number(f.vendidas);
        const agotada = v >= max;
        return (
          <div key={f.sucursal} className="tope" title={f.sucursal}>
            <div className="tope-barra"><i style={{ width: `${Math.min(100, (v / max) * 100)}%` }} className={agotada ? "lleno" : ""} /></div>
            <span className="pequeno">{num(v)} de {num(max)}{f.sucursal && o.vendidasPorSucursal.length > 1 ? ` · ${f.sucursal}` : ""}</span>
            {agotada && <span className="pastilla agotada">Agotada</span>}
          </div>
        );
      })}
    </div>
  );
}

/** Fechas en RD (UTC-4) como AAAA-MM-DD. */
const fechaRD = (d: Date) => new Date(d.getTime() - 4 * 3600e3).toISOString().slice(0, 10);
const masDias = (base: string, n: number) => fechaRD(new Date(new Date(`${base}T12:00:00-04:00`).getTime() + n * 864e5));
function vigencia(clave: "hoy" | "semana" | "finde" | "7" | "mes"): { inicia: string; termina: string } {
  const h = hoy();
  const dia = new Date(`${h}T12:00:00-04:00`).getUTCDay(); // 0 = domingo
  switch (clave) {
    case "hoy": return { inicia: h, termina: h };
    case "semana": return { inicia: h, termina: masDias(h, (7 - dia) % 7) };           // hasta el domingo
    case "finde": {
      const aViernes = (5 - dia + 7) % 7;
      const inicia = dia === 6 || dia === 0 ? h : masDias(h, aViernes);
      return { inicia, termina: masDias(h, (7 - dia) % 7) };                             // viernes a domingo
    }
    case "7": return { inicia: h, termina: masDias(h, 6) };
    case "mes": {
      const [a, m] = h.split("-").map(Number);
      return { inicia: h, termina: fechaRD(new Date(Date.UTC(a, m, 0, 16))) };          // último día del mes
    }
  }
}

interface Referencia {
  nombre: string; presentacion: string; factor: string; tasaItbis: string; precioIncluyeItbis: boolean;
  precioNormal: string | null; costoPromedioUnidad: string | null;
  ultimaCompraNormal: { costoUnidad: string; fecha: string; proveedor: string } | null;
  ultimaCompraOferta: { costoUnidad: string; costoRegularUnidad: string | null; fecha: string; proveedor: string; unidades: string } | null;
}

function NuevaOferta({ onCerrar, onCreada }: { onCerrar: () => void; onCreada: () => void }) {
  const { sucursales, categorias } = useCatalogo();
  const { productos } = useCatalogo();
  const [o, setO] = useState({
    nombre: "", tipo: "PRECIO_ESPECIAL", valor: "", lleva: "2", paga: "1", cantidadMinima: "1",
    ...vigencia("semana"), horaDesde: "", horaHasta: "", nivel: "", tope: "",
  });
  const [presentacionId, setPresentacionId] = useState("");
  const [ref, setRef] = useState<Referencia | null>(null);
  const [dias, setDias] = useState<number[]>([]);
  const [suc, setSuc] = useState<string[]>([]);
  const [productoId, setProductoId] = useState("");
  const [categoriaId, setCategoriaId] = useState("");
  const [msg, setMsg] = useState("");
  const set = (k: keyof typeof o) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setO({ ...o, [k]: e.target.value });
  const producto = productos.find((p) => p.id === productoId);
  // Presentación para la referencia de costos: la elegida, o la de menor factor (la unidad)
  const presRef = presentacionId || producto?.presentaciones.slice().sort((a, b) => Number(a.factor) - Number(b.factor))[0]?.id || "";
  useEffect(() => {
    setRef(null);
    if (!presRef) return;
    api<Referencia>(`/central/ofertas/referencia/${presRef}`).then(setRef).catch(() => setRef(null));
  }, [presRef]);

  // Costos de referencia, por presentación y como precio de venta (con ITBIS si el precio lo incluye)
  const comoPrecio = (costoUnidad: string | null | undefined) => {
    if (!ref || costoUnidad == null) return null;
    const c = Number(costoUnidad) * Number(ref.factor) * (ref.precioIncluyeItbis ? 1 + Number(ref.tasaItbis) : 1);
    return Math.ceil(c * 100 - 1e-6) / 100;
  };
  const costoProm = comoPrecio(ref?.costoPromedioUnidad);
  const costoOferta = comoPrecio(ref?.ultimaCompraOferta?.costoUnidad);
  const costoNormal = comoPrecio(ref?.ultimaCompraNormal?.costoUnidad);
  const precioOferta = o.tipo === "PRECIO_ESPECIAL" || o.tipo === "POR_VOLUMEN" ? Number(o.valor || 0) : 0;
  const bajoCosto = precioOferta > 0 && costoProm !== null && precioOferta < costoProm - 0.005;
  const bajoCostoOferta = precioOferta > 0 && costoOferta !== null && precioOferta < costoOferta - 0.005;
  const usarPrecio = (v: number | null) => v !== null && setO({ ...o, tipo: o.tipo === "POR_VOLUMEN" ? "POR_VOLUMEN" : "PRECIO_ESPECIAL", valor: v.toFixed(2) });

  const crear = async () => {
    setMsg("");
    try {
      await api("/central/ofertas", {
        cuerpo: {
          nombre: o.nombre, tipo: o.tipo,
          ...(o.tipo === "LLEVA_PAGA" ? { lleva: Number(o.lleva), paga: Number(o.paga) } : { valor: o.valor }),
          cantidadMinima: o.tipo === "POR_VOLUMEN" ? o.cantidadMinima : "1",
          iniciaEn: o.inicia === hoy() ? new Date().toISOString() : `${o.inicia}T00:00:00-04:00`, terminaEn: `${o.termina}T23:59:59-04:00`,
          unidadesMaximas: o.tope ? o.tope : null,
          diasSemana: dias.length ? dias : undefined,
          horaDesde: o.horaDesde || undefined, horaHasta: o.horaHasta || undefined,
          sucursales: suc.length ? suc : null,
          nivelPrecio: o.nivel ? Number(o.nivel) : undefined,
          alcance: [presentacionId ? { presentacionId } : productoId ? { productoId } : { categoriaId }],
        },
      });
      onCreada();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  return (
    <div className="fondo-modal" onMouseDown={onCerrar}>
      <div className="modal ancho" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Nueva oferta</h3>
        <label className="campo"><span>Nombre (lo verá el cliente en el ticket y el verificador)</span><input value={o.nombre} onChange={set("nombre")} placeholder="Ej. 2x1 en refrescos" /></label>
        <div className="tres-col">
          <label className="campo"><span>Tipo</span><select value={o.tipo} onChange={set("tipo")}>{Object.entries(TIPOS).map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>
          {o.tipo === "LLEVA_PAGA" ? (
            <>
              <label className="campo"><span>Lleva</span><input inputMode="numeric" value={o.lleva} onChange={set("lleva")} /></label>
              <label className="campo"><span>Paga</span><input inputMode="numeric" value={o.paga} onChange={set("paga")} /></label>
            </>
          ) : (
            <>
              <label className="campo"><span>{o.tipo === "PORCENTAJE" ? "Porcentaje" : "Precio unitario"}</span><input inputMode="decimal" value={o.valor} onChange={set("valor")} /></label>
              {o.tipo === "POR_VOLUMEN" && <label className="campo"><span>Desde cantidad</span><input inputMode="decimal" value={o.cantidadMinima} onChange={set("cantidadMinima")} /></label>}
            </>
          )}
        </div>
        <div className="dos-col">
          <div className="dos-col">
            <label className="campo"><span>Producto</span><SelectorProducto valor={productoId} onCambio={(v) => { setProductoId(v); setPresentacionId(""); setCategoriaId(""); }} /></label>
            <label className="campo"><span>Presentación</span>
              <select value={presentacionId} onChange={(e) => setPresentacionId(e.target.value)} disabled={!producto}>
                <option value="">Todas</option>
                {producto?.presentaciones.map((p) => <option key={p.id} value={p.id}>{p.nombre}{Number(p.factor) > 1 ? ` (${num(p.factor)})` : ""}</option>)}
              </select>
            </label>
          </div>
          <label className="campo"><span>…o toda una categoría</span>
            <select value={categoriaId} onChange={(e) => { setCategoriaId(e.target.value); setProductoId(""); }}>
              <option value="">—</option>{categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </label>
        </div>
        {ref && (o.tipo === "PRECIO_ESPECIAL" || o.tipo === "POR_VOLUMEN") && (
          <div className="referencia-costos">
            <div className="ref-titulo"><b>¿Hasta dónde puede bajar?</b><span className="suave pequeno">{ref.nombre} · {ref.presentacion}{ref.precioIncluyeItbis ? " · precios con ITBIS" : ""}</span></div>
            <div className="ref-filas">
              <div className="ref"><span>Precio normal</span><b>{ref.precioNormal ? rd(ref.precioNormal) : "—"}</b><i /></div>
              <div className="ref"><span>Costo promedio actual</span><b>{costoProm !== null ? rd(costoProm) : "—"}</b>
                <button className="boton chico" disabled={costoProm === null} onClick={() => usarPrecio(costoProm)}>Usar</button></div>
              <div className="ref"><span>Última compra normal{ref.ultimaCompraNormal && <small className="suave"> · {ref.ultimaCompraNormal.proveedor} · {new Date(ref.ultimaCompraNormal.fecha + "T12:00:00").toLocaleDateString("es-DO")}</small>}</span>
                <b>{costoNormal !== null ? rd(costoNormal) : "—"}</b>
                <button className="boton chico" disabled={costoNormal === null} onClick={() => usarPrecio(costoNormal)}>Usar</button></div>
              <div className={"ref" + (ref.ultimaCompraOferta ? " destacada" : "")}>
                <span>Última compra en oferta del proveedor{ref.ultimaCompraOferta && <small className="suave"> · {ref.ultimaCompraOferta.proveedor} · {new Date(ref.ultimaCompraOferta.fecha + "T12:00:00").toLocaleDateString("es-DO")} · {num(ref.ultimaCompraOferta.unidades)} unidades</small>}</span>
                <b>{costoOferta !== null ? rd(costoOferta) : "—"}</b>
                <button className="boton chico" disabled={costoOferta === null} onClick={() => usarPrecio(costoOferta)}>Usar</button></div>
            </div>
            {!ref.ultimaCompraOferta && <p className="suave pequeno">Aún no hay compras en oferta de este producto. Se registran en Compras marcando "En oferta del proveedor".</p>}
            {bajoCostoOferta ? <p className="texto-alerta pequeno">Ese precio está por debajo de lo que costó incluso en la oferta del proveedor: se vende con pérdida.</p>
              : bajoCosto ? <p className="texto-aviso pequeno">Ese precio está por debajo del costo promedio{costoOferta !== null ? ", pero cubre lo que costó en la oferta del proveedor" : ""}.</p> : null}
          </div>
        )}
        <div className="campo"><span>Vigencia</span>
          <div className="chips">
            {([["hoy", "Hoy"], ["semana", "Esta semana"], ["finde", "Fin de semana"], ["7", "7 días"], ["mes", "Este mes"]] as const).map(([k, t]) => {
              const v = vigencia(k);
              return <button key={k} className={"chip" + (o.inicia === v.inicia && o.termina === v.termina ? " activo" : "")} onClick={() => setO({ ...o, ...v })}>{t}</button>;
            })}
          </div>
        </div>
        <div className="cuatro-col">
          <label className="campo"><span>Desde</span><input type="date" value={o.inicia} onChange={set("inicia")} /></label>
          <label className="campo"><span>Hasta</span><input type="date" value={o.termina} onChange={set("termina")} /></label>
          <label className="campo"><span>Hora inicio (opcional)</span><input type="time" value={o.horaDesde} onChange={set("horaDesde")} /></label>
          <label className="campo"><span>Hora fin</span><input type="time" value={o.horaHasta} onChange={set("horaHasta")} /></label>
        </div>
        <div className="campo"><span>Días (ninguno = todos)</span>
          <div className="chips">{DIAS.map((d, i) => (
            <button key={d} className={"chip" + (dias.includes(i) ? " activo" : "")} onClick={() => setDias(dias.includes(i) ? dias.filter((x) => x !== i) : [...dias, i])}>{d}</button>
          ))}</div>
        </div>
        <div className="campo"><span>Sucursales (ninguna = todas)</span>
          <div className="chips">{sucursales.map((s) => (
            <button key={s.id} className={"chip" + (suc.includes(s.id) ? " activo" : "")} onClick={() => setSuc(suc.includes(s.id) ? suc.filter((x) => x !== s.id) : [...suc, s.id])}>{s.nombre}</button>
          ))}</div>
        </div>
        <div className="dos-col">
          <label className="campo"><span>Tope de unidades (opcional)</span>
            <input inputMode="decimal" value={o.tope} onChange={(e) => setO({ ...o, tope: e.target.value.replace(/[^\d.]/g, "") })} placeholder="Sin tope: vale por las fechas" />
            <small className="suave">Al venderse estas unidades, la oferta se acaba sola: la caja avisa y cobra el precio normal. Se cuenta por sucursal.</small>
            {ref?.ultimaCompraOferta && (
              <button className="enlace pequeno" onClick={() => setO({ ...o, tope: String(Number(ref.ultimaCompraOferta!.unidades)) })}>
                Usar lo que compró en oferta ({num(ref.ultimaCompraOferta.unidades)} unidades)
              </button>
            )}
          </label>
          <div />
        </div>
        <label className="campo"><span>Solo para clientes de nivel</span>
          <select value={o.nivel} onChange={set("nivel")}><option value="">Todos</option><option value="1">Precio 1</option><option value="2">Precio 2</option><option value="3">Precio 3</option></select>
        </label>
        <Aviso texto={msg} />
        <div className="acciones-modal">
          <button className="boton fantasma" onClick={onCerrar}>Cancelar</button>
          <button className="boton primario" disabled={o.nombre.trim().length < 3 || (!productoId && !categoriaId)} onClick={crear}>Crear oferta</button>
        </div>
      </div>
    </div>
  );
}
