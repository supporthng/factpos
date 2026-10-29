import { useState } from "react";
import { api, rd, num, sesionActual } from "../api";
import { Aviso, Encabezado, SelectorAlmacen, SelectorProducto, SelectorSucursal, Tabla, useCatalogo, useDatos } from "../ui";

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
interface Linea { productoId: string; tipo: string; cantidad: string; nota: string }
const nueva = (): Linea => ({ productoId: "", tipo: "MERMA", cantidad: "", nota: "" });

export function Ajustes() {
  const { sucursales, productos } = useCatalogo();
  const [sucursalId, setSucursalIdCrudo] = useState(sucursales[0]?.id ?? "");
  const [almacenId, setAlmacenId] = useState("");
  const setSucursalId = (v: string) => { setSucursalIdCrudo(v); setAlmacenId(""); };
  const [motivo, setMotivo] = useState("");
  const [lineas, setLineas] = useState<Linea[]>([nueva()]);
  const [msg, setMsg] = useState<{ t: string; tipo: "error" | "ok" } | null>(null);
  const [filtro, setFiltro] = useState("");
  const historial = useDatos<any[]>(`/central/ajustes${filtro ? `?sucursalId=${filtro}` : ""}`);

  const set = (i: number, k: keyof Linea, v: string) => setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const validas = lineas.filter((l) => l.productoId && Number(l.cantidad) > 0);

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
      setLineas([nueva()]);
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
        <table className="tabla tabla-edicion">
          <thead><tr><th>Producto</th><th>Tipo</th><th className="der">Cantidad</th><th>Nota</th><th></th></tr></thead>
          <tbody>
            {lineas.map((l, i) => (
              <tr key={i}>
                <td style={{ minWidth: 260 }}><SelectorProducto valor={l.productoId} onCambio={(v) => set(i, "productoId", v)} /></td>
                <td><select className={l.tipo === "AJUSTE_ENTRADA" ? "texto-ok" : "texto-alerta"} value={l.tipo} onChange={(e) => set(i, "tipo", e.target.value)}>{TIPOS.map((t) => <option key={t.v} value={t.v}>{t.t}</option>)}</select></td>
                <td className="der"><input className="numero" inputMode="decimal" value={l.cantidad} onChange={(e) => set(i, "cantidad", e.target.value.replace(/[^\d.]/g, ""))} /></td>
                <td><input value={l.nota} onChange={(e) => set(i, "nota", e.target.value)} /></td>
                <td><button className="enlace" onClick={() => setLineas((ls) => ls.length > 1 ? ls.filter((_, j) => j !== i) : [nueva()])}>Quitar</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="fila-acciones">
          <button className="boton fantasma" onClick={() => setLineas([...lineas, nueva()])}>+ Agregar línea</button>
          <span className="flex" />
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
      {!productos.length && <p className="suave">No hay productos.</p>}
    </>
  );
}
