import { TecladoPantalla } from "./Teclado";
import { PantallaActualizacion, usePreparado } from "./PantallaActualizacion";
import { leerTema } from "./escala";
import { AvisoLicencia } from "./AvisoLicencia";
import { useEffect, useRef, useState } from "react";
import { api, equipoId, leerAjustes, guardarAjustes, rd, sesionCaja, fijarSesionCaja, type Ajustes } from "./api";
import { guardarCache, iniciarVigilancia, leerCache, recordarPin, usuarioPorPinSinServidor, verificarPinSinServidor, useConexion } from "./contingencia";
import { Venta, Modal, ConsultaPrecios } from "./Venta";
import { PinSupervisor } from "./Operaciones";
import { TurnoCaja } from "./Turno";
import { PantallaMesero } from "./Mesero";
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
  /** TIENDA (por defecto) o RESTAURANTE, BAR, DISCOTECA, COMIDA_RAPIDA: activa las cuentas abiertas */
  tipoNegocio?: string;
  /** Control de entradas y aforo (bar o discoteca) */
  aforoActivo?: boolean;
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
export interface Usuario { id: string; nombre: string; tienePin?: boolean; /** mesero: entra directo al salón, sin turno ni cobro */ soloSalon?: boolean }
export interface Turno { id: string; abiertoEn: string; fondoInicial: string; usuarioId: string; usuario: string }

/**
 * Flujo de la terminal: configurar (una sola vez) → elegir usuario → abrir turno → vender.
 */
const MINUTOS_INACTIVIDAD = 5;

/** Desvincula esta PC del servidor actual: borra lo guardado y vuelve a buscar los servidores de la red para elegir otro. */
function cambiarServidor() {
  try { localStorage.removeItem("factpos.terminal"); } catch { /* sin almacenamiento */ }
  fijarSesionCaja(null);
  location.reload();
}
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

  // Aplicación de escritorio: la caja solo trabaja con un servidor de SU red local. Si la dirección guardada es de otra red
  // (p. ej. quedó apuntando al servidor de otra sucursal), se descarta y se vuelve a buscar el servidor de esta red.
  useEffect(() => {
    const a = leerAjustes();
    if (!a?.servidor) return;
    fetch(`/escritorio.json?servidor=${encodeURIComponent(a.servidor)}`, { signal: AbortSignal.timeout(2000), cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && d.enRed === false) {
          try { localStorage.removeItem("factpos.terminal"); } catch { /* sin almacenamiento */ }
          fijarSesionCaja(null); setUsuario(null); setConfig(null); setAjustes(null);
        }
      }).catch(() => { /* no es la aplicación de escritorio o no responde: se deja como está */ });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Seguridad de la caja: con el turno abierto, salir de FactPOS necesita la aprobación de un supervisor
  const [saliendo, setSaliendo] = useState(false);
  const [cambiando, setCambiando] = useState(false);
  // Sin conexión con el servidor no hay dónde validar el PIN: en la pantalla del PIN se deja cerrar FactPOS sin él
  const [sinServidor, setSinServidor] = useState(false);
  useEffect(() => {
    if (!saliendo || !ajustes) { setSinServidor(false); return; }
    let vivo = true;
    fetch(`${ajustes.servidor}/`, { method: "HEAD", signal: AbortSignal.timeout(2500), cache: "no-store" })
      .then(() => vivo && setSinServidor(false)).catch(() => vivo && setSinServidor(true));
    return () => { vivo = false; };
  }, [saliendo]); // eslint-disable-line react-hooks/exhaustive-deps
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

  // Sin turno abierto (ya se hizo el cierre) no hay nada que proteger: se cierra la caja con una confirmación, sin PIN
  // En la pantalla del PIN (nadie ha entrado) no hay turno de nadie que proteger, pero cerrar la caja sí pide a un supervisor o administrador
  const ventanaCambiar = cambiando && ajustes ? (
    <Modal titulo="Cambiar de servidor" onCerrar={() => setCambiando(false)}>
      <p>Esta PC quedó asignada a su caja y solo un administrador puede cambiarla. Escriba su PIN para desvincularla y elegir otro servidor.</p>
      <PinSupervisor ajustes={ajustes} permiso="caja.cambiar_servidor" textoBoton="Autorizar y cambiar de servidor" enfocar onAprobado={cambiarServidor} />
      <p className="suave" style={{ marginTop: 8 }}>Después, el administrador debe liberar esta PC en el servidor anterior (Sucursales y terminales › Liberar PC) para que pueda tomar otra caja.</p>
      <button className="boton ancho" style={{ marginTop: 8 }} onClick={() => setCambiando(false)}>Volver</button>
    </Modal>
  ) : null;
  const ventanaSalir = saliendo && ajustes && !usuario && sinServidor ? (
    <Modal titulo="Cerrar FactPOS" onCerrar={() => setSaliendo(false)}>
      <p>No hay conexión con el servidor, así que no se puede comprobar un PIN. Como no hay ninguna sesión abierta, puede cerrar FactPOS.</p>
      <button className="boton primario ancho" onClick={aprobadoSalir}>Cerrar FactPOS</button>
      <button className="boton ancho" style={{ marginTop: 8 }} onClick={() => setSaliendo(false)}>Volver a la caja</button>
    </Modal>
  ) : saliendo && ajustes && !usuario ? (
    <Modal titulo="Cerrar FactPOS" onCerrar={() => setSaliendo(false)}>
      <p>Para cerrar la caja escriba el PIN de un supervisor o administrador.</p>
      <PinSupervisor ajustes={ajustes} permiso="caja.salir" textoBoton="Autorizar y cerrar FactPOS" enfocar onAprobado={aprobadoSalir} />
      <button className="boton ancho" style={{ marginTop: 8 }} onClick={() => setSaliendo(false)}>Volver a la caja</button>
    </Modal>
  ) : saliendo && ajustes && turno === null ? (
    <Modal titulo="Cerrar FactPOS" onCerrar={() => setSaliendo(false)}>
      <p>El turno ya está cerrado. Al cerrar FactPOS podrá apagar el equipo o volver a abrir la caja desde su acceso directo.</p>
      <button className="boton primario ancho" onClick={aprobadoSalir}>Cerrar FactPOS</button>
      <button className="boton ancho" style={{ marginTop: 8 }} onClick={() => setSaliendo(false)}>Volver a la caja</button>
    </Modal>
  ) : saliendo && ajustes ? (
    <Modal titulo="Hay un turno abierto" onCerrar={() => setSaliendo(false)}>
      <p>No se puede cerrar FactPOS con el turno abierto. Cierre el turno en <b>Turno y cierre</b>, o pida a un supervisor que autorice la salida.</p>
      <PinSupervisor ajustes={ajustes} permiso="caja.salir" textoBoton="Autorizar y cerrar FactPOS" enfocar onAprobado={aprobadoSalir} />
      <button className="boton ancho" style={{ marginTop: 8 }} onClick={() => setSaliendo(false)}>Volver a la caja</button>
    </Modal>
  ) : null;
  const ventanaMin = minimizando ? (
    <Modal titulo="Minimizar la caja" onCerrar={() => setMinimizando(false)}>
      <p>Para minimizar la caja hace falta la aprobación de un supervisor.</p>
      {ajustes
        ? <PinSupervisor ajustes={ajustes} permiso="caja.salir" textoBoton="Autorizar y minimizar" enfocar onAprobado={() => { setMinimizando(false); electron?.minimizar?.(); }} />
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
    return <Pantalla><h2>Sin conexión con el servidor</h2><p className="error">{error}</p><p className="suave">Esta caja sigue asignada. Revise que el servidor esté encendido.</p><button className="boton ancho" onClick={() => { setError(""); setAjustes({ ...ajustes }); }}>Reintentar</button><button className="enlace" onClick={aprobadoSalir}>Cerrar FactPOS</button></Pantalla>;
  }
  if (!ajustes) {
    return <Configurar inicial={ajustes} error={error} onListo={(a) => { guardarAjustes(a); setError(""); setAjustes(a); }} onCerrar={() => { window.dispatchEvent(new Event("factpos:antes-salir")); setTimeout(cerrarTodo, 200); }} />;
  }
  if (!config) return <Pantalla><p className="suave">Conectando con el servidor…</p><button className="enlace" onClick={aprobadoSalir}>Cerrar FactPOS</button></Pantalla>;
  if (!usuario) return <><ElegirUsuario ajustes={ajustes} config={config} onElegir={setUsuario} onCerrar={() => setSaliendo(true)} onCambiar={() => setCambiando(true)} />{ventanaSalir}{ventanaCambiar}{ventanaMin}</>;
  if (usuario.soloSalon) return <><PantallaMesero ajustes={ajustes} config={config} usuario={usuario} onSalir={salir} />{pantallaBloqueo}</>;
  if (turno === undefined) return <Pantalla><p className="suave">Cargando turno…</p></Pantalla>;
  if (turno === null) return <><AbrirTurno ajustes={ajustes} config={config} usuario={usuario} onSalir={salir} onCerrarSistema={() => setSaliendo(true)} onAbierto={(fondo) => { setBienvenida({ usuario: usuario.nombre, fondo }); setTurno(undefined); }} recargar={() => api<Turno | null>(ajustes.servidor, `/cajas/${ajustes.cajaId}/turno`).then((t) => { setTurno(t); guardarCache(ajustes, "turno", t); })} />{ventanaSalir}</>;

  // El turno es de quien lo abrió: otro cajero no vende dentro de un turno ajeno (el cuadre sería de dos personas)
  if (turno.usuarioId !== usuario.id) {
    return <><TurnoAjeno ajustes={ajustes} config={config} usuario={usuario} turno={turno} onSalir={salir} onCerrado={() => { guardarCache(ajustes, "turno", null); setTurno(null); }} />{ventanaSalir}</>;
  }
  return <><AvisoLicencia servidor={ajustes.servidor} /><Venta ajustes={ajustes} config={config} usuario={usuario} turno={turno} onSalir={salir} />{ventanaSalir}{ventanaMin}{pantallaBloqueo}{bienvenida && <BienvenidaTurno {...bienvenida} onCerrar={() => setBienvenida(null)} />}</>;
}

/** Ventas en pausa guardadas en esta caja (aunque sean de otro cajero): impiden cerrar el turno */
function contarPausadas(cajaId: string): number {
  try { const v = JSON.parse(localStorage.getItem(`factpos.pausadas.${cajaId}`) ?? "[]"); return Array.isArray(v) ? v.length : 0; } catch { return 0; }
}

function TurnoAjeno({ ajustes, config, usuario, turno, onSalir, onCerrado }: {
  ajustes: Ajustes; config: ConfigCaja; usuario: Usuario; turno: Turno; onSalir: () => void; onCerrado: () => void;
}) {
  const [cerrando, setCerrando] = useState(false);
  const [autorizado, setAutorizado] = useState(false);
  if (cerrando && autorizado) return <TurnoCaja ajustes={ajustes} config={config} usuario={usuario} turno={turno} pausadas={contarPausadas(ajustes.cajaId)} onCerrado={onCerrado} onCerrar={() => { setCerrando(false); setAutorizado(false); }} />;
  return (
    <Pantalla>
      <h2>Esta caja tiene un turno abierto</h2>
      <p>El turno de <b>{turno.usuario}</b> sigue abierto. Cada cajero trabaja con su propio turno para que el cuadre sea de una sola persona.</p>
      <p className="suave">{turno.usuario} debe cerrar su turno, o un supervisor o administrador puede cerrarlo ahora (si usted lo es, se cierra sin pedir otro PIN). Después podrá abrir el suyo con su fondo inicial.</p>
      {cerrando ? (
        <PinSupervisor ajustes={ajustes} permiso="caja.salir" textoBoton="Autorizar y cerrar el turno" enfocar onAprobado={() => setAutorizado(true)} />
      ) : (
        <button className="boton ancho" onClick={() => setCerrando(true)}>Cerrar el turno de {turno.usuario} (supervisor o administrador)</button>
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
async function probar(url: string, ms = 800): Promise<Encontrado | null> {
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
async function buscarServidores(avance: (texto: string) => void, alEncontrar: (e: Encontrado) => void, todos = false) {
  const vistos = new Set<string>();
  const anotar = (e: Encontrado | null) => { if (e && !vistos.has(e.url)) { vistos.add(e.url); alEncontrar(e); } };
  // Aplicación de escritorio: ella indica el servidor con el que se instaló esta caja
  try {
    const r = await fetch("/escritorio.json", { signal: AbortSignal.timeout(1500), cache: "no-store" });
    const d = r.ok ? await r.json() : null;
    if (d?.servidor) {
      avance("Conectando con el servidor…");
      const e = await probar(String(d.servidor).replace(/\/$/, ""), 3000);
      if (e) { anotar(e); if (!todos) return; }
    }
  } catch { /* no es la aplicación de escritorio */ }
  if (location.pathname.startsWith("/terminal")) {
    avance("Conectando con el servidor…");
    const e = await probar(location.origin, 3000);
    if (e) { anotar(e); if (!todos) return; }
  }
  // La aplicación de escritorio busca por UDP en la red (como el instalador) y, si hace falta, barre las redes de este equipo;
  // al mismo tiempo se prueba el nombre factpos.local. En un navegador /descubrir-red no existe y se sigue con lo demás.
  avance("Buscando el servidor en la red…");
  const delEscritorio = fetch("/descubrir-red", { signal: AbortSignal.timeout(9000), cache: "no-store" })
    .then((r) => (r.ok ? r.json() : [])).then((l) => (Array.isArray(l) ? (l as Encontrado[]) : [])).catch(() => [] as Encontrado[]);
  const [porNombre, lista] = await Promise.all([probar("http://factpos.local:3000", 1500), delEscritorio]);
  if (lista.length) lista.forEach(anotar); else anotar(porNombre); // el mismo servidor por IP y por nombre no se ofrece dos veces
  if (vistos.size && !todos) return;
  if (todos && lista.length) return; // el escritorio ya buscó en toda la red

  // Redes locales: la de esta misma pantalla (si se abrió por IP) y las de los routers más usados
  const redes = new Set<string>();
  const ip = /^(\d+\.\d+\.\d+)\.\d+$/.exec(location.hostname);
  if (ip) redes.add(ip[1]);
  ["192.168.1", "192.168.0", "192.168.100", "10.0.0", "192.168.2", "192.168.10", "10.0.1"].forEach((r) => redes.add(r));
  for (const red of redes) {
    avance(`Buscando en la red ${red}.x…`);
    const ips = Array.from({ length: 254 }, (_, k) => `http://${red}.${k + 1}:3000`);
    for (let k = 0; k < ips.length; k += 127) {
      (await Promise.all(ips.slice(k, k + 127).map((u) => probar(u, 600)))).forEach(anotar);
    }
    if (vistos.size) return;
  }
}

interface CajaElegible { id: string; numero: number; nombre: string; sucursal: string; libre?: boolean; mia?: boolean }

function Configurar({ inicial, error, onListo, onCerrar }: { inicial: Ajustes | null; error: string; onListo: (a: Ajustes) => void; onCerrar: () => void }) {
  const [servidor, setServidor] = useState(inicial?.servidor ?? "");
  const [msg, setMsg] = useState(error);
  const [buscando, setBuscando] = useState(false);
  const [avance, setAvance] = useState("");
  const [encontrados, setEncontrados] = useState<Encontrado[]>([]);
  const [manual, setManual] = useState(false);
  const [cajas, setCajas] = useState<{ url: string; lista: CajaElegible[] } | null>(null);

  // Nada se asigna solo: primero se elige el servidor y luego la caja de esa sucursal
  const elegirServidor = async (url: string) => {
    setMsg("");
    setServidor(url);
    try {
      const lista = await api<CajaElegible[]>(url, `/cajas?equipo=${encodeURIComponent(equipoId())}`);
      const mia = lista.find((c) => c.mia);
      if (mia) { onListo({ servidor: url, cajaId: mia.id }); return; } // la asignación es definitiva: solo el administrador la libera
      setCajas({ url, lista });
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const asignar = async (url: string, cajaId: string) => {
    setMsg("");
    try {
      const c = await api<{ id: string }>(url, "/cajas/asignar", { cuerpo: { equipoId: equipoId(), cajaId } });
      onListo({ servidor: url, cajaId: c.id });
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const buscar = async () => {
    setBuscando(true);
    setEncontrados([]);
    setCajas(null);
    setMsg("");
    // Un mismo servidor puede aparecer por varias direcciones (localhost, su IP, factpos.local): se muestra una sola vez, con la más directa
    const porServidor = new Map<string, Encontrado>();
    const rango = (u: string) => { const h = new URL(u).hostname; return h === "localhost" || h === "127.0.0.1" ? 0 : /^\d+\.\d+\.\d+\.\d+$/.test(h) ? 1 : 2; };
    await buscarServidores(setAvance, (e) => {
      const clave = `${e.equipo}|${e.empresa}|${e.sucursales.join(",")}`;
      const previo = porServidor.get(clave);
      if (!previo || rango(e.url) < rango(previo.url)) porServidor.set(clave, e);
      setEncontrados([...porServidor.values()]);
    }, true);
    const hallados = [...porServidor.values()];
    setBuscando(false);
    if (!hallados.length) { setMsg("No se encontró el servidor en la red. Revise que esté encendido y en la misma red, o escriba su dirección."); setManual(true); }
  };
  useEffect(() => { buscar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (cajas) {
    return (
      <Pantalla>
        <h2>¿Qué caja es esta PC?</h2>
        <p className="suave">{cajas.url.replace("http://", "")}</p>
        <div className="lista-opciones">
          {cajas.lista.map((c) => (
            <button key={c.id} className="opcion" disabled={c.libre === false && !c.mia} onClick={() => asignar(cajas.url, c.id)}>
              <b>{c.sucursal} · {c.nombre}</b> <span className="suave">{c.mia ? "esta PC la tenía" : c.libre === false ? "en uso por otra PC" : "libre"}</span>
            </button>
          ))}
          {!cajas.lista.length && <p className="suave">Ese servidor no tiene cajas activas.</p>}
        </div>
        {msg && <p className="error">{msg}</p>}
        <button className="enlace" onClick={() => setCajas(null)}>Elegir otro servidor</button>
        <button className="enlace" onClick={onCerrar}>Cerrar FactPOS</button>
      </Pantalla>
    );
  }

  return (
    <Pantalla>
      <h2>Preparando esta caja</h2>
      {buscando && <p className="buscando"><span className="girando" aria-hidden="true" />{avance}</p>}
      {encontrados.length > 0 && (
        <div className="lista-opciones">
          <p className="suave">{encontrados.length > 1 ? "Se encontraron varios servidores. ¿Cuál es el de esta sucursal?" : "Se encontró este servidor. Tóquelo para conectar esta caja."}</p>
          {encontrados.map((e) => (
            <button key={e.url} className="opcion" onClick={() => elegirServidor(e.url)}>
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
              <input value={servidor} placeholder="http://192.168.1.10:3000" onChange={(e) => setServidor(e.target.value)} onKeyDown={(e) => e.key === "Enter" && elegirServidor(servidor.replace(/\/$/, ""))} />
            </label>
            <div className="dos-columnas">
              <button className="boton fantasma" onClick={buscar}>Buscar de nuevo</button>
              <button className="boton primario" onClick={() => elegirServidor(servidor.replace(/\/$/, ""))}>Conectar</button>
            </div>
          </>
        )
        : <button className="enlace" onClick={() => setManual(true)}>Escribir la dirección a mano</button>)}
      {/* Sin servidor no hay PIN que validar: se puede cerrar el programa sin clave */}
      <button className="enlace" onClick={onCerrar}>Cerrar FactPOS</button>
    </Pantalla>
  );
}

function ElegirUsuario({ ajustes, config, onElegir, bloqueo, onCerrar, onCambiar }: { ajustes: Ajustes; config: ConfigCaja; onElegir: (u: Usuario) => void; bloqueo?: Usuario; onCerrar?: () => void; onCambiar?: () => void }) {
  const [pin, setPin] = useState("");
  const [msg, setMsg] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [sinServidor, setSinServidor] = useState(false);
  const conexion = useConexion();
  // Solo se averigua si hay servidor (la pantalla no muestra nombres: el PIN identifica a la persona)
  useEffect(() => {
    api<Usuario[]>(ajustes.servidor, `/cajas/${ajustes.cajaId}/usuarios`)
      .then(() => setSinServidor(false))
      .catch(() => setSinServidor(true));
  }, [ajustes, conexion.enLinea]);

  const entrar = async (valor = pin) => {
    if (valor.length < 4 || enviando) return;
    setEnviando(true); setMsg("");
    try {
      if (sinServidor) {
        // Sin servidor: solo entran quienes ya usaron esta caja (su PIN se verifica aquí mismo)
        const quien = bloqueo ? ((await verificarPinSinServidor(ajustes, bloqueo.id, valor)) ? bloqueo : null) : await usuarioPorPinSinServidor(ajustes, valor);
        if (!quien) throw new Error("PIN incorrecto");
        fijarSesionCaja(null);
        onElegir({ id: quien.id, nombre: quien.nombre });
        return;
      }
      const r = await api<{ token: string; usuario: Usuario }>(ajustes.servidor, `/cajas/${ajustes.cajaId}/entrar`, { cuerpo: { usuarioId: bloqueo?.id, pin: valor } });
      fijarSesionCaja({ token: r.token, usuario: r.usuario, cajaId: ajustes.cajaId });
      // Guardar el PIN para contingencia no debe poder trabar el ingreso (si el almacenamiento local se cuelga, se sigue)
      await Promise.race([recordarPin(ajustes, r.usuario, valor).catch(() => {}), new Promise((ok) => setTimeout(ok, 1500))]);
      onElegir(r.usuario);
    } catch (e) {
      // Caja bloqueada: un administrador o supervisor también puede desbloquearla con su PIN (la sesión y la venta del cajero siguen igual)
      if (bloqueo && !sinServidor) {
        try {
          await api(ajustes.servidor, `/cajas/${ajustes.cajaId}/autorizar`, { cuerpo: { pin: valor, permiso: "caja.salir" } });
          onElegir(bloqueo);
          return;
        } catch { /* tampoco es un supervisor: se muestra el error del PIN */ }
      }
      setMsg((e as Error).message);
      setPin("");
    } finally { setEnviando(false); }
  };
  const tecla = (t: string) => {
    if (t === "⌫") return setPin(pin.slice(0, -1));
    if (t === "OK") return entrar();
    if (pin.length < 6) setPin(pin + t);
  };

  return (
    <Pantalla>
      <p className="suave">{config.sucursal} · {config.nombre}</p>
      <h2>{bloqueo ? "Caja bloqueada" : "Escriba su PIN"}</h2>
      {bloqueo && <p className="suave">Por inactividad. Escriba su PIN para continuar (o el PIN de un supervisor o administrador); la venta en curso se conserva.</p>}
      {sinServidor && !bloqueo && <p className="aviso-sin-servidor-chico">Sin conexión con el servidor: solo pueden entrar quienes ya usaron esta caja.</p>}
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
      {onCerrar && (
        <div className="fila-enlaces">
          <button className="enlace" onClick={onCerrar}>Cerrar FactPOS</button>
          {onCambiar && <button className="enlace" onClick={onCambiar}>Cambiar de servidor</button>}
        </div>
      )}
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

/** Billetes y monedas de RD$ para contar el fondo de caja */
const DENOMINACIONES = [2000, 1000, 500, 200, 100, 50, 25, 10, 5, 1];

function AbrirTurno({ ajustes, config, usuario, onAbierto, recargar, onSalir, onCerrarSistema }: {
  ajustes: Ajustes; config: ConfigCaja; usuario: Usuario; onAbierto: (fondo: string) => void; recargar: () => void; onSalir: () => void; onCerrarSistema: () => void;
}) {
  const [fondo, setFondo] = useState("");
  /** Desglose de billetes y monedas: cantidad por denominación. Mientras haya algo contado, el fondo es la suma. */
  const [cant, setCant] = useState<Record<number, string>>({});
  const totalContado = DENOMINACIONES.reduce((a, d) => a + d * (parseInt(cant[d] || "0", 10) || 0), 0);
  const hayConteo = DENOMINACIONES.some((d) => (parseInt(cant[d] || "0", 10) || 0) > 0);
  const contar = (d: number, v: string) => {
    const nuevo = { ...cant, [d]: v.replace(/\D/g, "").slice(0, 4) };
    setCant(nuevo);
    const t = DENOMINACIONES.reduce((a, x) => a + x * (parseInt(nuevo[x] || "0", 10) || 0), 0);
    setFondo(t > 0 ? String(t) : "");
  };
  const sumar = (d: number, delta: number) => contar(d, String(Math.max(0, (parseInt(cant[d] || "0", 10) || 0) + delta)));
  const [msg, setMsg] = useState("");
  const [consultando, setConsultando] = useState(false);
  const abrir = async () => {
    try {
      await api(ajustes.servidor, `/cajas/${ajustes.cajaId}/turno/abrir`, { cuerpo: { usuarioId: usuario.id, fondoInicial: fondo || "0", ...(hayConteo ? { conteoApertura: Object.fromEntries(DENOMINACIONES.map((d) => [String(d), parseInt(cant[d] || "0", 10) || 0]).filter(([, n]) => (n as number) > 0)) } : {}) } });
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
        <input autoFocus inputMode="decimal" value={fondo} onChange={(e) => { setFondo(e.target.value.replace(/[^\d.]/g, "")); setCant({}); }}
          onKeyDown={(e) => e.key === "Enter" && abrir()} />
      </label>
      <div className="desglose-turno">
        <div className="desglose-titulo">Desglose de billetes y monedas <span className="suave">(cuente el efectivo y el fondo se calcula solo)</span></div>
        <div className="desglose-grid">
          {DENOMINACIONES.map((d) => (
            <div className="desglose-fila" key={d}>
              <b>{d.toLocaleString("es-DO")}</b>
              <button type="button" className="boton fantasma chico" aria-label={`Quitar uno de ${d}`} onClick={() => sumar(d, -1)}>−</button>
              <input inputMode="numeric" value={cant[d] ?? ""} placeholder="0" aria-label={`Cantidad de ${d}`} onChange={(e) => contar(d, e.target.value)} />
              <button type="button" className="boton fantasma chico" aria-label={`Agregar uno de ${d}`} onClick={() => sumar(d, 1)}>+</button>
            </div>
          ))}
        </div>
        {hayConteo && <div className="desglose-total">Total contado: <b>{rd(totalContado)}</b></div>}
        {hayConteo && <button type="button" className="enlace" onClick={() => { setCant({}); setFondo(""); }}>Borrar el conteo</button>}
      </div>
      <p className="suave">Fondo: {rd(fondo || 0)} <span className="pequeno">(el cajero digita o cuenta su monto; si no pone nada, abre en cero)</span></p>
      <button className="boton primario ancho" onClick={abrir}>Abrir turno</button>
      <button className="boton ancho" onClick={() => setConsultando(true)}>Consultar precios</button>
      <button className="enlace" style={{ marginTop: 10 }} onClick={onSalir}>← Volver a la pantalla del PIN</button>
      <button className="enlace" onClick={onCerrarSistema}>Cerrar FactPOS (para apagar el equipo)</button>
      <p className="suave pequeno">Sin turno abierto solo se pueden consultar precios y existencias; para facturar hay que abrir el turno.</p>
      {msg && <p className="error">{msg}</p>}
      {consultando && <ConsultaPrecios ajustes={ajustes} onCerrar={() => setConsultando(false)} />}
    </Pantalla>
  );
}

/** Aplicación + pantalla de actualización (tapa todo mientras el servidor se actualiza y pide el PIN de nuevo al terminar). */
export function App() {
  const listo = usePreparado(() => leerAjustes()?.servidor ?? "", () => fijarSesionCaja(null));
  return (
    <>
      {listo ? <AppInterna /> : <div className="cargando" style={{ padding: 40, textAlign: "center" }}>Iniciando…</div>}
      <TecladoPantalla />
      <PantallaActualizacion servidor={() => leerAjustes()?.servidor ?? ""} alCambiarVersion={() => fijarSesionCaja(null)} />
    </>
  );
}
