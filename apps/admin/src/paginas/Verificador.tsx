import { useState } from "react";
import { esLocal } from "../api";
import { Aviso, Encabezado, SelectorSucursal, useDatos } from "../ui";

interface Consultas {
  dias: number; total: number; sinPrecio: number;
  masConsultados: { codigo: string; descripcion: string | null; veces: number }[];
  /** Códigos que se pasaron por el lector y no tenían precio. */
  sinPrecioLista: { codigo: string; veces: number; ultima: string }[];
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

const DESCARGA_ANDROID = "https://github.com/supporthng/factpos/releases/download/verificador-android/FactPOS-Verificador.apk";
const DESCARGA_WINDOWS = "https://github.com/supporthng/factpos/releases/download/verificador-windows/Instalador_Verificador_FactPOS.exe";

/** Verificadores de precios (Android y Windows): la dirección que se configura en cada equipo y cómo dejarlo en pantalla completa. */
export function Verificador() {
  const [sucursalId, setSucursalId] = useState("");
  const [niveles, setNiveles] = useState(false);
  const [copiado, setCopiado] = useState<string | null>(null);
  const copiar = async (t: string, k: string) => { try { await navigator.clipboard.writeText(t); setCopiado(k); setTimeout(() => setCopiado(null), 2000); } catch { /* sin portapapeles */ } };

  const base = location.origin;
  const params = [sucursalId ? `sucursal=${sucursalId}` : "", niveles ? "niveles=1" : ""].filter(Boolean).join("&");
  const pagina = `${base}/verificador${params ? `?${params}` : ""}`;
  const api = `${base}/verificador/${sucursalId || "ID_SUCURSAL"}/CODIGO_DE_BARRAS`;
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
      {!esLocal() && <Aviso tipo="info" texto="Esta dirección es la del servidor donde está abierta la administración. Los verificadores se conectan al servidor de la sucursal (en su red local): abra esta pantalla desde allí, o use la dirección IP de ese servidor en lugar de la que aparece abajo." />}
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Dirección del verificador</h3>
        <div className="fila-acciones" style={{ flexWrap: "wrap" }}>
          <SelectorSucursal valor={sucursalId} onCambio={setSucursalId} />
          <label className="pequeno"><input type="checkbox" checked={niveles} onChange={(e) => setNiveles(e.target.checked)} /> Mostrar precios por nivel (mayoristas)</label>
        </div>
        <p className="suave pequeno">Si el servidor atiende una sola sucursal no hace falta elegirla: la página la detecta sola.</p>
        <Fila k="pagina" titulo="Para equipos con navegador o pantalla web (Android y Windows)" texto={pagina} />
        <Fila k="api" titulo="Para equipos que consultan por su cuenta (API, responde JSON)" texto={api} />
      </div>

      <ConsultasRecientes sucursalId={sucursalId} />

      <div className="dos-col" style={{ marginTop: 16 }}>
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>App para Android (tableta o pantalla)</h3>
          <ol className="pequeno" style={{ paddingLeft: 20 }}>
            <li>Conecte el equipo a la misma red Wi-Fi o cable que el servidor de la sucursal.</li>
            <li>Desde el equipo, descargue e instale <a href={DESCARGA_ANDROID}>FactPOS-Verificador.apk</a> (Android pide permitir «instalar apps desconocidas» una sola vez).</li>
            <li>Al abrirla, escriba la dirección del servidor (la de arriba) y una <b>clave de salida</b>. Solo se hace una vez.</li>
            <li>Queda a pantalla completa, arranca al encender el equipo y no se puede cerrar sin la clave (esquina superior izquierda ⓘ).</li>
            <li>Para bloqueo total, conecte el equipo a la PC y ejecute: <span className="mono">adb shell dpm set-device-owner com.factpos.verificador/.AdminReceiver</span> (con el equipo sin cuentas).</li>
            <li>El lector integrado debe estar en modo «teclado» (escribe el código y envía Enter), que es lo normal.</li>
          </ol>
        </div>
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>App para Windows</h3>
          <ol className="pequeno" style={{ paddingLeft: 20 }}>
            <li>Conecte la PC a la red del servidor de la sucursal.</li>
            <li>Descargue y ejecute <a href={DESCARGA_WINDOWS}>Instalador_Verificador_FactPOS.exe</a> (no pide administrador). Deje marcado «abrir al iniciar Windows».</li>
            <li>Al abrirla, escriba la dirección del servidor (la de arriba) y una <b>clave de salida</b>.</li>
            <li>Queda a pantalla completa, bloquea Alt+Tab y la tecla Windows, y solo se cierra con la clave (esquina superior izquierda ⓘ).</li>
          </ol>
          <p className="suave pequeno">¿Prefiere no instalar nada? Edge en modo kiosco también funciona, con este destino del acceso directo:</p>
          <Fila k="win" titulo="" texto={windows} />
        </div>
      </div>
    </>
  );
}
