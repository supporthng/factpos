import { Correo } from "./paginas/Correo";
import { useEffect, useState, type ComponentType } from "react";
import { api, CONFIG, enPortal, esLocal, fijarModoServidor, fijarSesion, leerSesion, puede, type Sesion } from "./api";
import { Portal } from "./paginas/Portal";
import { Actualizaciones } from "./paginas/Actualizaciones";
import { Licencia, AvisoLicencia } from "./paginas/Licencia";
import { CatalogoCtx, useCatalogo, type CatalogoAdmin } from "./ui";
import { Resumen } from "./paginas/Resumen";
import { Inventario } from "./paginas/Inventario";
import { Productos } from "./paginas/Productos";
import { Compras } from "./paginas/Compras";
import { Ajustes } from "./paginas/Ajustes";
import { Conteos } from "./paginas/Conteos";
import { Precios } from "./paginas/Precios";
import { Ofertas } from "./paginas/Ofertas";
import { Traspasos } from "./paginas/Traspasos";
import { Delivery } from "./paginas/Delivery";
import { Reportes } from "./paginas/Reportes";
import { Kardex } from "./paginas/Kardex";
import { Fiscal } from "./paginas/Fiscal";
import { Sucursales } from "./paginas/Sucursales";
import { Marca } from "./paginas/Marca";
import { Padron } from "./paginas/Padron";
import { Usuarios } from "./paginas/Usuarios";
import { Cxc } from "./paginas/Cxc";
import { MovimientosCaja } from "./paginas/MovimientosCaja";
import { Incidentes } from "./paginas/Incidentes";
import { aplicarTemaAdmin } from "./tema";
import { SimboloFactPOS } from "./Logo";

const SECCIONES = [
  { id: "resumen", titulo: "Resumen", grupo: "General", C: Resumen, p: ["admin.reportes"] },
  { id: "productos", titulo: "Productos", grupo: "Inventario", C: Productos, p: ["admin.productos"] },
  { id: "compras", titulo: "Compras", grupo: "Inventario", C: Compras, p: ["admin.compras"] },
  { id: "inventario", titulo: "Existencias", grupo: "Inventario", C: Inventario, p: ["admin.inventario", "admin.reportes"] },
  { id: "ajustes", titulo: "Ajustes", grupo: "Inventario", C: Ajustes, p: ["admin.inventario"] },
  { id: "conteos", titulo: "Conteos físicos", grupo: "Inventario", C: Conteos, p: ["admin.inventario"] },
  { id: "traspasos", titulo: "Traspasos", grupo: "Inventario", C: Traspasos, p: ["admin.traspasos", "admin.recibir"] },
  { id: "kardex", titulo: "Kardex", grupo: "Inventario", C: Kardex, p: ["admin.inventario"] },
  { id: "precios", titulo: "Precios", grupo: "Comercial", C: Precios, p: ["admin.precios"] },
  { id: "ofertas", titulo: "Ofertas", grupo: "Comercial", C: Ofertas, p: ["admin.precios"] },
  { id: "delivery", titulo: "Delivery", grupo: "Comercial", C: Delivery, p: ["admin.config"] },
  { id: "cxc", titulo: "Cuentas por cobrar", grupo: "Finanzas", C: Cxc, p: ["admin.cxc", "admin.reportes"] },
  { id: "caja", titulo: "Retiros y gastos", grupo: "Finanzas", C: MovimientosCaja, p: ["admin.reportes"] },
  { id: "fiscal", titulo: "Facturación electrónica", grupo: "Fiscal", C: Fiscal, p: ["admin.fiscal"] },
  { id: "padron", titulo: "Padrón de RNC (DGII)", grupo: "Fiscal", C: Padron, p: ["admin.fiscal"] },
  { id: "reportes", titulo: "Reportes", grupo: "Reportes", C: Reportes, p: ["admin.reportes"] },
  { id: "sucursales", titulo: "Sucursales y terminales", grupo: "Configuración", C: Sucursales, p: ["admin.config"] },
  { id: "incidentes", titulo: "Incidentes y soporte", grupo: "Configuración", C: Incidentes, p: ["admin.config"] },
  { id: "usuarios", titulo: "Usuarios y permisos", grupo: "Configuración", C: Usuarios, p: ["admin.usuarios"] },
  { id: "correo", titulo: "Correo y envíos", grupo: "Configuración", C: Correo, p: ["admin.config"] },
  { id: "marca", titulo: "Marca y colores", grupo: "Configuración", C: Marca, p: ["admin.config"] },
  { id: "licencia", titulo: "Licencia", grupo: "Configuración", C: Licencia, p: ["admin.config"] },
  { id: "actualizaciones", titulo: "Actualizaciones", grupo: "Configuración", C: Actualizaciones, p: ["admin.config"] },
] as const;
/** En el portal del proveedor solo hay clientes/licencias y su propio equipo. */
const SECCIONES_PORTAL = [
  { id: "clientes", titulo: "Clientes y licencias", grupo: "Portal FactPOS", C: Portal, p: ["*"] },
  { id: "usuarios", titulo: "Usuarios del portal", grupo: "Portal FactPOS", C: Usuarios, p: ["admin.usuarios"] },
] as const;
type Seccion = (typeof SECCIONES)[number]["id"] | (typeof SECCIONES_PORTAL)[number]["id"];
const CATALOGO_VACIO: CatalogoAdmin = { sucursales: [], productos: [], categorias: [], usuarios: [] };

export function App() {
  const [sesion, setSesion] = useState<Sesion | null>(leerSesion());
  const [catalogo, setCatalogo] = useState<CatalogoAdmin | null>(null);
  const [seccion, setSeccion] = useState<Seccion>(() => (location.hash.slice(1) as Seccion) || (enPortal ? "clientes" : "resumen"));
  const [menu, setMenu] = useState(false);
  const [error, setError] = useState("");
  const [logo, setLogo] = useState<string | null>(null);
  const [cambiarClave, setCambiarClave] = useState(false);
  const [, setRefresco] = useState(0);

  const salir = () => { fijarSesion(null); setSesion(null); setCatalogo(null); };
  useEffect(() => {
    const f = () => { salir(); setError("Su sesión terminó: entre de nuevo"); };
    window.addEventListener("factpos:sesion-vencida", f);
    return () => window.removeEventListener("factpos:sesion-vencida", f);
  }, []);

  useEffect(() => {
    if (!sesion) return;
    // Permisos al día (si el administrador cambió el rol, se refleja al abrir)
    api<{ usuario: { permisos: string[]; nombre: string; sucursales: string[] | null }; modo?: string }>("/central/sesion")
      .then((r) => { fijarModoServidor(r.modo ?? null); fijarSesion({ ...sesion, permisos: r.usuario.permisos, nombre: r.usuario.nombre, sucursales: r.usuario.sucursales }); setRefresco((x) => x + 1); })
      .catch(() => {});
    if (enPortal) { setCatalogo(CATALOGO_VACIO); return; }
    api<CatalogoAdmin>("/central/catalogo").then(setCatalogo).catch((e) => setError(e.message));
    api<{ logo: string | null; primario: string; secundario: string | null; nombre: string }>("/central/marca")
      .then((m) => { aplicarTemaAdmin(m); setLogo(m.logo); })
      .catch(() => {});
  }, [sesion]);
  useEffect(() => { if (location.hash.slice(1) !== seccion) location.hash = seccion; }, [seccion]);
  // Enlaces internos (#seccion) desde cualquier pantalla, y atrás/adelante del navegador
  useEffect(() => {
    const f = () => { const h = location.hash.slice(1).split("?")[0] as Seccion; if (h) setSeccion(h); };
    addEventListener("hashchange", f);
    return () => removeEventListener("hashchange", f);
  }, []);

  if (!sesion || !catalogo && error) {
    return <Entrar error={error} onListo={(s) => { fijarSesion(s); setError(""); setSesion(s); }} />;
  }
  if (!catalogo) return <div className="cargando">Cargando…</div>;

  const visibles = ((enPortal ? SECCIONES_PORTAL : SECCIONES) as readonly { id: Seccion; titulo: string; grupo: string; C: ComponentType; p: readonly string[] }[])
    .filter((s) => s.p.some(puede));
  const Actual = (visibles.find((s) => s.id === seccion) ?? visibles[0])?.C ?? SinPermisos;
  const actualId = (visibles.find((s) => s.id === seccion) ?? visibles[0])?.id;
  const grupos = [...new Set(visibles.map((s) => s.grupo))];

  return (
    <CatalogoCtx.Provider value={catalogo}>
      <div className="app">
        <aside className={"lateral" + (menu ? " abierto" : "")}>
          {logo
            ? <div className="marca-logo"><img src={logo} alt="Logo" /><small>FactPOS · Administración</small></div>
            : <div className="marca con-icono"><SimboloFactPOS tamano={40} /><span className="texto"><span className="nombre">Fact<b>POS</b></span><small>{enPortal ? "Portal de licencias" : CONFIG.cliente ?? "Administración"}</small></span></div>}
          <nav>
            {grupos.map((g) => (
              <div key={g} className="grupo">
                <span className="grupo-titulo">{g}</span>
                {visibles.filter((s) => s.grupo === g).map((s) => (
                  <button key={s.id} className={actualId === s.id ? "activo" : ""} onClick={() => { setSeccion(s.id); setMenu(false); }}>
                    {s.titulo}
                  </button>
                ))}
              </div>
            ))}
          </nav>
          <div className="lateral-pie">
            <button className="enlace nombre-usuario" title="Cambiar mi contraseña" onClick={() => setCambiarClave(true)}>{sesion.nombre}</button>
            <button className="enlace" onClick={salir}>Salir</button>
          </div>
        </aside>
        <div className="contenido">
          <header className="barra-movil">
            <button className="boton fantasma" onClick={() => setMenu(!menu)}>☰</button>
            <span className="marca chica">Fact<span>POS</span></span>
          </header>
          <main key={actualId}>
            {esLocal() && <AvisoLocal />}
            {!enPortal && actualId !== "licencia" && <AvisoLicencia irA={() => setSeccion("licencia")} />}
            <Actual />
          </main>
          {cambiarClave && <CambiarClave onCerrar={() => setCambiarClave(false)} />}
        </div>
      </div>
    </CatalogoCtx.Provider>
  );
}

/**
 * Dirección de la central por defecto:
 * - en Vercel: la variable VITE_CENTRAL_URL (la API publicada en otro proyecto);
 * - servida por el servidor FactPOS (/admin/): ese mismo servidor;
 * - en desarrollo: el servidor local en el puerto 3000.
 */
function centralPredeterminada() {
  if (CONFIG.api !== undefined) return (CONFIG.api || location.origin).replace(/\/$/, "");
  const env = import.meta.env.VITE_CENTRAL_URL as string | undefined;
  if (env) return env.replace(/\/$/, "");
  if (location.pathname.startsWith("/admin")) return location.origin;
  return `${location.protocol}//${location.hostname}:3000`;
}

function Entrar({ error, onListo }: { error: string; onListo: (s: Sesion) => void }) {
  const previa = leerSesion();
  const [servidor, setServidor] = useState(CONFIG.modo ? centralPredeterminada() : previa?.servidor ?? centralPredeterminada());
  const [verServidor, setVerServidor] = useState(!CONFIG.modo && !import.meta.env.VITE_CENTRAL_URL && !location.pathname.startsWith("/admin"));
  const [usuario, setUsuario] = useState("");
  const [clave, setClave] = useState("");
  const [rnc, setRnc] = useState("");
  const [pedirRnc, setPedirRnc] = useState(false);
  const [msg, setMsg] = useState(error);
  const [entrando, setEntrando] = useState(false);
  // Nube recién instalada (base vacía): se configura la empresa y el primer usuario
  const [inicio, setInicio] = useState<{ necesitaConfigurar: boolean; pideClave: boolean } | null>(null);
  useEffect(() => {
    if (!servidor) return;
    api<{ necesitaConfigurar: boolean; pideClave: boolean }>("/central/inicio", { servidor }).then(setInicio).catch(() => setInicio(null));
  }, [servidor]);
  if (inicio?.necesitaConfigurar) {
    return <PrimerUso servidor={servidor} pideClave={inicio.pideClave} onListo={(u) => { setInicio(null); setUsuario(u); setMsg("Listo. Entre con el usuario que acaba de crear."); }} />;
  }

  const entrar = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setMsg(""); setEntrando(true);
    try {
      const r = await api<{ token: string; usuario: { id: string; nombre: string; permisos: string[] }; empresa: { id: string; nombre: string } }>(
        "/central/entrar", { servidor, cuerpo: { usuario, clave, rnc: rnc || undefined } });
      onListo({ servidor, token: r.token, empresaId: r.empresa.id, empresa: r.empresa.nombre, usuarioId: r.usuario.id, nombre: r.usuario.nombre, permisos: r.usuario.permisos });
    } catch (e) {
      const t = (e as Error).message;
      if (/RNC/.test(t)) setPedirRnc(true);
      setMsg(t);
    } finally { setEntrando(false); }
  };

  return (
    <div className="entrar">
      <form className="tarjeta-entrar" onSubmit={entrar}>
        <span className="icono-entrar"><SimboloFactPOS tamano={84} fondo /></span>
        <div className="marca grande">Fact<span>POS</span><small>{enPortal ? "Portal de licencias" : CONFIG.cliente ?? "Administración"}</small></div>
        <label className="campo"><span>Usuario</span><input autoFocus value={usuario} onChange={(e) => setUsuario(e.target.value)} autoComplete="username" autoCapitalize="none" /></label>
        <label className="campo"><span>Contraseña</span><input type="password" value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="current-password" /></label>
        {pedirRnc && <label className="campo"><span>RNC de la empresa</span><input value={rnc} onChange={(e) => setRnc(e.target.value)} inputMode="numeric" /></label>}
        {verServidor && <label className="campo"><span>Dirección de la central</span><input value={servidor} onChange={(e) => setServidor(e.target.value)} /></label>}
        <button className="boton primario ancho" disabled={!usuario || !clave || entrando}>{entrando ? "Entrando…" : "Entrar"}</button>
        {msg && <p className="error">{msg}</p>}
        {!verServidor && !CONFIG.modo && <button type="button" className="enlace pequeno" onClick={() => setVerServidor(true)}>Otra central…</button>}
      </form>
    </div>
  );
}

function PrimerUso({ servidor, pideClave, onListo }: { servidor: string; pideClave: boolean; onListo: (usuario: string) => void }) {
  const [d, setD] = useState({ claveAcceso: "", rnc: "", razonSocial: "", nombreComercial: CONFIG.cliente ?? "", sucursal: "Principal", nombre: "", usuario: "admin", clave: "", repetir: "", pin: "" });
  const [msg, setMsg] = useState("");
  const [trabajando, setTrabajando] = useState(false);
  const set = (k: keyof typeof d, v: string) => setD((x) => ({ ...x, [k]: v }));
  const crear = async (e: React.FormEvent) => {
    e.preventDefault(); setMsg("");
    if (d.clave !== d.repetir) return setMsg("Las dos contraseñas no coinciden");
    setTrabajando(true);
    try {
      const { repetir: _r, pin, claveAcceso, ...resto } = d;
      await api("/central/inicio", { servidor, cuerpo: { ...resto, pin: pin || undefined, claveAcceso: claveAcceso || undefined } });
      onListo(d.usuario);
    } catch (e) { setMsg((e as Error).message); } finally { setTrabajando(false); }
  };
  return (
    <div className="entrar">
      <form className="tarjeta-entrar ancha" onSubmit={crear}>
        <div className="marca grande">Fact<span>POS</span><small>Configuración inicial</small></div>
        <p className="suave">Esta instalación está nueva. Registre la empresa y el usuario administrador; después podrá crear sucursales, usuarios y productos.</p>
        {pideClave && <label className="campo"><span>Clave de acceso de la instalación (CLAVE_ACCESO de Vercel)</span><input type="password" value={d.claveAcceso} onChange={(e) => set("claveAcceso", e.target.value)} /></label>}
        <div className="dos-col">
          <label className="campo"><span>RNC</span><input value={d.rnc} inputMode="numeric" onChange={(e) => set("rnc", e.target.value.replace(/\D/g, ""))} /></label>
          <label className="campo"><span>Nombre comercial</span><input value={d.nombreComercial} onChange={(e) => set("nombreComercial", e.target.value)} /></label>
        </div>
        <label className="campo"><span>Razón social</span><input value={d.razonSocial} onChange={(e) => set("razonSocial", e.target.value)} /></label>
        <label className="campo"><span>Nombre de la primera sucursal</span><input value={d.sucursal} onChange={(e) => set("sucursal", e.target.value)} /></label>
        <div className="dos-col">
          <label className="campo"><span>Su nombre</span><input value={d.nombre} onChange={(e) => set("nombre", e.target.value)} /></label>
          <label className="campo"><span>Usuario</span><input value={d.usuario} autoCapitalize="none" onChange={(e) => set("usuario", e.target.value.toLowerCase())} /></label>
          <label className="campo"><span>Contraseña (8+, letras y números)</span><input type="password" value={d.clave} onChange={(e) => set("clave", e.target.value)} autoComplete="new-password" /></label>
          <label className="campo"><span>Repita la contraseña</span><input type="password" value={d.repetir} onChange={(e) => set("repetir", e.target.value)} autoComplete="new-password" /></label>
        </div>
        <label className="campo"><span>PIN para la caja (opcional, 4 a 6 números)</span><input value={d.pin} inputMode="numeric" maxLength={6} onChange={(e) => set("pin", e.target.value.replace(/\D/g, ""))} /></label>
        <button className="boton primario ancho" disabled={trabajando || !d.rnc || !d.razonSocial || !d.nombreComercial || !d.nombre || !d.usuario || !d.clave}>
          {trabajando ? "Configurando…" : "Crear empresa"}
        </button>
        {msg && <p className="error">{msg}</p>}
      </form>
    </div>
  );
}

/** Administración local (servidor de la tienda): qué se ve aquí y cuánto falta por subir. */
function AvisoLocal() {
  const [e, setE] = useState<{ pendientes: number; ultimaSubida: string | null; activa: boolean } | null>(null);
  useEffect(() => {
    const cargar = () => api<{ pendientes: number; ultimaSubida: string | null; activa: boolean }>("/sync/estado").then(setE).catch(() => {});
    cargar();
    const t = setInterval(cargar, 30_000);
    return () => clearInterval(t);
  }, []);
  const nombre = useCatalogo().sucursales[0]?.nombre;
  return (
    <div className="aviso-local">
      <b>Administración local{nombre ? ` · ${nombre}` : ""}.</b>{" "}
      Funciona sin internet y muestra solo esta sucursal. Los cambios suben solos a la nube
      {e?.activa ? (e.pendientes ? `: ${e.pendientes} pendiente(s) por subir.` : " (todo al día).") : " cuando esté conectada."}
      {" "}Lo que afecta a otras sucursales (traspasos, secuencias e-CF, certificado, correo) se hace en la nube.
    </div>
  );
}

function SinPermisos() {
  return <p className="suave">Su usuario no tiene secciones habilitadas. Pídale al administrador que revise su rol.</p>;
}

function CambiarClave({ onCerrar }: { onCerrar: () => void }) {
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [repetir, setRepetir] = useState("");
  const [msg, setMsg] = useState<{ t: string; ok?: boolean } | null>(null);
  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (nueva !== repetir) return setMsg({ t: "Las dos contraseñas nuevas no coinciden" });
    try {
      await api("/central/sesion/clave", { cuerpo: { actual, nueva } });
      setMsg({ t: "Contraseña cambiada", ok: true });
      setTimeout(onCerrar, 900);
    } catch (e) { setMsg({ t: (e as Error).message }); }
  };
  return (
    <div className="fondo-modal" onMouseDown={onCerrar}>
      <form className="modal" onMouseDown={(e) => e.stopPropagation()} onSubmit={guardar}>
        <h2 style={{ marginTop: 0 }}>Cambiar mi contraseña</h2>
        <label className="campo"><span>Contraseña actual</span><input type="password" autoFocus value={actual} onChange={(e) => setActual(e.target.value)} autoComplete="current-password" /></label>
        <label className="campo"><span>Nueva (8 o más, con letras y números)</span><input type="password" value={nueva} onChange={(e) => setNueva(e.target.value)} autoComplete="new-password" /></label>
        <label className="campo"><span>Repita la nueva</span><input type="password" value={repetir} onChange={(e) => setRepetir(e.target.value)} autoComplete="new-password" /></label>
        {msg && <p className={msg.ok ? "ok" : "error"}>{msg.t}</p>}
        <div className="acciones-modal">
          <button type="button" className="boton" onClick={onCerrar}>Cancelar</button>
          <button className="boton primario" disabled={!actual || !nueva}>Guardar</button>
        </div>
      </form>
    </div>
  );
}
