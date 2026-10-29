import { useEffect, useState } from "react";
import { api, sesionActual, encabezados } from "../api";
import { Aviso, Encabezado, Tabla, useCatalogo, useDatos } from "../ui";

/**
 * Correo y envíos: la cuenta de correo desde la que salen los reportes y qué
 * se envía automáticamente (cierres de caja, resumen del día, incidentes).
 */
type Metodo = "SMTP" | "RESEND";
type Seguridad = "SSL" | "STARTTLS" | "NINGUNA";
interface Config {
  metodo: Metodo; smtpServidor: string | null; smtpPuerto: number | null; smtpSeguridad: Seguridad; usuario: string | null;
  tieneClave: boolean; remitenteNombre: string | null; remitenteCorreo: string | null; responderA: string | null;
  probadoEn: string | null; pruebaOk: boolean | null; pruebaError: string | null;
}
type Tipo = "CIERRE_CAJA" | "RESUMEN_DIARIO" | "INCIDENTES";
interface Envio { tipo: Tipo; activo: boolean; destinatarios: string[]; sucursales: string[] | null; hora: number; soloConDiferencia: boolean; ultimoEnvio: string | null }
interface Enviado { id: string; tipo: Tipo; asunto: string | null; destinatarios: string[] | null; estado: "ENVIANDO" | "ENVIADO" | "ERROR"; intentos: number; error: string | null; creadoEn: string; enviadoEn: string | null; proximoIntento: string | null }

/** Ajustes conocidos: el usuario solo elige su proveedor y escribe correo y contraseña. */
const PROVEEDORES: { id: string; nombre: string; servidor?: string; puerto?: number; seguridad?: Seguridad; ayuda: string }[] = [
  { id: "gmail", nombre: "Gmail / Google Workspace", servidor: "smtp.gmail.com", puerto: 465, seguridad: "SSL",
    ayuda: "Use una contraseña de aplicación, no la suya: Cuenta de Google › Seguridad › Verificación en 2 pasos › Contraseñas de aplicaciones." },
  { id: "outlook", nombre: "Outlook / Microsoft 365", servidor: "smtp.office365.com", puerto: 587, seguridad: "STARTTLS",
    ayuda: "La cuenta debe tener activado «SMTP autenticado» (Centro de administración de Microsoft 365 › Usuarios › Correo)." },
  { id: "zoho", nombre: "Zoho Mail", servidor: "smtp.zoho.com", puerto: 465, seguridad: "SSL", ayuda: "Si tiene verificación en 2 pasos, cree una contraseña específica de aplicación." },
  { id: "otro", nombre: "Otro (correo del hosting)", ayuda: "Los datos SMTP los da su proveedor de hosting o de correo (cPanel › Cuentas de correo › Conectar dispositivos)." },
  { id: "resend", nombre: "Resend (servicio por API)", ayuda: "Cree una clave en resend.com › API Keys y verifique su dominio para enviar desde su propio correo." },
];
const proveedorDe = (c: Config | null) =>
  !c ? "gmail" : c.metodo === "RESEND" ? "resend" : PROVEEDORES.find((p) => p.servidor && p.servidor === c.smtpServidor)?.id ?? "otro";

const fecha = (v: string | null) => (v ? new Date(v).toLocaleString("es-DO", { dateStyle: "medium", timeStyle: "short" }) : "—");
const esCorreo = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
const NOMBRE_TIPO: Record<Tipo, string> = { CIERRE_CAJA: "Cierre de caja", RESUMEN_DIARIO: "Resumen del día", INCIDENTES: "Incidente" };

export function Correo() {
  const { datos, recargar } = useDatos<{ config: Config | null; envios: Envio[]; cron: boolean }>("/central/correo");
  const historial = useDatos<Enviado[]>("/central/correo/historial");
  if (!datos) return <Encabezado titulo="Correo y envíos" descripcion="Cargando…" />;
  const lista = !!datos.config?.tieneClave && !!datos.config.remitenteCorreo;
  return (
    <>
      <Encabezado titulo="Correo y envíos" descripcion="La cuenta desde la que salen los reportes, y qué se envía solo: cierres de caja, el resumen del día y los avisos de incidentes." />
      <Conexion config={datos.config} onGuardado={() => { recargar(); }} />
      <h2>Envíos automáticos</h2>
      {!lista && <Aviso tipo="info" texto="Configure y guarde la cuenta de correo de arriba para poder activar los envíos." />}
      {!datos.cron && <Aviso tipo="info" texto="Falta la tarea de vigilancia (CRON_SECRET en Vercel y en GitHub): sin ella el resumen del día no sale a su hora. Los cierres de caja sí salen al llegar de la sucursal." />}
      <div className="envios-correo">
        {datos.envios.map((e) => <TarjetaEnvio key={e.tipo} envio={e} habilitado={lista} onGuardado={() => { recargar(); historial.recargar(); }} />)}
      </div>
      <Historial filas={historial.datos ?? []} onCambio={() => historial.recargar()} />
    </>
  );
}

// ---------------------------------------------------------------- conexión
function Conexion({ config, onGuardado }: { config: Config | null; onGuardado: () => void }) {
  const [prov, setProv] = useState(proveedorDe(config));
  const p = PROVEEDORES.find((x) => x.id === prov)!;
  const [servidor, setServidor] = useState(config?.smtpServidor ?? p.servidor ?? "");
  const [puerto, setPuerto] = useState(String(config?.smtpPuerto ?? p.puerto ?? 465));
  const [seguridad, setSeguridad] = useState<Seguridad>(config?.smtpSeguridad ?? p.seguridad ?? "SSL");
  const [correo, setCorreo] = useState(config?.remitenteCorreo ?? "");
  const [usuario, setUsuario] = useState(config?.usuario ?? "");
  const [clave, setClave] = useState("");
  const [nombre, setNombre] = useState(config?.remitenteNombre ?? "");
  const [responder, setResponder] = useState(config?.responderA ?? "");
  const [pruebaA, setPruebaA] = useState("");
  const [ocupado, setOcupado] = useState<"" | "guardar" | "probar">("");
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" } | null>(null);
  const [avanzado, setAvanzado] = useState(prov === "otro");
  const resend = prov === "resend";

  const elegir = (id: string) => {
    setProv(id); setMsg(null);
    const n = PROVEEDORES.find((x) => x.id === id)!;
    if (n.servidor) { setServidor(n.servidor); setPuerto(String(n.puerto)); setSeguridad(n.seguridad!); }
    if (id === "otro") { setAvanzado(true); if (PROVEEDORES.some((x) => x.servidor === servidor)) setServidor(""); }
  };
  const cuerpo = () => ({
    metodo: (resend ? "RESEND" : "SMTP") as Metodo,
    smtpServidor: resend ? null : servidor.trim(), smtpPuerto: resend ? null : Number(puerto) || null, smtpSeguridad: seguridad,
    usuario: resend ? null : usuario.trim() || null, clave: clave || undefined,
    remitenteNombre: nombre.trim() || null, remitenteCorreo: correo.trim(), responderA: responder.trim() || null,
  });
  const guardar = async () => {
    setOcupado("guardar"); setMsg(null);
    try { await api("/central/correo/config", { metodo: "PUT", cuerpo: cuerpo() }); setClave(""); setMsg({ t: "Cuenta de correo guardada. Envíe una prueba para confirmar que funciona.", tipo: "ok" }); onGuardado(); }
    catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
    finally { setOcupado(""); }
  };
  const probar = async () => {
    setOcupado("probar"); setMsg(null);
    try {
      // Si cambió algo en el formulario, se prueba eso (sin guardarlo todavía)
      await api("/central/correo/prueba", { cuerpo: { para: pruebaA.trim(), ...(clave || !config ? { config: cuerpo() } : {}) } });
      setMsg({ t: `Correo de prueba enviado a ${pruebaA}. Revise también la carpeta de spam.`, tipo: "ok" });
      onGuardado();
    } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
    finally { setOcupado(""); }
  };
  const valido = esCorreo(correo) && (resend || servidor.trim()) && (clave || config?.tieneClave);

  return (
    <div className="panel correo-conexion">
      <div className="encabezado-sub">
        <h3 style={{ margin: 0 }}>Cuenta de correo</h3>
        {config?.probadoEn && (
          config.pruebaOk
            ? <span className="pastilla recibida">Funciona · probado {fecha(config.probadoEn)}</span>
            : <span className="pastilla con_diferencia">Falló la última prueba</span>
        )}
      </div>
      {config?.pruebaOk === false && config.pruebaError && <Aviso texto={config.pruebaError} />}

      <div className="proveedores" role="radiogroup" aria-label="Proveedor de correo">
        {PROVEEDORES.map((x) => (
          <button key={x.id} type="button" role="radio" aria-checked={prov === x.id} className={"proveedor" + (prov === x.id ? " elegido" : "")} onClick={() => elegir(x.id)}>{x.nombre}</button>
        ))}
      </div>
      <p className="suave pequeno ayuda-proveedor">{p.ayuda}</p>

      <div className="dos-col">
        <label className="campo"><span>Correo que envía</span><input type="email" value={correo} onChange={(e) => setCorreo(e.target.value)} placeholder="reportes@susupermercado.com" autoComplete="off" /></label>
        <label className="campo"><span>Nombre que verán</span><input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder={sesionActual().empresa || "Supermercado"} /></label>
      </div>
      <div className="dos-col">
        <label className="campo">
          <span>{resend ? "Clave de Resend (API key)" : "Contraseña"}{config?.tieneClave ? " · vacía = no cambia" : ""}</span>
          <input type="password" value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="new-password" placeholder={config?.tieneClave ? "••••••••  (guardada)" : resend ? "re_…" : prov === "gmail" ? "Contraseña de aplicación (16 letras)" : ""} />
        </label>
        <label className="campo"><span>Respuestas a (opcional)</span><input type="email" value={responder} onChange={(e) => setResponder(e.target.value)} placeholder="administracion@susupermercado.com" /></label>
      </div>

      {!resend && (
        <>
          {!avanzado && <button type="button" className="enlace" onClick={() => setAvanzado(true)}>Ver servidor y puerto</button>}
          {avanzado && (
            <div className="cuatro-col">
              <label className="campo"><span>Servidor SMTP</span><input value={servidor} onChange={(e) => setServidor(e.target.value)} placeholder="mail.susupermercado.com" /></label>
              <label className="campo"><span>Puerto</span><input inputMode="numeric" value={puerto} onChange={(e) => setPuerto(e.target.value.replace(/\D/g, ""))} /></label>
              <label className="campo"><span>Seguridad</span>
                <select value={seguridad} onChange={(e) => { const s = e.target.value as Seguridad; setSeguridad(s); setPuerto(s === "SSL" ? "465" : "587"); }}>
                  <option value="SSL">SSL (465)</option><option value="STARTTLS">STARTTLS (587)</option><option value="NINGUNA">Ninguna</option>
                </select>
              </label>
              <label className="campo"><span>Usuario (si no es el mismo correo)</span><input value={usuario} onChange={(e) => setUsuario(e.target.value)} placeholder={correo || "el mismo correo"} /></label>
            </div>
          )}
        </>
      )}

      <div className="fila-acciones correo-acciones">
        <button className="boton primario" disabled={!valido || !!ocupado} onClick={guardar}>{ocupado === "guardar" ? "Guardando…" : "Guardar cuenta"}</button>
        <span className="flex" />
        <input type="email" value={pruebaA} onChange={(e) => setPruebaA(e.target.value)} placeholder="Enviar una prueba a…" aria-label="Correo para la prueba" />
        <button className="boton" disabled={!esCorreo(pruebaA) || !valido || !!ocupado} onClick={probar}>{ocupado === "probar" ? "Enviando…" : "Enviar prueba"}</button>
      </div>
      {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}
    </div>
  );
}

// ---------------------------------------------------------------- envíos
const TEXTOS: Record<Tipo, { titulo: string; descripcion: string; vista?: boolean }> = {
  CIERRE_CAJA: { titulo: "Cierre de caja", descripcion: "Cada vez que un cajero cierra su turno: lo vendido, el cuadre por forma de pago, el faltante o sobrante, retiros y gastos.", vista: true },
  RESUMEN_DIARIO: { titulo: "Resumen del día", descripcion: "Una vez al día, lo del día anterior: ventas por sucursal, formas de pago, cierres con diferencia, comprobantes rechazados e incidentes.", vista: true },
  INCIDENTES: { titulo: "Avisos al servicio técnico", descripcion: "Cuando un servidor de tienda se cae o una caja trabaja sin servidor, y cuando se resuelve." },
};

function TarjetaEnvio({ envio, habilitado, onGuardado }: { envio: Envio; habilitado: boolean; onGuardado: () => void }) {
  const { sucursales } = useCatalogo();
  const tiendas = sucursales.filter((s) => s.tipo !== "ALMACEN");
  const [activo, setActivo] = useState(envio.activo);
  const [para, setPara] = useState<string[]>(envio.destinatarios);
  const [nuevo, setNuevo] = useState("");
  const [todas, setTodas] = useState(!envio.sucursales);
  const [elegidas, setElegidas] = useState<Set<string>>(new Set(envio.sucursales ?? []));
  const [hora, setHora] = useState(envio.hora);
  const [soloDif, setSoloDif] = useState(envio.soloConDiferencia);
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" } | null>(null);
  const [vista, setVista] = useState<string | null>(null);
  const t = TEXTOS[envio.tipo];
  const cambio = activo !== envio.activo || para.join() !== envio.destinatarios.join() || todas !== !envio.sucursales || hora !== envio.hora
    || soloDif !== envio.soloConDiferencia || (!todas && [...elegidas].sort().join() !== [...(envio.sucursales ?? [])].sort().join());

  const agregar = (texto: string) => {
    const nuevos = texto.split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
    const malos = nuevos.filter((x) => !esCorreo(x));
    setPara([...new Set([...para, ...nuevos.filter(esCorreo)])]);
    setNuevo(malos.join(", "));
    if (malos.length) setMsg({ t: `Revise: ${malos.join(", ")}`, tipo: "error" }); else setMsg(null);
  };
  const guardar = async (activar = activo) => {
    const lista = nuevo.trim() ? [...new Set([...para, ...nuevo.split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter(esCorreo)])] : para;
    try {
      await api(`/central/correo/envios/${envio.tipo}`, {
        metodo: "PUT",
        cuerpo: { activo: activar, destinatarios: lista, sucursales: todas ? null : [...elegidas], hora, soloConDiferencia: soloDif },
      });
      setPara(lista); setNuevo(""); setActivo(activar);
      setMsg({ t: activar ? "Guardado. Se enviará automáticamente." : "Guardado (desactivado).", tipo: "ok" });
      onGuardado();
    } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
  };
  const verEjemplo = async () => {
    try {
      const r = await fetch(`${sesionActual().servidor.replace(/\/$/, "")}/central/correo/vista-previa/${envio.tipo}`, { headers: encabezados() });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "No se pudo armar el ejemplo");
      setVista(await r.text());
    } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
  };

  return (
    <div className={"panel envio-correo" + (activo ? " activo" : "")}>
      <div className="encabezado-sub">
        <h3 style={{ margin: 0 }}>{t.titulo}</h3>
        <label className="interruptor">
          <input type="checkbox" checked={activo} disabled={!habilitado && !activo} onChange={(e) => guardar(e.target.checked)} />
          <span>{activo ? "Activado" : "Desactivado"}</span>
        </label>
      </div>
      <p className="suave pequeno" style={{ marginTop: 4 }}>{t.descripcion}</p>

      <label className="campo"><span>Enviar a</span>
        <div className="destinatarios">
          {para.map((c) => (
            <span key={c} className="chip">{c}<button type="button" aria-label={`Quitar ${c}`} onClick={() => setPara(para.filter((x) => x !== c))}>×</button></span>
          ))}
          <input
            value={nuevo} onChange={(e) => setNuevo(e.target.value)} placeholder={para.length ? "Agregar otro…" : "correo@ejemplo.com"}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); agregar(nuevo); } }}
            onBlur={() => nuevo.trim() && agregar(nuevo)}
          />
        </div>
      </label>

      {envio.tipo !== "INCIDENTES" && tiendas.length > 1 && (
        <div className="campo">
          <span>Sucursales</span>
          <div className="fila-opciones">
            <label className="interruptor"><input type="radio" checked={todas} onChange={() => setTodas(true)} /><span>Todas</span></label>
            <label className="interruptor"><input type="radio" checked={!todas} onChange={() => setTodas(false)} /><span>Solo:</span></label>
            {!todas && tiendas.map((s) => (
              <label key={s.id} className="interruptor"><input type="checkbox" checked={elegidas.has(s.id)} onChange={() => { const n = new Set(elegidas); if (n.has(s.id)) n.delete(s.id); else n.add(s.id); setElegidas(n); }} /><span>{s.nombre}</span></label>
            ))}
          </div>
        </div>
      )}
      {envio.tipo === "RESUMEN_DIARIO" && (
        <label className="campo campo-corto"><span>Hora de envío</span>
          <select value={hora} onChange={(e) => setHora(Number(e.target.value))}>
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{new Date(2000, 0, 1, h).toLocaleTimeString("es-DO", { hour: "numeric", minute: "2-digit" })}</option>)}
          </select>
        </label>
      )}
      {envio.tipo === "CIERRE_CAJA" && (
        <label className="interruptor"><input type="checkbox" checked={soloDif} onChange={(e) => setSoloDif(e.target.checked)} /><span>Solo cuando haya faltante o sobrante</span></label>
      )}

      <div className="fila-acciones">
        <button className="boton primario" disabled={!cambio && !nuevo.trim()} onClick={() => guardar()}>Guardar</button>
        {t.vista && <button className="boton" onClick={verEjemplo}>Ver ejemplo</button>}
        <span className="flex" />
        <span className="suave pequeno">{envio.ultimoEnvio ? `Último: ${fecha(envio.ultimoEnvio)}` : "Sin envíos todavía"}</span>
      </div>
      {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}
      {vista && <VistaPrevia html={vista} titulo={t.titulo} onCerrar={() => setVista(null)} />}
    </div>
  );
}

function VistaPrevia({ html, titulo, onCerrar }: { html: string; titulo: string; onCerrar: () => void }) {
  useEffect(() => {
    const f = (e: KeyboardEvent) => e.key === "Escape" && onCerrar();
    addEventListener("keydown", f);
    return () => removeEventListener("keydown", f);
  }, [onCerrar]);
  return (
    <div className="fondo-modal" onMouseDown={onCerrar}>
      <div className="modal ancho vista-correo" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label={`Ejemplo: ${titulo}`}>
        <div className="encabezado-sub"><h2 style={{ margin: 0 }}>Así llega: {titulo}</h2><button className="boton" onClick={onCerrar}>Cerrar</button></div>
        <p className="suave pequeno">Con datos reales: el último cierre o el último día con ventas.</p>
        <iframe title={`Ejemplo de ${titulo}`} srcDoc={html} sandbox="" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- historial
function Historial({ filas, onCambio }: { filas: Enviado[]; onCambio: () => void }) {
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" } | null>(null);
  const reenviar = async (id: string) => {
    try { await api(`/central/correo/historial/${id}/reenviar`, { cuerpo: {} }); setMsg({ t: "Reenviado.", tipo: "ok" }); onCambio(); }
    catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
  };
  const procesar = async () => {
    try { const r = await api("/central/correo/procesar", { cuerpo: {} }); setMsg({ t: r.enviados ? `${r.enviados} correo(s) enviados.` : "No había nada pendiente.", tipo: "ok" }); onCambio(); }
    catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
  };
  return (
    <>
      <div className="encabezado-sub" style={{ marginTop: 28 }}>
        <h2 style={{ margin: 0 }}>Enviados</h2>
        <button className="boton" onClick={procesar}>Enviar pendientes ahora</button>
      </div>
      {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}
      <Tabla
        filas={filas}
        clave={(f) => f.id}
        vacio="Todavía no se ha enviado ningún correo"
        columnas={[
          { titulo: "Fecha", valor: (f) => fecha(f.enviadoEn ?? f.creadoEn), ancho: "170px" },
          { titulo: "Tipo", valor: (f) => NOMBRE_TIPO[f.tipo] ?? f.tipo },
          { titulo: "Asunto", valor: (f) => <>{f.asunto ?? "—"}{f.error && <div className="error pequeno">{f.error}</div>}</> },
          { titulo: "Para", valor: (f) => <span className="pequeno">{(f.destinatarios ?? []).join(", ")}</span> },
          { titulo: "Estado", valor: (f) => (
            <span className={"pastilla " + (f.estado === "ENVIADO" ? "recibida" : f.estado === "ERROR" ? "con_diferencia" : "en_transito")}>
              {f.estado === "ENVIADO" ? "Enviado" : f.estado === "ERROR" ? (f.proximoIntento ? "Se reintenta" : "No salió") : "Enviando"}
            </span>
          ) },
          { titulo: "", valor: (f) => f.tipo !== "INCIDENTES" && <button className="enlace" onClick={() => reenviar(f.id)}>Reenviar</button> },
        ]}
      />
    </>
  );
}
