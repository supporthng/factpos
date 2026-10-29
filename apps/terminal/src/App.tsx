import { leerTema } from "./escala";
import { useEffect, useState } from "react";
import { api, leerAjustes, guardarAjustes, rd, sesionCaja, fijarSesionCaja, type Ajustes } from "./api";
import { guardarCache, iniciarVigilancia, leerCache, recordarPin, usuariosSinServidor, verificarPinSinServidor, useConexion } from "./contingencia";
import { Venta } from "./Venta";
import { temaTerminal } from "@factpos/compartido";
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
  marca: { logo: string | null; primario: string; secundario: string | null; logoEnTicket: boolean };
}

/** Tema camaleón: los colores del logo del cliente pintan la terminal. */
function aplicarMarca(m: ConfigCaja["marca"]) {
  marcaActual = m;
  for (const [k, v] of Object.entries(temaTerminal(m, leerTema()))) document.documentElement.style.setProperty(k, v);
}
let marcaActual: ConfigCaja["marca"] | null = null;
// Al cambiar de tema claro/oscuro, los colores de la marca se recalculan para ese fondo
window.addEventListener("factpos:tema", () => { if (marcaActual) aplicarMarca(marcaActual); });
export interface Usuario { id: string; nombre: string; tienePin?: boolean }
export interface Turno { id: string; abiertoEn: string; fondoInicial: string; usuarioId: string; usuario: string }

/**
 * Flujo de la terminal: configurar (una sola vez) → elegir usuario → abrir turno → vender.
 */
export function App() {
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

  // Configuración de la caja. Si el servidor no responde, la última guardada en esta caja
  // (así se puede seguir vendiendo en contingencia).
  useEffect(() => {
    if (!ajustes) return;
    api<ConfigCaja>(ajustes.servidor, `/cajas/${ajustes.cajaId}/config`)
      .then((c) => { aplicarMarca(c.marca); setConfig(c); guardarCache(ajustes, "config", c); })
      .catch(async (e) => {
        const c = await leerCache<ConfigCaja>(ajustes, "config");
        if (c) { aplicarMarca(c.marca); setConfig(c); } else setError(e.message);
      });
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

  if (!ajustes || (error && !config)) {
    return <Configurar inicial={ajustes} error={error} onListo={(a) => { guardarAjustes(a); setError(""); setAjustes(a); }} />;
  }
  if (!config) return <Pantalla><p className="suave">Conectando con el servidor…</p></Pantalla>;
  if (!usuario) return <ElegirUsuario ajustes={ajustes} config={config} onElegir={setUsuario} />;
  if (turno === undefined) return <Pantalla><p className="suave">Cargando turno…</p></Pantalla>;
  if (turno === null) return <AbrirTurno ajustes={ajustes} config={config} usuario={usuario} onAbierto={() => setTurno(undefined)} recargar={() => api<Turno | null>(ajustes.servidor, `/cajas/${ajustes.cajaId}/turno`).then((t) => { setTurno(t); guardarCache(ajustes, "turno", t); })} />;

  return <Venta ajustes={ajustes} config={config} usuario={usuario} turno={turno} onSalir={salir} />;
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
  const [cajas, setCajas] = useState<{ id: string; nombre: string; sucursal: string }[]>([]);
  const [msg, setMsg] = useState(error);
  const [buscando, setBuscando] = useState(false);
  const [avance, setAvance] = useState("");
  const [encontrados, setEncontrados] = useState<Encontrado[]>([]);
  const [manual, setManual] = useState(false);

  const conectar = async (url: string) => {
    setMsg("");
    setServidor(url);
    try {
      setCajas(await api(url, "/cajas"));
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const buscar = async () => {
    setBuscando(true);
    setEncontrados([]);
    setCajas([]);
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
      <h2>Configurar esta caja</h2>
      {buscando && <p className="buscando"><span className="girando" aria-hidden="true" />{avance}</p>}
      {!cajas.length && encontrados.length > 1 && (
        <div className="lista-opciones">
          <p className="suave">Se encontraron varios servidores. ¿Cuál es el de esta sucursal?</p>
          {encontrados.map((e) => (
            <button key={e.url} className="opcion" onClick={() => conectar(e.url)}>
              <b>{e.empresa ?? "FactPOS"}</b> <span className="suave">{e.sucursales.join(", ")} · {e.url.replace("http://", "")}</span>
            </button>
          ))}
        </div>
      )}
      {cajas.length > 0 && (
        <div className="lista-opciones">
          <p className="suave">Servidor encontrado en <b>{servidor.replace("http://", "")}</b>. ¿Qué caja es esta?</p>
          {cajas.map((c) => (
            <button key={c.id} className="opcion" onClick={() => onListo({ servidor, cajaId: c.id })}>
              <b>{c.nombre}</b> <span className="suave">{c.sucursal}</span>
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

function ElegirUsuario({ ajustes, config, onElegir }: { ajustes: Ajustes; config: ConfigCaja; onElegir: (u: Usuario) => void }) {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [elegido, setElegido] = useState<Usuario | null>(null);
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
      await recordarPin(ajustes, r.usuario, valor);
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
      <h2>{elegido.nombre}</h2>
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
      <button className="enlace" onClick={() => setElegido(null)}>← No soy {elegido.nombre.split(" ")[0]}</button>
    </Pantalla>
  );
}

function AbrirTurno({ ajustes, config, usuario, onAbierto, recargar }: {
  ajustes: Ajustes; config: ConfigCaja; usuario: Usuario; onAbierto: () => void; recargar: () => void;
}) {
  const [fondo, setFondo] = useState("2000");
  const [msg, setMsg] = useState("");
  const abrir = async () => {
    try {
      await api(ajustes.servidor, `/cajas/${ajustes.cajaId}/turno/abrir`, { cuerpo: { usuarioId: usuario.id, fondoInicial: fondo || "0" } });
      onAbierto();
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
      {msg && <p className="error">{msg}</p>}
    </Pantalla>
  );
}
