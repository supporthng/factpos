import { useMemo, useRef, useState } from "react";
import { api, descargarCsv, num } from "../api";
import { Aviso, SelectorSucursal, useCatalogo } from "../ui";
import { aNumero, leerTabla, type Tabla } from "../leerTabla";

/**
 * Actualizar la existencia con un Excel/CSV: por SKU o código de barras.
 *  - «Fijar»: la cantidad del archivo es la existencia real (conteo); se ajusta la diferencia.
 *  - «Sumar»: la cantidad del archivo se suma (o se resta, si es negativa) a la existencia actual.
 * Se ve primero qué cambiaría; al aplicar queda un ajuste en el kardex con el nombre de quien lo hizo.
 */
interface Resuelta { fila: number; sku?: string; nombre?: string; actual: number; nuevo: number; diferencia: number; error?: string }
const CAMPOS = [
  { id: "sku", t: "SKU / código interno", re: /sku|referencia|c[oó]digo|code|^id$|ref/i },
  { id: "codigo", t: "Código de barras", re: /barra|ean|upc|gtin|barcode/i },
  { id: "cantidad", t: "Cantidad", re: /exist|stock|cantidad|qty|conteo|contad|saldo/i },
  { id: "costo", t: "Costo (solo entradas, opcional)", re: /costo|cost/i },
] as const;
type Campo = (typeof CAMPOS)[number]["id"];

export function ActualizarInventarioExcel({ onCerrar, onTerminado }: { onCerrar: () => void; onTerminado: () => void }) {
  const { sucursales } = useCatalogo();
  const [sucursalId, setSucursalId] = useState(sucursales[0]?.id ?? "");
  const [modo, setModo] = useState<"FIJAR" | "SUMAR">("FIJAR");
  const [motivo, setMotivo] = useState("");
  const [tabla, setTabla] = useState<Tabla>([]);
  const [archivo, setArchivo] = useState("");
  const [mapa, setMapa] = useState<Partial<Record<Campo, number>>>({});
  const [vista, setVista] = useState<Resuelta[] | null>(null);
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" | "info" } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);

  const titulos = tabla[0] ?? [];
  const datos = useMemo(() => tabla.slice(1), [tabla]);

  const abrir = async (f?: File) => {
    if (!f) return;
    setMsg(null); setVista(null);
    try {
      const t = (await leerTabla(f)).filter((r) => r.some((c) => c.trim()));
      if (t.length < 2) return setMsg({ t: "El archivo no tiene filas con datos.", tipo: "error" });
      setTabla(t); setArchivo(f.name);
      const m: Partial<Record<Campo, number>> = {};
      for (const c of CAMPOS) { const i = t[0].findIndex((h, k) => c.re.test(h) && !Object.values(m).includes(k)); if (i >= 0) m[c.id] = i; }
      setMapa(m);
    } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
  };

  const filas = () => datos.map((r, i) => {
    const cant = mapa.cantidad != null ? aNumero(r[mapa.cantidad] ?? "") : null;
    return { fila: i + 2, sku: mapa.sku != null ? (r[mapa.sku] ?? "").trim() || undefined : undefined, codigo: mapa.codigo != null ? (r[mapa.codigo] ?? "").trim() || undefined : undefined,
      cantidad: cant, costo: mapa.costo != null ? aNumero(r[mapa.costo] ?? "") ?? undefined : undefined };
  });
  const cuerpo = () => {
    const todas = filas();
    const buenas = todas.filter((f) => f.cantidad !== null && (f.sku || f.codigo));
    return { omitidas: todas.length - buenas.length, cuerpo: { sucursalId, modo, filas: buenas.map((f) => ({ fila: f.fila, sku: f.sku, codigo: f.codigo, cantidad: f.cantidad!, ...(f.costo ? { costo: f.costo } : {}) })) } };
  };
  const listo = (mapa.sku != null || mapa.codigo != null) && mapa.cantidad != null && !!sucursalId;

  const revisar = async () => {
    setOcupado(true); setMsg(null);
    try {
      const { cuerpo: c, omitidas } = cuerpo();
      if (!c.filas.length) throw new Error("Ninguna fila tiene SKU/código y una cantidad válida.");
      const r = await api<{ filas: Resuelta[] }>("/central/inventario/excel/vista", { metodo: "POST", cuerpo: c });
      setVista(r.filas);
      if (omitidas) setMsg({ t: `${omitidas} fila(s) sin código o sin cantidad se omitieron.`, tipo: "info" });
    } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
    setOcupado(false);
  };
  const cambios = (vista ?? []).filter((f) => !f.error && f.diferencia !== 0);
  const errores = (vista ?? []).filter((f) => f.error);
  const aplicar = async () => {
    setOcupado(true); setMsg(null);
    try {
      const r = await api<{ numero: string; productos: number }>("/central/inventario/excel/aplicar", { metodo: "POST", cuerpo: { ...cuerpo().cuerpo, motivo: motivo.trim() } });
      setMsg({ t: `Listo: ajuste Nº ${r.numero} con ${r.productos} producto(s) actualizados.`, tipo: "ok" });
      setVista(null); setTabla([]); onTerminado();
    } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
    setOcupado(false);
  };

  return (
    <div className="fondo-modal" onMouseDown={(e) => e.target === e.currentTarget && !ocupado && onCerrar()}>
      <div className="modal ancho" role="dialog" aria-modal="true" aria-label="Actualizar inventario con Excel">
        <div className="pr-cabecera">
          <div><h2>Actualizar inventario con Excel</h2><p className="suave">Suba un archivo con SKU o código de barras y la cantidad. Primero verá qué cambiaría.</p></div>
          <button className="boton fantasma" onClick={onCerrar} disabled={ocupado} aria-label="Cerrar">✕</button>
        </div>
        {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}
        <div className="fila-acciones" style={{ flexWrap: "wrap" }}>
          <SelectorSucursal todas={false} valor={sucursalId} onCambio={(v) => { setSucursalId(v); setVista(null); }} />
          <select value={modo} onChange={(e) => { setModo(e.target.value as "FIJAR" | "SUMAR"); setVista(null); }}>
            <option value="FIJAR">Fijar: la cantidad del archivo es la existencia real</option>
            <option value="SUMAR">Sumar: la cantidad se suma a la existencia actual</option>
          </select>
          <button className="enlace" disabled={!sucursalId} onClick={() => descargarCsv(`/central/inventario/plantilla?sucursalId=${sucursalId}`, "inventario-plantilla")}>Descargar existencias actuales (para editar)</button>
        </div>
        <div className="panel" style={{ textAlign: "center", padding: 20 }}>
          <input ref={entrada} type="file" accept=".xlsx,.xlsm,.csv,.tsv,.txt" hidden onChange={(e) => abrir(e.target.files?.[0])} />
          <button className="boton primario" onClick={() => entrada.current?.click()}>{archivo ? "Elegir otro archivo…" : "Elegir archivo…"}</button>
          {archivo && <p className="suave pequeno" style={{ marginBottom: 0 }}><b>{archivo}</b> · {datos.length} filas</p>}
        </div>
        {tabla.length > 0 && <>
          <div className="imp-mapa">
            <span className="cab">Dato</span><span className="cab">Columna de su archivo</span><span className="cab">Ejemplo</span>
            {CAMPOS.map((c) => (
              <div key={c.id} style={{ display: "contents" }}>
                <span>{c.t}</span>
                <select value={mapa[c.id] ?? ""} onChange={(e) => { setVista(null); setMapa({ ...mapa, [c.id]: e.target.value === "" ? undefined : Number(e.target.value) }); }}>
                  <option value="">— no usar —</option>
                  {titulos.map((t, i) => <option key={i} value={i}>{t || `Columna ${i + 1}`}</option>)}
                </select>
                <span className="suave pequeno">{mapa[c.id] != null ? datos.slice(0, 3).map((f) => f[mapa[c.id]!]).filter(Boolean).join(" · ") : ""}</span>
              </div>
            ))}
          </div>
          <div className="fila-acciones"><span className="flex" /><button className="boton primario" disabled={!listo || ocupado} onClick={revisar}>Revisar cambios</button></div>
        </>}
        {vista && <>
          <p><b>{cambios.length}</b> producto(s) cambiarían{errores.length ? <> · <span className="texto-alerta"><b>{errores.length}</b> con problemas (se omiten)</span></> : null} · {vista.length - cambios.length - errores.length} sin diferencia</p>
          <div style={{ maxHeight: 260, overflow: "auto" }}>
            <table className="tabla">
              <thead><tr><th>Fila</th><th>Producto</th><th className="der">Actual</th><th className="der">Nueva</th><th className="der">Diferencia</th></tr></thead>
              <tbody>
                {[...errores, ...cambios].slice(0, 300).map((f) => (
                  <tr key={f.fila}>
                    <td>{f.fila}</td><td>{f.nombre ?? "—"}{f.sku && <span className="suave"> · {f.sku}</span>}{f.error && <div className="texto-alerta pequeno">{f.error}</div>}</td>
                    <td className="der">{f.error ? "" : num(f.actual, 3)}</td><td className="der">{f.error ? "" : num(f.nuevo, 3)}</td>
                    <td className="der">{f.error ? "" : `${f.diferencia > 0 ? "+" : ""}${num(f.diferencia, 3)}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {cambios.length > 0 && <>
            <label className="campo"><span>Motivo (obligatorio)</span><input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej. Conteo físico de octubre" /></label>
            <div className="fila-acciones"><span className="flex" /><button className="boton primario" disabled={ocupado || motivo.trim().length < 3} onClick={aplicar}>Aplicar {cambios.length} cambio(s)</button></div>
          </>}
        </>}
      </div>
    </div>
  );
}
