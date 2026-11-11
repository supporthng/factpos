import { imprimirHtml } from "../impresion";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { CONFIG, api, esLocal } from "../api";
import { Aviso, Encabezado, SelectorSucursal, useDatos } from "../ui";

interface Consultas {
  dias: number; total: number; sinPrecio: number;
  masConsultados: { codigo: string; descripcion: string | null; veces: number }[];
  /** Códigos que se pasaron por el lector y no tenían precio. */
  sinPrecioLista: { codigo: string; veces: number; ultima: string }[];
}

/** Todo lo de la consulta de precios por internet en un solo lugar: interruptor, ubicación, distancia, código del QR, cartel y bloqueos. */
function ConsultaInternet({ sucursalId }: { sucursalId: string }) {
  type Aj = { empresaEnPortal?: boolean | null; empresaCorta?: string; enlaceInternet?: string | null; consultaWeb?: boolean; radioM?: number; ubicaciones?: Record<string, { lat: number; lng: number }>; codigos?: Record<string, string> };
  const { datos, recargar } = useDatos<Aj>("/central/verificador/ajustes");
  const [activa, setActiva] = useState(false);
  const [coord, setCoord] = useState("");
  const [radio, setRadio] = useState(150);
  const [msg, setMsg] = useState("");
  const [ok, setOk] = useState("");
  const [guardando, setGuardando] = useState(false);
  const guardada = sucursalId ? datos?.ubicaciones?.[sucursalId] : undefined;
  const codigo = sucursalId ? datos?.codigos?.[sucursalId] : undefined;
  // El formulario parte de lo guardado, así que al volver a abrir la pantalla se ve la configuración tal como quedó
  useEffect(() => {
    if (!datos) return;
    setActiva(datos.consultaWeb ?? false);
    setRadio(datos.radioM ?? 150);
    setCoord(guardada ? `${guardada.lat}, ${guardada.lng}` : "");
  }, [datos, guardada?.lat, guardada?.lng, sucursalId]);

  const usarMia = () => {
    setMsg(""); setOk("");
    if (!navigator.geolocation) { setMsg("Este navegador no permite leer la ubicación."); return; }
    navigator.geolocation.getCurrentPosition((p) => setCoord(`${p.coords.latitude.toFixed(6)}, ${p.coords.longitude.toFixed(6)}`),
      () => setMsg("No se pudo leer la ubicación (la app de escritorio y las PC sin GPS suelen no poder). Pega las coordenadas o el enlace de Google Maps."), { enableHighAccuracy: true, timeout: 15000 });
  };
  const guardar = async () => {
    setMsg(""); setOk("");
    if (!sucursalId) { setMsg("Elige la sucursal."); return; }
    if (/(?:maps\.app\.goo\.gl|goo\.gl\/maps)\//i.test(coord)) { setMsg("Ese enlace corto de Google Maps no trae las coordenadas. Ábrelo en el navegador y copia la dirección completa de la barra, o los números."); return; }
    const c = coord.trim() ? coordenadasDeTexto(coord) : null;
    if (coord.trim() && !c) { setMsg("No encontré coordenadas. Pega los números (18.486100, -69.931200) o el enlace de Google Maps."); return; }
    setGuardando(true);
    try {
      const r = Math.min(1000, Math.max(30, Math.round(Number(radio) || 150)));
      await api("/central/verificador/ajustes", { metodo: "PUT", cuerpo: { consultaWeb: activa, radioM: r } });
      if ((c?.lat ?? null) !== (guardada?.lat ?? null) || (c?.lng ?? null) !== (guardada?.lng ?? null)) {
        await api("/central/verificador/ubicacion", { metodo: "PUT", cuerpo: { sucursalId, lat: c?.lat ?? null, lng: c?.lng ?? null } });
      }
      recargar(); setOk("Guardado.");
    } catch (e) { setMsg((e as Error).message); }
    finally { setGuardando(false); }
  };
  const cambiarCodigo = async (quitar: boolean) => {
    setMsg(""); setOk("");
    if (!quitar && codigo && !window.confirm("Se creará un código nuevo. Los QR ya impresos dejan de funcionar y hay que imprimir el cartel otra vez. ¿Continuar?")) return;
    try { await api("/central/verificador/codigo-consulta", { metodo: "PUT", cuerpo: { sucursalId, quitar } }); recargar(); setOk(quitar ? "Código quitado: cualquier QR de la tienda vuelve a funcionar." : "Código nuevo creado. Imprime el cartel otra vez."); }
    catch (e) { setMsg((e as Error).message); }
  };

  const internet = datos?.enlaceInternet && sucursalId ? `${datos.enlaceInternet}?sucursal=${sucursalId}${codigo ? `&k=${codigo}` : ""}` : "";
  const [img, setImg] = useState("");
  useEffect(() => {
    let vivo = true;
    if (!internet) { setImg(""); return; }
    QRCode.toDataURL(internet, { margin: 2, width: 480, errorCorrectionLevel: "M" }).then((d) => { if (vivo) setImg(d); }).catch(() => { if (vivo) setImg(""); });
    return () => { vivo = false; };
  }, [internet]);
  const imprimir = () => {
    const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
    const pasos = ["Escanea este código con la cámara del celular", "Permite la ubicación cuando el celular lo pida", "Escanea el código de barras del producto y mira su precio"];
    void imprimirHtml(`<!doctype html><meta charset="utf-8"><title>Consulta de precios</title>
<body style="font-family:system-ui,sans-serif;text-align:center;padding:36px;color:#10202e">
<h1>Consulta el precio desde tu celular</h1>
<ol style="display:inline-block;text-align:left;font-size:22px;line-height:1.5;margin:10px 0 0;padding-left:30px">${pasos.map((t) => `<li>${esc(t)}</li>`).join("")}</ol>
<img src="${img}" style="width:340px;margin:10px auto;display:block" alt="">
<p style="font-size:18px;color:#5b6b7a">Funciona estando dentro de la tienda.</p></body>`);
  };

  const [verBloqueos, setVerBloqueos] = useState(false);
  const { datos: bl } = useDatos<{ bloqueos: { creadoEn: string; motivo: string; distanciaM: number | null; equipo: string | null; sucursal: string }[] }>(
    verBloqueos ? `/central/verificador/bloqueos${sucursalId ? `?sucursal=${sucursalId}` : ""}` : "", [verBloqueos, sucursalId]);

  const paso = (listo: boolean, texto: string) => <li style={{ color: listo ? "#1f7a3d" : "#b3261e" }}>{listo ? "✓" : "✗"} {texto}</li>;
  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <h3 style={{ marginTop: 0 }}>Consulta de precios por internet (QR)</h3>
      <p className="suave pequeno">
        El cliente escanea el QR con la cámara del celular y ve el precio de cualquier producto, sin WiFi y solo estando dentro de la tienda.
        Solo se muestra nombre, precio y oferta: nunca costos ni existencias. Elige la sucursal arriba, ajusta y pulsa <b>Guardar</b>: todo queda guardado.
      </p>
      {!sucursalId ? <Aviso tipo="info" texto="Elige la sucursal en «Dirección del verificador» para configurar su consulta por internet." /> : (
        <>
          <ul className="pequeno" style={{ listStyle: "none", padding: 0, margin: "0 0 10px" }}>
            {paso(!!datos?.consultaWeb, "Consulta por internet encendida")}
            {paso(!!guardada, guardada ? `Ubicación de la tienda guardada (${guardada.lat}, ${guardada.lng})` : "Falta la ubicación de la tienda: sin ella no se muestran precios")}
            {paso(!!datos?.enlaceInternet && datos?.empresaEnPortal !== false, !datos?.enlaceInternet ? "Falta el nombre de la empresa en el servidor (FACTPOS_EMPRESA)" : datos.empresaEnPortal === false ? `El nombre «${datos.empresaCorta}» (FACTPOS_EMPRESA) no existe en el portal: revise cómo está escrito en el .env del servidor, o el nombre corto del cliente en Portal › Clientes. El QR no funcionará así.` : "Enlace de internet de la empresa listo")}
          </ul>
          <label className="check" style={{ fontSize: 16 }}>
            <input type="checkbox" disabled={!datos} checked={activa} onChange={(e) => setActiva(e.target.checked)} /> Consulta por internet encendida
          </label>
          <label className="campo" style={{ marginTop: 10, maxWidth: 420 }}>
            <span>Ubicación de la tienda: coordenadas o enlace de Google Maps</span>
            <input value={coord} placeholder="18.486100, -69.931200 o enlace de Google Maps" onChange={(e) => setCoord(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void guardar()} />
          </label>
          <div className="fila-acciones" style={{ marginTop: 6 }}>
            <button className="boton" onClick={usarMia}>Usar mi ubicación actual</button>
            {guardada && <a className="boton" style={{ textDecoration: "none" }} target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${guardada.lat},${guardada.lng}`}>Ver en el mapa</a>}
          </div>
          <label className="campo" style={{ marginTop: 10, maxWidth: 260 }}>
            <span>Distancia máxima a la tienda (metros)</span>
            <input type="number" min={30} max={1000} value={radio} onChange={(e) => setRadio(Number(e.target.value))} />
          </label>
          <div className="fila-acciones" style={{ marginTop: 12 }}>
            <button className="boton primario" disabled={guardando} onClick={guardar}>{guardando ? "Guardando…" : "Guardar"}</button>
          </div>
          <Aviso texto={msg} />
          {ok && <p style={{ color: "#1f7a3d", margin: "8px 0 0" }}>✓ {ok}</p>}

          <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center", marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--borde, #d9e1e6)" }}>
            {img ? <img src={img} alt="QR de la consulta de precios" width={200} height={200} style={{ border: "1px solid #dde3e8", borderRadius: 8 }} /> : <div style={{ width: 200, height: 200 }} />}
            <div style={{ flex: 1, minWidth: 240 }}>
              <label className="campo"><span>Dirección que abre el QR</span><input readOnly value={internet} onFocus={(e) => e.currentTarget.select()} /></label>
              <div className="fila-acciones" style={{ marginTop: 10 }}>
                <button className="boton" disabled={!img} onClick={imprimir}>Imprimir cartel</button>
                <a className="boton" style={{ textDecoration: "none" }} href={img} download="qr-consulta-precios.png" aria-disabled={!img}>Descargar imagen</a>
              </div>
              <p className="suave pequeno" style={{ margin: "10px 0 4px" }}>
                <b>Código de seguridad del QR:</b> {codigo ? <span className="mono">{codigo}</span> : "sin código (cualquier QR de esta tienda funciona)"}.
                Si alguien comparte el QR fuera de la tienda, crea un código nuevo e imprime el cartel otra vez.
              </p>
              <div className="fila-acciones">
                <button className="boton" onClick={() => cambiarCodigo(false)}>{codigo ? "Renovar código" : "Crear código"}</button>
                {codigo && <button className="boton" onClick={() => cambiarCodigo(true)}>Quitar código</button>}
              </div>
            </div>
          </div>

          <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--borde, #d9e1e6)" }}>
            <button className="boton" onClick={() => setVerBloqueos((v) => !v)}>{verBloqueos ? "Ocultar intentos bloqueados" : "Ver intentos bloqueados (30 días)"}</button>
            {verBloqueos && (
              <div style={{ marginTop: 8 }}>
                {!bl ? <p className="suave pequeno">Cargando…</p> : bl.bloqueos.length === 0 ? <p className="suave pequeno">Sin intentos bloqueados. Solo se ven aquí los de este servidor; los de internet llegan al servidor principal.</p> : (
                  <table className="tabla"><thead><tr><th>Cuándo</th><th>Sucursal</th><th>Motivo</th><th>Distancia</th><th>Equipo</th></tr></thead><tbody>
                    {bl.bloqueos.map((b, i) => <tr key={i}><td>{new Date(b.creadoEn).toLocaleString("es-DO")}</td><td>{b.sucursal}</td><td>{b.motivo}</td>
                      <td>{b.distanciaM == null ? "—" : b.distanciaM >= 1000 ? `${(b.distanciaM / 1000).toFixed(1)} km` : `${b.distanciaM} m`}</td><td className="mono">{b.equipo ?? ""}</td></tr>)}
                  </tbody></table>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Coordenadas escritas o pegadas: «18.4861, -69.9312», o un enlace de Google Maps / OpenStreetMap
 *  (…/@18.48,-69.93,17z · …?q=18.48,-69.93 · …!3d18.48!4d-69.93 · …?ll=… · …#map=17/18.48/-69.93). */
function coordenadasDeTexto(texto: string): { lat: number; lng: number } | null {
  let t = (texto ?? "").trim();
  try { t = decodeURIComponent(t); } catch { /* se usa tal cual */ }
  const patrones = [
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
    /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    /[?&](?:q|query|ll|center|destination)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    /[?&]mlat=(-?\d+(?:\.\d+)?)&mlon=(-?\d+(?:\.\d+)?)/,
    /#map=\d+\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)/,
    /^\s*\(?\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*\)?\s*$/,
  ];
  for (const p of patrones) {
    const m = t.match(p);
    if (!m) continue;
    const lat = Number(m[1]), lng = Number(m[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)) {
      return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
    }
  }
  return null;
}

/** Interruptor general: mostrar u ocultar las ofertas en la pantalla del verificador. */
function AjustesVerificador() {
  const { datos, recargar, error } = useDatos<{ mostrarOfertas: boolean; mostrarQr: boolean; consultaWeb?: boolean; wifi?: string; autoActualizar: boolean; segundosOferta?: number; radioM?: number; ubicaciones?: Record<string, { lat: number; lng: number }> }>("/central/verificador/ajustes");
  const [msg, setMsg] = useState("");
  const cambiar = async (cambio: { mostrarOfertas?: boolean; mostrarQr?: boolean; consultaWeb?: boolean; wifi?: string; autoActualizar?: boolean; segundosOferta?: number; radioM?: number }) => {
    setMsg("");
    try { await api("/central/verificador/ajustes", { metodo: "PUT", cuerpo: cambio }); recargar(); }
    catch (e) { setMsg((e as Error).message); }
  };
  const [enviando, setEnviando] = useState(false);
  const [okOrden, setOkOrden] = useState("");
  const actualizarAhora = async () => {
    setMsg(""); setOkOrden(""); setEnviando(true);
    try {
      await api("/central/verificador/actualizar-ahora", { metodo: "PUT", cuerpo: {} });
      setOkOrden("Orden enviada. Los verificadores con versión nueva disponible se actualizan en menos de 2 minutos y se reabren solos.");
    } catch (e) { setMsg((e as Error).message); }
    finally { setEnviando(false); }
  };
  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <h3 style={{ marginTop: 0 }}>Configuración del verificador</h3>
      <label className="check" style={{ fontSize: 16 }}>
        <input type="checkbox" disabled={!datos} checked={datos?.mostrarOfertas ?? true} onChange={(e) => cambiar({ mostrarOfertas: e.target.checked })} />
        {" "}Mostrar las ofertas en la pantalla del verificador
      </label>
      <p className="suave pequeno" style={{ marginBottom: 0 }}>
        Apagado: la pantalla solo dice «Consulta de precios» y el producto que se pase por el lector. Encendido: además muestra las ofertas vigentes
        (en Precios › Ofertas se elige cuáles). Las ofertas se siguen aplicando en la caja en ambos casos.
      </p>
      <label className="campo" style={{ marginTop: 14, maxWidth: 260 }}>
        <span>Segundos que se ve cada oferta (si hay varias)</span>
        <input type="number" min={3} max={120} disabled={!datos} defaultValue={datos?.segundosOferta ?? 7} key={datos?.segundosOferta ?? 7}
          onBlur={(e) => { const v = Math.min(120, Math.max(3, Math.round(Number(e.target.value) || 7))); if (v !== (datos?.segundosOferta ?? 7)) cambiar({ segundosOferta: v }); }} />
      </label>
      <label className="check" style={{ fontSize: 16, marginTop: 14, display: "block" }}>
        <input type="checkbox" disabled={!datos} checked={datos?.mostrarQr ?? true} onChange={(e) => cambiar({ mostrarQr: e.target.checked })} />
        {" "}Mostrar el QR para consultar desde el celular
      </label>
      <p className="suave pequeno" style={{ marginBottom: 0 }}>
        Muestra en la pantalla del verificador un código QR (abajo al centro) para que el cliente consulte precios desde su celular con la cámara.
      </p>
      <label className="check" style={{ fontSize: 16, marginTop: 14, display: "block" }}>
        <input type="checkbox" disabled={!datos} checked={datos?.autoActualizar ?? true} onChange={(e) => cambiar({ autoActualizar: e.target.checked })} />
        {" "}Actualizar las apps de los verificadores automáticamente
      </label>
      <p className="suave pequeno" style={{ marginBottom: 8 }}>
        Encendido: cada app instala sola la versión nueva cuando sale. Apagado: solo se actualizan cuando pulsas «Actualizar verificadores ahora».
      </p>
      <div className="fila-acciones">
        <button className="boton primario" disabled={enviando} onClick={actualizarAhora}>{enviando ? "Enviando…" : "Actualizar verificadores ahora"}</button>
      </div>
      {okOrden && <p className="suave pequeno" style={{ marginBottom: 0 }}>{okOrden}</p>}
      <Aviso texto={error || msg} />
    </div>
  );
}

/** Lo que consultan los clientes: sirve para completar precios y códigos de barras que faltan. */
function ConsultasRecientes({ sucursalId }: { sucursalId: string }) {
  const [dias, setDias] = useState(30);
  const { datos: d, error } = useDatos<Consultas>(`/central/verificador/consultas?dias=${dias}${sucursalId ? `&sucursal=${sucursalId}` : ""}`, [dias, sucursalId]);
  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <div className="fila-acciones" style={{ justifyContent: "space-between" }}>
        <h3 style={{ margin: 0 }}>Consultas de los clientes</h3>
        <select value={dias} onChange={(e) => setDias(Number(e.target.value))}>
          <option value={7}>Últimos 7 días</option><option value={30}>Últimos 30 días</option><option value={90}>Últimos 90 días</option>
        </select>
      </div>
      {error && <Aviso tipo="error" texto={error} />}
      {d && (
        <>
          <p className="suave pequeno">{d.total.toLocaleString("es-DO")} consultas, {d.sinPrecio.toLocaleString("es-DO")} sin precio. Solo cuenta lo consultado en el servidor donde está abierta esta pantalla.</p>
          <div className="dos-col">
            <div>
              <b>Códigos sin precio</b>
              {d.sinPrecioLista.length === 0 ? <p className="suave pequeno">Ninguno: todo lo que pasaron por el lector tenía precio.</p> : (
                <table className="tabla"><thead><tr><th>Código</th><th>Veces</th><th>Última</th></tr></thead><tbody>
                  {d.sinPrecioLista.map((x) => <tr key={x.codigo}><td className="mono">{x.codigo}</td><td>{x.veces}</td><td>{new Date(x.ultima).toLocaleDateString("es-DO")}</td></tr>)}
                </tbody></table>
              )}
            </div>
            <div>
              <b>Lo más consultado</b>
              {d.masConsultados.length === 0 ? <p className="suave pequeno">Todavía no hay consultas.</p> : (
                <table className="tabla"><thead><tr><th>Producto</th><th>Veces</th></tr></thead><tbody>
                  {d.masConsultados.map((x) => <tr key={x.codigo}><td>{x.descripcion ?? x.codigo}</td><td>{x.veces}</td></tr>)}
                </tbody></table>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// El servidor las pide al portal de FactPOS (que las entrega desde GitHub aunque el repositorio sea privado)
const descarga = (so: "android" | "windows") => `${CONFIG.api ?? ""}/verificador/descarga/${so}`;

/** Verificadores de precios (Android y Windows): la dirección que se configura en cada equipo y cómo dejarlo en pantalla completa. */
export function Verificador() {
  // La sucursal elegida se recuerda en este equipo: al volver a abrir la pantalla ya está seleccionada
  const [sucursalId, setSucursalId] = useState(() => { try { return localStorage.getItem("verificador.sucursal") ?? ""; } catch { return ""; } });
  useEffect(() => { try { localStorage.setItem("verificador.sucursal", sucursalId); } catch { /* sin almacenamiento */ } }, [sucursalId]);
  const [niveles, setNiveles] = useState(false);
  const [copiado, setCopiado] = useState<string | null>(null);
  const copiar = async (t: string, k: string) => { try { await navigator.clipboard.writeText(t); setCopiado(k); setTimeout(() => setCopiado(null), 2000); } catch { /* sin portapapeles */ } };

  // Abierta en el propio servidor (127.0.0.1 / localhost) la dirección no sirve a otros equipos: se muestra la IP de la red de la tienda
  // En la administración de un cliente (factpos.app/<cliente>) el servidor real es su API, no factpos.app
  const [base, setBase] = useState(CONFIG.modo === "cliente" && CONFIG.api ? CONFIG.api.replace(/\/$/, "") : location.origin);
  useEffect(() => {
    if (!/^(127\.\d+\.\d+\.\d+|localhost)$/i.test(location.hostname)) return;
    fetch("/descubrir").then((r) => r.json()).then((d: { direcciones?: string[] }) => {
      const ip = (d.direcciones ?? []).find((x) => !/\.local(:|$)/i.test(x));
      if (ip) setBase(ip);
    }).catch(() => { /* se queda la dirección actual */ });
  }, []);
  const params = [sucursalId ? `sucursal=${sucursalId}` : "", niveles ? "niveles=1" : ""].filter(Boolean).join("&");
  const pagina = `${base}/verificador${params ? `?${params}` : ""}`;
  const api = `${base}/verificador/${sucursalId || "ID_SUCURSAL"}/CODIGO_DE_BARRAS`;
  // Desde factpos.app/<empresa>: enlace FIJO (el portal manda a la dirección vigente del servidor, que cambia al reiniciarlo)
  const { datos: ajEnlace } = useDatos<{ empresaEnPortal?: boolean | null; empresaCorta?: string; enlaceInternet?: string | null; codigos?: Record<string, string> }>("/central/verificador/ajustes");
  const codigoQr = sucursalId ? ajEnlace?.codigos?.[sucursalId] : undefined;
  const movil = CONFIG.modo === "cliente" && CONFIG.slug
    ? `${location.origin}/${CONFIG.slug}/precios${sucursalId ? `?sucursal=${sucursalId}${codigoQr ? `&k=${codigoQr}` : ""}` : ""}`
    : ajEnlace?.enlaceInternet ? `${ajEnlace.enlaceInternet}${sucursalId ? `?sucursal=${sucursalId}${codigoQr ? `&k=${codigoQr}` : ""}` : ""}`
    : `${base}/verificador/movil${sucursalId ? `?sucursal=${sucursalId}` : ""}`;
  const windows = `msedge --kiosk "${pagina}" --edge-kiosk-type=fullscreen --no-first-run`;

  const Fila = ({ k, titulo, texto }: { k: string; titulo: string; texto: string }) => (
    <div style={{ margin: "10px 0" }}>
      <b>{titulo}</b>
      <div className="fila-acciones" style={{ marginTop: 4 }}>
        <input readOnly className="mono" style={{ flex: 1 }} value={texto} onFocus={(e) => e.currentTarget.select()} />
        <button className="boton" onClick={() => copiar(texto, k)}>{copiado === k ? "Copiado" : "Copiar"}</button>
      </div>
    </div>
  );

  return (
    <>
      <Encabezado titulo="Verificador de precios" descripcion="El cliente pasa el producto por el lector del equipo y ve su precio, la oferta vigente y si el precio incluye ITBIS. Funciona desde el servidor de la sucursal, también sin internet." />
      <AjustesVerificador />
      {ajEnlace?.empresaEnPortal === false && <Aviso texto={`El nombre «${ajEnlace.empresaCorta}» (FACTPOS_EMPRESA) no existe en el portal, por eso el QR dice «No encontramos esa administración». Corríjalo en el .env del servidor y reinícielo.`} />}
      {!esLocal() && <Aviso tipo="info" texto="Esta dirección es la del servidor donde está abierta la administración. Los verificadores se conectan al servidor de la sucursal (en su red local): abra esta pantalla desde allí, o use la dirección IP de ese servidor en lugar de la que aparece abajo." />}
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Dirección del verificador</h3>
        <div className="fila-acciones" style={{ flexWrap: "wrap" }}>
          <SelectorSucursal valor={sucursalId} onCambio={setSucursalId} />
          <label className="pequeno"><input type="checkbox" checked={niveles} onChange={(e) => setNiveles(e.target.checked)} /> Mostrar precios por nivel (mayoristas)</label>
        </div>
        <p className="suave pequeno">Si el servidor atiende una sola sucursal no hace falta elegirla: la página la detecta sola.</p>
        <Fila k="pagina" titulo="Para equipos con navegador o pantalla web (Android y Windows)" texto={pagina} />
        <Fila k="movil" titulo="Consulta de precios desde el celular del cliente (por internet; enlace fijo que no cambia al reiniciar el servidor). Se configura en el panel de abajo" texto={movil} />
        <Fila k="api" titulo="Para equipos que consultan por su cuenta (API, responde JSON)" texto={api} />
      </div>

      <ConsultaInternet sucursalId={sucursalId} />

      <ConsultasRecientes sucursalId={sucursalId} />

      <div className="dos-col" style={{ marginTop: 16 }}>
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>App para Android (tableta o pantalla)</h3>
          <ol className="pequeno" style={{ paddingLeft: 20 }}>
            <li>Conecte el equipo a la misma red Wi-Fi o cable que el servidor de la sucursal.</li>
            <li>Desde el equipo, descargue e instale <a href={descarga("android")}>FactPOS-Verificador.apk</a> (Android pide permitir «instalar apps desconocidas» una sola vez).</li>
            <li>Al abrirla, busca sola el servidor de la tienda (o escriba la dirección de arriba). Solo se hace una vez.</li>
            <li>Queda a pantalla completa, arranca al encender el equipo y no se puede cerrar sin el <b>PIN de un supervisor o administrador</b> de FactPOS (botones ✕ y ⓘ, abajo).</li>
            <li>Para bloqueo total, conecte el equipo a la PC y ejecute: <span className="mono">adb shell dpm set-device-owner com.factpos.verificador/.AdminReceiver</span> (con el equipo sin cuentas).</li>
            <li>El lector integrado debe estar en modo «teclado» (escribe el código y envía Enter), que es lo normal.</li>
          </ol>
        </div>
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>App para Windows</h3>
          <ol className="pequeno" style={{ paddingLeft: 20 }}>
            <li>Conecte la PC a la red del servidor de la sucursal.</li>
            <li>Descargue y ejecute <a href={descarga("windows")}>Instalador_Verificador_FactPOS.exe</a> (no pide administrador). Deje marcado «abrir al iniciar Windows».</li>
            <li>Al abrirla, busca sola el servidor de la tienda (o escriba la dirección de arriba).</li>
            <li>Queda a pantalla completa, bloquea Alt+Tab y la tecla Windows, y solo se cierra con el <b>PIN de un supervisor o administrador</b> de FactPOS (botones ✕ y ⓘ, abajo).</li>
          </ol>
          <p className="suave pequeno">¿Prefiere no instalar nada? Edge en modo kiosco también funciona, con este destino del acceso directo:</p>
          <Fila k="win" titulo="" texto={windows} />
        </div>
      </div>
    </>
  );
}
