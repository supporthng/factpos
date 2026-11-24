import { useEffect, useState } from "react";
import { api, num, sesionActual } from "../api";
import { Aviso, Encabezado, useDatos } from "../ui";

/**
 * Farmacia: vencimientos con aviso escalonado (30, 60 y 90 días; lo vencido no se factura), ubicación de cada producto en la tramería
 * (estante › nivel › posición) y búsqueda por nombre, código o principio activo para saber dónde está y qué sustitutos hay.
 */
type Nivel = "VENCIDO" | "30" | "60" | "90";
interface Resumen { VENCIDO: { lotes: number; unidades: string }; "30": { lotes: number; unidades: string }; "60": { lotes: number; unidades: string }; "90": { lotes: number; unidades: string } }
interface Venc { productoId: string; sku: string; nombre: string; principioActivo: string | null; lote: string; vence: string; dias: number; cantidad: string; almacen: string; almacenId: string; sucursalId: string; nivel: Nivel; ubicacion: string | null }
interface Ubic { id: string; almacenId: string; almacen: string; estante: string; nivel: number; posicion: string; activo: boolean; productos: number }
interface Hallado { id: string; sku: string; nombre: string; principioActivo: string | null; laboratorio: string | null; controlado: boolean; requiereReceta: boolean; existencia: string; vencido: string; ubicacion: string | null }

const TITULO: Record<Nivel, string> = { VENCIDO: "Vencidos", "30": "Vencen en 30 días", "60": "En 31 a 60 días", "90": "En 61 a 90 días" };
const COLOR: Record<Nivel, string> = { VENCIDO: "#b91c1c", "30": "#c2410c", "60": "#b45309", "90": "#4d7c0f" };
const cola = (l: string) => (l === "" ? "" : l);

export function Farmacia() {
  const [vista, setVista] = useState<"vencimientos" | "ubicaciones" | "buscar" | "recetas">("vencimientos");
  return (
    <>
      <Encabezado titulo="Farmacia" descripcion="Vencimientos con aviso, ubicación de cada producto en la tramería y búsqueda por principio activo. Lo vencido no se factura." />
      <div className="pestanas">
        <button className={vista === "vencimientos" ? "activa" : ""} onClick={() => setVista("vencimientos")}>Vencimientos</button>
        <button className={vista === "ubicaciones" ? "activa" : ""} onClick={() => setVista("ubicaciones")}>Tramería (ubicaciones)</button>
        <button className={vista === "buscar" ? "activa" : ""} onClick={() => setVista("buscar")}>¿Dónde está?</button>
        <button className={vista === "recetas" ? "activa" : ""} onClick={() => setVista("recetas")}>Recetas</button>
      </div>
      {vista === "vencimientos" ? <Vencimientos /> : vista === "ubicaciones" ? <Ubicaciones /> : vista === "buscar" ? <Buscar /> : <Recetas />}
    </>
  );
}

function Vencimientos() {
  const [nivel, setNivel] = useState<Nivel | "">("");
  const res = useDatos<Resumen>("/central/farmacia/resumen", []);
  const lista = useDatos<Venc[]>(`/central/farmacia/vencimientos${nivel ? `?nivel=${nivel}` : ""}`, [nivel]);
  const niveles: Nivel[] = ["VENCIDO", "30", "60", "90"];
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" } | null>(null);
  const [dando, setDando] = useState("");
  /** Baja por vencimiento: saca del inventario todo lo vencido de ese producto en ese almacén (queda en el kardex y en Ajustes) */
  const darBaja = async (v: Venc) => {
    const vencidas = (lista.datos ?? []).filter((x) => x.nivel === "VENCIDO" && x.productoId === v.productoId && x.almacenId === v.almacenId);
    const total = vencidas.reduce((a, x) => a + Number(x.cantidad), 0);
    if (!confirm(`Dar de baja ${num(total, 0)} unidad(es) vencida(s) de ${v.nombre} (${vencidas.map((x) => x.lote).join(", ")}).\n\nSalen del inventario por vencimiento. ¿Continuar?`)) return;
    setDando(v.productoId + v.almacenId); setMsg(null);
    try {
      await api("/central/ajustes", { cuerpo: { sucursalId: v.sucursalId, almacenId: v.almacenId, usuarioId: sesionActual().usuarioId, motivo: `Baja por vencimiento: lote ${vencidas.map((x) => x.lote).join(", ")}`,
        items: [{ productoId: v.productoId, tipo: "VENCIMIENTO", cantidad: total.toFixed(3) }] } });
      setMsg({ t: `Baja registrada: ${num(total, 0)} unidad(es) de ${v.nombre}.`, tipo: "ok" });
      lista.recargar(); res.recargar();
    } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
    setDando("");
  };
  const primeraVencida = new Set<string>();
  return (
    <>
      <div className="cifras" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10, margin: "10px 0" }}>
        {niveles.map((n) => {
          const d = res.datos?.[n];
          return (
            <button key={n} className="tarjeta" onClick={() => setNivel(nivel === n ? "" : n)}
              style={{ textAlign: "left", cursor: "pointer", borderLeft: `5px solid ${COLOR[n]}`, outline: nivel === n ? `2px solid ${COLOR[n]}` : undefined }}>
              <div className="suave">{TITULO[n]}</div>
              <div style={{ fontSize: 26, fontWeight: 700, color: COLOR[n] }}>{d ? d.lotes : "…"} <span style={{ fontSize: 13, fontWeight: 400 }}>lote(s)</span></div>
              <div className="suave pequeno">{d ? `${num(d.unidades, 0)} unidades` : ""}</div>
            </button>
          );
        })}
      </div>
      {nivel === "VENCIDO" && <Aviso tipo="info" texto="Estos lotes ya no se pueden facturar. Retírelos de la tramería y regístrelos en Ajustes como baja por vencimiento." />}
      <Aviso texto={lista.error} />
      {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}
      <div className="tarjeta" style={{ overflowX: "auto" }}>
        <table className="tabla">
          <thead><tr><th>Producto</th><th>Lote</th><th>Vence</th><th className="der">Días</th><th className="der">Cantidad</th><th>Ubicación</th><th>Almacén</th><th></th></tr></thead>
          <tbody>
            {(lista.datos ?? []).length === 0 && <tr><td colSpan={8} className="suave">{lista.cargando ? "Cargando…" : "No hay lotes en este grupo."}</td></tr>}
            {(lista.datos ?? []).map((v, i) => (
              <tr key={`${v.productoId}-${v.lote}-${i}`}>
                <td><b>{v.nombre}</b><div className="suave pequeno">{v.sku}{v.principioActivo ? ` · ${v.principioActivo}` : ""}</div></td>
                <td>{v.lote}</td>
                <td>{v.vence}</td>
                <td className="der" style={{ color: COLOR[v.nivel], fontWeight: 700 }}>{v.dias < 0 ? `venció hace ${-v.dias}` : v.dias}</td>
                <td className="der">{num(v.cantidad, 0)}</td>
                <td>{cola(v.ubicacion ?? "") || <span className="suave">sin ubicación</span>}</td>
                <td className="suave">{v.almacen}</td>
                <td className="der">{v.nivel === "VENCIDO" && !primeraVencida.has(v.productoId + v.almacenId) && (primeraVencida.add(v.productoId + v.almacenId), true)
                  && <button className="boton chico" disabled={dando === v.productoId + v.almacenId} onClick={() => darBaja(v)}>Dar de baja</button>}</td>
              </tr>))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Ubicaciones() {
  const lista = useDatos<Ubic[]>("/central/farmacia/ubicaciones", []);
  const almacenes = useDatos<{ id: string; nombre: string }[]>("/central/farmacia/almacenes", []);
  const [almacenId, setAlmacenId] = useState("");
  const [estante, setEstante] = useState("");
  const [nivel, setNivel] = useState("1");
  const [posiciones, setPosiciones] = useState("10");
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" } | null>(null);
  useEffect(() => { if (!almacenId && almacenes.datos?.[0]) setAlmacenId(almacenes.datos[0].id); }, [almacenes.datos, almacenId]);
  const crear = async () => {
    setMsg(null);
    try {
      const r = await api<{ creadas: number }>("/central/farmacia/ubicaciones", { cuerpo: { almacenId, estante, nivel: Number(nivel), posiciones: Number(posiciones) } });
      setMsg({ t: `Listo: ${r.creadas} ubicación(es) nueva(s) en el estante ${estante.toUpperCase()}, nivel ${nivel}.`, tipo: "ok" });
      lista.recargar();
    } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
  };
  const alternar = async (u: Ubic) => {
    try { await api(`/central/farmacia/ubicaciones/${u.id}`, { metodo: "PUT", cuerpo: { activo: !u.activo } }); lista.recargar(); } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
  };
  // Se agrupan por estante para verlas como la tramería: un estante, sus niveles y sus posiciones
  const porEstante = new Map<string, Ubic[]>();
  for (const u of lista.datos ?? []) { const k = `${u.almacen} · Estante ${u.estante}`; porEstante.set(k, [...(porEstante.get(k) ?? []), u]); }
  return (
    <>
      <div className="tarjeta" style={{ marginTop: 10 }}>
        <b>Crear ubicaciones</b>
        <p className="suave" style={{ margin: "4px 0 8px" }}>Cada ubicación es estante › nivel › posición (por ejemplo A-2-5 es el estante A, nivel 2, posición 5). Escriba cuántas posiciones tiene ese nivel y se crean todas de una vez. Luego, en la ficha de cada producto, elija dónde está.</p>
        <div className="panel cab-compra" style={{ flexWrap: "wrap" }}>
          <label className="campo"><span>Almacén</span><select value={almacenId} onChange={(e) => setAlmacenId(e.target.value)}>{(almacenes.datos ?? []).map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}</select></label>
          <label className="campo"><span>Estante</span><input value={estante} onChange={(e) => setEstante(e.target.value)} placeholder="A" style={{ width: 90 }} /></label>
          <label className="campo"><span>Nivel</span><input className="numero" inputMode="numeric" value={nivel} onChange={(e) => setNivel(e.target.value.replace(/\D/g, ""))} style={{ width: 80 }} /></label>
          <label className="campo"><span>Posiciones</span><input className="numero" inputMode="numeric" value={posiciones} onChange={(e) => setPosiciones(e.target.value.replace(/\D/g, ""))} style={{ width: 90 }} /></label>
          <button className="boton primario" disabled={!almacenId || !estante.trim() || !Number(nivel) || !Number(posiciones)} onClick={crear}>Crear</button>
        </div>
        {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}
      </div>
      <Aviso texto={lista.error} />
      {[...porEstante.entries()].map(([titulo, us]) => (
        <div key={titulo} className="tarjeta" style={{ marginTop: 10 }}>
          <b>{titulo}</b>
          {[...new Set(us.map((u) => u.nivel))].sort((a, b) => a - b).map((nv) => (
            <div key={nv} style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginTop: 8 }}>
              <span className="suave" style={{ width: 70 }}>Nivel {nv}</span>
              {us.filter((u) => u.nivel === nv).map((u) => (
                <button key={u.id} className="boton chico" onClick={() => alternar(u)} title={u.activo ? "Clic para desactivar" : "Clic para activar"}
                  style={{ opacity: u.activo ? 1 : 0.4, textDecoration: u.activo ? undefined : "line-through" }}>
                  {u.posicion}{u.productos > 0 ? ` · ${u.productos}` : ""}
                </button>))}
            </div>))}
        </div>))}
      {(lista.datos ?? []).length === 0 && !lista.cargando && <p className="suave">Todavía no hay ubicaciones: cree la primera arriba.</p>}
    </>
  );
}

function Buscar() {
  const [q, setQ] = useState("");
  const [lista, setLista] = useState<Hallado[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (q.trim().length < 2) { setLista([]); return; }
    const t = setTimeout(() => api<Hallado[]>(`/central/farmacia/buscar?q=${encodeURIComponent(q.trim())}`).then((r) => { setLista(r); setError(""); }).catch((e) => setError((e as Error).message)), 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="tarjeta" style={{ marginTop: 10 }}>
      <label className="campo"><span>Nombre, código o principio activo</span><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ej. amoxicilina" autoFocus /></label>
      <Aviso texto={error} />
      <table className="tabla" style={{ marginTop: 8 }}>
        <thead><tr><th>Producto</th><th>Principio activo</th><th className="der">Existencia</th><th>Ubicación</th></tr></thead>
        <tbody>
          {q.trim().length >= 2 && lista.length === 0 && <tr><td colSpan={4} className="suave">No se encontró.</td></tr>}
          {lista.map((p) => (
            <tr key={p.id}>
              <td><b>{p.nombre}</b> {p.controlado && <span style={{ color: "#b91c1c" }}>· controlado</span>}{!p.controlado && p.requiereReceta && <span style={{ color: "#b45309" }}>· con receta</span>}
                <div className="suave pequeno">{p.sku}{p.laboratorio ? ` · ${p.laboratorio}` : ""}</div></td>
              <td>{p.principioActivo ?? <span className="suave">—</span>}</td>
              <td className="der">{num(p.existencia, 0)}{Number(p.vencido) > 0 && <div style={{ color: "#b91c1c" }} className="pequeno">{num(p.vencido, 0)} vencida(s)</div>}</td>
              <td>{p.ubicacion ?? <span className="suave">sin ubicación</span>}</td>
            </tr>))}
        </tbody>
      </table>
    </div>
  );
}

function Recetas() {
  const hoy = new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10);
  const [desde, setDesde] = useState(hoy.slice(0, 8) + "01");
  const [hasta, setHasta] = useState(hoy);
  const d = useDatos<{ ventaId: string; factura: string; fecha: string; paciente: string; medico: string; exequatur: string | null; fechaReceta: string | null; sucursal: string; vendedor: string | null; productos: string | null }[]>(
    `/central/farmacia/recetas?desde=${desde}&hasta=${hasta}`, [desde, hasta]);
  const csv = () => {
    const celda = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const filas = [["Fecha", "Factura", "Paciente", "Médico", "Exequátur", "Fecha de la receta", "Productos", "Sucursal", "Vendedor"],
      ...(d.datos ?? []).map((r) => [r.fecha, r.factura, r.paciente, r.medico, r.exequatur, r.fechaReceta, r.productos, r.sucursal, r.vendedor])];
    const url = URL.createObjectURL(new Blob(["\ufeff" + filas.map((f) => f.map(celda).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `recetas-${desde}-a-${hasta}.csv`; a.click(); URL.revokeObjectURL(url);
  };
  return (
    <div className="tarjeta" style={{ marginTop: 10, overflowX: "auto" }}>
      <div className="panel cab-compra" style={{ flexWrap: "wrap" }}>
        <label className="campo"><span>Desde</span><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
        <label className="campo"><span>Hasta</span><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
        <button className="boton" disabled={!(d.datos ?? []).length} onClick={csv}>Descargar CSV</button>
      </div>
      <Aviso texto={d.error} />
      <table className="tabla">
        <thead><tr><th>Fecha</th><th>Factura</th><th>Paciente</th><th>Médico</th><th>Exequátur</th><th>Receta del</th><th>Medicamentos</th></tr></thead>
        <tbody>
          {(d.datos ?? []).length === 0 && <tr><td colSpan={7} className="suave">{d.cargando ? "Cargando…" : "No hay recetas en esas fechas."}</td></tr>}
          {(d.datos ?? []).map((r) => (
            <tr key={r.ventaId}><td>{r.fecha}</td><td>#{r.factura}</td><td>{r.paciente}</td><td>{r.medico}</td><td>{r.exequatur ?? "—"}</td><td>{r.fechaReceta ?? "—"}</td><td>{r.productos ?? ""}</td></tr>))}
        </tbody>
      </table>
    </div>
  );
}

/** Datos del medicamento dentro de la ficha del producto (solo en farmacias): principio activo, laboratorio, controlado / con receta y ubicación. */
export function FarmaciaProducto({ id }: { id: string | null }) {
  const [esFarmacia, setEsFarmacia] = useState(false);
  const [f, setF] = useState<{ principioActivo: string | null; laboratorio: string | null; controlado: boolean; requiereReceta: boolean; ubicaciones: string[] } | null>(null);
  const [ubic, setUbic] = useState<Ubic[]>([]);
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" } | null>(null);
  useEffect(() => { api<{ tipoNegocio: string }>("/central/empresa/tipo-negocio").then((r) => setEsFarmacia(r.tipoNegocio === "FARMACIA")).catch(() => {}); }, []);
  useEffect(() => {
    if (!esFarmacia || !id) return;
    api<NonNullable<typeof f>>(`/central/farmacia/productos/${id}`).then(setF).catch((e) => setMsg({ t: (e as Error).message, tipo: "error" }));
    api<Ubic[]>("/central/farmacia/ubicaciones").then((r) => setUbic(r.filter((u) => u.activo))).catch(() => {});
  }, [esFarmacia, id]);
  if (!esFarmacia) return null;
  if (!id) return <div className="panel"><h3>Farmacia</h3><p className="suave" style={{ margin: 0 }}>Guarde el producto y después anote aquí su principio activo, si es controlado y dónde está en la tramería.</p></div>;
  if (!f) return <div className="panel suave">Cargando datos de farmacia…</div>;
  const guardar = async () => {
    setMsg(null);
    try { await api(`/central/farmacia/productos/${id}`, { metodo: "PUT", cuerpo: f }); setMsg({ t: "Datos de farmacia guardados.", tipo: "ok" }); }
    catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
  };
  const etiqueta = (u: Ubic) => `${u.almacen} · ${u.estante}-${u.nivel}-${u.posicion}`;
  const sinElegir = ubic.filter((u) => !f.ubicaciones.includes(u.id));
  return (
    <div className="panel">
      <h3>Farmacia</h3>
      <div className="dos-col">
        <label className="campo"><span>Principio activo</span><input value={f.principioActivo ?? ""} onChange={(e) => setF({ ...f, principioActivo: e.target.value })} placeholder="Ej. Amoxicilina" /></label>
        <label className="campo"><span>Laboratorio</span><input value={f.laboratorio ?? ""} onChange={(e) => setF({ ...f, laboratorio: e.target.value })} /></label>
      </div>
      <label className="en-linea" style={{ marginTop: 8 }}><input type="checkbox" checked={f.requiereReceta} onChange={(e) => setF({ ...f, requiereReceta: e.target.checked })} /> Se vende con receta (la caja pide paciente y médico)</label>
      <label className="en-linea"><input type="checkbox" checked={f.controlado} onChange={(e) => setF({ ...f, controlado: e.target.checked })} /> Medicamento controlado (la caja pide los datos de la receta)</label>
      <div style={{ marginTop: 10 }}>
        <span className="suave">Ubicación en la tramería</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "6px 0" }}>
          {f.ubicaciones.length === 0 && <span className="suave">Sin ubicación.</span>}
          {f.ubicaciones.map((uid) => { const u = ubic.find((x) => x.id === uid); return (
            <button key={uid} className="boton chico" title="Quitar" onClick={() => setF({ ...f, ubicaciones: f.ubicaciones.filter((x) => x !== uid) })}>{u ? etiqueta(u) : "Ubicación"} ✕</button>); })}
        </div>
        <select value="" onChange={(e) => e.target.value && setF({ ...f, ubicaciones: [...f.ubicaciones, e.target.value] })}>
          <option value="">{ubic.length ? "Agregar ubicación…" : "Primero cree ubicaciones en Farmacia › Tramería"}</option>
          {sinElegir.map((u) => <option key={u.id} value={u.id}>{etiqueta(u)}</option>)}
        </select>
      </div>
      <p style={{ margin: "10px 0 0" }}><button className="boton" onClick={guardar}>Guardar datos de farmacia</button></p>
      {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}
    </div>
  );
}

/** Aviso arriba de toda la administración (solo farmacias): lo vencido y lo que vence en 30 días. */
export function AvisoVencimientos({ irA }: { irA: () => void }) {
  const [r, setR] = useState<Resumen | null>(null);
  useEffect(() => {
    let vivo = true;
    const cargar = async () => {
      try {
        const t = await api<{ tipoNegocio: string }>("/central/empresa/tipo-negocio");
        if (t.tipoNegocio !== "FARMACIA") return;
        const d = await api<Resumen>("/central/farmacia/resumen");
        if (vivo) setR(d);
      } catch { /* sin permiso o sin servidor: no avisa */ }
    };
    void cargar();
    const i = setInterval(cargar, 10 * 60_000);
    return () => { vivo = false; clearInterval(i); };
  }, []);
  if (!r || (r.VENCIDO.lotes === 0 && r["30"].lotes === 0 && r["60"].lotes === 0)) return null;
  const partes = [
    r.VENCIDO.lotes ? `${r.VENCIDO.lotes} lote(s) VENCIDO(S) — no se facturan, retírelos` : "",
    r["30"].lotes ? `${r["30"].lotes} vencen en 30 días` : "",
    r["60"].lotes ? `${r["60"].lotes} en 31 a 60 días` : "",
  ].filter(Boolean);
  return (
    <div className={"aviso-linea " + (r.VENCIDO.lotes ? "error" : "info")} style={{ cursor: "pointer" }} onClick={irA} role="button">
      <b>Vencimientos:</b> {partes.join(" · ")}. <u>Ver el detalle</u>
    </div>
  );
}
