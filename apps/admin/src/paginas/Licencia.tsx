import { useEffect, useState } from "react";
import { api, puede } from "../api";
import { Aviso, Encabezado, useDatos } from "../ui";

/**
 * Licencia de FactPOS de esta empresa: estado, sucursales permitidas y
 * activación con la clave que entrega el proveedor. Se renueva sola cada 12 h.
 */
interface EstadoLicencia {
  estado: "VIGENTE" | "POR_VENCER" | "GRACIA" | "VENCIDA" | "PRUEBA" | "PRUEBA_VENCIDA";
  permiteVender: boolean; dias: number; mensaje: string | null; error: string | null;
  cliente: string | null; sucursales: number | null; vence: string | null; modulos: string[];
  instalacionId: string; activada: boolean; local?: boolean;
  plan?: string | null; politica?: { pruebaActualiza: boolean; contacto: { nombre: string | null; telefono: string | null; whatsapp: string | null; correo: string | null } } | null;
  tunel?: { activo: boolean; url: string | null; error: string | null; reportado: string | null } | null; web?: string | null; ultimoContacto: string | null; ultimoError: string | null; portal: string; sucursalesEnUso: number;
}
const NOMBRES: Record<EstadoLicencia["estado"], string> = {
  VIGENTE: "Vigente", POR_VENCER: "Por vencer", GRACIA: "Vencida · en gracia", VENCIDA: "Vencida · solo consulta",
  PRUEBA: "Versión de prueba", PRUEBA_VENCIDA: "Prueba terminada · solo consulta",
};
const fecha = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("es-DO", { day: "numeric", month: "long", year: "numeric" });

export function Licencia() {
  const { datos, error, recargar } = useDatos<EstadoLicencia>("/central/licencia");
  const [clave, setClave] = useState("");
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" } | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const admin = puede("*");

  const accion = async (ruta: string, cuerpo: unknown, ok: string) => {
    setTrabajando(true); setMsg(null);
    try {
      await api(ruta, { cuerpo });
      setMsg({ t: ok, tipo: "ok" }); setClave("");
      await recargar();
      window.dispatchEvent(new Event("factpos:licencia"));
    } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
    finally { setTrabajando(false); }
  };

  if (!datos) return <><Encabezado titulo="Licencia" /><Aviso texto={error} /></>;
  const d = datos;
  return (
    <>
      <Encabezado titulo="Licencia de FactPOS"
        descripcion="La licencia se cobra por sucursal. Se renueva sola con su proveedor; aquí ve su estado y la activa con la clave que le dieron." />
      {d.mensaje && <Aviso texto={d.mensaje} tipo={d.permiteVender ? "info" : "error"} />}

      <div className="lic-resumen">
        <div className="panel lic-plan">
          <h3>
            {d.plan ? `Plan ${d.plan}` : d.activada ? "Licencia activa" : "Versión de prueba"}
            <span className={"pastilla " + (d.estado === "VIGENTE" ? "ok" : d.permiteVender ? "aviso" : "alerta")}>{NOMBRES[d.estado]}</span>
          </h3>
          {d.cliente && <p className="suave" style={{ margin: 0 }}>Licenciado a <b>{d.cliente}</b></p>}
          <Vigencia d={d} />
          <ul className="lic-lista">
            <li><span className="suave">{d.vence ? "Vence" : "La prueba termina"}</span><b>{d.vence ? fecha(d.vence) : `en ${Math.max(d.dias, 0)} día(s)`}</b></li>
            <li><span className="suave">Sucursales activas</span><b>{d.sucursalesEnUso} de {d.sucursales ?? 2}</b></li>
            <li><span className="suave">Actualizaciones</span><b>{d.activada ? "Incluidas" : d.politica?.pruebaActualiza ? "Disponibles durante la prueba" : "Al activar la licencia"}</b></li>
            {d.modulos.length > 0 && <li><span className="suave">Módulos</span><b>{d.modulos.join(", ")}</b></li>}
          </ul>
          {d.sucursales != null && d.sucursalesEnUso >= d.sucursales && (
            <p className="texto-aviso pequeno" style={{ margin: 0 }}>Usa todas sus sucursales: para abrir otra tienda, amplíe la licencia con su proveedor.</p>
          )}
        </div>
        <div className="panel lic-contacto">
          <h3 style={{ marginTop: 0 }}>{d.activada ? "Renovar o ampliar" : "Comprar o activar"}</h3>
          <p className="suave pequeno">
            {d.activada
              ? "La renovación la registra su proveedor y llega sola a su sistema (hasta 12 horas) o al pulsar «Actualizar ahora»."
              : "Pida su clave de activación a su proveedor y escríbala abajo. Hasta entonces el sistema funciona en prueba."}
          </p>
          <Contacto c={d.politica?.contacto ?? null} />
        </div>
      </div>

      {d.local ? (
        <div className="panel"><p className="suave" style={{ margin: 0 }}>
          Este es el servidor de la sucursal: usa la licencia que le manda la nube de su empresa y la verifica solo, sin internet.
          Para activarla o renovarla entre a la administración en la nube.
        </p></div>
      ) : (
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>{d.activada ? "Cambiar o volver a activar la licencia" : "Activar la licencia"}</h3>
        <p className="suave">Escriba la clave de activación que le entregó su proveedor (empieza con FPS-). Solo se usa una vez por instalación.</p>
        <div className="en-linea">
          <input className="mono" value={clave} onChange={(e) => setClave(e.target.value.toUpperCase())} placeholder="FPS-XXXX-XXXX-XXXX-XXXX" maxLength={24} disabled={!admin} />
          <button className="boton primario" disabled={!admin || trabajando || clave.replace(/[^A-Z0-9]/g, "").length < 16}
            onClick={() => accion("/central/licencia/activar", { clave }, "Licencia activada")}>Activar</button>
        </div>
        {!admin && <p className="suave pequeno">Solo un administrador puede activar la licencia.</p>}
        {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}
      </div>
      )}

      {d.activada && !d.local && (
        <div className="panel">
          <div className="encabezado-sub">
            <h3>Comunicación con el proveedor</h3>
            <button className="boton" disabled={trabajando} onClick={() => accion("/central/licencia/renovar", {}, "Licencia actualizada con el proveedor")}>Actualizar ahora</button>
          </div>
          <p className="suave pequeno">
            Último contacto: {d.ultimoContacto ? new Date(d.ultimoContacto).toLocaleString("es-DO") : "nunca"}
            {d.ultimoError && <span className="texto-alerta"> · {d.ultimoError}</span>}
          </p>
          <p className="suave pequeno">
            Al proveedor solo se le informa el número de licencia, esta instalación, la versión y cuántas sucursales están activas.
            Sus ventas, productos y clientes nunca salen de su nube.
          </p>
        </div>
      )}
      {d.tunel && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Acceso desde internet</h3>
          {d.web && <p>Administración web de su empresa: <a href={d.web} target="_blank" rel="noreferrer"><b>{d.web}</b></a></p>}
          <p className="suave pequeno">
            Túnel: {d.tunel.activo ? <span className="texto-ok">abierto</span> : <span className="texto-alerta">cerrado</span>}
            {d.tunel.url && <> · <span className="mono">{d.tunel.url}</span></>}
            {d.tunel.reportado && <> · avisado al portal {new Date(d.tunel.reportado).toLocaleTimeString("es-DO")}</>}
            {d.tunel.error && <span className="texto-alerta"> · {d.tunel.error}</span>}
          </p>
          {!d.activada && <p className="suave pequeno">La dirección web queda lista al activar la licencia.</p>}
        </div>
      )}
      <p className="suave pequeno">Instalación: <span className="mono">{d.instalacionId}</span> · Portal: {d.portal}</p>
    </>
  );
}

function Vigencia({ d }: { d: EstadoLicencia }) {
  // Barra del tiempo que queda: 365 días (licencia) o 15 (prueba) como referencia visual
  const total = d.vence ? 365 : 15;
  const pct = Math.max(0, Math.min(100, Math.round((d.dias / total) * 100)));
  const clase = !d.permiteVender || d.dias < 0 ? "grave" : d.dias < 15 ? "aviso" : "";
  const texto = d.dias >= 0 ? `Quedan ${d.dias} día(s)` : `Venció hace ${-d.dias} día(s)`;
  return (
    <div>
      <div className="lic-barra" role="img" aria-label={texto}><b className={clase} style={{ width: `${pct}%` }} /></div>
      <span className="suave pequeno">{texto}</span>
    </div>
  );
}

function Contacto({ c }: { c: { nombre: string | null; telefono: string | null; whatsapp: string | null; correo: string | null } | null }) {
  if (!c || !(c.telefono || c.whatsapp || c.correo)) return <p className="suave pequeno" style={{ margin: 0 }}>Comuníquese con su proveedor de FactPOS.</p>;
  return (
    <div>
      {c.nombre && <b>{c.nombre}</b>}
      <div>
        {c.whatsapp && <a href={`https://wa.me/${c.whatsapp}`} target="_blank" rel="noreferrer">WhatsApp</a>}
        {c.telefono && <a href={`tel:${c.telefono}`}>{c.telefono}</a>}
        {c.correo && <a href={`mailto:${c.correo}`}>{c.correo}</a>}
      </div>
    </div>
  );
}

/** Aviso arriba de cualquier pantalla cuando la licencia no está vigente. */
export function AvisoLicencia({ irA }: { irA: () => void }) {
  const [e, setE] = useState<EstadoLicencia | null>(null);
  useEffect(() => {
    const cargar = () => api<EstadoLicencia>("/central/licencia").then(setE).catch(() => {});
    cargar();
    addEventListener("factpos:licencia", cargar);
    return () => removeEventListener("factpos:licencia", cargar);
  }, []);
  if (!e?.mensaje || e.estado === "VIGENTE") return null;
  return (
    <div className={"aviso-licencia" + (e.permiteVender ? "" : " grave")}>
      <span>{e.mensaje}</span>
      <button className="enlace" onClick={irA}>Ver licencia</button>
    </div>
  );
}
