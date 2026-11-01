import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Aviso, Encabezado } from "../ui";

/**
 * Pantalla del cliente: segunda pantalla de la caja que muestra lo que se digita y el total a pagar.
 * Mientras no se cobra presenta las ofertas del negocio que se arman aquí.
 */
interface Oferta { id: string; titulo: string; texto: string; precio: string; imagen: string | null; activa: boolean; desde: string | null; hasta: string | null }
interface Datos { activa: boolean; bienvenida: string; segundos: number; ofertas: Oferta[] }
const VACIO: Datos = { activa: true, bienvenida: "", segundos: 10, ofertas: [] };

/** Reduce la imagen (máx. 900 px, JPEG) para que pese poco en todas las cajas. */
async function procesarImagen(archivo: File): Promise<string> {
  const url = URL.createObjectURL(archivo);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const escala = Math.min(1, 900 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.width * escala));
    c.height = Math.max(1, Math.round(img.height * escala));
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    for (const q of [0.82, 0.7, 0.55, 0.4]) {
      const d = c.toDataURL("image/jpeg", q);
      if (d.length <= 250000) return d;
    }
    throw new Error("La imagen sigue muy pesada: use una más pequeña");
  } finally { URL.revokeObjectURL(url); }
}

export function PantallaCliente() {
  const [f, setF] = useState<Datos | null>(null);
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const archivo = useRef<HTMLInputElement>(null);
  const [paraImagen, setParaImagen] = useState<string | null>(null);
  useEffect(() => { api<Partial<Datos>>("/central/marca/pantalla-cliente").then((d) => setF({ ...VACIO, ...d, ofertas: d.ofertas ?? [] })).catch((e) => setMsg({ t: (e as Error).message, tipo: "error" })); }, []);
  if (!f) return <><Encabezado titulo="Pantalla del cliente" /><Aviso texto={msg?.t ?? ""} /></>;

  const cambiar = (id: string, x: Partial<Oferta>) => setF({ ...f, ofertas: f.ofertas.map((o) => (o.id === id ? { ...o, ...x } : o)) });
  const agregar = () => setF({ ...f, ofertas: [...f.ofertas, { id: crypto.randomUUID(), titulo: "", texto: "", precio: "", imagen: null, activa: true, desde: null, hasta: null }] });
  const quitar = (id: string) => setF({ ...f, ofertas: f.ofertas.filter((o) => o.id !== id) });
  const mover = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= f.ofertas.length) return;
    const o = [...f.ofertas];
    [o[i], o[j]] = [o[j]!, o[i]!];
    setF({ ...f, ofertas: o });
  };
  const subir = async (file: File | undefined) => {
    const id = paraImagen;
    setParaImagen(null);
    if (!file || !id) return;
    try { cambiar(id, { imagen: await procesarImagen(file) }); } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
  };
  const guardar = async () => {
    setGuardando(true); setMsg(null);
    try { await api("/central/marca/pantalla-cliente", { metodo: "PUT", cuerpo: f }); setMsg({ t: "Guardado. Las cajas lo reciben en unos minutos.", tipo: "ok" }); }
    catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
    setGuardando(false);
  };

  return (
    <>
      <Encabezado titulo="Pantalla del cliente" descripcion="Segunda pantalla de la caja: muestra al cliente los productos que se digitan y el monto a pagar. Mientras no se cobra, presenta las ofertas del negocio.">
        <button className="boton primario" disabled={guardando} onClick={guardar}>Guardar</button>
      </Encabezado>
      {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}
      <input ref={archivo} type="file" accept="image/*" hidden onChange={(e) => { subir(e.target.files?.[0]); e.target.value = ""; }} />

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Cómo se ve</h3>
        <label className="check"><input type="checkbox" checked={f.activa} onChange={(e) => setF({ ...f, activa: e.target.checked })} /> Mostrar las ofertas mientras no se cobra</label>
        <div className="dos-col">
          <label className="campo"><span>Mensaje de bienvenida (si no hay ofertas)</span><input maxLength={80} placeholder="Bienvenido a su tienda" value={f.bienvenida} onChange={(e) => setF({ ...f, bienvenida: e.target.value })} /></label>
          <label className="campo"><span>Segundos por oferta</span><input type="number" min={4} max={60} value={f.segundos} onChange={(e) => setF({ ...f, segundos: Math.max(4, Math.min(60, Number(e.target.value) || 10)) })} /></label>
        </div>
        <p className="suave pequeno" style={{ marginBottom: 0 }}>En cada caja se abre con el botón «Pantalla del cliente». En la aplicación de escritorio se abre sola si el equipo tiene un segundo monitor.</p>
      </div>

      <div className="panel">
        <div className="fila-acciones" style={{ marginTop: 0 }}>
          <h3 style={{ margin: 0 }}>Ofertas ({f.ofertas.length} de 10)</h3><span className="flex" />
          <button className="boton" disabled={f.ofertas.length >= 10} onClick={agregar}>Agregar oferta</button>
        </div>
        {!f.ofertas.length && <p className="suave">Aún no hay ofertas. Agrega una con su título, texto, precio y una imagen.</p>}
        {f.ofertas.map((o, i) => (
          <div key={o.id} className="seg-fila" style={{ alignItems: "flex-start", gap: 16 }}>
            <div style={{ width: 150, flexShrink: 0 }}>
              {o.imagen
                ? <img src={o.imagen} alt="" style={{ width: 150, height: 100, objectFit: "cover", borderRadius: 8, display: "block" }} />
                : <div className="suave pequeno" style={{ width: 150, height: 100, border: "1px dashed var(--borde)", borderRadius: 8, display: "grid", placeItems: "center" }}>Sin imagen</div>}
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                <button className="boton" onClick={() => { setParaImagen(o.id); archivo.current?.click(); }}>{o.imagen ? "Cambiar" : "Subir imagen"}</button>
                {o.imagen && <button className="boton" onClick={() => cambiar(o.id, { imagen: null })}>Quitar</button>}
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="dos-col">
                <label className="campo"><span>Título</span><input maxLength={60} placeholder="2x1 en cervezas" value={o.titulo} onChange={(e) => cambiar(o.id, { titulo: e.target.value })} /></label>
                <label className="campo"><span>Precio o destacado (opcional)</span><input maxLength={30} placeholder="RD$ 250" value={o.precio} onChange={(e) => cambiar(o.id, { precio: e.target.value })} /></label>
              </div>
              <label className="campo"><span>Texto (opcional)</span><input maxLength={160} value={o.texto} onChange={(e) => cambiar(o.id, { texto: e.target.value })} /></label>
              <div className="dos-col">
                <label className="campo"><span>Desde (opcional)</span><input type="date" value={o.desde ?? ""} onChange={(e) => cambiar(o.id, { desde: e.target.value || null })} /></label>
                <label className="campo"><span>Hasta (opcional)</span><input type="date" value={o.hasta ?? ""} onChange={(e) => cambiar(o.id, { hasta: e.target.value || null })} /></label>
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <label className="check"><input type="checkbox" checked={o.activa} onChange={(e) => cambiar(o.id, { activa: e.target.checked })} /> Activa</label>
                <button className="boton" disabled={i === 0} onClick={() => mover(i, -1)}>↑</button>
                <button className="boton" disabled={i === f.ofertas.length - 1} onClick={() => mover(i, 1)}>↓</button>
                <button className="boton" onClick={() => quitar(o.id)}>Quitar oferta</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
