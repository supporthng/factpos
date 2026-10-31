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
import { Icono, type NombreIcono } from "./Iconos";

const SECCIONES = [
  { id: "resumen", titulo: "Resumen", grupo: "General", C: Resumen, i: "resumen", p: ["admin.reportes"] },
  { id: "productos", titulo: "Productos", grupo: "Inventario", C: Productos, i: "productos", p: ["admin.productos"] },
  { id: "compras", titulo: "Compras", grupo: "Inventario", C: Compras, i: "compras", p: ["admin.compras"] },
  { id: "inventario", titulo: "Existencias", grupo: "Inventario", C: Inventario, i: "inventario", p: ["admin.inventario", "admin.reportes"] },
  { id: "ajustes", titulo: "Ajustes", grupo: "Inventario", C: Ajustes, i: "ajustes", p: ["admin.inventario"] },
  { id: "conteos", titulo: "Conteos físicos", grupo: "Inventario", C: Conteos, i: "conteos", p: ["admin.inventario"] },
  { id: "traspasos", titulo: "Traspasos", grupo: "Inventario", C: Traspasos, i: "traspasos", p: ["admin.traspasos", "admin.recibir"] },
  { id: "kardex", titulo: "Kardex", grupo: "Inventario", C: Kardex, i: "kardex", p: ["admin.inventario"] },
  { id: "precios", titulo: "Precios", grupo: "Comercial", C: Precios, i: "precios", p: ["admin.precios"] },
  { id: "ofertas", titulo: "Ofertas", grupo: "Comercial", C: Ofertas, i: "ofertas", p: ["admin.precios"] },
  { id: "delivery", titulo: "Delivery", grupo: "Comercial", C: Delivery, i: "delivery", p: ["admin.config"] },
  { id: "cxc", titulo: "Cuentas por cobrar", grupo: "Finanzas", C: Cxc, i: "cxc", p: ["admin.cxc", "admin.reportes"] },
  { id: "caja", titulo: "Retiros y gastos", grupo: "Finanzas", C: MovimientosCaja, i: "caja", p: ["admin.reportes"] },
  { id: "fiscal", titulo: "Facturación electrónica", grupo: "Fiscal", C: Fiscal, i: "fiscal", p: ["admin.fiscal"] },
  { id: "padron", titulo: "Padrón de RNC (DGII)", grupo: "Fiscal", C: Padron, i: "padron", p: ["admin.fiscal"] },
  { id: "reportes", titulo: "Reportes", grupo: "Reportes", C: Reportes, i: "reportes", p: ["admin.reportes"] },
  { id: "sucursales", titulo: "Sucursales y terminales", grupo: "Configuración", C: Sucursales, i: "sucursales", p: ["admin.config"] },
  { id: "incidentes", titulo: "Incidentes y soporte", grupo: "Configuración", C: Incidentes, i: "incidentes", p: ["admin.config"] },
  { id: "usuarios", titulo: "Usuarios y permisos", grupo: "Configuración", C: Usuarios, i: "usuarios", p: ["admin.usuarios"] },
  { id: "correo", titulo: "Correo y envíos", grupo: "Configuración", C: Correo, i: "correo", p: ["admin.config"] },
  { id: "marca", titulo: "Marca y colores", grupo: "Configuración", C: Marca, i: "marca", p: ["admin.config"] },
  { id: "licencia", titulo: "Licencia", grupo: "Configuración", C: Licencia, i: "licencia", p: ["admin.config"] },
  { id: "actualizaciones", titulo: "Actualizaciones", grupo: "Configuración", C: Actualizaciones, i: "actualizaciones", p: ["admin.config"] },
] as const;
/** En el portal del proveedor solo hay clientes/licencias y su propio equipo. */
const SECCIONES_PORTAL = [
  { id: "clientes", titulo: "Clientes y licencias", grupo: "Portal FactPOS", C: Portal, i: "clientes", p: ["*"] },
  { id: "usuarios", titulo: "Usuarios del portal", grupo: "Portal FactPOS", C: Usuarios, i: "usuarios", p: ["admin.usuarios"] },
] as const;
type Seccion = (typeof SECCIONES)[number]["id"] | (typeof SECCIONES_PORTAL)[number]["id"];
type Item = { id: string; titulo: string; grupo: string; C: ComponentType; i: NombreIcono; p: readonly string[] };

/** Qué hace cada opción (se ve en su recuadro). */
const DESCRIPCION: Record<string, string> = {
  resumen: "Ventas del día, alertas y existencias por reponer",
  productos: "Ficha, códigos de barra, precios y combos",
  compras: "Entrada de mercancía de los proveedores",
  inventario: "Existencia de cada producto por sucursal",
  ajustes: "Corregir existencias: mermas, daños, sobrantes",
  conteos: "Inventario físico y sus diferencias",
  traspasos: "Mover mercancía entre sucursales y almacenes",
  kardex: "Historial de entradas y salidas de un producto",
  precios: "Cambiar precios por nivel y por sucursal",
  ofertas: "Promociones, combos y descuentos con tope",
  delivery: "Pedidos a domicilio y repartidores",
  cxc: "Clientes a crédito, abonos y estados de cuenta",
  caja: "Retiros, gastos y movimientos de caja",
  fiscal: "e-CF, certificado digital y secuencias de NCF",
  padron: "Consulta de RNC y cédulas de la DGII",
  reportes: "Ventas, cierres, inventario, impuestos y más",
  sucursales: "Tiendas, cajas y servidores de cada local",
  incidentes: "Fallas, caídas de conexión y soporte",
  usuarios: "Cuentas, roles y permisos del personal",
  correo: "Envío de reportes y facturas por correo",
  marca: "Logo y colores de la caja y la administración",
  licencia: "Plan, vigencia y activación de FactPOS",
  actualizaciones: "Nuevas versiones del sistema",
  clientes: "Empresas, licencias y sus instalaciones",
};
/** Las funciones principales del inicio, en este orden. */
const GRUPOS: Record<string, { slug: string; i: NombreIcono; color: string; d: string }> = {
  "General": { slug: "general", i: "resumen", color: "#0f766e", d: "Cómo va el día en todas las sucursales" },
  "Inventario": { slug: "inventario", i: "productos", color: "#2563eb", d: "Productos, compras, existencias y traspasos" },
  "Comercial": { slug: "comercial", i: "precios", color: "#d97706", d: "Precios, ofertas y delivery" },
  "Finanzas": { slug: "finanzas", i: "cxc", color: "#16a34a", d: "Cuentas por cobrar, retiros y gastos" },
  "Fiscal": { slug: "fiscal", i: "fiscal", color: "#7c3aed", d: "Facturación electrónica y padrón de la DGII" },
  "Reportes": { slug: "reportes", i: "reportes", color: "#0891b2", d: "Todos los informes del negocio" },
  "Configuración": { slug: "configuracion", i: "ajustes", color: "#475569", d: "Sucursales, usuarios, marca y licencia" },
  "Portal FactPOS": { slug: "portal", i: "clientes", color: "#0f766e", d: "Clientes, licencias y equipo del portal" },
};
const datosGrupo = (g: string) => GRUPOS[g] ?? { slug: g.toLowerCase(), i: "resumen" as NombreIcono, color: "#475569", d: "" };

const CATALOGO_VACIO: CatalogoAdmin = { sucursales: [], productos: [], categorias: [], usuarios: [] };

export function App() {
  const [sesion, setSesion] = useState<Sesion | null>(leerSesion());
  const [catalogo, setCatalogo] = useState<CatalogoAdmin | null>(null);
  const [seccion, setSeccion] = useState<string>(() => location.hash.slice(1) || "inicio");
  const [menu, setMenu] = useState(false);
  const [forma, setForma] = useState<Forma>(leerForma);
  const cambiarForma = (f: Forma) => { setForma(f); guardarForma(f); };
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
  useEffect(() => { if (location.hash.slice(1).split("?")[0] !== seccion) location.hash = seccion; window.scrollTo(0, 0); document.querySelector(".contenido")?.scrollTo(0, 0); }, [seccion]);
  // Enlaces internos (#seccion) desde cualquier pantalla, y atrás/adelante del navegador
  useEffect(() => {
    const f = () => { const h = location.hash.slice(1).split("?")[0]; setSeccion(h || "inicio"); };
    addEventListener("hashchange", f);
    return () => removeEventListener("hashchange", f);
  }, []);

  if (!sesion || !catalogo && error) {
    return <Entrar error={error} onListo={(s) => { fijarSesion(s); setError(""); setSesion(s); }} />;
  }
  if (!catalogo) return <div className="cargando">Cargando…</div>;

  const visibles = ((enPortal ? SECCIONES_PORTAL : SECCIONES) as readonly Item[]).filter((s) => s.p.some(puede));
  const grupos = [...new Set(visibles.map((s) => s.grupo))];
  const enGrupo = (g: string) => visibles.filter((s) => s.grupo === g);
  // Ruta: "inicio", "g-<grupo>" o el id de una opción
  const actual = visibles.find((s) => s.id === seccion);
  const grupoAbierto = seccion.startsWith("g-") ? grupos.find((g) => "g-" + datosGrupo(g).slug === seccion) : undefined;
  const vista: "inicio" | "grupo" | "seccion" = actual ? "seccion" : grupoAbierto ? "grupo" : "inicio";
  const grupoActual = actual?.grupo ?? grupoAbierto;
  const Actual = actual?.C ?? SinPermisos;
  const actualId = actual?.id;
  const iniciales = sesion.nombre.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "?";
  /** Un grupo con una sola opción abre directo esa opción. */
  const abrirGrupo = (g: string) => { const items = enGrupo(g); setSeccion(items.length === 1 ? items[0]!.id : "g-" + datosGrupo(g).slug); };

  return (
    <CatalogoCtx.Provider value={catalogo}>
      <div className={"app " + (forma === "lateral" ? "app-lateral" : "app-cuadricula")}>
        {forma === "lateral" && (
          <aside className={"lateral" + (menu ? " abierto" : "")}>
            {logo
              ? <div className="marca-logo"><img src={logo} alt="Logo" /><small>FactPOS · Administración</small></div>
              : <div className="marca con-icono"><SimboloFactPOS tamano={36} fondo /><span className="texto"><span className="nombre">Fact<b>POS</b></span><small>{enPortal ? "Portal de licencias" : CONFIG.cliente ?? "Administración"}</small></span></div>}
            <nav>
              <div className="grupo">
                <button className={vista === "inicio" ? "activo" : ""} onClick={() => { setSeccion("inicio"); setMenu(false); }}><Icono n="inicio" /><span>Inicio</span></button>
              </div>
              {grupos.map((g) => (
                <div key={g} className="grupo">
                  <span className="grupo-titulo">{g}</span>
                  {enGrupo(g).map((x) => (
                    <button key={x.id} className={actualId === x.id ? "activo" : ""} aria-current={actualId === x.id ? "page" : undefined}
                      onClick={() => { setSeccion(x.id); setMenu(false); }}>
                      <Icono n={x.i} /><span>{x.titulo}</span>
                    </button>
                  ))}
                </div>
              ))}
            </nav>
          </aside>
        )}
        {forma === "lateral" && menu && <div className="velo-menu" onClick={() => setMenu(false)} />}
        <div className="contenido">
          <header className="barra-superior">
            {forma === "lateral" && <button className="boton-icono solo-movil" aria-label="Menú" onClick={() => setMenu(!menu)}><Icono n="menu" /></button>}
            {forma === "cuadricula" && <button className="marca-superior" onClick={() => setSeccion("inicio")} title="Inicio">
              {logo ? <img src={logo} alt="Logo" /> : <SimboloFactPOS tamano={34} fondo />}
              {!logo && <span className="nombre">Fact<b>POS</b></span>}
            </button>}
            <nav className="migas-superior" aria-label="Ubicación">
              <button className={vista === "inicio" ? "actual" : ""} onClick={() => setSeccion("inicio")}><Icono n="inicio" tamano={16} /><span>Inicio</span></button>
              {grupoActual && enGrupo(grupoActual).length > 1 && (<>
                <span className="separador" aria-hidden="true">›</span>
                <button className={vista === "grupo" ? "actual" : ""} onClick={() => abrirGrupo(grupoActual)}>{grupoActual}</button>
              </>)}
              {actual && (<><span className="separador" aria-hidden="true">›</span><b className="actual">{actual.titulo}</b></>)}
            </nav>
            <span className="flex" />
            <div className="selector-forma" role="group" aria-label="Forma del menú">
              <button className={forma === "cuadricula" ? "activo" : ""} aria-pressed={forma === "cuadricula"} title="Menú en cuadrícula" onClick={() => cambiarForma("cuadricula")}><Icono n="resumen" tamano={17} /></button>
              <button className={forma === "lateral" ? "activo" : ""} aria-pressed={forma === "lateral"} title="Menú lateral" onClick={() => cambiarForma("lateral")}><Icono n="menu-lateral" tamano={17} /></button>
            </div>
            <span className="empresa-superior">{sesion.empresa}</span>
            <button className="chip-usuario" title="Cambiar mi contraseña" onClick={() => setCambiarClave(true)}>
              <span className="avatar" aria-hidden="true">{iniciales}</span><span className="solo-escritorio">{sesion.nombre.split(" ")[0]}</span>
            </button>
            <button className="boton-icono" title="Salir" aria-label="Salir" onClick={salir}><Icono n="salir" /></button>
          </header>

          {forma === "cuadricula" && vista === "seccion" && grupoActual && enGrupo(grupoActual).length > 1 && (
            <nav className="subnav" aria-label={grupoActual}>
              {enGrupo(grupoActual).map((s) => (
                <button key={s.id} className={s.id === actualId ? "activo" : ""} aria-current={s.id === actualId ? "page" : undefined} onClick={() => setSeccion(s.id)}>
                  <Icono n={s.i} tamano={17} /><span>{s.titulo}</span>
                </button>
              ))}
            </nav>
          )}

          <main key={seccion} className={vista !== "seccion" ? "main-cuadricula" : ""}>
            {esLocal() && <AvisoLocal />}
            {!enPortal && actualId !== "licencia" && <AvisoLicencia irA={() => setSeccion("licencia")} />}

            {vista === "inicio" && (
              <>
                <div className="saludo">
                  <h1>{saludo()}, {sesion.nombre.split(" ")[0]}</h1>
                  <p className="suave">¿Qué desea hacer hoy? Elija una función.</p>
                </div>
                <div className="cuadricula cuadricula-grupos">
                  {grupos.map((g) => {
                    const dg = datosGrupo(g), items = enGrupo(g);
                    return (
                      <button key={g} className="mosaico mosaico-grupo" style={{ "--c": dg.color } as React.CSSProperties} onClick={() => abrirGrupo(g)}>
                        <span className="mosaico-icono"><Icono n={dg.i} tamano={28} /></span>
                        <span className="mosaico-texto">
                          <b>{items.length === 1 ? items[0]!.titulo : g}</b>
                          <small>{items.length === 1 ? DESCRIPCION[items[0]!.id] ?? dg.d : dg.d}</small>
                        </span>
                        {items.length > 1 && (
                          <span className="mosaico-pie">
                            {items.slice(0, 3).map((s) => <i key={s.id}>{s.titulo}</i>)}
                            {items.length > 3 && <i className="mas">+{items.length - 3}</i>}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {vista === "grupo" && grupoAbierto && (
              <>
                <div className="saludo con-icono" style={{ "--c": datosGrupo(grupoAbierto).color } as React.CSSProperties}>
                  <button className="boton-icono volver" aria-label="Volver al inicio" title="Volver al inicio" onClick={() => setSeccion("inicio")}>‹</button>
                  <span className="mosaico-icono"><Icono n={datosGrupo(grupoAbierto).i} tamano={26} /></span>
                  <div><h1>{grupoAbierto}</h1><p className="suave">{datosGrupo(grupoAbierto).d}</p></div>
                </div>
                <div className="cuadricula cuadricula-opciones" style={{ "--c": datosGrupo(grupoAbierto).color } as React.CSSProperties}>
                  {enGrupo(grupoAbierto).map((s) => (
                    <button key={s.id} className="mosaico mosaico-opcion" onClick={() => setSeccion(s.id)}>
                      <span className="mosaico-icono"><Icono n={s.i} tamano={24} /></span>
                      <span className="mosaico-texto"><b>{s.titulo}</b><small>{DESCRIPCION[s.id] ?? ""}</small></span>
                      <span className="mosaico-flecha" aria-hidden="true">›</span>
                    </button>
                  ))}
                </div>
              </>
            )}

            {vista === "seccion" && <Actual />}
          </main>
          {cambiarClave && <CambiarClave onCerrar={() => setCambiarClave(false)} />}
        </div>
      </div>
    </CatalogoCtx.Provider>
  );
}

type Forma = "cuadricula" | "lateral";
/** Forma del menú elegida en este equipo (Apariencia). */
function leerForma(): Forma {
  try { return localStorage.getItem("factpos.admin.forma") === "lateral" ? "lateral" : "cuadricula"; } catch { return "cuadricula"; }
}
function guardarForma(f: Forma) {
  try { localStorage.setItem("factpos.admin.forma", f); } catch { /* sin almacenamiento */ }
}

function saludo() {
  const h = new Date().getHours();
  return h < 12 ? "Buenos días" : h < 19 ? "Buenas tardes" : "Buenas noches";
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
    if (d.clave.length < 4) return setMsg("La contraseña debe tener al menos 4 caracteres");
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
          <label className="campo"><span>Contraseña (4 o más)</span><input type="password" minLength={4} maxLength={200} value={d.clave} onChange={(e) => set("clave", e.target.value)} autoComplete="new-password" /></label>
          <label className="campo"><span>Repita la contraseña</span><input type="password" minLength={4} maxLength={200} value={d.repetir} onChange={(e) => set("repetir", e.target.value)} autoComplete="new-password" /></label>
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
        <label className="campo"><span>Nueva (4 o más caracteres)</span><input type="password" value={nueva} onChange={(e) => setNueva(e.target.value)} autoComplete="new-password" /></label>
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
