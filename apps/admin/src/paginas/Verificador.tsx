import { useState } from "react";
import { esLocal } from "../api";
import { Aviso, Encabezado, SelectorSucursal } from "../ui";

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

      <div className="dos-col" style={{ marginTop: 16 }}>
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Verificador Android</h3>
          <ol className="pequeno" style={{ paddingLeft: 20 }}>
            <li>Conecte el equipo a la misma red Wi-Fi o cable que el servidor de la sucursal.</li>
            <li>Si trae una aplicación de verificación, ponga como dirección del servidor la de arriba (la <b>primera</b> si pide una página, la <b>segunda</b> si consulta por API con el código de barras).</li>
            <li>Si no, abra la dirección en Chrome, menú ⋮ › <b>Añadir a la pantalla de inicio</b> (o «Instalar aplicación»). Se abre en pantalla completa y mantiene la pantalla encendida.</li>
            <li>Para dejarlo fijo, use el modo kiosco del equipo o una app como Fully Kiosk con esa dirección de inicio.</li>
            <li>El lector integrado debe estar en modo «teclado» (escribe el código y envía Enter), que es lo normal.</li>
          </ol>
        </div>
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Verificador Windows</h3>
          <ol className="pequeno" style={{ paddingLeft: 20 }}>
            <li>Conecte el equipo a la red del servidor de la sucursal.</li>
            <li>Cree un acceso directo de Microsoft Edge con este destino (pantalla completa, sin barras):</li>
          </ol>
          <Fila k="win" titulo="" texto={windows} />
          <p className="suave pequeno">Para que arranque con Windows, copie el acceso directo en la carpeta de inicio (<span className="mono">shell:startup</span>). Si el equipo ya trae su software de verificación, use la dirección de la izquierda en él.</p>
        </div>
      </div>
    </>
  );
}
