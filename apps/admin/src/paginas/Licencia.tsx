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
  instalacionId: string; licenciaId?: string | null; activada: boolean; local?: boolean;
  solicitud?: { estado: "PENDIENTE" | "ASIGNADA" | "RECHAZADA" | "LIBERADA" | "SUSPENDIDA"; revisada: string } | null;
  solicitudEnviada?: { enviadaEn: string; datos: { planId?: string | null; sucursales?: number; empresa?: string } | null } | null;
  empresa?: { nombre: string; rnc: string } | null;
  plan?: string | null; politica?: { pruebaActualiza: boolean; plazoHoras?: number; contacto: { nombre: string | null; telefono: string | null; whatsapp: string | null; correo: string | null } } | null;
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
  const [solicitando, setSolicitando] = useState(false);

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
      {solicitando && <SolicitarActivacion d={d} onCerrar={() => setSolicitando(false)} onEnviada={async () => { setSolicitando(false); await recargar(); window.dispatchEvent(new Event("factpos:licencia")); }} />}
      <Encabezado titulo="Licencia de FactPOS"
        descripcion="La licencia se cobra por sucursal. Se renueva sola con su proveedor; aquí ve su estado y la activa con la clave que le dieron." />
      {d.mensaje && <Aviso texto={d.mensaje} tipo={d.permiteVender ? "info" : "error"} />}
      {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}

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
          {d.activada ? (
            <>
              <h3 style={{ marginTop: 0 }}>Renovar o ampliar</h3>
              <p className="suave pequeno">La renovación la registra su proveedor y llega sola a su sistema (hasta 12 horas) o al pulsar «Actualizar ahora».</p>
              <Contacto c={d.politica?.contacto ?? null} />
            </>
          ) : d.solicitudEnviada ? (
            <>
              <h3 style={{ marginTop: 0 }}>Solicitud enviada</h3>
              <p className="suave pequeno">Su solicitud llegó a su proveedor el {new Date(d.solicitudEnviada.enviadaEn).toLocaleString("es-DO")}.</p>
              <Contacto c={d.politica?.contacto ?? null} />
            </>
          ) : (
            <>
              <h3 style={{ marginTop: 0 }}>¿Le gusta FactPOS?</h3>
              <p className="suave pequeno">Solicite su licencia: elija el plan, déjenos sus datos y nos comunicamos con usted para confirmar el pago y activarla. No pierde nada de lo que ya cargó.</p>
              <button className="boton primario" disabled={!admin} onClick={() => setSolicitando(true)}>Solicitar activación</button>
              {!admin && <p className="suave pequeno">Solo un administrador puede solicitarla.</p>}
            </>
          )}
        </div>
      </div>

      {!d.activada && !d.local && d.solicitudEnviada && (
        <div className="panel solicitud">
          <div className="encabezado-sub">
            <h3>{d.solicitud?.estado === "RECHAZADA" ? "Solicitud no aprobada" : "Su licencia está en proceso de activación"}</h3>
            <button className="boton" disabled={trabajando} onClick={async () => {
              setTrabajando(true); setMsg(null);
              try {
                const r = await api<{ activada?: boolean; solicitud?: { estado: string } | null; estado: string }>("/central/licencia/comprobar", { cuerpo: {} });
                await recargar(); window.dispatchEvent(new Event("factpos:licencia"));
                if (r.solicitud?.estado === "ASIGNADA") setMsg({ t: "¡Su licencia fue aprobada y ya está aplicada! Abajo puede verla y descargarla.", tipo: "ok" });
                else if (r.solicitud?.estado === "SUSPENDIDA") setMsg({ t: "Su licencia está suspendida. Comuníquese con su proveedor.", tipo: "error" });
                else setMsg({ t: "Todavía no la han aprobado. Se aplica sola cuando la activen.", tipo: "ok" });
              }
              catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
              finally { setTrabajando(false); }
            }}>Comprobar ahora</button>
          </div>
          {d.solicitud?.estado === "RECHAZADA"
            ? <p className="texto-alerta" style={{ margin: 0 }}>Su proveedor no aprobó la solicitud. Comuníquese con él o, si ya tiene una clave, actívela abajo.</p>
            : <p style={{ margin: 0 }}>En un plazo de <b>{d.politica?.plazoHoras ?? 24} horas</b> se estarán comunicando con usted para confirmar el pago y activar su licencia.
                Mientras tanto puede seguir usando la versión de prueba; cuando la activen, este sistema la recibe solo y no tiene que hacer nada.</p>}
          {d.solicitudEnviada.datos && (
            <p className="suave pequeno" style={{ marginBottom: 0 }}>
              Pidió: {d.solicitudEnviada.datos.sucursales ?? 1} sucursal(es){d.solicitudEnviada.datos.empresa ? ` para ${d.solicitudEnviada.datos.empresa}` : ""}.
              {d.solicitud && <> Última consulta: {new Date(d.solicitud.revisada).toLocaleTimeString("es-DO")}.</>}
            </p>
          )}
        </div>
      )}

      {d.activada && !d.local && <MiLicencia d={d} onError={(t) => setMsg({ t, tipo: "error" })} />}

      {d.local ? (
        <div className="panel"><p className="suave" style={{ margin: 0 }}>
          Este es el servidor de la sucursal: usa la licencia que le manda la nube de su empresa y la verifica solo, sin internet.
          Para activarla o renovarla entre a la administración en la nube.
        </p></div>
      ) : (
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>{d.activada ? "Cambiar o volver a activar la licencia" : "¿Ya tiene una clave de activación?"}</h3>
        <p className="suave">Escriba la clave de activación que le entregó su proveedor (empieza con FPS-). Solo se usa una vez por instalación.</p>
        <div className="en-linea">
          <input className="mono" value={clave} onChange={(e) => setClave(e.target.value.toUpperCase())} placeholder="FPS-XXXX-XXXX-XXXX-XXXX" maxLength={24} disabled={!admin} />
          <button className="boton primario" disabled={!admin || trabajando || clave.replace(/[^A-Z0-9]/g, "").length < 16}
            onClick={() => accion("/central/licencia/activar", { clave }, "Licencia activada")}>Activar</button>
        </div>
        {!admin && <p className="suave pequeno">Solo un administrador puede activar la licencia.</p>}
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

interface PlanOferta { id: string; nombre: string; descripcion: string | null; precioSucursal: number; periodo: "MENSUAL" | "ANUAL"; sucursalesIncluidas: number; permiteActualizaciones: boolean }

/** Formulario «Solicitar activación»: plan, sucursales y datos de la empresa. Llega al portal del proveedor. */
function SolicitarActivacion({ d, onCerrar, onEnviada }: { d: EstadoLicencia; onCerrar: () => void; onEnviada: () => void }) {
  const planes = useDatos<PlanOferta[]>("/central/licencia/planes");
  const [f, setF] = useState({ empresa: d.empresa?.nombre ?? "", rnc: d.empresa?.rnc ?? "", correo: "", telefono: "", contacto: "", mensaje: "", planId: "", sucursales: Math.max(1, d.sucursalesEnUso) });
  const [msg, setMsg] = useState("");
  const [enviando, setEnviando] = useState(false);
  const lista = planes.datos ?? [];
  const plan = lista.find((p) => p.id === f.planId);
  useEffect(() => { if (!f.planId && lista[0]) setF((x) => ({ ...x, planId: lista[0].id, sucursales: Math.max(x.sucursales, lista[0].sucursalesIncluidas) })); }, [lista.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const valido = f.empresa.trim().length >= 2 && /^\d{9}(\d{2})?$/.test(f.rnc) && /^\S+@\S+\.\S+$/.test(f.correo) && f.telefono.replace(/\D/g, "").length >= 7;
  const enviar = async () => {
    setEnviando(true); setMsg("");
    try {
      await api("/central/licencia/solicitar", { cuerpo: { empresa: f.empresa.trim(), rnc: f.rnc, correo: f.correo.trim(), telefono: f.telefono.trim(), contacto: f.contacto.trim() || null,
        planId: f.planId || null, sucursales: f.sucursales, mensaje: f.mensaje.trim() || null } });
      onEnviada();
    } catch (e) { setMsg((e as Error).message); }
    finally { setEnviando(false); }
  };
  return (
    <div className="fondo-modal" onMouseDown={(e) => e.target === e.currentTarget && !enviando && onCerrar()}>
      <div className="modal ancho" role="dialog" aria-modal="true" aria-label="Solicitar activación">
        <div className="pr-cabecera">
          <div><h2>Solicitar activación</h2><p className="suave">Elija su plan y déjenos sus datos. Su proveedor se comunicará con usted para confirmar el pago y activar la licencia.</p></div>
          <button className="boton fantasma" onClick={onCerrar} aria-label="Cerrar">✕</button>
        </div>
        {lista.length > 0 && (
          <div className="planes-elegir" role="radiogroup" aria-label="Tipo de licencia">
            {lista.map((p) => (
              <button key={p.id} type="button" role="radio" aria-checked={f.planId === p.id} className={f.planId === p.id ? "activo" : ""}
                onClick={() => set({ planId: p.id, sucursales: Math.max(f.sucursales, p.sucursalesIncluidas) })}>
                <b>{p.nombre}</b>
                <small>{p.descripcion}</small>
                <span>{p.precioSucursal > 0 ? `RD$ ${p.precioSucursal.toLocaleString("es-DO")} por sucursal / ${p.periodo === "MENSUAL" ? "mes" : "año"}` : "Precio a convenir"}</span>
              </button>
            ))}
          </div>
        )}
        {planes.datos && !lista.length && <p className="suave pequeno">No se pudieron cargar los planes (revise el internet). Puede enviar la solicitud y su proveedor le propondrá uno.</p>}
        <div className="dos-col">
          <label className="campo"><span>Empresa</span><input value={f.empresa} onChange={(e) => set({ empresa: e.target.value })} /></label>
          <label className="campo"><span>RNC</span><input value={f.rnc} inputMode="numeric" maxLength={11} onChange={(e) => set({ rnc: e.target.value.replace(/\D/g, "") })} /></label>
          <label className="campo"><span>Correo</span><input type="email" value={f.correo} onChange={(e) => set({ correo: e.target.value })} placeholder="nombre@empresa.com" /></label>
          <label className="campo"><span>Teléfono / WhatsApp</span><input value={f.telefono} inputMode="tel" onChange={(e) => set({ telefono: e.target.value })} placeholder="809-555-1234" /></label>
          <label className="campo"><span>Persona de contacto <em className="suave">(opcional)</em></span><input value={f.contacto} onChange={(e) => set({ contacto: e.target.value })} /></label>
          <label className="campo"><span>Sucursales (tiendas) que necesita</span><input type="number" min={1} max={999} value={f.sucursales} onChange={(e) => set({ sucursales: Math.max(1, Number(e.target.value) || 1) })} /></label>
        </div>
        <label className="campo"><span>Comentario <em className="suave">(opcional)</em></span><input value={f.mensaje} maxLength={500} onChange={(e) => set({ mensaje: e.target.value })} placeholder="Horario para llamarle, dudas, etc." /></label>
        {plan && plan.precioSucursal > 0 && <p className="suave pequeno">Estimado: {f.sucursales} × RD$ {plan.precioSucursal.toLocaleString("es-DO")} = <b>RD$ {(f.sucursales * plan.precioSucursal).toLocaleString("es-DO")}</b> por {plan.periodo === "MENSUAL" ? "mes" : "año"} (ITBIS aparte, si aplica). El monto final lo confirma su proveedor.</p>}
        <Aviso texto={msg} />
        <div className="acciones-modal">
          <button className="boton fantasma" onClick={onCerrar} disabled={enviando}>Cancelar</button>
          <button className="boton primario" disabled={!valido || enviando} onClick={enviar}>{enviando ? "Enviando…" : "Enviar solicitud"}</button>
        </div>
      </div>
    </div>
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

/** La licencia aplicada: sus datos a la vista y un botón para descargar el archivo. */
function MiLicencia({ d, onError }: { d: EstadoLicencia; onError: (t: string) => void }) {
  const [copiado, setCopiado] = useState(false);
  const traer = () => api<{ nombre: string; contenido: string }>("/central/licencia/archivo");
  const descargar = async () => {
    try {
      const a = await traer();
      const url = URL.createObjectURL(new Blob([a.contenido], { type: "text/plain;charset=utf-8" }));
      const enlace = Object.assign(document.createElement("a"), { href: url, download: a.nombre });
      document.body.appendChild(enlace); enlace.click(); enlace.remove(); URL.revokeObjectURL(url);
    } catch (e) { onError((e as Error).message); }
  };
  const copiar = async () => {
    try { await navigator.clipboard.writeText((await traer()).contenido); setCopiado(true); setTimeout(() => setCopiado(false), 2000); }
    catch (e) { onError((e as Error).message); }
  };
  return (
    <div className="panel">
      <div className="encabezado-sub">
        <h3>Su licencia</h3>
        <span className="en-linea">
          <button className="boton" onClick={copiar}>{copiado ? "Copiada" : "Copiar"}</button>
          <button className="boton primario" onClick={descargar}>Descargar licencia</button>
        </span>
      </div>
      <ul className="lic-lista">
        <li><span className="suave">Número de licencia</span><b className="mono">{d.licenciaId ?? "—"}</b></li>
        <li><span className="suave">Licenciado a</span><b>{d.cliente}</b></li>
        <li><span className="suave">Plan</span><b>{d.plan ?? "—"}</b></li>
        <li><span className="suave">Sucursales permitidas</span><b>{d.sucursales}</b></li>
        <li><span className="suave">Vence</span><b>{d.vence ? fecha(d.vence) : "—"}</b></li>
        <li><span className="suave">Instalación</span><b className="mono">{d.instalacionId}</b></li>
      </ul>
      <p className="suave pequeno" style={{ marginBottom: 0 }}>El archivo está firmado por FactPOS y solo sirve en esta instalación. Guárdelo como respaldo.</p>
    </div>
  );
}
