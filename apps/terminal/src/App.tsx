import { TecladoPantalla } from "./Teclado";
import { PantallaActualizacion, usePreparado } from "./PantallaActualizacion";
import { leerTema } from "./escala";
import { AvisoLicencia } from "./AvisoLicencia";
import { useEffect, useRef, useState } from "react";
import { api, equipoId, leerAjustes, guardarAjustes, rd, sesionCaja, fijarSesionCaja, type Ajustes } from "./api";
import { guardarCache, iniciarVigilancia, leerCache, recordarPin, usuariosSinServidor, verificarPinSinServidor, useConexion } from "./contingencia";
import { Venta, Modal, ConsultaPrecios } from "./Venta";
import { PinSupervisor } from "./Operaciones";
import { TurnoCaja } from "./Turno";
import { temaTerminal, marcaEfectiva } from "@factpos/compartido";
import { SimboloFactPOS } from "./Logo";

export interface ConfigCaja {
  id: string;
  numero: number;
  nombre: string;
  sucursalId: string;
  sucursal: string;
  empresa: string;
  rnc: string;
  modulos: { delivery: { activo: boolean } };
  /** Funciones de Seguridad que cambian la pantalla de venta */
  funciones?: { sinComprobante: boolean };
  marca: { logo: string | null; primario: string; secundario: string | null; logoEnTicket: boolean; usarColores?: boolean; formato?: Partial<import("@factpos/compartido").FormatoTicket>; pantallaCliente?: Partial<import("./pantalla-cliente").ConfigPantalla> };
  direccion?: string | null;
  telefono?: string | null;
}

/** Tema camaleón: los colores del logo del cliente pintan la terminal. */
function aplicarMarca(m: ConfigCaja["marca"]) {
  marcaActual = m;
  for (const [k, v] of Object.entries(temaTerminal(marcaEfectiva(m), leerTema()))) document.documentElement.style.setProperty(k, v);
}
let marcaActual: ConfigCaja["marca"] | null = null;
// Al cambiar de tema claro/oscuro, los colores de la marca se recalculan para ese fondo
window.addEventListener("factpos:tema", () => { if (marcaActual) aplicarMarca(marcaActual); });
export interface Usuario { id: string; nombre: string; tienePin?: boolean }
export interface Turno { id: string; abiertoEn: string; fondoInicial: string; usuarioId: string; usuario: string }

/**
 * Flujo de la terminal: configurar (una sola vez) → elegir usuario → abrir turno → vender.
 */
const MINUTOS_INACTIVIDAD = 5;
function AppInterna() {
  const [ajustes, setAjustes] = useState<Ajustes | null>(leerAjustes());
  const [config, setConfig] = useState<ConfigCaja | null>(null);
  const previa = sesionCaja();
  const [usuario, setUsuario] = useState<Usuario | null>(previa && previa.cajaId === ajustes?.cajaId ? previa.usuario : null);
  const salir = () => { fijarSesionCaja(null); setUsuario(null); setTurno(undefined); };

  // Si el servidor dice que la sesión terminó, se vuelve a la pantalla del PIN
  useEffect(() => {
    const f = () => salir();
    window.addEventListener("factpos:sesion-vencida", f);
    return () => window.removeEventListener("factpos:sesion-vencida", f);
  }, []);
  const [turno, setTurno] = useState<Turno | null | undefined>(undefined);
  const [error, setError] = useState("");

  // Seguridad de la caja: con el turno abierto, salir de FactPOS necesita la aprobación de un supervisor
  const [saliendo, setSaliendo] = useState(false);
  const [bienvenida, setBienvenida] = useState<{ usuario: string; fondo: string } | null>(null);
  const [minimizando, setMinimizando] = useState(false);
  const [bloqueada, setBloqueada] = useState(false);
  const electron = (window as unknown as { factpos?: { turno?: (v: boolean) => void; alIntentarCerrar?: (f: () => void) => void; cerrar?: () => void; alIntentarMinimizar?: (f: () => void) => void; minimizar?: () => void } }).factpos;
  // Minimizar la caja (Windows+D, etc.) también necesita el permiso de un supervisor
  useEffect(() => { electron?.alIntentarMinimizar?.(() => setMinimizando(true)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Inactividad: pasados unos minutos sin tocar la caja se bloquea y pide el PIN de quien está en caja (la venta en curso se conserva)
  const ultimaActividad = useRef(Date.now());
  useEffect(() => {
    const marcar = () => { ultimaActividad.current = Date.now(); };
    const ev = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;
    ev.forEach((x) => window.addEventListener(x, marcar, { passive: true }));
    const t = setInterval(() => { if (Date.now() - ultimaActividad.current > MINUTOS_INACTIVIDAD * 60000 && sesionCaja()) setBloqueada(true); }, 10000);
    return () => { ev.forEach((x) => window.removeEventListener(x, marcar)); clearInterval(t); };
  }, []);
  useEffect(() => { if (turno !== undefined) electron?.turno?.(!!turno); }, [turno]); // eslint-disable-line react-hooks/exhaustive-deps
  // En el navegador (la app de escritorio ya abre en kiosko) la caja pasa a pantalla completa con el primer toque o tecla:
  // los navegadores no permiten hacerlo sin una acción del usuario.
  useEffect(() => {
    if (electron) return;
    const pantallaCompleta = () => {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
    };
    window.addEventListener("pointerdown", pantallaCompleta, { once: true });
    window.addEventListener("keydown", pantallaCompleta, { once: true });
    return () => { window.removeEventListener("pointerdown", pantallaCompleta); window.removeEventListener("keydown", pantallaCompleta); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [cerrada, setCerrada] = useState(false);
  const turnoRef = useRef<Turno | null | undefined>(undefined);
  turnoRef.current = turno;
  useEffect(() => {
    electron?.alIntentarCerrar?.(() => setSaliendo(true)); // Alt+F4, cerrar la ventana o Ctrl+Mayús+Q con el turno abierto
    const f = () => { if (turnoRef.current) setSaliendo(true); else if (confirm("¿Cerrar FactPOS?")) cerrarTodo(); };
    window.addEventListener("factpos:salir-sistema", f);
    return () => window.removeEventListener("factpos:salir-sistema", f);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // En la aplicación de escritorio se cierra el programa; en un navegador no se puede cerrar la pestaña a la fuerza:
  // se cierra la sesión y queda una pantalla de «Caja cerrada» (nunca se vuelve a las ventas).
  const cerrarTodo = () => {
    if (electron?.cerrar) return electron.cerrar();
    fijarSesionCaja(null); setUsuario(null); setTurno(undefined); setSaliendo(false); setCerrada(true);
    try { window.close(); } catch { /* el navegador no lo permite */ }
  };
  const aprobadoSalir = () => { window.dispatchEvent(new Event("factpos:antes-salir")); setTimeout(cerrarTodo, 200); };

  // Configuración de la caja. Si el servidor no responde, la última guardada en esta caja
  // (así se puede seguir vendiendo en contingencia).
  useEffect(() => {
    if (!ajustes) return;
    // Arranque rápido: se muestra de inmediato la última configuración guardada en esta caja y se actualiza en segundo plano
    let activo = true;
    leerCache<ConfigCaja>(ajustes, "config").then((c) => { if (activo && c) { aplicarMarca(c.marca); setConfig((previa) => previa ?? c); } }).catch(() => {});
    api<ConfigCaja>(ajustes.servidor, `/cajas/${ajustes.cajaId}/config`)
      .then((c) => { aplicarMarca(c.marca); setConfig(c); guardarCache(ajustes, "config", c); })
      .catch(async (e) => {
        const c = await leerCache<ConfigCaja>(ajustes, "config");
        if (c) { aplicarMarca(c.marca); setConfig(c); } else setError(e.message);
      });
    return () => { activo = false; };
  }, [ajustes]);
  useEffect(() => { if (ajustes && config) void iniciarVigilancia(ajustes); }, [ajustes, config]);

  useEffect(() => {
    if (!ajustes || !usuario) return;
    api<Turno | null>(ajustes.servidor, `/cajas/${ajustes.cajaId}/turno`)
      .then((t) => { setTurno(t); guardarCache(ajustes, "turno", t); })
      .catch(async (e) => {
        const t = await leerCache<Turno | null>(ajustes, "turno");
        if (t !== undefined) setTurno(t); else setError(e.message);
      });
  }, [ajustes, usuario]);

  const ventanaSalir = saliendo && ajustes ? (
    <Modal titulo="Hay un turno abierto" onCerrar={() => setSaliendo(false)}>
      <p>No se puede cerrar FactPOS con el turno abierto. Cierre el turno en <b>Turno y cierre</b>, o pida a un supervisor que autorice la salida.</p>
      <PinSupervisor ajustes={ajustes} permiso="caja.salir" textoBoton="Autorizar y cerrar FactPOS" onAprobado={aprobadoSalir} />
      <button className="boton ancho" style={{ marginTop: 8 }} onClick={() => setSaliendo(false)}>Volver a la caja</button>
    </Modal>
  ) : null;
  const ventanaMin = minimizando ? (
    <Modal titulo="Minimizar la caja" onCerrar={() => setMinimizando(false)}>
      <p>Para minimizar la caja hace falta la aprobación de un supervisor.</p>
      {ajustes
        ? <PinSupervisor ajustes={ajustes} permiso="caja.salir" textoBoton="Autorizar y minimizar" onAprobado={() => { setMinimizando(false); electron?.minimizar?.(); }} />
        : <button className="boton ancho" onClick={() => { setMinimizando(false); electron?.minimizar?.(); }}>Minimizar</button>}
      <button className="boton ancho" style={{ marginTop: 8 }} onClick={() => setMinimizando(false)}>Volver a la caja</button>
    </Modal>
  ) : null;
  const pantallaBloqueo = bloqueada && ajustes && config && usuario ? (
    <div className="bloqueo-caja"><ElegirUsuario ajustes={ajustes} config={config} bloqueo={usuario} onElegir={() => { ultimaActividad.current = Date.now(); setBloqueada(false); }} /></div>
  ) : null;
  if (cerrada) return <Pantalla><h2>Caja cerrada</h2><p className="suave">Ya puede cerrar esta ventana.</p><button className="boton ancho" onClick={() => location.reload()}>Abrir de nuevo</button></Pantalla>;
  if (ajustes && error && !config) {
    // Esta PC ya tiene su caja: un fallo de conexión nunca la desconfigura, solo se reintenta
    return <Pantalla><h2>Sin conexión con el servidor</h2><p className="error">{error}</p><p className="suave">Esta caja sigue asignada. Revise que el servidor esté encendido.</p><button className="boton ancho" onClick={() => { setError(""); setAjustes({ ...ajustes }); }}>Reintentar</button></Pantalla>;
  }
  if (!ajustes) {
    return <Configurar inicial={ajustes} error={error} onListo={(a) => { guardarAjustes(a); setError(""); setAjustes(a); }} />;
  }
  if (!config) return <Pantalla><p className="suave">Conectando con el servidor…</p></Pantalla>;
  if (!usuario) return <><ElegirUsuario ajustes={ajustes} config={config} onElegir={setUsuario} />{ventanaSalir}{ventanaMin}</>;
  if (turno === undefined) return <Pantalla><p className="suave">Cargando turno…</p></Pantalla>;
  if (turno === null) return <AbrirTurno ajustes={ajustes} config={config} usuario={usuario} onAbierto={(fondo) => { setBienvenida({ usuario: usuario.nombre, fondo }); setTurno(undefined); }} recargar={() => api<Turno | null>(ajustes.servidor, `/cajas/${ajustes.cajaId}/turno`).then((t) => { setTurno(t); guardarCache(ajustes, "turno", t); })} />;

  // El turno es de quien lo abrió: otro cajero no vende dentro de un turno ajeno (el cuadre sería de dos personas)
  if (turno.usuarioId !== usuario.id) {
    return <><TurnoAjeno ajustes={ajustes} config={config} usuario={usuario} turno={turno} onSalir={salir} onCerrado={() => { guardarCache(ajustes, "turno", null); setTurno(null); }} />{ventanaSalir}</>;
  }
  return <><AvisoLicencia servidor={ajustes.servidor} /><Venta ajustes={ajustes} config={config} usuario={usuario} turno={turno} onSalir={salir} />{ventanaSalir}{ventanaMin}{pantallaBloqueo}{bienvenida && <BienvenidaTurno {...bienvenida} onCerrar={() => setBienvenida(null)} />}</>;
}

function TurnoAjeno({ ajustes, config, usuario, turno, onSalir, onCerrado }: {
  ajustes: Ajustes; config: ConfigCaja; usuario: Usuario; turno: Turno; onSalir: () => void; onCerrado: () => void;
}) {
  const [cerrando, setCerrando] = useState(false);
  const [autorizado, setAutorizado] = useState(false);
  if (cerrando && autorizado) return <TurnoCaja ajustes={ajustes} config={config} usuario={usuario} turno={turno} pausadas={0} onCerrado={onCerrado} onCerrar={() => { setCerrando(false); setAutorizado(false); }} />;
  return (
    <Pantalla>
      <h2>Esta caja tiene un turno abierto</h2>
      <p>El turno de <b>{turno.usuario}</b> sigue abierto. Cada cajero trabaja con su propio turno para que el cuadre sea de una sola persona.</p>
      <p className="suave">{turno.usuario} debe cerrar su turno, o un supervisor puede cerrarlo ahora. Después podrá abrir el suyo con su fondo inicial.</p>
      {cerrando ? (
        <PinSupervisor ajustes={ajustes} permiso="caja.salir" textoBoton="Autorizar y cerrar el turno" onAprobado={() => setAutorizado(true)} />
      ) : (
        <button className="boton ancho" onClick={() => setCerrando(true)}>Cerrar el turno de {turno.usuario} (supervisor)</button>
      )}
      <button className="enlace" style={{ marginTop: 10 }} onClick={onSalir}>← Volver a la pantalla del PIN</button>
    </Pantalla>
  );
}

function Pantalla({ children }: { children: React.ReactNode }) {
  return (
    <div className="pantalla-centro">
      <div className="tarjeta-centro">
        <div className="marca con-icono"><SimboloFactPOS tamano={36} /><span>Fact<span>POS</span></span></div>
        {children}
      </div>
    </div>
  );
}

interface Encontrado { url: string; empresa: string | null; sucursales: string[]; equipo: string }

/** Pregunta a una dirección si es un servidor FactPOS (responde /descubrir). */
async function probar(url: string, ms = 1200): Promise<Encontrado | null> {
  try {
    const r = await fetch(`${url}/descubrir`, { signal: AbortSignal.timeout(ms) });
    if (!r.ok) return null;
    const d = await r.json();
    return d?.producto === "FactPOS" ? { url, empresa: d.empresa, sucursales: d.sucursales ?? [], equipo: d.equipo } : null;
  } catch { return null; }
}

/**
 * Búsqueda del servidor de la sucursal, en este orden:
 *  1. Si esta pantalla la sirve el servidor (lo normal), es ese.
 *  2. El nombre factpos.local (el servidor lo anuncia en la red).
 *  3. Recorre las redes locales más comunes buscando quién responde.
 */
async function buscarServidores(avance: (texto: string) => void, alEncontrar: (e: Encontrado) => void) {
  const vistos = new Set<string>();
  const anotar = (e: Encontrado | null) => { if (e && !vistos.has(e.url)) { vistos.add(e.url); alEncontrar(e); } };
  // Aplicación de escritorio: ella indica el servidor con el que se instaló esta caja
  try {
    const r = await fetch("/escritorio.json", { signal: AbortSignal.timeout(1500), cache: "no-store" });
    const d = r.ok ? await r.json() : null;
    if (d?.servidor) {
      avance("Conectando con el servidor…");
      const e = await probar(String(d.servidor).replace(/\/$/, ""), 3000);
      if (e) return anotar(e);
    }
  } catch { /* no es la aplicación de escritorio */ }
  if (location.pathname.startsWith("/terminal")) {
    avance("Conectando con el servidor…");
    const e = await probar(location.origin, 3000);
    if (e) return anotar(e);
  }
  avance("Buscando factpos.local…");
  anotar(await probar("http://factpos.local:3000", 2500));
  if (vistos.size) return;

  // Redes locales: la de esta misma pantalla (si se abrió por IP) y las de los routers más usados
  const redes = new Set<string>();
  const ip = /^(\d+\.\d+\.\d+)\.\d+$/.exec(location.hostname);
  if (ip) redes.add(ip[1]);
  ["192.168.1", "192.168.0", "192.168.100", "10.0.0", "192.168.2", "192.168.10", "10.0.1"].forEach((r) => redes.add(r));
  for (const red of redes) {
    avance(`Buscando en la red ${red}.x…`);
    const ips = Array.from({ length: 254 }, (_, k) => `http://${red}.${k + 1}:3000`);
    for (let k = 0; k < ips.length; k += 64) {
      (await Promise.all(ips.slice(k, k + 64).map((u) => probar(u)))).forEach(anotar);
    }
    if (vistos.size) return;
  }
}

function Configurar({ inicial, error, onListo }: { inicial: Ajustes | null; error: string; onListo: (a: Ajustes) => void }) {
  const [servidor, setServidor] = useState(inicial?.servidor ?? "");
  const [msg, setMsg] = useState(error);
  const [buscando, setBuscando] = useState(false);
  const [avance, setAvance] = useState("");
  const [encontrados, setEncontrados] = useState<Encontrado[]>([]);
  const [manual, setManual] = useState(false);

  const conectar = async (url: string) => {
    setMsg("");
    setServidor(url);
    try {
      // La primera vez, el servidor le asigna a esta PC su caja y queda definitiva: no se pregunta
      const c = await api<{ id: string }>(url, "/cajas/asignar", { cuerpo: { equipoId: equipoId() } });
      onListo({ servidor: url, cajaId: c.id });
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const buscar = async () => {
    setBuscando(true);
    setEncontrados([]);
    setMsg("");
    const hallados: Encontrado[] = [];
    await buscarServidores(setAvance, (e) => { hallados.push(e); setEncontrados([...hallados]); });
    setBuscando(false);
    // Un solo servidor: se conecta directo
    if (hallados.length === 1) conectar(hallados[0].url);
    else if (!hallados.length) { setMsg("No se encontró el servidor en la red. Revise que esté encendido y en la misma red, o escriba su dirección."); setManual(true); }
  };
  useEffect(() => { buscar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Pantalla>
      <h2>Preparando esta caja</h2>
      {buscando && <p className="buscando"><span className="girando" aria-hidden="true" />{avance}</p>}
      {encontrados.length > 1 && (
        <div className="lista-opciones">
          <p className="suave">Se encontraron varios servidores. ¿Cuál es el de esta sucursal?</p>
          {encontrados.map((e) => (
            <button key={e.url} className="opcion" onClick={() => conectar(e.url)}>
              <b>{e.empresa ?? "FactPOS"}</b> <span className="suave">{e.sucursales.join(", ")} · {e.url.replace("http://", "")}</span>
            </button>
          ))}
        </div>
      )}
      {msg && <p className="error">{msg}</p>}
      {!buscando && (manual
        ? (
          <>
            <label className="campo">
              <span>Dirección del servidor de la sucursal</span>
              <input value={servidor} placeholder="http://192.168.1.10:3000" onChange={(e) => setServidor(e.target.value)} onKeyDown={(e) => e.key === "Enter" && conectar(servidor)} />
            </label>
            <div className="dos-columnas">
              <button className="boton fantasma" onClick={buscar}>Buscar de nuevo</button>
              <button className="boton primario" onClick={() => conectar(servidor.replace(/\/$/, ""))}>Conectar</button>
            </div>
          </>
        )
        : <button className="enlace" onClick={() => setManual(true)}>Escribir la dirección a mano</button>)}
    </Pantalla>
  );
}

function ElegirUsuario({ ajustes, config, onElegir, bloqueo }: { ajustes: Ajustes; config: ConfigCaja; onElegir: (u: Usuario) => void; bloqueo?: Usuario }) {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [elegido, setElegido] = useState<Usuario | null>(bloqueo ?? null);
  const [pin, setPin] = useState("");
  const [msg, setMsg] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [sinServidor, setSinServidor] = useState(false);
  const conexion = useConexion();
  useEffect(() => {
    api<Usuario[]>(ajustes.servidor, `/cajas/${ajustes.cajaId}/usuarios`)
      .then((u) => { setUsuarios(u); setSinServidor(false); })
      // Sin servidor: solo quien ya entró antes en esta caja (su PIN se verifica aquí mismo)
      .catch(async () => { setUsuarios(await usuariosSinServidor(ajustes)); setSinServidor(true); });
  }, [ajustes, conexion.enLinea]);

  const entrar = async (valor = pin) => {
    if (!elegido || valor.length < 4 || enviando) return;
    setEnviando(true); setMsg("");
    try {
      if (sinServidor) {
        if (!(await verificarPinSinServidor(ajustes, elegido.id, valor))) throw new Error("PIN incorrecto");
        fijarSesionCaja(null);
        onElegir({ id: elegido.id, nombre: elegido.nombre });
        return;
      }
      const r = await api<{ token: string; usuario: Usuario }>(ajustes.servidor, `/cajas/${ajustes.cajaId}/entrar`, { cuerpo: { usuarioId: elegido.id, pin: valor } });
      fijarSesionCaja({ token: r.token, usuario: r.usuario, cajaId: ajustes.cajaId });
      // Guardar el PIN para contingencia no debe poder trabar el ingreso (si el almacenamiento local se cuelga, se sigue)
      await Promise.race([recordarPin(ajustes, r.usuario, valor).catch(() => {}), new Promise((ok) => setTimeout(ok, 1500))]);
      onElegir(r.usuario);
    } catch (e) {
      setMsg((e as Error).message);
      setPin("");
    } finally { setEnviando(false); }
  };
  const tecla = (t: string) => {
    if (t === "⌫") return setPin(pin.slice(0, -1));
    if (t === "OK") return entrar();
    if (pin.length < 6) setPin(pin + t);
  };

  if (!elegido) {
    return (
      <Pantalla>
        <p className="suave">{config.sucursal} · {config.nombre}</p>
        <h2>¿Quién está en caja?</h2>
        {sinServidor && <p className="aviso-sin-servidor-chico">Sin conexión con el servidor: solo pueden entrar quienes ya usaron esta caja.</p>}
        <div className="lista-opciones">
          {usuarios.map((u) => (
            <button key={u.id} className="opcion grande" disabled={!u.tienePin} title={u.tienePin ? "" : "Sin PIN asignado"}
              onClick={() => { setElegido(u); setPin(""); setMsg(""); }}>
              {u.nombre}{!u.tienePin && <small className="suave"> · sin PIN</small>}
            </button>
          ))}
        </div>
        {msg && <p className="error">{msg}</p>}
      </Pantalla>
    );
  }
  return (
    <Pantalla>
      <p className="suave">{config.sucursal} · {config.nombre}</p>
      <h2>{bloqueo ? "Caja bloqueada" : elegido.nombre}</h2>
      {bloqueo && <p className="suave">Por inactividad. {elegido.nombre}, escriba su PIN para continuar; la venta en curso se conserva.</p>}
      <label className="campo">
        <span>Su PIN</span>
        <input autoFocus type="password" inputMode="numeric" autoComplete="off" className="entrada-grande pin" aria-label="PIN"
          value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))} onKeyDown={(e) => e.key === "Enter" && entrar()} />
      </label>
      <div className="teclado-pin">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "OK"].map((t) => (
          <button key={t} className={"tecla" + (t === "OK" ? " ok" : "")} disabled={enviando || (t === "OK" && pin.length < 4)} onClick={() => tecla(t)}>{t}</button>
        ))}
      </div>
      {msg && <p className="error">{msg}</p>}
      {!bloqueo && <button className="enlace" onClick={() => setElegido(null)}>← No soy {elegido.nombre.split(" ")[0]}</button>}
    </Pantalla>
  );
}

/** Mensaje al abrir el turno: quién lo inicia y con cuánto. Se cierra solo. */
function BienvenidaTurno({ usuario, fondo, onCerrar }: { usuario: string; fondo: string; onCerrar: () => void }) {
  useEffect(() => { const t = setTimeout(onCerrar, 6000); return () => clearTimeout(t); }, [onCerrar]);
  return (
    <Modal titulo={`¡Bienvenido, ${usuario}!`} onCerrar={onCerrar}>
      <p>Su turno quedó abierto.</p>
      <p>Monto inicial en caja: <b>{rd(fondo)}</b></p>
      <button className="boton primario ancho" autoFocus onClick={onCerrar}>Comenzar a vender</button>
    </Modal>
  );
}

function AbrirTurno({ ajustes, config, usuario, onAbierto, recargar }: {
  ajustes: Ajustes; config: ConfigCaja; usuario: Usuario; onAbierto: (fondo: string) => void; recargar: () => void;
}) {
  const [fondo, setFondo] = useState("2000");
  const [msg, setMsg] = useState("");
  const [consultando, setConsultando] = useState(false);
  const abrir = async () => {
    try {
      await api(ajustes.servidor, `/cajas/${ajustes.cajaId}/turno/abrir`, { cuerpo: { usuarioId: usuario.id, fondoInicial: fondo || "0" } });
      onAbierto(fondo || "0");
      recargar();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  return (
    <Pantalla>
      <p className="suave">{config.nombre} · {usuario.nombre}</p>
      <h2>Abrir turno</h2>
      <label className="campo">
        <span>Fondo de caja (efectivo inicial)</span>
        <input autoFocus inputMode="decimal" value={fondo} onChange={(e) => setFondo(e.target.value.replace(/[^\d.]/g, ""))}
          onKeyDown={(e) => e.key === "Enter" && abrir()} />
      </label>
      <p className="suave">Fondo: {rd(fondo || 0)}</p>
      <button className="boton primario ancho" onClick={abrir}>Abrir turno</button>
      <button className="boton ancho" onClick={() => setConsultando(true)}>Consultar precios</button>
      <p className="suave pequeno">Sin turno abierto solo se pueden consultar precios y existencias; para facturar hay que abrir el turno.</p>
      {msg && <p className="error">{msg}</p>}
      {consultando && <ConsultaPrecios ajustes={ajustes} onCerrar={() => setConsultando(false)} />}
    </Pantalla>
  );
}

/** Aplicación + pantalla de actualización (tapa todo mientras el servidor se actualiza y pide el PIN de nuevo al terminar). */
declare const __INTERFAZ__: string;
/** Versión instalada, siempre visible en una esquina: la del servidor y la fecha de compilación de esta interfaz. */
function VersionCaja() {
  const [v, setV] = useState("");
  useEffect(() => {
    const url = leerAjustes()?.servidor; if (!url) return;
    fetch(`${url.replace(/\/$/, "")}/actualizacion/estado`, { cache: "no-store" }).then((r) => r.json()).then((d) => setV(String(d.version ?? ""))).catch(() => {});
  }, []);
  return <div className="version-caja" title="Versión del servidor · fecha de compilación de esta pantalla">FactPOS {v ? `v${v.replace(/\.0$/, "")}` : ""} · {__INTERFAZ__}</div>;
}

export function App() {
  const listo = usePreparado(() => leerAjustes()?.servidor ?? "", () => fijarSesionCaja(null));
  return (
    <>
      {listo ? <AppInterna /> : <div className="cargando" style={{ padding: 40, textAlign: "center" }}>Iniciando…</div>}
      <VersionCaja />
      <TecladoPantalla />
      <PantallaActualizacion servidor={() => leerAjustes()?.servidor ?? ""} alCambiarVersion={() => fijarSesionCaja(null)} />
    </>
  );
}
