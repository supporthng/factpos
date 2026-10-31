import { useEffect, useState } from "react";
import { api, puede } from "../api";
import { Aviso, Encabezado, SelectorProducto, SelectorSucursal, Tabla, useCatalogo, useDatos } from "../ui";

/**
 * Pedidos de clientes (venta al por mayor): el vendedor anota el pedido aquí y lo envía a una caja como comanda.
 * La caja lo alista y lo factura. Los precios se cobran al facturar.
 */
interface Fila {
  id: string; numero: string; sucursalId: string; sucursal: string; caja: string | null; clienteNombre: string; telefono: string | null;
  estado: "PENDIENTE" | "LISTO" | "FACTURADO" | "CANCELADO"; creadoEn: string; lineas: number; alistadas: number; preparadoPor: string | null; creadoPor: string | null;
}
interface Item { id: string; presentacionId: string; producto: string; presentacion: string; cantidad: string; nota: string | null; alistado: boolean }
interface Detalle extends Fila { clienteId: string | null; cajaId: string | null; nota: string | null; items: Item[] }

const ESTADOS: Record<string, string> = { PENDIENTE: "En la caja, por alistar", LISTO: "Listo para facturar", FACTURADO: "Facturado", CANCELADO: "Cancelado" };
const fecha = (v: string) => new Date(v).toLocaleString("es-DO", { dateStyle: "short", timeStyle: "short" });
const num = (v: string) => String(Number(v));

export function Pedidos() {
  const [estado, setEstado] = useState("ABIERTOS");
  const [sucursalId, setSucursalId] = useState("");
  const [recarga, setRecarga] = useState(0);
  const [editar, setEditar] = useState<string | "nuevo" | null>(null);
  const [ver, setVer] = useState<string | null>(null);
  const lista = useDatos<Fila[]>(`/central/pedidos?${new URLSearchParams({ ...(estado ? { estado } : {}), ...(sucursalId ? { sucursalId } : {}) })}`, [recarga]);
  useEffect(() => { const t = setInterval(() => lista.recargar(), 20000); return () => clearInterval(t); }, [lista.recargar]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <Encabezado titulo="Pedidos de clientes" descripcion="Pedidos al por mayor: se envían a una caja como comanda, se alistan y se facturan desde la caja.">
        {puede("admin.pedidos") && <button className="boton primario" onClick={() => setEditar("nuevo")}>Nuevo pedido</button>}
      </Encabezado>
      <div className="fila-acciones" style={{ marginBottom: 12 }}>
        <select value={estado} onChange={(e) => setEstado(e.target.value)}>
          <option value="ABIERTOS">Abiertos (en caja)</option>
          <option value="PENDIENTE">Por alistar</option>
          <option value="LISTO">Listos para facturar</option>
          <option value="FACTURADO">Facturados</option>
          <option value="CANCELADO">Cancelados</option>
          <option value="">Todos</option>
        </select>
        <SelectorSucursal valor={sucursalId} onCambio={setSucursalId} />
      </div>
      <Aviso texto={lista.error} />
      <Tabla
        filas={lista.datos ?? []} clave={(f) => f.id} vacio="No hay pedidos con este filtro."
        columnas={[
          { titulo: "Pedido", valor: (f) => <button className="enlace" onClick={() => setVer(f.id)}>{f.numero}</button> },
          { titulo: "Cliente", valor: (f) => <>{f.clienteNombre}{f.telefono && <div className="suave">{f.telefono}</div>}</> },
          { titulo: "Sucursal / caja", valor: (f) => <>{f.sucursal}<div className="suave">{f.caja ?? "Cualquier caja"}</div></> },
          { titulo: "Estado", valor: (f) => <span className={"pastilla " + (f.estado === "LISTO" ? "ok" : f.estado === "CANCELADO" ? "alerta" : "")}>{ESTADOS[f.estado]}</span> },
          { titulo: "Alistado", valor: (f) => `${f.alistadas} de ${f.lineas}` },
          { titulo: "Creado", valor: (f) => fecha(f.creadoEn) },
        ]}
      />
      {ver && <VerPedido id={ver} onCerrar={() => setVer(null)} onEditar={() => { setEditar(ver); setVer(null); }} onCambio={() => setRecarga((n) => n + 1)} />}
      {editar && <FormPedido id={editar === "nuevo" ? null : editar} onCerrar={() => setEditar(null)} onGuardado={() => { setEditar(null); setRecarga((n) => n + 1); }} />}
    </>
  );
}

function VerPedido({ id, onCerrar, onEditar, onCambio }: { id: string; onCerrar: () => void; onEditar: () => void; onCambio: () => void }) {
  const { datos: d, error, recargar } = useDatos<Detalle>(`/central/pedidos/${id}`);
  const [msg, setMsg] = useState("");
  const cancelar = async () => {
    if (!confirm("¿Cancelar este pedido? La caja ya no lo verá.")) return;
    try { await api(`/central/pedidos/${id}/cancelar`, { metodo: "POST", cuerpo: {} }); onCambio(); recargar(); } catch (e) { setMsg((e as Error).message); }
  };
  return (
    <div className="fondo-modal" onMouseDown={onCerrar}>
      <div className="modal ancho" onMouseDown={(e) => e.stopPropagation()}>
        <div className="fila-acciones" style={{ marginTop: 0 }}>
          <h2 style={{ margin: 0 }}>Pedido {d?.numero}</h2><span className="flex" />
          {d && ["PENDIENTE", "LISTO"].includes(d.estado) && puede("admin.pedidos") && <>
            <button className="boton chico" onClick={onEditar}>Cambiar</button>
            <button className="boton chico" onClick={cancelar}>Cancelar pedido</button>
          </>}
        </div>
        <Aviso texto={error || msg} />
        {d && <>
          <p><b>{d.clienteNombre}</b>{d.telefono && ` · ${d.telefono}`}<br />
            <span className="suave">{d.sucursal} · {d.caja ?? "Cualquier caja"} · {ESTADOS[d.estado]}{d.preparadoPor ? ` · Lo prepara: ${d.preparadoPor}` : ""}</span></p>
          {d.nota && <p className="nota">{d.nota}</p>}
          <Tabla filas={d.items} clave={(i) => i.id} columnas={[
            { titulo: "Producto", valor: (i) => <>{i.producto} <span className="suave">{i.presentacion}</span>{i.nota && <div className="suave">{i.nota}</div>}</> },
            { titulo: "Cantidad", der: true, valor: (i) => num(i.cantidad) },
            { titulo: "Alistado", valor: (i) => (i.alistado ? "✓" : "—") },
          ]} />
        </>}
        <div className="fila-acciones"><span className="flex" /><button className="boton" onClick={onCerrar}>Cerrar</button></div>
      </div>
    </div>
  );
}

interface LineaForm { clave: string; presentacionId: string; producto: string; presentacion: string; cantidad: string; nota: string }

function FormPedido({ id, onCerrar, onGuardado }: { id: string | null; onCerrar: () => void; onGuardado: () => void }) {
  const { sucursales, productos } = useCatalogo();
  const previo = useDatos<Detalle>(id ? `/central/pedidos/${id}` : null);
  const [sucursalId, setSucursalId] = useState(sucursales[0]?.id ?? "");
  const [cajaId, setCajaId] = useState("");
  const cajas = useDatos<{ id: string; nombre: string }[]>(sucursalId ? `/central/pedidos/cajas?sucursalId=${sucursalId}` : null, [sucursalId]);
  const [cliente, setCliente] = useState<{ id: string | null; nombre: string; telefono: string }>({ id: null, nombre: "", telefono: "" });
  const [q, setQ] = useState("");
  const [res, setRes] = useState<{ clienteId: string; nombre: string; telefono: string | null }[]>([]);
  const [preparadoPor, setPreparadoPor] = useState("");
  const [nota, setNota] = useState("");
  const [lineas, setLineas] = useState<LineaForm[]>([]);
  const [prod, setProd] = useState("");
  const [msg, setMsg] = useState("");
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    const d = previo.datos;
    if (!d) return;
    setSucursalId(d.sucursalId); setCajaId(d.cajaId ?? ""); setCliente({ id: d.clienteId, nombre: d.clienteNombre, telefono: d.telefono ?? "" });
    setPreparadoPor(d.preparadoPor ?? ""); setNota(d.nota ?? "");
    setLineas(d.items.map((i) => ({ clave: i.id, presentacionId: i.presentacionId, producto: i.producto, presentacion: i.presentacion, cantidad: num(i.cantidad), nota: i.nota ?? "" })));
  }, [previo.datos]);
  useEffect(() => {
    if (q.trim().length < 2) return setRes([]);
    const t = setTimeout(() => api<any[]>(`/central/cxc/buscar?q=${encodeURIComponent(q.trim())}`).then(setRes).catch(() => setRes([])), 200);
    return () => clearTimeout(t);
  }, [q]);

  const agregar = (productoId: string) => {
    const p = productos.find((x) => x.id === productoId);
    setProd("");
    if (!p) return;
    // Se propone la presentación mayor (caja, saco…): es lo normal en un pedido grande
    const pr = [...p.presentaciones].sort((a, b) => Number(b.factor) - Number(a.factor))[0];
    if (!pr) return;
    if (lineas.some((l) => l.presentacionId === pr.id)) return setMsg(`${p.nombre} ya está en el pedido; cambie su cantidad.`);
    setMsg("");
    setLineas((ls) => [...ls, { clave: crypto.randomUUID(), presentacionId: pr.id, producto: p.nombre, presentacion: pr.nombre, cantidad: "1", nota: "" }]);
  };
  const cambiarPresentacion = (clave: string, presentacionId: string) => {
    const l = lineas.find((x) => x.clave === clave)!;
    const p = productos.find((x) => x.presentaciones.some((pr) => pr.id === l.presentacionId))!;
    const pr = p.presentaciones.find((x) => x.id === presentacionId)!;
    if (lineas.some((x) => x.presentacionId === presentacionId)) return setMsg(`${p.nombre} ${pr.nombre} ya está en el pedido.`);
    setLineas((ls) => ls.map((x) => (x.clave === clave ? { ...x, presentacionId, presentacion: pr.nombre } : x)));
  };
  const valido = !!sucursalId && cliente.nombre.trim().length >= 2 && lineas.length > 0 && lineas.every((l) => Number(l.cantidad) > 0);

  const guardar = async () => {
    setGuardando(true); setMsg("");
    try {
      const cuerpo = {
        sucursalId, cajaId: cajaId || null, clienteId: cliente.id, clienteNombre: cliente.nombre.trim(), telefono: cliente.telefono.trim() || undefined,
        nota: nota.trim() || undefined, preparadoPor: preparadoPor.trim() || undefined,
        items: lineas.map((l) => ({ presentacionId: l.presentacionId, cantidad: String(Number(l.cantidad)), nota: l.nota.trim() || undefined })),
      };
      await api(id ? `/central/pedidos/${id}` : "/central/pedidos", { metodo: id ? "PUT" : "POST", cuerpo });
      onGuardado();
    } catch (e) { setMsg((e as Error).message); } finally { setGuardando(false); }
  };

  return (
    <div className="fondo-modal" onMouseDown={onCerrar}>
      <div className="modal ancho" onMouseDown={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>{id ? "Cambiar pedido" : "Nuevo pedido"}</h2>
        {id && <p className="nota">Al guardar los cambios, el pedido vuelve a empezar a alistarse en la caja.</p>}
        <div className="dos-columnas">
          <label className="campo"><span>Sucursal</span><SelectorSucursal valor={sucursalId} onCambio={(v) => { setSucursalId(v); setCajaId(""); }} todas={false} /></label>
          <label className="campo"><span>Enviar a la caja</span>
            <select value={cajaId} onChange={(e) => setCajaId(e.target.value)}>
              <option value="">Cualquier caja de la sucursal</option>
              {(cajas.datos ?? []).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </label>
        </div>
        <label className="campo"><span>Cliente (busque uno registrado o escriba el nombre)</span>
          <input value={q || cliente.nombre} placeholder="Nombre, RNC o cédula"
            onChange={(e) => { setQ(e.target.value); setCliente({ ...cliente, id: null, nombre: e.target.value }); }} />
        </label>
        {res.length > 0 && q && (
          <div className="desplegable" style={{ position: "static", marginBottom: 8 }}>
            {res.map((c) => <button key={c.clienteId} onClick={() => { setCliente({ id: c.clienteId, nombre: c.nombre, telefono: c.telefono ?? "" }); setQ(""); setRes([]); }}>{c.nombre} <span className="suave">{c.telefono}</span></button>)}
          </div>
        )}
        <div className="dos-columnas">
          <label className="campo"><span>Teléfono</span><input value={cliente.telefono} onChange={(e) => setCliente({ ...cliente, telefono: e.target.value })} /></label>
          <label className="campo"><span>Lo prepara (opcional)</span><input value={preparadoPor} onChange={(e) => setPreparadoPor(e.target.value)} placeholder="Nombre del personal" /></label>
        </div>
        <label className="campo"><span>Agregar producto</span><SelectorProducto valor={prod} onCambio={agregar} /></label>
        {lineas.length > 0 && (
          <div className="tabla-contenedor"><table className="tabla"><thead><tr><th>Producto</th><th>Presentación</th><th className="der">Cantidad</th><th>Nota</th><th /></tr></thead><tbody>
            {lineas.map((l) => {
              const p = productos.find((x) => x.presentaciones.some((pr) => pr.id === l.presentacionId));
              return (
                <tr key={l.clave}>
                  <td>{l.producto}</td>
                  <td>{p && p.presentaciones.length > 1
                    ? <select value={l.presentacionId} onChange={(e) => cambiarPresentacion(l.clave, e.target.value)}>{p.presentaciones.map((pr) => <option key={pr.id} value={pr.id}>{pr.nombre}</option>)}</select>
                    : l.presentacion}</td>
                  <td className="der"><input style={{ width: 90, textAlign: "right" }} inputMode="decimal" value={l.cantidad} onChange={(e) => setLineas((ls) => ls.map((x) => (x.clave === l.clave ? { ...x, cantidad: e.target.value.replace(/[^\d.]/g, "") } : x)))} /></td>
                  <td><input value={l.nota} placeholder="Opcional" onChange={(e) => setLineas((ls) => ls.map((x) => (x.clave === l.clave ? { ...x, nota: e.target.value } : x)))} /></td>
                  <td><button className="enlace" onClick={() => setLineas((ls) => ls.filter((x) => x.clave !== l.clave))}>Quitar</button></td>
                </tr>
              );
            })}
          </tbody></table></div>
        )}
        <label className="campo"><span>Nota del pedido</span><input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ej. entrega a las 3 p. m. por el muelle" /></label>
        <Aviso texto={msg} />
        <div className="fila-acciones">
          <span className="flex" />
          <button className="boton" onClick={onCerrar}>Cancelar</button>
          <button className="boton primario" disabled={!valido || guardando} onClick={guardar}>{id ? "Guardar y enviar a la caja" : "Enviar a la caja"}</button>
        </div>
      </div>
    </div>
  );
}
