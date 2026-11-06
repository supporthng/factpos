import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Aviso } from "../ui";

/**
 * Buscar fotos de productos por su código de barras (Open Food Facts). Solo busca por el código exacto, nunca por el nombre.
 * Primero se buscan, luego se revisan (se desmarca la que no sea) y solo entonces se guardan. Nunca pisa una foto existente.
 */
interface Pendiente { id: string; sku: string; nombre: string; marca: string | null; barras: string }
interface Resultado { p: Pendiente; imagen: string | null; nombreOff: string | null; motivo: string | null; marcada: boolean }

/** Misma reducción que al subir una foto a mano: 320 px en WebP, liviana para sincronizar a las cajas. */
function reducir(dataUrl: string): Promise<string> {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      try {
        const k = Math.min(1, 320 / Math.max(img.width, img.height));
        const cv = document.createElement("canvas");
        cv.width = Math.max(1, Math.round(img.width * k)); cv.height = Math.max(1, Math.round(img.height * k));
        cv.getContext("2d")!.drawImage(img, 0, 0, cv.width, cv.height);
        res(cv.toDataURL("image/webp", 0.82));
      } catch { res(dataUrl); }
    };
    img.onerror = () => res(dataUrl);
    img.src = dataUrl;
  });
}

export function FotosProductos({ onCerrar, onTerminado }: { onCerrar: () => void; onTerminado: () => void }) {
  const [pend, setPend] = useState<Pendiente[] | null>(null);
  const [error, setError] = useState("");
  const [res, setRes] = useState<Resultado[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [hecho, setHecho] = useState(0);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState("");
  const parar = useRef(false);

  useEffect(() => {
    api<Pendiente[]>("/central/productos/fotos/pendientes").then(setPend).catch((e) => setError(e.message));
  }, []);

  const buscar = async () => {
    if (!pend) return;
    parar.current = false; setBuscando(true); setRes([]); setHecho(0); setMensaje(""); setError("");
    const cola = [...pend]; let hechos = 0;
    // Pocas consultas a la vez: Open Food Facts es un servicio público gratuito
    const trabajador = async () => {
      while (!parar.current) {
        const p = cola.shift();
        if (!p) return;
        let r: Resultado;
        try {
          const d = await api<{ imagen: string | null; motivo: string | null; nombre: string | null }>(`/central/productos/fotos/sugerencia/${p.barras}`);
          r = { p, imagen: d.imagen, nombreOff: d.nombre, motivo: d.motivo, marcada: !!d.imagen };
        } catch (e: any) {
          r = { p, imagen: null, nombreOff: null, motivo: e?.message ?? "error", marcada: false };
        }
        hechos++; setHecho(hechos);
        setRes((x) => [...x, r]);
      }
    };
    await Promise.all([trabajador(), trabajador(), trabajador()]);
    setBuscando(false);
  };

  const conFoto = res.filter((r) => r.imagen);
  const sinFoto = res.filter((r) => !r.imagen);
  const marcadas = conFoto.filter((r) => r.marcada);
  const alternar = (id: string, v?: boolean) => setRes((x) => x.map((r) => (r.p.id === id ? { ...r, marcada: v ?? !r.marcada } : r)));
  const todas = (v: boolean) => setRes((x) => x.map((r) => (r.imagen ? { ...r, marcada: v } : r)));

  const guardar = async () => {
    setGuardando(true); setError(""); setMensaje("");
    let ok = 0, fallos = 0;
    for (const r of marcadas) {
      try {
        await api(`/central/productos/${r.p.id}/imagen`, { metodo: "PUT", cuerpo: { imagen: await reducir(r.imagen!) } });
        ok++;
      } catch { fallos++; }
    }
    setGuardando(false);
    setMensaje(`${ok} foto${ok === 1 ? "" : "s"} guardada${ok === 1 ? "" : "s"}${fallos ? ` · ${fallos} no se pudo guardar (quizá ya tenían foto)` : ""}. Las cajas la reciben en la próxima sincronización.`);
    const hechas = new Set(marcadas.map((r) => r.p.id));
    setRes((x) => x.filter((r) => !hechas.has(r.p.id)));
    onTerminado();
  };

  return (
    <div className="fondo-modal" role="dialog" aria-modal="true" aria-label="Buscar fotos de productos">
      <div className="modal ancho fotos-modal">
        <div className="fotos-cab">
          <div>
            <h2>Buscar fotos de productos</h2>
            <p className="suave">Se busca solo por código de barras en Open Food Facts. Usted revisa cada foto antes de guardarla; no se cambia ninguna foto existente.</p>
          </div>
          <button className="boton fantasma" onClick={onCerrar} disabled={guardando}>Cerrar</button>
        </div>
        <Aviso texto={error} />
        <Aviso texto={mensaje} tipo="ok" />
        {!pend && !error && <div className="cargando">Cargando…</div>}
        {pend && (
          <div className="fotos-barra">
            <span><b>{pend.length}</b> producto{pend.length === 1 ? "" : "s"} sin foto con código de barras.</span>
            {!buscando
              ? <button className="boton primario" onClick={buscar} disabled={!pend.length || guardando}>{res.length ? "Buscar de nuevo" : "Buscar fotos"}</button>
              : <button className="boton" onClick={() => { parar.current = true; }}>Detener</button>}
            {(buscando || hecho > 0) && <span className="suave">{hecho} de {pend.length} revisados</span>}
          </div>
        )}
        {conFoto.length > 0 && (
          <>
            <div className="fotos-barra">
              <b>{conFoto.length} foto{conFoto.length === 1 ? "" : "s"} encontrada{conFoto.length === 1 ? "" : "s"}</b>
              <button className="enlace" onClick={() => todas(true)}>Marcar todas</button>
              <button className="enlace" onClick={() => todas(false)}>Desmarcar todas</button>
              <button className="boton primario" onClick={guardar} disabled={!marcadas.length || buscando || guardando}>
                {guardando ? "Guardando…" : `Guardar ${marcadas.length} marcada${marcadas.length === 1 ? "" : "s"}`}
              </button>
            </div>
            <div className="fotos-rejilla">
              {conFoto.map((r) => (
                <label key={r.p.id} className={"foto-tarjeta" + (r.marcada ? " marcada" : "")}>
                  <img src={r.imagen!} alt="" />
                  <input type="checkbox" checked={r.marcada} onChange={() => alternar(r.p.id)} />
                  <div className="foto-nombre">{r.p.nombre}</div>
                  <div className="foto-off suave">Open Food Facts: {r.nombreOff ?? "—"}</div>
                  <div className="foto-off suave">{r.p.barras}</div>
                </label>
              ))}
            </div>
          </>
        )}
        {!buscando && hecho > 0 && sinFoto.length > 0 && (
          <details className="fotos-sin">
            <summary>{sinFoto.length} sin foto disponible</summary>
            <ul>{sinFoto.map((r) => <li key={r.p.id}>{r.p.nombre} <span className="suave">({r.p.barras}) · {r.motivo}</span></li>)}</ul>
          </details>
        )}
      </div>
    </div>
  );
}
