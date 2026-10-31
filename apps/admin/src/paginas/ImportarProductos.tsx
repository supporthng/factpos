import { useMemo, useRef, useState } from "react";
import { api } from "../api";
import { Aviso, useCatalogo } from "../ui";
import { useFuncionSeguridad } from "../seguridad";
import { aNumero, leerTabla, type Tabla } from "../leerTabla";

/**
 * Importar inventario desde Excel/CSV con asignación de columnas: el archivo del cliente casi nunca
 * tiene nuestro formato, así que se elige qué columna es cada dato. Crea los productos (con sus
 * 3 niveles de precio) y, si se pide, carga la existencia inicial con un ajuste que queda en el kardex.
 */
type Campo = "codigo" | "sku" | "nombre" | "categoria" | "marca" | "costo" | "p1" | "p2" | "p3" | "existencia" | "minimo";
const CAMPOS: { id: Campo; t: string; req?: boolean; adivina: RegExp }[] = [
  { id: "nombre", t: "Nombre del producto", req: true, adivina: /nombre|descrip|producto|art[ií]culo|item/i },
  { id: "p1", t: "Precio detalle", req: true, adivina: /detalle|precio ?1|p1|venta|precio|pvp|retail/i },
  { id: "p2", t: "Precio mayorista", adivina: /mayor|precio ?2|p2|whole/i },
  { id: "p3", t: "Precio distribuidor", adivina: /distrib|precio ?3|p3/i },
  { id: "costo", t: "Costo", adivina: /costo|cost|compra/i },
  { id: "codigo", t: "Código de barras", adivina: /barra|c[oó]d.*bar|ean|upc|gtin|barcode/i },
  { id: "sku", t: "SKU / código interno", adivina: /sku|referencia|c[oó]digo|code|^id$|ref/i },
  { id: "categoria", t: "Categoría", adivina: /categor|grupo|familia|depart|l[ií]nea/i },
  { id: "marca", t: "Marca", adivina: /marca|brand|fabric/i },
  { id: "existencia", t: "Existencia inicial", adivina: /exist|stock|cantidad|qty|inventario|saldo|disponible/i },
  { id: "minimo", t: "Existencia mínima", adivina: /m[ií]n|reorden|punto/i },
];
const CLAVE_MAPA = "factpos.importar.mapa";

interface Linea { fila: number; sku: string; nombre: string; codigo: string; categoria: string; marca: string; costo: number; p: [number, number, number]; existencia: number; minimo: number; error?: string; aviso?: string }

const guardarMapa = (m: Record<string, string>) => { try { localStorage.setItem(CLAVE_MAPA, JSON.stringify(m)); } catch { /* sin almacenamiento */ } };
const leerMapa = (): Record<string, string> => { try { return JSON.parse(localStorage.getItem(CLAVE_MAPA) ?? "{}"); } catch { return {}; } };

export function ImportarProductos({ aux, recargarAux, onCerrar, onTerminado }: {
  aux: { impuestos: { id: string; nombre: string; tasa: number }[]; categorias: { id: string; nombre: string }[] };
  recargarAux: () => void; onCerrar: () => void; onTerminado: () => void;
}) {
  const { sucursales } = useCatalogo();
  const { habilitada: puedeExistencia } = useFuncionSeguridad("agregar_existencia");
  const [paso, setPaso] = useState<1 | 2 | 3 | 4>(1);
  const [tabla, setTabla] = useState<Tabla>([]);
  const [nombreArchivo, setNombreArchivo] = useState("");
  const [filaTitulos, setFilaTitulos] = useState(true);
  const [mapa, setMapa] = useState<Partial<Record<Campo, number>>>({});
  const [incluye, setIncluye] = useState(true);
  const [impuestoId, setImpuestoId] = useState(aux.impuestos.find((i) => i.tasa === 0.18)?.id ?? aux.impuestos[0]?.id ?? "");
  const [crearCats, setCrearCats] = useState(true);
  const [sucursalId, setSucursalId] = useState(sucursales[0]?.id ?? "");
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" | "info" } | null>(null);
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [progreso, setProgreso] = useState(0);
  const [resultado, setResultado] = useState<{ creados: number; omitidos: number; fallidos: { fila: number; nombre: string; motivo: string }[]; stock: number } | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);

  const titulos = useMemo(() => (filaTitulos ? tabla[0] ?? [] : (tabla[0] ?? []).map((_, i) => `Columna ${i + 1}`)), [tabla, filaTitulos]);
  const datos = useMemo(() => (filaTitulos ? tabla.slice(1) : tabla), [tabla, filaTitulos]);
  const nCols = Math.max(0, ...tabla.slice(0, 50).map((f) => f.length));
  const tituloDe = (i: number) => titulos[i] || `Columna ${i + 1}`;

  const adivinar = (t: string[], conTitulos: boolean) => {
    const guardado = leerMapa();
    const m: Partial<Record<Campo, number>> = {};
    if (!conTitulos) return m;
    const usados = new Set<number>();
    for (const c of CAMPOS) {
      const porMemoria = t.findIndex((h, i) => guardado[h.toLowerCase()] === c.id && !usados.has(i));
      const idx = porMemoria >= 0 ? porMemoria : t.findIndex((h, i) => c.adivina.test(h) && !usados.has(i));
      if (idx >= 0) { m[c.id] = idx; usados.add(idx); }
    }
    return m;
  };

  const abrir = async (f: File | undefined) => {
    if (!f) return;
    setMsg(null);
    try {
      const t = await leerTabla(f);
      if (t.length < 2) return setMsg({ t: "El archivo no tiene filas de datos.", tipo: "error" });
      setTabla(t); setNombreArchivo(f.name); setFilaTitulos(true); setMapa(adivinar(t[0], true)); setPaso(2);
    } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
  };

  const cambiarTitulos = (v: boolean) => { setFilaTitulos(v); setMapa(adivinar(tabla[0] ?? [], v)); };
  const poner = (c: Campo, v: string) => setMapa((m) => { const x = { ...m }; if (v === "") delete x[c]; else x[c] = Number(v); return x; });

  const plantilla = () => {
    const csv = "﻿Codigo de barras,SKU,Nombre,Categoria,Marca,Costo,Precio detalle,Precio mayorista,Precio distribuidor,Existencia,Existencia minima\r\n7461234567890,RON-001,Ron Brugal Extra Viejo 700 ml,Licores,Brugal,520,780,740,700,24,6\r\n";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = "plantilla-productos-factpos.csv"; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  const revisar = async () => {
    if (mapa.nombre == null || mapa.p1 == null) return setMsg({ t: "Indique al menos la columna del nombre y la del precio detalle.", tipo: "error" });
    setMsg(null); setTrabajando(true);
    try {
      const m: Record<string, string> = {};
      for (const c of CAMPOS) if (mapa[c.id] != null && titulos[mapa[c.id]!]) m[titulos[mapa[c.id]!].toLowerCase()] = c.id;
      guardarMapa({ ...leerMapa(), ...m });

      const existentes = new Set((await api<{ sku: string }[]>("/central/productos?estado=todos")).map((p) => p.sku.toUpperCase()));
      const vistoSku = new Set<string>(), vistoCod = new Set<string>();
      const val = (f: string[], c: Campo) => (mapa[c] != null ? (f[mapa[c]!] ?? "").trim() : "");
      const num = (f: string[], c: Campo) => aNumero(val(f, c)) ?? 0;
      const out: Linea[] = datos.map((f, i) => {
        let codigo = val(f, "codigo");
        const l: Linea = {
          fila: i + (filaTitulos ? 2 : 1), sku: val(f, "sku").toUpperCase().slice(0, 30), nombre: val(f, "nombre").slice(0, 120), codigo: "",
          categoria: val(f, "categoria"), marca: val(f, "marca").slice(0, 60), costo: num(f, "costo"),
          p: [num(f, "p1"), num(f, "p2"), num(f, "p3")], existencia: Math.max(0, num(f, "existencia")), minimo: Math.max(0, num(f, "minimo")),
        };
        if (/^\d+(\.0+)?$/.test(codigo)) codigo = codigo.replace(/\.0+$/, "");
        if (/^\d{6,14}$/.test(codigo)) l.codigo = codigo; else if (codigo) l.aviso = "Código de barras inválido: se omitió";
        if (!l.sku) l.sku = l.codigo || "IMP" + String(l.fila).padStart(5, "0");
        if (l.nombre.length < 2) l.error = "Sin nombre";
        else if (l.p[0] <= 0) l.error = "Sin precio detalle";
        else if (existentes.has(l.sku)) l.error = "Ya existe un producto con ese SKU";
        else if (vistoSku.has(l.sku)) l.error = "SKU repetido en el archivo";
        else if (l.codigo && vistoCod.has(l.codigo)) l.error = "Código de barras repetido en el archivo";
        if (!l.error) { vistoSku.add(l.sku); if (l.codigo) vistoCod.add(l.codigo); }
        return l;
      });
      setLineas(out); setPaso(3);
    } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
    finally { setTrabajando(false); }
  };

  const buenas = lineas.filter((l) => !l.error);
  const malas = lineas.filter((l) => l.error);
  const conStock = buenas.filter((l) => l.existencia > 0);

  const importar = async () => {
    setTrabajando(true); setMsg(null); setPaso(4); setProgreso(0);
    const fallidos: { fila: number; nombre: string; motivo: string }[] = malas.map((l) => ({ fila: l.fila, nombre: l.nombre, motivo: l.error! }));
    try {
      // Categorías
      const cats = new Map(aux.categorias.map((c) => [c.nombre.trim().toLowerCase(), c.id]));
      if (crearCats) {
        for (const nombre of new Set(buenas.map((l) => l.categoria).filter(Boolean))) {
          if (cats.has(nombre.toLowerCase())) continue;
          try { cats.set(nombre.toLowerCase(), (await api<{ id: string }>("/central/categorias", { cuerpo: { nombre: nombre.slice(0, 40) } })).id); } catch { /* sigue sin categoría */ }
        }
        recargarAux();
      }
      // Productos, 5 a la vez
      const creados: { id: string; costo: number; existencia: number }[] = [];
      let hechos = 0;
      const cola = [...buenas];
      const trabajador = async () => {
        for (let l = cola.shift(); l; l = cola.shift()) {
          try {
            const r = await api<{ id: string }>("/central/productos", {
              metodo: "POST",
              cuerpo: {
                sku: l.sku, nombre: l.nombre, marca: l.marca || null, categoriaId: cats.get(l.categoria.toLowerCase()) ?? null,
                tipo: "INVENTARIABLE", impuestoId, precioIncluyeItbis: incluye, costoReferencia: String(l.costo),
                presentaciones: [{
                  nombre: "Unidad", factor: "1", codigos: l.codigo ? [l.codigo] : [],
                  precios: { "1": l.p[0].toFixed(2), "2": l.p[1] > 0 ? l.p[1].toFixed(2) : null, "3": l.p[2] > 0 ? l.p[2].toFixed(2) : null },
                  porcentajes: {},
                }],
                sucursales: sucursales.map((s) => ({ sucursalId: s.id, stockMinimo: String(l.minimo), stockMaximo: null, ubicacion: null, activo: true })),
              },
            });
            creados.push({ id: r.id, costo: l.costo, existencia: l.existencia });
          } catch (e) { fallidos.push({ fila: l.fila, nombre: l.nombre, motivo: (e as Error).message }); }
          setProgreso(Math.round((++hechos / buenas.length) * 100));
        }
      };
      await Promise.all(Array.from({ length: 5 }, trabajador));
      // Existencia inicial: un ajuste de entrada (queda en el kardex)
      let stock = 0;
      const conExistencia = sucursalId && puedeExistencia ? creados.filter((c) => c.existencia > 0) : [];
      for (let i = 0; i < conExistencia.length; i += 500) {
        const lote = conExistencia.slice(i, i + 500);
        try {
          await api("/central/productos-existencia", {
            metodo: "POST",
            cuerpo: {
              sucursalId, motivo: `Carga inicial por importación (${nombreArchivo})`.slice(0, 200),
              items: lote.map((c) => ({ productoId: c.id, cantidad: c.existencia.toFixed(3).replace(/\.?0+$/, "") || "0", ...(c.costo > 0 ? { costoUnitario: c.costo.toFixed(2) } : {}) })),
            },
          });
          stock += lote.length;
        } catch (e) { setMsg({ t: `Los productos se crearon, pero la existencia inicial falló: ${(e as Error).message}. Cárguela desde Ajustes.`, tipo: "error" }); }
      }
      setResultado({ creados: creados.length, omitidos: malas.length, fallidos, stock });
      onTerminado();
    } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
    finally { setTrabajando(false); }
  };

  const etapas = ["Archivo", "Columnas", "Revisión", "Importación"];
  return (
    <div className="fondo-modal" onMouseDown={(e) => e.target === e.currentTarget && !trabajando && onCerrar()}>
      <div className="modal ancho" role="dialog" aria-modal="true" aria-label="Importar productos">
        <div className="pr-cabecera">
          <div><h2>Importar inventario</h2><p className="suave">Desde Excel o CSV. Usted indica qué columna es cada dato; no tiene que cambiar su archivo.</p></div>
          <button className="boton fantasma" onClick={onCerrar} disabled={trabajando} aria-label="Cerrar">✕</button>
        </div>
        <div className="imp-pasos">{etapas.map((e, i) => <span key={e} className={paso === i + 1 ? "activo" : ""}>{i + 1}. {e}</span>)}</div>
        {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}

        {paso === 1 && (
          <>
            <div className="panel" style={{ textAlign: "center", padding: 32 }}>
              <p style={{ marginTop: 0 }}><b>Elija su archivo de inventario</b></p>
              <p className="suave pequeno">Formatos: Excel (.xlsx) o CSV. Se lee la primera hoja.</p>
              <input ref={entrada} type="file" accept=".xlsx,.xlsm,.csv,.tsv,.txt" hidden onChange={(e) => abrir(e.target.files?.[0])} />
              <button className="boton primario" onClick={() => entrada.current?.click()}>Elegir archivo…</button>
            </div>
            <p className="suave pequeno">¿Prefiere partir de nuestro formato? <button className="enlace" onClick={plantilla}>Descargar plantilla (CSV)</button></p>
          </>
        )}

        {paso === 2 && (
          <>
            <p className="suave pequeno" style={{ marginTop: 0 }}><b>{nombreArchivo}</b> · {datos.length} filas · {nCols} columnas</p>
            <label className="regla" style={{ marginBottom: 12 }}><input type="checkbox" checked={filaTitulos} onChange={(e) => cambiarTitulos(e.target.checked)} /><span><b>La primera fila son los títulos de las columnas</b></span></label>
            <div className="imp-mapa">
              <span className="cab">Dato en FactPOS</span><span className="cab">Columna de su archivo</span><span className="cab">Ejemplo</span>
              {CAMPOS.map((c) => (
                <FilaMapa key={c.id} c={c} valor={mapa[c.id]} nCols={nCols} tituloDe={tituloDe} ejemplo={(i) => datos.slice(0, 3).map((f) => f[i]).filter(Boolean).join("  ·  ")} poner={poner} />
              ))}
            </div>
            <div className="panel" style={{ marginTop: 14 }}>
              <div className="pr-fila pr-fila-costo">
                <label className="campo"><span>ITBIS de estos productos</span>
                  <select value={impuestoId} onChange={(e) => setImpuestoId(e.target.value)}>{aux.impuestos.map((i) => <option key={i.id} value={i.id}>{i.nombre}</option>)}</select></label>
                <label className="pr-check"><input type="checkbox" checked={incluye} onChange={(e) => setIncluye(e.target.checked)} /><span>Los precios del archivo ya incluyen ITBIS</span></label>
                <label className="pr-check"><input type="checkbox" checked={crearCats} onChange={(e) => setCrearCats(e.target.checked)} /><span>Crear las categorías que no existan</span></label>
              </div>
              {mapa.existencia != null && !puedeExistencia && (
                <p className="suave pequeno">La columna de existencia no se cargará: «Agregar existencia» está desactivado. Un administrador puede activarlo en Configuración › Seguridad.</p>
              )}
              {mapa.existencia != null && puedeExistencia && (
                <label className="campo" style={{ maxWidth: 360, marginBottom: 0 }}><span>Cargar la existencia inicial en</span>
                  <select value={sucursalId} onChange={(e) => setSucursalId(e.target.value)}>
                    <option value="">No cargar existencia</option>
                    {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                  </select></label>
              )}
            </div>
            <div className="acciones-modal">
              <button className="boton fantasma" onClick={() => setPaso(1)}>Cambiar archivo</button>
              <span className="pr-espacio" />
              <button className="boton primario" onClick={revisar} disabled={trabajando}>{trabajando ? "Revisando…" : "Revisar"}</button>
            </div>
          </>
        )}

        {paso === 3 && (
          <>
            <p style={{ marginTop: 0 }}><b>{buenas.length}</b> producto(s) listos para crear{conStock.length && sucursalId ? <> · <b>{conStock.length}</b> con existencia inicial</> : null}{malas.length ? <> · <span className="texto-alerta"><b>{malas.length}</b> con problemas (se omiten)</span></> : null}</p>
            <div className="imp-tabla">
              <table>
                <thead><tr><th>Fila</th><th>Nombre</th><th>Código</th><th>Costo</th><th>Detalle</th><th>Mayorista</th><th>Distribuidor</th><th>Exist.</th><th>Estado</th></tr></thead>
                <tbody>
                  {[...malas, ...buenas].slice(0, 200).map((l) => (
                    <tr key={l.fila} className={l.error ? "mala" : ""}>
                      <td>{l.fila}</td><td>{l.nombre}</td><td>{l.codigo}</td><td>{l.costo || ""}</td><td>{l.p[0] || ""}</td><td>{l.p[1] || ""}</td><td>{l.p[2] || ""}</td><td>{l.existencia || ""}</td>
                      <td>{l.error ? <span className="texto-alerta">{l.error}</span> : l.aviso ? <span className="texto-aviso">{l.aviso}</span> : <span className="texto-ok">Listo</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {lineas.length > 200 && <p className="suave pequeno">Se muestran 200 de {lineas.length} filas (primero las que tienen problemas).</p>}
            <div className="acciones-modal">
              <button className="boton fantasma" onClick={() => setPaso(2)}>← Volver a las columnas</button>
              <span className="pr-espacio" />
              <button className="boton primario" onClick={importar} disabled={!buenas.length}>Importar {buenas.length} producto(s)</button>
            </div>
          </>
        )}

        {paso === 4 && (
          <>
            {!resultado ? (
              <div className="panel" style={{ textAlign: "center", padding: 28 }}>
                <p style={{ marginTop: 0 }}><b>Importando… {progreso}%</b></p>
                <progress max={100} value={progreso} style={{ width: "100%" }} />
                <p className="suave pequeno">No cierre esta ventana.</p>
              </div>
            ) : (
              <>
                <Aviso tipo={resultado.fallidos.length ? "info" : "ok"} texto={`${resultado.creados} producto(s) creados${resultado.stock ? `, ${resultado.stock} con existencia inicial` : ""}.${resultado.fallidos.length ? ` ${resultado.fallidos.length} no se importaron.` : ""}`} />
                {resultado.fallidos.length > 0 && (
                  <div className="imp-tabla"><table><thead><tr><th>Fila</th><th>Producto</th><th>Motivo</th></tr></thead>
                    <tbody>{resultado.fallidos.map((f, i) => <tr key={i} className="mala"><td>{f.fila}</td><td>{f.nombre}</td><td>{f.motivo}</td></tr>)}</tbody></table></div>
                )}
                <div className="acciones-modal"><button className="boton primario" onClick={onCerrar}>Listo</button></div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function FilaMapa({ c, valor, nCols, tituloDe, ejemplo, poner }: {
  c: (typeof CAMPOS)[number]; valor: number | undefined; nCols: number; tituloDe: (i: number) => string; ejemplo: (i: number) => string; poner: (c: Campo, v: string) => void;
}) {
  return (
    <>
      <span>{c.t}{c.req && <em className="texto-alerta"> *</em>}</span>
      <select value={valor ?? ""} onChange={(e) => poner(c.id, e.target.value)} aria-label={c.t}>
        <option value="">{c.req ? "— elegir columna —" : "— no importar —"}</option>
        {Array.from({ length: nCols }, (_, i) => <option key={i} value={i}>{tituloDe(i)}</option>)}
      </select>
      <span className="imp-muestra">{valor != null ? ejemplo(valor) : ""}</span>
    </>
  );
}
