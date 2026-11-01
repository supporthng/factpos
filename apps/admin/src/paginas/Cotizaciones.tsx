import { useEffect, useMemo, useState } from "react";
import { api, puede, rd, num, hoy } from "../api";
import { Aviso, Encabezado, SelectorProducto, useCatalogo, useDatos } from "../ui";

/**
 * Cotizaciones: se preparan con los precios del nivel del cliente, se envían por correo
 * (o se imprimen / guardan como PDF) y luego se marcan aceptadas o rechazadas.
 */
interface Fila { id: string; numero: number; clienteNombre: string; clienteCorreo: string | null; fecha: string; vence: string; estado: Estado; total: number; enviadaEn: string | null; vencida: boolean }
type Estado = "BORRADOR" | "ENVIADA" | "ACEPTADA" | "RECHAZADA";
interface LineaC { presentacionId: string | null; descripcion: string; cantidad: number; precio: number; incluyeItbis: boolean; tasaItbis: number; descuento: number; total?: number; base?: number; itbis?: number }
interface Detalle {
  id: string; numero: number; clienteId: string | null; clienteNombre: string; clienteDocumento: string | null; clienteCorreo: string | null; clienteTelefono: string | null;
  fecha: string; vence: string; estado: Estado; notas: string | null; condiciones: string | null; subtotal: number; descuento: number; itbis: number; total: number;
  enviadaEn: string | null; enviadaA: string[] | null; lineas: LineaC[];
}
interface ClienteB { id: string; nombre: string; documento: string | null; correo: string | null; telefono: string | null; nivel: number | null }

const ETIQUETA: Record<Estado, string> = { BORRADOR: "Borrador", ENVIADA: "Enviada", ACEPTADA: "Aceptada", RECHAZADA: "Rechazada" };
const COLOR: Record<Estado, string> = { BORRADOR: "", ENVIADA: "aviso", ACEPTADA: "ok", RECHAZADA: "alerta" };
const num3 = (n: string) => num(Number(n));
const codigo = (n: number) => `COT-${String(n).padStart(4, "0")}`;
const sumarDias = (iso: string, d: number) => { const f = new Date(iso + "T12:00:00"); f.setDate(f.getDate() + d); return f.toISOString().slice(0, 10); };
const fechaCorta = (f: string) => new Date(f + "T12:00:00").toLocaleDateString("es-DO");

export function Cotizaciones() {
  const [estado, setEstado] = useState("");
  const [q, setQ] = useState("");
  const [recarga, setRecarga] = useState(0);
  const [abierta, setAbierta] = useState<string | "nueva" | null>(null);
  const lista = useDatos<Fila[]>(`/central/cotizaciones?${new URLSearchParams({ ...(estado ? { estado } : {}), ...(q.trim() ? { q: q.trim() } : {}) })}`, [recarga]);
  const edita = puede("admin.cotizaciones");

  if (abierta) return <Editor id={abierta === "nueva" ? null : abierta} onCerrar={() => { setAbierta(null); setRecarga((x) => x + 1); }} />;
  return (
    <>
      <Encabezado titulo="Cotizaciones" descripcion="Prepare la cotización con los precios del cliente y envíela por correo.">
        {edita && <button className="boton primario" onClick={() => setAbierta("nueva")}>Nueva cotización</button>}
      </Encabezado>
      <div className="fila-acciones" style={{ marginBottom: 12 }}>
        <input placeholder="Buscar por cliente o número" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 280 }} />
        <select value={estado} onChange={(e) => setEstado(e.target.value)}>
          <option value="">Todas</option>
          {(Object.keys(ETIQUETA) as Estado[]).map((e) => <option key={e} value={e}>{ETIQUETA[e]}</option>)}
        </select>
      </div>
      <div className="tabla-contenedor"><table className="tabla">
        <thead><tr><th>Número</th><th>Cliente</th><th>Fecha</th><th>Válida hasta</th><th>Estado</th><th className="der">Total</th><th /></tr></thead>
        <tbody>
          {lista.datos?.map((c) => (
            <tr key={c.id}>
              <td className="mono">{codigo(c.numero)}</td>
              <td>{c.clienteNombre}</td>
              <td>{fechaCorta(c.fecha)}</td>
              <td>{fechaCorta(c.vence)}{c.vencida && <span className="texto-alerta pequeno"> · vencida</span>}</td>
              <td><span className={`pastilla ${COLOR[c.estado]}`}>{ETIQUETA[c.estado]}</span></td>
              <td className="der">{rd(c.total)}</td>
              <td className="der"><button className="enlace" onClick={() => setAbierta(c.id)}>Abrir</button></td>
            </tr>
          ))}
          {lista.datos && !lista.datos.length && <tr><td colSpan={7} className="suave">Todavía no hay cotizaciones.</td></tr>}
        </tbody>
      </table></div>
    </>
  );
}

function Editor({ id, onCerrar }: { id: string | null; onCerrar: () => void }) {
  const { productos } = useCatalogo();
  const edita = puede("admin.cotizaciones");
  const det = useDatos<Detalle>(id ? `/central/cotizaciones/${id}` : null);
  const [cab, setCab] = useState({ clienteId: null as string | null, clienteNombre: "", clienteDocumento: "", clienteCorreo: "", clienteTelefono: "", fecha: hoy(), vence: sumarDias(hoy(), 15), notas: "", condiciones: "Precios sujetos a cambio sin previo aviso. Incluyen ITBIS donde aplica." });
  const [lineas, setLineas] = useState<LineaC[]>([]);
  const [estado, setEstado] = useState<Estado>("BORRADOR");
  const [numero, setNumero] = useState<number | null>(null);
  const [prod, setProd] = useState("");
  const [busca, setBusca] = useState("");
  const [encontrados, setEncontrados] = useState<ClienteB[]>([]);
  const [msg, setMsg] = useState("");
  const [ok, setOk] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [correo, setCorreo] = useState<{ para: string; mensaje: string } | null>(null);
  const bloqueada = estado === "ACEPTADA" || !edita;

  useEffect(() => {
    const d = det.datos;
    if (!d) return;
    setCab({ clienteId: d.clienteId, clienteNombre: d.clienteNombre, clienteDocumento: d.clienteDocumento ?? "", clienteCorreo: d.clienteCorreo ?? "", clienteTelefono: d.clienteTelefono ?? "", fecha: d.fecha, vence: d.vence, notas: d.notas ?? "", condiciones: d.condiciones ?? "" });
    setLineas(d.lineas); setEstado(d.estado); setNumero(d.numero);
  }, [det.datos]);

  useEffect(() => {
    if (busca.trim().length < 2) return setEncontrados([]);
    const t = setTimeout(() => api<ClienteB[]>(`/central/clientes?q=${encodeURIComponent(busca.trim())}`).then(setEncontrados).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [busca]);

  const elegirCliente = async (c: ClienteB) => {
    setCab((x) => ({ ...x, clienteId: c.id, clienteNombre: c.nombre, clienteDocumento: c.documento ?? "", clienteCorreo: c.correo ?? "", clienteTelefono: c.telefono ?? "" }));
    setBusca(""); setEncontrados([]);
    // Los precios se vuelven a leer con el nivel del cliente elegido
    setLineas(await Promise.all(lineas.map(async (l) => {
      if (!l.presentacionId) return l;
      try { const r = await api<{ precio: number }>(`/central/cotizaciones/precio?presentacionId=${l.presentacionId}&clienteId=${c.id}`); return { ...l, precio: r.precio }; } catch { return l; }
    })));
  };

  const agregar = async (presentacionId: string) => {
    const p = productos.find((x) => x.presentaciones.some((pr) => pr.id === presentacionId))!;
    const pr = p.presentaciones.find((x) => x.id === presentacionId)!;
    setProd("");
    try {
      const r = await api<{ precio: number; incluyeItbis: boolean; tasaItbis: number }>(`/central/cotizaciones/precio?presentacionId=${presentacionId}${cab.clienteId ? `&clienteId=${cab.clienteId}` : ""}`);
      setLineas((ls) => [...ls, { presentacionId, descripcion: `${p.nombre}${pr.nombre !== "Unidad" ? ` · ${pr.nombre}` : ""}`, cantidad: 1, precio: r.precio, incluyeItbis: r.incluyeItbis, tasaItbis: r.tasaItbis, descuento: 0 }]);
    } catch (e) { setMsg((e as Error).message); }
  };
  const producto = productos.find((p) => p.id === prod);
  useEffect(() => { if (producto && producto.presentaciones.length === 1) void agregar(producto.presentaciones[0]!.id); }, [prod]); // eslint-disable-line react-hooks/exhaustive-deps
  const fijar = (i: number, c: Partial<LineaC>) => setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, ...c } : l)));

  const calc = useMemo(() => lineas.map((l) => {
    const bruto = Math.round(l.cantidad * l.precio * 100) / 100;
    const neto = Math.max(0, bruto - l.descuento);
    const total = l.incluyeItbis ? neto : Math.round(neto * (1 + l.tasaItbis) * 100) / 100;
    return { total };
  }), [lineas]);
  const total = calc.reduce((s, c) => s + c.total, 0);

  const cuerpo = () => ({
    ...cab, clienteDocumento: cab.clienteDocumento || null, clienteCorreo: cab.clienteCorreo || null, clienteTelefono: cab.clienteTelefono || null,
    notas: cab.notas || null, condiciones: cab.condiciones || null,
    lineas: lineas.map((l) => ({ presentacionId: l.presentacionId, descripcion: l.descripcion, cantidad: l.cantidad, precio: l.precio, incluyeItbis: l.incluyeItbis, tasaItbis: l.tasaItbis, descuento: l.descuento })),
  });
  const guardar = async (): Promise<string | null> => {
    setGuardando(true); setMsg(""); setOk("");
    try {
      const r = id ? await api<Detalle>(`/central/cotizaciones/${id}`, { metodo: "PUT", cuerpo: cuerpo() }) : await api<Detalle>("/central/cotizaciones", { cuerpo: cuerpo() });
      setOk(`Guardada como ${codigo(r.numero)}.`);
      if (!id) { onCerrar(); }
      return r.id;
    } catch (e) { setMsg((e as Error).message); return null; }
    finally { setGuardando(false); }
  };
  const valida = cab.clienteNombre.trim().length >= 2 && lineas.length > 0 && lineas.every((l) => l.cantidad > 0 && l.descripcion.trim());

  const enviar = async () => {
    if (!id || !correo) return;
    setMsg("");
    try {
      if (!(await guardar())) return;
      await api(`/central/cotizaciones/${id}/enviar`, { cuerpo: { para: correo.para.split(/[,;\s]+/).filter(Boolean), mensaje: correo.mensaje || undefined } });
      setCorreo(null); setOk("Cotización enviada."); det.recargar();
    } catch (e) { setMsg((e as Error).message); }
  };
  const cambiarEstado = async (e: Estado) => { try { await api(`/central/cotizaciones/${id}/estado`, { metodo: "PUT", cuerpo: { estado: e } }); det.recargar(); } catch (x) { setMsg((x as Error).message); } };

  const imprimir = () => {
    const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
    const w = window.open("", "_blank");
    if (!w) return setMsg("El navegador bloqueó la ventana. Permita las ventanas emergentes para imprimir.");
    w.document.write(`<!doctype html><meta charset="utf-8"><title>${codigo(numero ?? 0)}</title>
<style>body{font:14px Segoe UI,Arial,sans-serif;margin:32px;color:#1f2933}h1{margin:0 0 4px}table{width:100%;border-collapse:collapse;margin:16px 0}th,td{padding:7px 6px;border-bottom:1px solid #ddd;text-align:left}th{font-size:12px;color:#555}.d{text-align:right}.t{font-size:16px;font-weight:700}.s{color:#666;font-size:12px;white-space:pre-line}</style>
<h1>Cotización ${numero ? codigo(numero) : ""}</h1>
<div>Cliente: <b>${esc(cab.clienteNombre)}</b>${cab.clienteDocumento ? ` · ${esc(cab.clienteDocumento)}` : ""}</div>
<div>Fecha: ${fechaCorta(cab.fecha)} · Válida hasta: ${fechaCorta(cab.vence)}</div>
<table><tr><th>Descripción</th><th class="d">Cant.</th><th class="d">Precio</th><th class="d">Total</th></tr>
${lineas.map((l, i) => `<tr><td>${esc(l.descripcion)}</td><td class="d">${num(l.cantidad)}</td><td class="d">${rd(l.precio)}</td><td class="d">${rd(calc[i]!.total)}</td></tr>`).join("")}
<tr><td colspan="3" class="d t">Total${lineas.some((l) => l.incluyeItbis) ? " (ITBIS incluido)" : ""}</td><td class="d t">${rd(total)}</td></tr></table>
${cab.notas ? `<p><b>Notas:</b> ${esc(cab.notas)}</p>` : ""}<p class="s">${esc(cab.condiciones)}</p>
<script>onload=()=>setTimeout(()=>print(),200)</script>`);
    w.document.close();
  };

  return (
    <>
      <div className="migas"><button className="enlace" onClick={onCerrar}>Cotizaciones</button><span>/</span><span>{numero ? codigo(numero) : "Nueva cotización"}</span></div>
      <Encabezado titulo={numero ? `Cotización ${codigo(numero)}` : "Nueva cotización"} descripcion={estado !== "BORRADOR" ? `Estado: ${ETIQUETA[estado]}${det.datos?.enviadaA?.length ? ` · enviada a ${det.datos.enviadaA.join(", ")}` : ""}` : undefined}>
        {id && <button className="boton" onClick={imprimir} disabled={!lineas.length}>Imprimir / PDF</button>}
        {id && edita && <button className="boton" disabled={!valida} onClick={() => setCorreo({ para: cab.clienteCorreo, mensaje: "" })}>Enviar por correo</button>}
        {!bloqueada && <button className="boton primario" disabled={!valida || guardando} onClick={() => void guardar()}>{guardando ? "Guardando…" : "Guardar"}</button>}
      </Encabezado>
      <Aviso texto={msg} />
      {ok && <p className="texto-ok">{ok}</p>}

      <div className="panel">
        <div className="tres-col">
          <label className="campo"><span>Cliente (busque uno registrado o escriba el nombre)</span>
            <input value={cab.clienteId ? cab.clienteNombre : busca || cab.clienteNombre} disabled={bloqueada}
              onChange={(e) => { setBusca(e.target.value); setCab({ ...cab, clienteId: null, clienteNombre: e.target.value }); }} placeholder="Nombre, RNC o teléfono" />
            {encontrados.length > 0 && (
              <div className="desplegable">{encontrados.slice(0, 8).map((c) => (
                <button key={c.id} onMouseDown={() => void elegirCliente(c)}>{c.nombre} <span className="suave">{c.documento ?? ""}{c.nivel ? ` · Precio ${c.nivel}` : ""}</span></button>
              ))}</div>
            )}
          </label>
          <label className="campo"><span>Documento (RNC / cédula)</span><input value={cab.clienteDocumento} disabled={bloqueada} onChange={(e) => setCab({ ...cab, clienteDocumento: e.target.value })} /></label>
          <label className="campo"><span>Correo</span><input type="email" value={cab.clienteCorreo} disabled={bloqueada} onChange={(e) => setCab({ ...cab, clienteCorreo: e.target.value })} /></label>
          <label className="campo"><span>Teléfono</span><input value={cab.clienteTelefono} disabled={bloqueada} onChange={(e) => setCab({ ...cab, clienteTelefono: e.target.value })} /></label>
          <label className="campo"><span>Fecha</span><input type="date" value={cab.fecha} disabled={bloqueada} onChange={(e) => setCab({ ...cab, fecha: e.target.value })} /></label>
          <label className="campo"><span>Válida hasta</span><input type="date" value={cab.vence} min={cab.fecha} disabled={bloqueada} onChange={(e) => setCab({ ...cab, vence: e.target.value })} /></label>
        </div>
      </div>

      <div className="panel">
        <div className="encabezado-sub">
          <h3>Productos</h3>
          {!bloqueada && (
            <div className="agregar-linea">
              <SelectorProducto valor={prod} onCambio={setProd} placeholder="Agregar producto…" />
              {producto && producto.presentaciones.length > 1 && (
                <div className="chips">{producto.presentaciones.map((pr) => <button key={pr.id} className="chip" onClick={() => void agregar(pr.id)}>{pr.nombre}{Number(pr.factor) > 1 ? ` (${num3(pr.factor)})` : ""}</button>)}</div>
              )}
            </div>
          )}
        </div>
        {lineas.length === 0 ? <p className="suave">Agregue los productos a cotizar.</p> : (
          <div className="tabla-contenedor">
            <table className="tabla tabla-edicion">
              <thead><tr><th>Descripción</th><th className="der">Cantidad</th><th className="der">Precio</th><th className="der">Descuento</th><th className="der">Total</th><th /></tr></thead>
              <tbody>
                {lineas.map((l, i) => (
                  <tr key={i}>
                    <td><input value={l.descripcion} disabled={bloqueada} onChange={(e) => fijar(i, { descripcion: e.target.value })} />
                      <small className="suave">{l.incluyeItbis ? "Precio con ITBIS" : "Precio sin ITBIS"} · {Math.round(l.tasaItbis * 100)} %</small></td>
                    <td className="der" style={{ width: 100 }}><input className="numero" inputMode="decimal" value={l.cantidad || ""} disabled={bloqueada} onChange={(e) => fijar(i, { cantidad: Number(e.target.value.replace(/[^\d.]/g, "")) || 0 })} /></td>
                    <td className="der" style={{ width: 120 }}><input className="numero" inputMode="decimal" value={l.precio || ""} disabled={bloqueada} onChange={(e) => fijar(i, { precio: Number(e.target.value.replace(/[^\d.]/g, "")) || 0 })} /></td>
                    <td className="der" style={{ width: 110 }}><input className="numero" inputMode="decimal" value={l.descuento || ""} disabled={bloqueada} onChange={(e) => fijar(i, { descuento: Number(e.target.value.replace(/[^\d.]/g, "")) || 0 })} /></td>
                    <td className="der">{rd(calc[i]!.total)}</td>
                    <td>{!bloqueada && <button className="enlace" onClick={() => setLineas((ls) => ls.filter((_, j) => j !== i))}>Quitar</button>}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={4} className="der"><b>Total</b></td><td className="der"><b>{rd(total)}</b></td><td /></tr></tfoot>
            </table>
          </div>
        )}
      </div>

      <div className="panel">
        <label className="campo"><span>Notas para el cliente</span><input value={cab.notas} disabled={bloqueada} onChange={(e) => setCab({ ...cab, notas: e.target.value })} /></label>
        <label className="campo"><span>Condiciones</span><textarea rows={3} value={cab.condiciones} disabled={bloqueada} onChange={(e) => setCab({ ...cab, condiciones: e.target.value })} /></label>
      </div>

      {id && edita && (
        <div className="fila-acciones" style={{ flexWrap: "wrap" }}>
          {estado !== "ACEPTADA" && <button className="boton" onClick={() => cambiarEstado("ACEPTADA")}>Marcar aceptada</button>}
          {estado !== "RECHAZADA" && estado !== "ACEPTADA" && <button className="boton" onClick={() => cambiarEstado("RECHAZADA")}>Marcar rechazada</button>}
          {(estado === "RECHAZADA" || estado === "ACEPTADA") && <button className="boton" onClick={() => cambiarEstado("BORRADOR")}>Reabrir como borrador</button>}
          {estado === "BORRADOR" && <button className="enlace texto-alerta" onClick={async () => { if (confirm("¿Borrar este borrador?")) { await api(`/central/cotizaciones/${id}`, { metodo: "DELETE" }); onCerrar(); } }}>Borrar borrador</button>}
        </div>
      )}

      {correo && (
        <div className="fondo-modal" onClick={() => setCorreo(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Enviar cotización por correo</h3>
            <label className="campo"><span>Para (separe varias con coma)</span><input autoFocus type="email" multiple value={correo.para} onChange={(e) => setCorreo({ ...correo, para: e.target.value })} /></label>
            <label className="campo"><span>Mensaje (opcional)</span><textarea rows={4} value={correo.mensaje} onChange={(e) => setCorreo({ ...correo, mensaje: e.target.value })} placeholder="Estimado cliente, le enviamos la cotización solicitada…" /></label>
            <div className="acciones-modal">
              <button className="boton" onClick={() => setCorreo(null)}>Cancelar</button>
              <button className="boton primario" disabled={!correo.para.trim()} onClick={enviar}>Enviar</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
