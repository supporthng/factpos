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

/** QR para que el cliente consulte precios desde su celular (dentro del WiFi de la tienda). Se puede imprimir o descargar. */
function QrConsultaMovil({ inicial }: { inicial: string }) {
  const [url, setUrl] = useState(inicial);
  const [img, setImg] = useState("");
  const { datos: ajustes, recargar } = useDatos<{ wifi?: string }>("/central/verificador/ajustes");
  const [wifi, setWifi] = useState("");
  const [msgWifi, setMsgWifi] = useState("");
  useEffect(() => { if (ajustes) setWifi(ajustes.wifi ?? ""); }, [ajustes]);
  const guardarWifi = async () => {
    setMsgWifi("");
    try { await api("/central/verificador/ajustes", { metodo: "PUT", cuerpo: { wifi } }); recargar(); setMsgWifi("Guardado"); setTimeout(() => setMsgWifi(""), 2000); }
    catch (e) { setMsgWifi((e as Error).message); }
  };
  useEffect(() => setUrl(inicial), [inicial]);
  useEffect(() => {
    let vivo = true;
    QRCode.toDataURL(url, { margin: 2, width: 480, errorCorrectionLevel: "M" }).then((d) => { if (vivo) setImg(d); }).catch(() => { if (vivo) setImg(""); });
    return () => { vivo = false; };
  }, [url]);
  const imprimir = () => {
    const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
    const pasos = [
      wifi.trim() ? `Conéctate al WiFi «${wifi.trim()}» de la tienda` : "Conéctate al WiFi de la tienda",
      "Escanea este código con la cámara del celular",
      "Escanea o escribe el código de barras del producto y mira su precio",
    ];
    void imprimirHtml(`<!doctype html><meta charset="utf-8"><title>Consulta de precios</title>
<body style="font-family:system-ui,sans-serif;text-align:center;padding:36px;color:#10202e">
<h1>Consulta el precio desde tu celular</h1>
<ol style="display:inline-block;text-align:left;font-size:22px;line-height:1.5;margin:10px 0 0;padding-left:30px">${pasos.map((t) => `<li>${esc(t)}</li>`).join("")}</ol>
<img src="${img}" style="width:340px;margin:10px auto;display:block" alt="">
<p style="font-size:18px;color:#5b6b7a">Solo funciona dentro del WiFi de la tienda: no uses datos móviles.</p></body>`);
  };
  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <h3 style={{ marginTop: 0 }}>QR para consultar desde el celular</h3>
      <p className="suave pequeno">El cliente se conecta al WiFi de la tienda, escanea este QR y consulta el precio de cualquier producto. Imprime el cartel (lleva los 3 pasos: WiFi, QR y producto) y pégalo en el local. Si la dirección no es la del servidor de la sucursal (por ejemplo http://192.168.1.10:3000/verificador/movil), corrígela abajo.</p>
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center" }}>
        {img ? <img src={img} alt="QR de la consulta de precios" width={200} height={200} style={{ border: "1px solid #dde3e8", borderRadius: 8 }} /> : <div style={{ width: 200, height: 200 }} />}
        <div style={{ flex: 1, minWidth: 240 }}>
          <label className="campo"><span>Nombre del WiFi de la tienda (sale en el cartel impreso)</span>
            <input value={wifi} maxLength={40} placeholder="Ej.: Tienda_Clientes" onChange={(e) => setWifi(e.target.value)} onBlur={() => { if (ajustes && wifi !== (ajustes.wifi ?? "")) void guardarWifi(); }} />
          </label>
          {msgWifi && <p className="suave pequeno" style={{ margin: "4px 0" }}>{msgWifi}</p>}
          <label className="campo"><span>Dirección que abre el QR</span><input value={url} onChange={(e) => setUrl(e.target.value)} /></label>
          <div className="fila-acciones" style={{ marginTop: 10 }}>
            <button className="boton" disabled={!img} onClick={imprimir}>Imprimir</button>
            <a className="boton" style={{ textDecoration: "none" }} href={img} download="qr-consulta-precios.png" aria-disabled={!img}>Descargar imagen</a>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Interruptor general: mostrar u ocultar las ofertas en la pantalla del verificador. */
function AjustesVerificador() {
  const { datos, recargar, error } = useDatos<{ mostrarOfertas: boolean; mostrarQr: boolean; consultaWeb?: boolean; wifi?: string; autoActualizar: boolean; segundosOferta?: number }>("/central/verificador/ajustes");
  const [msg, setMsg] = useState("");
  const cambiar = async (cambio: { mostrarOfertas?: boolean; mostrarQr?: boolean; consultaWeb?: boolean; wifi?: string; autoActualizar?: boolean; segundosOferta?: number }) => {
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
        Muestra en la pantalla del verificador un código QR (abajo al centro) para que el cliente consulte precios desde su celular, conectado al WiFi de la tienda.
      </p>
      <label className="check" style={{ fontSize: 16, marginTop: 14, display: "block" }}>
        <input type="checkbox" disabled={!datos} checked={datos?.consultaWeb ?? false} onChange={(e) => cambiar({ consultaWeb: e.target.checked })} />
        {" "}Consulta por internet (enlace web con QR)
      </label>
      <p className="suave pequeno" style={{ marginBottom: 0 }}>
        Permite que el cliente consulte precios desde cualquier celular, aunque no esté en el WiFi de la tienda, con el enlace de la administración web
        (factpos.app › Verificador › «Consulta desde el celular»). Solo muestra el nombre, el precio y la oferta: nunca costos, existencias ni precios mayoristas.
        Cada persona tiene un límite de consultas por minuto. Apagado, ese enlace no responde.
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
  const [sucursalId, setSucursalId] = useState("");
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
  const movil = `${base}/verificador/movil${sucursalId ? `?sucursal=${sucursalId}` : ""}`;
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
      {!esLocal() && <Aviso tipo="info" texto="Esta dirección es la del servidor donde está abierta la administración. Los verificadores se conectan al servidor de la sucursal (en su red local): abra esta pantalla desde allí, o use la dirección IP de ese servidor en lugar de la que aparece abajo." />}
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Dirección del verificador</h3>
        <div className="fila-acciones" style={{ flexWrap: "wrap" }}>
          <SelectorSucursal valor={sucursalId} onCambio={setSucursalId} />
          <label className="pequeno"><input type="checkbox" checked={niveles} onChange={(e) => setNiveles(e.target.checked)} /> Mostrar precios por nivel (mayoristas)</label>
        </div>
        <p className="suave pequeno">Si el servidor atiende una sola sucursal no hace falta elegirla: la página la detecta sola.</p>
        <Fila k="pagina" titulo="Para equipos con navegador o pantalla web (Android y Windows)" texto={pagina} />
        <Fila k="movil" titulo={esLocal() ? "Consulta desde el celular del cliente (QR en la tienda; solo funciona dentro del WiFi de la sucursal). Para el enlace por internet, ábrala desde factpos.app" : "Consulta desde el celular del cliente por internet (genere un QR con esta dirección; hay que activar «Consulta por internet» arriba)"} texto={movil} />
        <Fila k="api" titulo="Para equipos que consultan por su cuenta (API, responde JSON)" texto={api} />
      </div>

      <QrConsultaMovil inicial={movil} />

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
