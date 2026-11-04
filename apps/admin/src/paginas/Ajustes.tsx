import { useEffect, useRef, useState } from "react";
import { api, rd, num, sesionActual } from "../api";
import { Aviso, Encabezado, SelectorAlmacen, SelectorSucursal, Tabla, useCatalogo, useDatos } from "../ui";

const TIPOS = [
  { v: "AJUSTE_ENTRADA", t: "Entrada (suma)", entrada: true },
  { v: "AJUSTE_SALIDA", t: "Salida (resta)" },
  { v: "MERMA", t: "Salida · merma / dañado" },
  { v: "VENCIMIENTO", t: "Salida · vencido" },
  { v: "CONSUMO_INTERNO", t: "Salida · consumo interno" },
];
/** Justificaciones frecuentes (se puede escribir cualquier otra) */
const MOTIVOS = [
  "Mercancía dañada o rota", "Producto vencido", "Diferencia encontrada en conteo físico", "Error al registrar una compra",
  "Mercancía recibida sin factura", "Devolución a proveedor", "Consumo interno de la tienda", "Robo o pérdida",
  "Muestra o degustación", "Corrección de existencia inicial",
];
interface Linea { productoId: string; nombre: string; sku: string; existencia: number; tipo: string; cantidad: string; nota: string }
interface Hallado { id: string; sku: string; nombre: string; existencia: string; categoria: string | null }
const SALIDAS = TIPOS.filter((t) => !t.entrada);

export function Ajustes() {
  const { sucursales } = useCatalogo();
  const [sucursalId, setSucursalIdCrudo] = useState(sucursales[0]?.id ?? "");
  const [almacenId, setAlmacenId] = useState("");
  const setSucursalId = (v: string) => { setSucursalIdCrudo(v); setAlmacenId(""); };
  const [motivo, setMotivo] = useState("");
  const [modo, setModo] = useState<"entrada" | "salida">("salida");
  const [tipoSalida, setTipoSalida] = useState("MERMA");
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [msg, setMsg] = useState<{ t: string; tipo: "error" | "ok" } | null>(null);
  const [filtro, setFiltro] = useState("");
  const historial = useDatos<any[]>(`/central/ajustes${filtro ? `?sucursalId=${filtro}` : ""}`);

  // Búsqueda por nombre, SKU o código de barras (el lector escribe el código y pulsa Enter)
  const [q, setQ] = useState("");
  const [halla, setHalla] = useState<Hallado[]>([]);
  const [sel, setSel] = useState(0);
  const caja = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const t = q.trim();
    if (!t) { setHalla([]); return; }
    let vivo = true;
    const h = setTimeout(() => {
      api<Hallado[]>(`/central/productos?q=${encodeURIComponent(t)}`).then((r) => { if (vivo) { setHalla(r.slice(0, 8)); setSel(0); } }).catch(() => {});
    }, 180);
    return () => { vivo = false; clearTimeout(h); };
  }, [q]);

  const tipoNuevo = modo === "entrada" ? "AJUSTE_ENTRADA" : tipoSalida;
  const agregar = (p: Hallado) => {
    setLineas((ls) => {
      const i = ls.findIndex((l) => l.productoId === p.id && (l.tipo === "AJUSTE_ENTRADA") === (tipoNuevo === "AJUSTE_ENTRADA"));
      if (i >= 0) return ls.map((l, j) => (j === i ? { ...l, cantidad: String((Number(l.cantidad) || 0) + 1) } : l));
      return [...ls, { productoId: p.id, nombre: p.nombre, sku: p.sku, existencia: Number(p.existencia), tipo: tipoNuevo, cantidad: "1", nota: "" }];
    });
    setQ(""); setHalla([]); caja.current?.focus();
  };
  const alEnter = () => {
    if (!halla.length) return;
    const exacto = halla.find((h) => h.sku.toLowerCase() === q.trim().toLowerCase());
    agregar(exacto ?? halla[sel] ?? halla[0]);
  };

  const set = (i: number, k: keyof Linea, v: string) => setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const validas = lineas.filter((l) => l.productoId && Number(l.cantidad) > 0);
  const excede = validas.filter((l) => l.tipo !== "AJUSTE_ENTRADA" && Number(l.cantidad) > l.existencia);

  const guardar = async () => {
    setMsg(null);
    try {
      const r = await api("/central/ajustes", {
        cuerpo: {
          sucursalId, almacenId: almacenId || undefined, usuarioId: sesionActual().usuarioId, motivo: motivo.trim(),
          items: validas.map((l) => ({ productoId: l.productoId, tipo: l.tipo, cantidad: l.cantidad, nota: l.nota || undefined })),
        },
      });
      setMsg({ t: `Ajuste #${r.numero} aplicado · ${r.lineas} línea(s) · ${rd(r.valor)} al costo`, tipo: "ok" });
      setLineas([]);
      setMotivo("");
      historial.recargar();
    } catch (e) {
      setMsg({ t: (e as Error).message, tipo: "error" });
    }
  };

  return (
    <>
      <Encabezado titulo="Ajustes de inventario" descripcion="Entradas y salidas de mercancía fuera de compras y ventas: mermas, vencidos, consumo interno y correcciones. Cada ajuste exige una justificación y queda en el kardex con su responsable." />
      <div className="panel">
        <div className="tres-col">
          <label className="campo"><span>Sucursal</span><SelectorSucursal valor={sucursalId} onCambio={setSucursalId} todas={false} /></label>
          <label className="campo"><span>Almacén</span><SelectorAlmacen sucursalId={sucursalId} valor={almacenId} onCambio={setAlmacenId} /></label>
          <label className="campo"><span>Justificación del ajuste (obligatoria)</span>
            <input list="motivos-ajuste" value={motivo} maxLength={200} onChange={(e) => setMotivo(e.target.value)} placeholder="Elija o escriba: ej. botellas rotas al descargar" />
            <datalist id="motivos-ajuste">{MOTIVOS.map((m) => <option key={m} value={m} />)}</datalist>
          </label>
        </div>
        <div className="ajuste-modo">
          <button className={modo === "entrada" ? "activo entrada" : ""} onClick={() => setModo("entrada")}>＋ Agregar mercancía</button>
          <button className={modo === "salida" ? "activo salida" : ""} onClick={() => setModo("salida")}>− Retirar mercancía</button>
          {modo === "salida" && (
            <select value={tipoSalida} onChange={(e) => setTipoSalida(e.target.value)} aria-label="Motivo de la salida">
              {SALIDAS.map((t) => <option key={t.v} value={t.v}>{t.t}</option>)}
            </select>
          )}
        </div>
        <div className="ajuste-buscar">
          <input ref={caja} autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Escanee el código de barras o escriba nombre / SKU y pulse Enter"
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); alEnter(); }
              else if (e.key === "ArrowDown") { e.preventDefault(); setSel((x) => Math.min(x + 1, halla.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setSel((x) => Math.max(x - 1, 0)); }
            }} />
          {halla.length > 0 && (
            <div className="desplegable">
              {halla.map((h, i) => (
                <button key={h.id} className={i === sel ? "sel" : ""} onMouseDown={() => agregar(h)}>
                  <span>{h.nombre} <span className="suave">{h.sku}</span></span><b>{num(h.existencia, Number(h.existencia) % 1 ? 2 : 0)} en existencia</b>
                </button>
              ))}
            </div>
          )}
        </div>
        {lineas.length === 0
          ? <p className="suave ajuste-vacio">Escanee o busque un producto para agregarlo. Si repite el mismo, se suma la cantidad.</p>
          : (
            <table className="tabla tabla-edicion">
              <thead><tr><th>Producto</th><th className="der">Existencia</th><th>Tipo</th><th className="der">Cantidad</th><th>Nota</th><th></th></tr></thead>
              <tbody>
                {lineas.map((l, i) => {
                  const sale = l.tipo !== "AJUSTE_ENTRADA";
                  const mal = sale && Number(l.cantidad) > l.existencia;
                  return (
                    <tr key={l.productoId + l.tipo}>
                      <td><b>{l.nombre}</b> <span className="suave">{l.sku}</span></td>
                      <td className="der">{num(l.existencia, l.existencia % 1 ? 2 : 0)}</td>
                      <td><select className={sale ? "texto-alerta" : "texto-ok"} value={l.tipo} onChange={(e) => set(i, "tipo", e.target.value)}>{TIPOS.map((t) => <option key={t.v} value={t.v}>{t.t}</option>)}</select></td>
                      <td className="der" style={{ width: 150 }}>
                        <span className="paso">
                          <button type="button" onClick={() => set(i, "cantidad", String(Math.max(0, (Number(l.cantidad) || 0) - 1)))}>−</button>
                          <input className={"numero" + (mal ? " invalido" : "")} inputMode="decimal" value={l.cantidad} onChange={(e) => set(i, "cantidad", e.target.value.replace(/[^\d.]/g, ""))} onFocus={(e) => e.target.select()} />
                          <button type="button" onClick={() => set(i, "cantidad", String((Number(l.cantidad) || 0) + 1))}>＋</button>
                        </span>
                        {mal && <small className="texto-alerta">Mayor que la existencia</small>}
                      </td>
                      <td><input value={l.nota} onChange={(e) => set(i, "nota", e.target.value)} /></td>
                      <td><button className="enlace" onClick={() => { setLineas((ls) => ls.filter((_, j) => j !== i)); caja.current?.focus(); }}>Quitar</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        <div className="fila-acciones">
          {lineas.length > 0 && <button className="boton fantasma" onClick={() => setLineas([])}>Vaciar lista</button>}
          <span className="flex" />
          {excede.length > 0 && <span className="texto-alerta pequeno">{excede.length} salida(s) superan la existencia</span>}
          {validas.length > 0 && motivo.trim().length < 3 && <span className="suave pequeno">Escriba la justificación para aplicar</span>}
          <button className="boton primario" disabled={!validas.length || motivo.trim().length < 3} onClick={guardar}>
            Aplicar ajuste{validas.length ? ` · ${validas.filter((l) => l.tipo === "AJUSTE_ENTRADA").length} entrada(s), ${validas.filter((l) => l.tipo !== "AJUSTE_ENTRADA").length} salida(s)` : ""}
          </button>
        </div>
        {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}
      </div>

      <div className="encabezado-sub">
        <h2>Historial</h2>
        <SelectorSucursal valor={filtro} onCambio={setFiltro} />
      </div>
      <Tabla
        filas={historial.datos ?? []}
        clave={(f) => f.id}
        vacio="Todavía no hay ajustes"
        columnas={[
          { titulo: "#", valor: (f) => f.numero },
          { titulo: "Fecha", valor: (f) => new Date(f.creadoEn).toLocaleString("es-DO") },
          { titulo: "Sucursal", valor: (f) => f.sucursal },
          { titulo: "Almacén", valor: (f) => f.almacen },
          { titulo: "Origen", valor: (f) => <span className="pastilla">{f.origen === "CONTEO" ? "Conteo" : "Manual"}</span> },
          { titulo: "Justificación", valor: (f) => f.motivo },
          { titulo: "Usuario", valor: (f) => f.usuario },
          { titulo: "Líneas", valor: (f) => num(f.lineas), der: true },
          { titulo: "Valor", valor: (f) => <span className={Number(f.valor) < 0 ? "texto-alerta" : ""}>{rd(f.valor)}</span>, der: true },
        ]}
      />
          </>
  );
}
