import { useEffect, useRef, useState } from "react";
import { Icono } from "../Iconos";
import { extraerPaleta, temaAdmin, temaTerminal, contraste } from "@factpos/compartido";
import { api } from "../api";
import { aplicarTemaAdmin } from "../tema";
import { Aviso, Encabezado } from "../ui";

interface MarcaDatos { nombre: string; logo: string | null; primario: string; secundario: string | null; logoEnTicket: boolean }

/** Reduce el logo (máx. 320 px) y extrae su paleta. */
async function procesarLogo(archivo: File): Promise<{ dataUrl: string; paleta: string[] }> {
  const url = URL.createObjectURL(archivo);
  const img = new Image();
  img.src = url;
  await img.decode();
  const escala = Math.min(1, 320 / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(img.width * escala));
  c.height = Math.max(1, Math.round(img.height * escala));
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const dataUrl = c.toDataURL("image/png");
  // Para la paleta basta una muestra pequeña
  const m = document.createElement("canvas");
  m.width = 64; m.height = Math.max(1, Math.round((64 * c.height) / c.width));
  m.getContext("2d")!.drawImage(c, 0, 0, m.width, m.height);
  const px = m.getContext("2d")!.getImageData(0, 0, m.width, m.height).data;
  URL.revokeObjectURL(url);
  return { dataUrl, paleta: extraerPaleta(px, 8) };
}

/**
 * Marca del cliente (tema camaleón): se sube el logo, el sistema propone sus
 * colores y toda la plataforma (Administración, Terminal y ticket) se adapta,
 * siempre con texto legible.
 */
export function Marca() {
  const [m, setM] = useState<MarcaDatos | null>(null);
  const [paleta, setPaleta] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" } | null>(null);
  const archivo = useRef<HTMLInputElement>(null);
  useEffect(() => { api<MarcaDatos>("/central/marca").then(setM); }, []);
  if (!m) return <p className="suave">Cargando…</p>;

  const subir = async (f: File | undefined) => {
    if (!f) return;
    try {
      const r = await procesarLogo(f);
      setPaleta(r.paleta);
      const colores = r.paleta.filter((c) => contraste(c, "#ffffff") > 1.3); // descarta el blanco del fondo
      setM({ ...m, logo: r.dataUrl, primario: colores[0] ?? m.primario, secundario: colores[1] ?? null });
      setMsg({ t: "Colores tomados del logo. Puede cambiarlos antes de guardar.", tipo: "ok" });
    } catch {
      setMsg({ t: "No se pudo leer la imagen. Use PNG, JPG, WebP o SVG.", tipo: "error" });
    }
  };
  const guardar = async () => {
    try {
      await api("/central/marca", { metodo: "PUT", cuerpo: { logo: m.logo, primario: m.primario, secundario: m.secundario, logoEnTicket: m.logoEnTicket } });
      aplicarTemaAdmin({ primario: m.primario, secundario: m.secundario });
      setMsg({ t: "Marca guardada. Las terminales la toman al iniciar.", tipo: "ok" });
    } catch (e) {
      setMsg({ t: (e as Error).message, tipo: "error" });
    }
  };

  const ta = temaAdmin({ primario: m.primario, secundario: m.secundario });
  const tt = temaTerminal({ primario: m.primario, secundario: m.secundario }, "claro"); // la terminal viene en tema claro
  const muestra = [...new Set([...paleta, m.primario, ...(m.secundario ? [m.secundario] : [])])];

  return (
    <>
      <Encabezado titulo="Marca" descripcion="Suba el logo del negocio: el sistema toma sus colores y se adapta a ellos.">
        <button className="boton primario" onClick={guardar}>Guardar marca</button>
      </Encabezado>
      {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}
      <div className="marca-grid">
        <div className="panel">
          <h3>Logo</h3>
          <div className="logo-caja" onClick={() => archivo.current?.click()}>
            {m.logo ? <img src={m.logo} alt="Logo del negocio" /> : <span className="suave">Toque para subir el logo</span>}
          </div>
          <input ref={archivo} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden onChange={(e) => subir(e.target.files?.[0])} />
          <div className="fila-acciones">
            <button className="boton" onClick={() => archivo.current?.click()}>{m.logo ? "Cambiar logo" : "Subir logo"}</button>
            {m.logo && <button className="enlace" onClick={() => setM({ ...m, logo: null })}>Quitar</button>}
          </div>
          <label className="check" style={{ marginTop: 12 }}>
            <input type="checkbox" checked={m.logoEnTicket} onChange={(e) => setM({ ...m, logoEnTicket: e.target.checked })} /> Imprimir el logo en el ticket
          </label>

          <h3 style={{ marginTop: 20 }}>Colores</h3>
          {muestra.length > 0 && <p className="suave pequeno">Del logo (toque para usarlo):</p>}
          <div className="paleta">
            {muestra.map((c) => (
              <button key={c} className="muestra" style={{ background: c }} title={c}
                onClick={() => setM({ ...m, primario: c })} onContextMenu={(e) => { e.preventDefault(); setM({ ...m, secundario: c }); }} />
            ))}
          </div>
          <div className="dos-col">
            <label className="campo"><span>Color principal</span>
              <span className="color-campo"><input type="color" value={m.primario} onChange={(e) => setM({ ...m, primario: e.target.value })} /><input value={m.primario} onChange={(e) => /^#[0-9a-f]{0,6}$/i.test(e.target.value) && setM({ ...m, primario: e.target.value })} /></span>
            </label>
            <label className="campo"><span>Color secundario</span>
              <span className="color-campo"><input type="color" value={m.secundario ?? "#14324a"} onChange={(e) => setM({ ...m, secundario: e.target.value })} /><input value={m.secundario ?? ""} placeholder="Opcional" onChange={(e) => setM({ ...m, secundario: e.target.value || null })} /></span>
            </label>
          </div>
          <p className="suave pequeno">Clic en una muestra = color principal · clic derecho = secundario. Si un color no se lee bien, el sistema ajusta su tono automáticamente.</p>
        </div>

        <div className="panel">
          <h3>Vista previa</h3>
          <p className="suave pequeno">Terminal de venta</p>
          <div className="prev-terminal" style={{ boxShadow: `inset 0 3px 0 ${tt["--barra-marca"]}` }}>
            <div className="prev-barra">
              {m.logo ? <img src={m.logo} alt="" /> : <b>{m.nombre}</b>}
              <span className="prev-caja">Caja 1 · En línea</span>
            </div>
            <div className="prev-cuerpo">
              <div className="prev-fila" style={{ boxShadow: `inset 3px 0 0 ${tt["--primario"]}`, background: `color-mix(in srgb, ${tt["--primario"]} 7%, #fff)` }}>
                <span className="prev-num" style={{ background: tt["--primario"] }}>1</span>Producto seleccionado
              </div>
              <div className="prev-fila">Otro producto</div>
              <div className="prev-total" style={{ boxShadow: `inset 0 3px 0 ${tt["--primario"]}` }}><span>Total a pagar</span><b>RD$1,445.00</b></div>
              <div className="prev-cobrar" style={{ background: tt["--cobrar"], color: tt["--texto-sobre-cobrar"] }}>Cobrar</div>
            </div>
          </div>
          <p className="suave pequeno" style={{ marginTop: 16 }}>Administración</p>
          <div className="prev-admin">
            <div className="prev-lateral">
              {m.logo ? <img src={m.logo} alt="" /> : <b>{m.nombre}</b>}
              <span className="activo" style={{ background: `color-mix(in srgb, ${ta["--primario"]} 10%, #fff)`, color: ta["--primario"], boxShadow: `inset 3px 0 0 ${ta["--primario"]}` }}>
                <Icono n="productos" tamano={14} />Inventario
              </span>
              <span><Icono n="precios" tamano={14} />Precios</span>
              <span><Icono n="reportes" tamano={14} />Reportes</span>
            </div>
            <div className="prev-contenido">
              <b>Resumen</b>
              <span className="prev-kpi"><small>Venta de hoy</small><b>RD$48,250</b></span>
              <span className="prev-boton" style={{ background: ta["--primario"], color: ta["--texto-sobre-primario"] }}>Nueva oferta</span>
            </div>
          </div>
          <p className="suave pequeno" style={{ marginTop: 16 }}>Ticket (impresora térmica)</p>
          <div className="prev-ticket">
            {m.logo && m.logoEnTicket && <img src={m.logo} alt="" />}
            <b>{m.nombre}</b>
            <span>Factura de Consumo Electrónica</span>
          </div>
        </div>
      </div>
    </>
  );
}
