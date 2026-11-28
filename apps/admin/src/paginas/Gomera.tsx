import { useEffect, useState } from "react";
import { api, num } from "../api";
import { Aviso, Encabezado, useDatos } from "../ui";
import { Ubicaciones } from "./Farmacia";
import { TIPOS_NEUMATICO, leerMedida, ANIOS_DOT } from "@factpos/compartido";

/**
 * Gomera: neumáticos por medida (ancho, perfil y rin), tipo de vehículo y condición, con lo que hay en cada sucursal y dónde está
 * (rack › nivel › posición), medidas más vendidas y antigüedad por DOT. Los servicios (pinchazos, montaje…) están en «Servicios de taller».
 */
interface Exis { sucursalId: string; sucursal: string; almacenId: string; cantidad: string; ubicacion: string | null }
interface Hallado { id: string; sku: string; nombre: string; marca: string | null; medida: string; tipo: string; condicion: "NUEVO" | "USADO"; modelo: string | null; indice: string | null; vidaBanda: number | null; existencias: Exis[]; masViejoVence: string | null; precio: string | null }
interface SinFicha { id: string; sku: string; nombre: string; marca: string | null }
interface Medida { medida: string; tipo: string; modelos: number; existencia: string; vendidos90: string }
interface Viejo { productoId: string; nombre: string; medida: string; dot: string; vence: string; edad: string; cantidad: string; sucursal: string; pasada: boolean }
interface Ficha { id: string; nombre: string; marca: string | null; medida: string | null; tipo: string | null; condicion: string | null; modelo: string | null; indice: string | null; vidaBanda: number | null; notas: string | null; controlaDot: boolean; ubicaciones: string[] }
interface Ubic { id: string; almacenId: string; almacen: string; estante: string; nivel: number; posicion: string; activo: boolean }

const nombreTipo = (id: string) => TIPOS_NEUMATICO.find((t) => t.id === id)?.nombre ?? id;

export function Gomera() {
  const [vista, setVista] = useState<"buscar" | "fichas" | "ubicaciones" | "medidas" | "antiguedad">("buscar");
  const [editar, setEditar] = useState<string | null>(null);
  return (
    <>
      <Encabezado titulo="Neumáticos" descripcion="Busque por medida, vea qué sucursal lo tiene y en qué rack está. La medida va en el nombre, así que cada caja lo encuentra escribiéndola." />
      <div className="pestanas">
        <button className={vista === "buscar" ? "activa" : ""} onClick={() => setVista("buscar")}>Buscar por medida</button>
        <button className={vista === "fichas" ? "activa" : ""} onClick={() => setVista("fichas")}>Fichas pendientes</button>
        <button className={vista === "ubicaciones" ? "activa" : ""} onClick={() => setVista("ubicaciones")}>Ubicaciones</button>
        <button className={vista === "medidas" ? "activa" : ""} onClick={() => setVista("medidas")}>Medidas</button>
        <button className={vista === "antiguedad" ? "activa" : ""} onClick={() => setVista("antiguedad")}>Antigüedad (DOT)</button>
      </div>
      {editar && <EditorFicha id={editar} cerrar={() => setEditar(null)} />}
      {vista === "buscar" ? <Buscar editar={setEditar} /> : vista === "fichas" ? <Pendientes editar={setEditar} /> : vista === "ubicaciones" ? <Ubicaciones /> : vista === "medidas" ? <Medidas /> : <Antiguedad />}
    </>
  );
}

function Buscar({ editar }: { editar: (id: string) => void }) {
  const [medida, setMedida] = useState("");
  const [q, setQ] = useState("");
  const [tipo, setTipo] = useState("");
  const [condicion, setCondicion] = useState("");
  const [soloExistencia, setSoloExistencia] = useState(true);
  const [lista, setLista] = useState<Hallado[]>([]);
  const [error, setError] = useState("");
  const med = medida.trim() ? leerMedida(medida) : null;
  useEffect(() => {
    const t = setTimeout(() => {
      if (medida.trim() && !med) { setError(""); return; }
      const p = new URLSearchParams();
      if (med) p.set("medida", med.texto);
      if (q.trim()) p.set("q", q.trim());
      if (tipo) p.set("tipo", tipo);
      if (condicion) p.set("condicion", condicion);
      p.set("soloConExistencia", soloExistencia ? "1" : "0");
      api<Hallado[]>(`/central/gomera/buscar?${p}`).then((r) => { setLista(r); setError(""); }).catch((e) => setError((e as Error).message));
    }, 250);
    return () => clearTimeout(t);
  }, [medida, q, tipo, condicion, soloExistencia]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <div className="panel cab-compra" style={{ flexWrap: "wrap", marginTop: 10 }}>
        <label className="campo"><span>Medida</span><input value={medida} onChange={(e) => setMedida(e.target.value)} placeholder="205/55R16" style={{ width: 130 }} /></label>
        <label className="campo"><span>Marca o modelo</span><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Michelin" style={{ width: 150 }} /></label>
        <label className="campo"><span>Vehículo</span><select value={tipo} onChange={(e) => setTipo(e.target.value)}><option value="">Todos</option>{TIPOS_NEUMATICO.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}</select></label>
        <label className="campo"><span>Condición</span><select value={condicion} onChange={(e) => setCondicion(e.target.value)}><option value="">Nuevos y usados</option><option value="NUEVO">Nuevos</option><option value="USADO">Usados</option></select></label>
        <label className="campo"><span>&nbsp;</span><span><input type="checkbox" checked={soloExistencia} onChange={(e) => setSoloExistencia(e.target.checked)} /> Solo con existencia</span></label>
      </div>
      {medida.trim() && !med && <Aviso tipo="info" texto="Escriba la medida como 205/55R16, 90/90-18, 11R22.5 o 26x1.95." />}
      <Aviso texto={error} />
      <div className="tabla-contenedor" style={{ marginTop: 10 }}>
        <table className="tabla">
          <thead><tr><th>Medida</th><th>Neumático</th><th>Vehículo</th><th>Precio</th><th>Dónde hay</th><th></th></tr></thead>
          <tbody>
            {lista.map((x) => (
              <tr key={x.id}>
                <td><b>{x.medida}</b>{x.indice ? <div className="suave">{x.indice}</div> : null}</td>
                <td>{x.nombre}{x.condicion === "USADO" && x.vidaBanda != null ? <div className="suave">Le queda {x.vidaBanda}% de banda</div> : null}</td>
                <td>{nombreTipo(x.tipo)}</td>
                <td className="numero">{x.precio ? num(x.precio) : "—"}</td>
                <td>{x.existencias.filter((e) => Number(e.cantidad) > 0).length === 0 ? <span className="suave">Sin existencia</span>
                  : x.existencias.filter((e) => Number(e.cantidad) > 0).map((e) => <div key={e.almacenId}><b>{e.sucursal}</b>: {Number(e.cantidad)}{e.ubicacion ? ` · ${e.ubicacion}` : ""}</div>)}</td>
                <td><button className="boton chico" onClick={() => editar(x.id)}>Ficha</button></td>
              </tr>))}
          </tbody>
        </table>
        {lista.length === 0 && !error && <p className="suave" style={{ padding: 10 }}>Nada con esos filtros. Si el neumático ya existe como producto, complete su ficha en «Fichas pendientes».</p>}
      </div>
    </>
  );
}

function Pendientes({ editar }: { editar: (id: string) => void }) {
  const [q, setQ] = useState("");
  const d = useDatos<SinFicha[]>(`/central/gomera/sin-ficha?q=${encodeURIComponent(q)}`, [q]);
  return (
    <>
      <p className="suave" style={{ margin: "10px 0 6px" }}>Productos que todavía no tienen medida ni tipo de vehículo. Complete la ficha de cada neumático: la medida se agrega al nombre para que las cajas lo encuentren. Los productos nuevos se crean en Productos y se completan aquí.</p>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar producto" style={{ width: 240 }} />
      <Aviso texto={d.error} />
      <div className="tabla-contenedor" style={{ marginTop: 10 }}>
        <table className="tabla"><thead><tr><th>Código</th><th>Producto</th><th>Marca</th><th></th></tr></thead>
          <tbody>{(d.datos ?? []).map((x) => (
            <tr key={x.id}><td>{x.sku}</td><td>{x.nombre}</td><td>{x.marca ?? ""}</td><td><button className="boton chico primario" onClick={() => editar(x.id)}>Completar ficha</button></td></tr>))}</tbody>
        </table>
        {(d.datos ?? []).length === 0 && !d.cargando && <p className="suave" style={{ padding: 10 }}>No quedan productos sin ficha.</p>}
      </div>
    </>
  );
}

function EditorFicha({ id, cerrar }: { id: string; cerrar: () => void }) {
  const f = useDatos<Ficha>(`/central/gomera/neumatico/${id}`, [id]);
  const ubic = useDatos<Ubic[]>("/central/farmacia/ubicaciones", []);
  const [medida, setMedida] = useState("");
  const [tipo, setTipo] = useState("CARRO");
  const [condicion, setCondicion] = useState("NUEVO");
  const [modelo, setModelo] = useState("");
  const [indice, setIndice] = useState("");
  const [vida, setVida] = useState("");
  const [notas, setNotas] = useState("");
  const [ubicaciones, setUbicaciones] = useState<string[]>([]);
  const [enNombre, setEnNombre] = useState(true);
  const [controlaDot, setControlaDot] = useState(true);
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" } | null>(null);
  useEffect(() => {
    const d = f.datos;
    if (!d) return;
    setMedida(d.medida ?? ""); setTipo(d.tipo ?? "CARRO"); setCondicion(d.condicion ?? "NUEVO"); setModelo(d.modelo ?? ""); setIndice(d.indice ?? "");
    setVida(d.vidaBanda == null ? "" : String(d.vidaBanda)); setNotas(d.notas ?? ""); setUbicaciones(d.ubicaciones ?? []); if (d.medida) setControlaDot(!!d.controlaDot);
  }, [f.datos]);
  const guardar = async () => {
    setMsg(null);
    try {
      await api(`/central/gomera/neumatico/${id}`, { metodo: "PUT", cuerpo: { medida, tipo, condicion, modelo: modelo || null, indice: indice || null, vidaBanda: condicion === "USADO" && vida !== "" ? Number(vida) : null, notas: notas || null, ubicaciones, medidaEnNombre: enNombre, controlaDot } });
      setMsg({ t: "Ficha guardada.", tipo: "ok" });
      setTimeout(cerrar, 600);
    } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
  };
  const med = medida.trim() ? leerMedida(medida) : null;
  const alternar = (u: string) => setUbicaciones((l) => (l.includes(u) ? l.filter((x) => x !== u) : [...l, u]));
  return (
    <div className="tarjeta" style={{ marginTop: 10, borderColor: "var(--primario, #2563eb)" }}>
      <b>Ficha del neumático</b> <span className="suave">{f.datos?.nombre}</span>
      <div className="panel cab-compra" style={{ flexWrap: "wrap", marginTop: 8 }}>
        <label className="campo"><span>Medida</span><input value={medida} onChange={(e) => setMedida(e.target.value)} placeholder="205/55R16" style={{ width: 140 }} /></label>
        <label className="campo"><span>Vehículo</span><select value={tipo} onChange={(e) => setTipo(e.target.value)}>{TIPOS_NEUMATICO.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}</select></label>
        <label className="campo"><span>Condición</span><select value={condicion} onChange={(e) => setCondicion(e.target.value)}><option value="NUEVO">Nuevo</option><option value="USADO">Usado</option></select></label>
        {condicion === "USADO" && <label className="campo"><span>% de banda que le queda</span><input className="numero" inputMode="numeric" value={vida} onChange={(e) => setVida(e.target.value.replace(/\D/g, "").slice(0, 3))} style={{ width: 90 }} /></label>}
        <label className="campo"><span>Modelo</span><input value={modelo} onChange={(e) => setModelo(e.target.value)} placeholder="Primacy 4" style={{ width: 140 }} /></label>
        <label className="campo"><span>Carga y velocidad</span><input value={indice} onChange={(e) => setIndice(e.target.value)} placeholder="91V" style={{ width: 90 }} /></label>
      </div>
      {medida.trim() && !med && <Aviso tipo="info" texto="No entiendo esa medida: use 205/55R16, 90/90-18, 11R22.5 o 26x1.95." />}
      <label className="campo" style={{ marginTop: 8 }}><span>Notas</span><input value={notas} onChange={(e) => setNotas(e.target.value)} style={{ width: "100%" }} /></label>
      <div style={{ marginTop: 8 }}>
        <span className="suave">Ubicación en el almacén (puede estar en más de una)</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
          {(ubic.datos ?? []).filter((u) => u.activo || ubicaciones.includes(u.id)).map((u) => (
            <button key={u.id} className={"boton chico" + (ubicaciones.includes(u.id) ? " primario" : "")} onClick={() => alternar(u.id)}>{u.estante}-{u.nivel}-{u.posicion} <span className="suave">{u.almacen}</span></button>))}
          {(ubic.datos ?? []).length === 0 && <span className="suave">Primero cree los racks en la pestaña Ubicaciones.</span>}
        </div>
      </div>
      <label style={{ display: "block", marginTop: 8 }}><input type="checkbox" checked={enNombre} onChange={(e) => setEnNombre(e.target.checked)} /> Poner la medida en el nombre del producto (recomendado: así la caja lo encuentra escribiéndola)</label>
      {condicion === "NUEVO" && <label style={{ display: "block", marginTop: 4 }}><input type="checkbox" checked={controlaDot} onChange={(e) => setControlaDot(e.target.checked)} /> Pedir el DOT al recibir la compra y vender primero el más viejo</label>}
      <p className="suave" style={{ margin: "6px 0" }}>El DOT (semana y año de fabricación, por ejemplo 2324) se anota al recibir la compra, en el campo de lote.</p>
      {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button className="boton primario" disabled={!med} onClick={guardar}>Guardar ficha</button>
        <button className="boton" onClick={cerrar}>Cerrar</button>
      </div>
    </div>
  );
}

function Medidas() {
  const d = useDatos<Medida[]>("/central/gomera/medidas", []);
  return (
    <>
      <p className="suave" style={{ margin: "10px 0 6px" }}>Medidas que maneja, con lo que hay en todas las sucursales y lo vendido en los últimos 90 días. Compre más de las que se venden y no tienen existencia.</p>
      <Aviso texto={d.error} />
      <div className="tabla-contenedor">
        <table className="tabla"><thead><tr><th>Medida</th><th>Vehículo</th><th>Modelos</th><th>Hay</th><th>Vendidos (90 días)</th></tr></thead>
          <tbody>{(d.datos ?? []).map((x) => (
            <tr key={x.medida + x.tipo}><td><b>{x.medida}</b></td><td>{nombreTipo(x.tipo)}</td><td className="numero">{x.modelos}</td>
              <td className="numero" style={{ color: Number(x.existencia) <= 0 && Number(x.vendidos90) > 0 ? "#b91c1c" : undefined }}>{Number(x.existencia)}</td>
              <td className="numero">{Number(x.vendidos90)}</td></tr>))}</tbody>
        </table>
        {(d.datos ?? []).length === 0 && !d.cargando && <p className="suave" style={{ padding: 10 }}>Todavía no hay neumáticos con ficha.</p>}
      </div>
    </>
  );
}

function Antiguedad() {
  const d = useDatos<Viejo[]>("/central/gomera/antiguedad", []);
  return (
    <>
      <p className="suave" style={{ margin: "10px 0 6px" }}>Neumáticos nuevos en existencia, del más viejo al más nuevo según el DOT que se anotó al comprarlos. Pasados {ANIOS_DOT} años desde la fabricación se marcan: véndalos primero o con descuento.</p>
      <Aviso texto={d.error} />
      <div className="tabla-contenedor">
        <table className="tabla"><thead><tr><th>Medida</th><th>Neumático</th><th>DOT</th><th>Edad</th><th>Cantidad</th><th>Sucursal</th></tr></thead>
          <tbody>{(d.datos ?? []).map((x, i) => (
            <tr key={i} style={x.pasada ? { color: "#b91c1c" } : undefined}><td><b>{x.medida}</b></td><td>{x.nombre}</td><td>{x.dot}</td>
              <td className="numero">{x.edad} años{x.pasada ? " ⚠" : ""}</td><td className="numero">{Number(x.cantidad)}</td><td>{x.sucursal}</td></tr>))}</tbody>
        </table>
        {(d.datos ?? []).length === 0 && !d.cargando && <p className="suave" style={{ padding: 10 }}>No hay neumáticos con DOT en existencia. Anote el DOT en el campo de lote al recibir cada compra.</p>}
      </div>
    </>
  );
}
