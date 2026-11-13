const Seguridad = lazy(() => import("./paginas/Seguridad").then((m) => ({ default: m.Seguridad })));
const AccesoRemoto = lazy(() => import("./paginas/AccesoRemoto").then((m) => ({ default: m.AccesoRemoto })));
import { AvisoAcceso } from "./AvisoAcceso";
import { SolicitarDispositivo } from "./SolicitarDispositivo";
import { PaginaInstalar } from "./PaginaInstalar";
const Instaladores = lazy(() => import("./paginas/Instaladores").then((m) => ({ default: m.Instaladores })));
const ActualizacionesPortal = lazy(() => import("./paginas/ActualizacionesPortal").then((m) => ({ default: m.ActualizacionesPortal })));
const InstaladoresPortal = lazy(() => import("./paginas/InstaladoresPortal").then((m) => ({ default: m.InstaladoresPortal })));
const VersionesEquipos = lazy(() => import("./paginas/VersionesEquipos").then((m) => ({ default: m.VersionesEquipos })));
const Pedidos = lazy(() => import("./paginas/Pedidos").then((m) => ({ default: m.Pedidos })));
const Facturas = lazy(() => import("./paginas/Facturas").then((m) => ({ default: m.Facturas })));
const CertificacionDgii = lazy(() => import("./paginas/CertificacionDgii").then((m) => ({ default: m.CertificacionDgii })));
const FacturacionElectronica = lazy(() => import("./paginas/FacturacionElectronica").then((m) => ({ default: m.FacturacionElectronica })));
import { DosPasos } from "./paginas/DosPasos";
const ConfigMovil = lazy(() => import("./paginas/ConfigMovil").then((m) => ({ default: m.ConfigMovil })));
import { PantallaActualizacion, usePreparado } from "./PantallaActualizacion";
const Correo = lazy(() => import("./paginas/Correo").then((m) => ({ default: m.Correo })));
import { FranjaEmpresa, SelectorEmpresa } from "./paginas/Empresas";
import { AgregarAInicio } from "./AgregarAInicio";
import { TarjetaAgregar } from "./TarjetaAgregar";
import { RecuperarClave } from "./RecuperarClave";
import { Suspense, lazy, useEffect, useState, type ComponentType, type LazyExoticComponent } from "react";
import { InicioPortal } from "./paginas/InicioPortal";
import { api, CONFIG, enPortal, esLocal, fijarModoServidor, fijarSesion, leerSesion, puede, type Sesion } from "./api";
const Portal = lazy(() => import("./paginas/Portal").then((m) => ({ default: m.Portal })));
import { Actualizaciones } from "./paginas/Actualizaciones";
import { Licencia, AvisoLicencia } from "./paginas/Licencia";
import { CatalogoCtx, type CatalogoAdmin } from "./ui";
import { Resumen } from "./paginas/Resumen";
import { EstadoSistema } from "./paginas/InicioCifras";
import { BarraPuesta, PuestaEnMarcha } from "./paginas/PuestaEnMarcha";
const Inventario = lazy(() => import("./paginas/Inventario").then((m) => ({ default: m.Inventario })));
const Productos = lazy(() => import("./paginas/Productos").then((m) => ({ default: m.Productos })));
const Compras = lazy(() => import("./paginas/Compras").then((m) => ({ default: m.Compras })));
const Ajustes = lazy(() => import("./paginas/Ajustes").then((m) => ({ default: m.Ajustes })));
const Conteos = lazy(() => import("./paginas/Conteos").then((m) => ({ default: m.Conteos })));
const Precios = lazy(() => import("./paginas/Precios").then((m) => ({ default: m.Precios })));
const Ofertas = lazy(() => import("./paginas/Ofertas").then((m) => ({ default: m.Ofertas })));
const Clientes = lazy(() => import("./paginas/Clientes").then((m) => ({ default: m.Clientes })));
const Cierres = lazy(() => import("./paginas/Cierres").then((m) => ({ default: m.Cierres })));
const Cotizaciones = lazy(() => import("./paginas/Cotizaciones").then((m) => ({ default: m.Cotizaciones })));
const Traspasos = lazy(() => import("./paginas/Traspasos").then((m) => ({ default: m.Traspasos })));
const Delivery = lazy(() => import("./paginas/Delivery").then((m) => ({ default: m.Delivery })));
const Reportes = lazy(() => import("./paginas/Reportes").then((m) => ({ default: m.Reportes })));
const Kardex = lazy(() => import("./paginas/Kardex").then((m) => ({ default: m.Kardex })));
const EquiposRed = lazy(() => import("./paginas/EquiposRed").then((m) => ({ default: m.EquiposRed })));
const Verificador = lazy(() => import("./paginas/Verificador").then((m) => ({ default: m.Verificador })));
const ComprobantesNcf = lazy(() => import("./paginas/Fiscal").then((m) => ({ default: m.ComprobantesNcf })));
const Fiscal = lazy(() => import("./paginas/Fiscal").then((m) => ({ default: m.Fiscal })));
const Sucursales = lazy(() => import("./paginas/Sucursales").then((m) => ({ default: m.Sucursales })));
const Marca = lazy(() => import("./paginas/Marca").then((m) => ({ default: m.Marca })));
const PanelMseller = lazy(() => import("./paginas/PanelMseller").then((m) => ({ default: m.PanelMseller })));
const DatosEmpresa = lazy(() => import("./paginas/DatosEmpresa").then((m) => ({ default: m.DatosEmpresa })));
const PantallaCliente = lazy(() => import("./paginas/PantallaCliente").then((m) => ({ default: m.PantallaCliente })));
const Respaldos = lazy(() => import("./paginas/Respaldos").then((m) => ({ default: m.Respaldos })));
const FormatosImpresion = lazy(() => import("./paginas/FormatosImpresion").then((m) => ({ default: m.FormatosImpresion })));
const EquiposCaja = lazy(() => import("./paginas/EquiposCaja").then((m) => ({ default: m.EquiposCaja })));
const Padron = lazy(() => import("./paginas/Padron").then((m) => ({ default: m.Padron })));
const Usuarios = lazy(() => import("./paginas/Usuarios").then((m) => ({ default: m.Usuarios })));
const Cxc = lazy(() => import("./paginas/Cxc").then((m) => ({ default: m.Cxc })));
const MovimientosCaja = lazy(() => import("./paginas/MovimientosCaja").then((m) => ({ default: m.MovimientosCaja })));
const Incidentes = lazy(() => import("./paginas/Incidentes").then((m) => ({ default: m.Incidentes })));
import { aplicarTemaAdmin } from "./tema";
import { SimboloFactPOS } from "./Logo";
import { Icono, type NombreIcono } from "./Iconos";

const SECCIONES = [
  { id: "resumen", titulo: "Resumen", grupo: "General", C: Resumen, i: "resumen", p: ["admin.reportes"] },
  { id: "puesta", titulo: "Puesta en marcha", grupo: "General", C: PuestaEnMarcha, i: "conteos", p: ["admin.config"] },
  { id: "facturas", titulo: "Facturas", grupo: "Ventas", C: Facturas, i: "venta", p: ["admin.facturas"] },
  { id: "cotizaciones", titulo: "Cotizaciones", grupo: "Ventas", C: Cotizaciones, i: "ticket", p: ["admin.cotizaciones"] },
  { id: "pedidos", titulo: "Pedidos de clientes", grupo: "Ventas", C: Pedidos, i: "compras", p: ["admin.pedidos"] },
  { id: "delivery", titulo: "Delivery", grupo: "Ventas", C: Delivery, i: "delivery", p: ["admin.config"] },
  { id: "clientela", titulo: "Clientes", grupo: "Ventas", C: Clientes, i: "clientes", p: ["admin.clientes", "admin.cxc"] },
  { id: "productos", titulo: "Productos", grupo: "Inventario", C: Productos, i: "productos", p: ["admin.productos"] },
  { id: "inventario", titulo: "Existencias", grupo: "Inventario", C: Inventario, i: "inventario", p: ["admin.inventario", "admin.reportes"] },
  { id: "compras", titulo: "Compras", grupo: "Inventario", C: Compras, i: "compras", p: ["admin.compras"] },
  { id: "traspasos", titulo: "Traspasos", grupo: "Inventario", C: Traspasos, i: "traspasos", p: ["admin.traspasos", "admin.recibir"] },
  { id: "conteos", titulo: "Conteos físicos", grupo: "Inventario", C: Conteos, i: "conteos", p: ["admin.inventario"] },
  { id: "ajustes", titulo: "Ajustes", grupo: "Inventario", C: Ajustes, i: "ajustes", p: ["admin.inventario"] },
  { id: "kardex", titulo: "Kardex", grupo: "Inventario", C: Kardex, i: "kardex", p: ["admin.inventario"] },
  { id: "precios", titulo: "Precios", grupo: "Precios", C: Precios, i: "precios", p: ["admin.precios"] },
  { id: "ofertas", titulo: "Ofertas", grupo: "Precios", C: Ofertas, i: "ofertas", p: ["admin.precios"] },
  { id: "verificador", titulo: "Verificador de precios", grupo: "Precios", C: Verificador, i: "precios", p: ["admin.precios"] },
  { id: "cxc", titulo: "Cuentas por cobrar", grupo: "Finanzas", C: Cxc, i: "cxc", p: ["admin.cxc", "admin.reportes"] },
  { id: "cierres", titulo: "Cierres de caja", grupo: "Finanzas", C: Cierres, i: "caja", p: ["admin.cierres"] },
  { id: "caja", titulo: "Retiros y gastos", grupo: "Finanzas", C: MovimientosCaja, i: "caja", p: ["admin.reportes"] },
  { id: "fiscal", titulo: "Facturación electrónica", grupo: "Fiscal", C: Fiscal, i: "fiscal", p: ["admin.fiscal"] },
  { id: "ncf", titulo: "Comprobantes (NCF)", grupo: "Fiscal", C: ComprobantesNcf, i: "fiscal", p: ["admin.fiscal"] },
  { id: "padron", titulo: "Padrón de RNC (DGII)", grupo: "Fiscal", C: Padron, i: "padron", p: ["admin.fiscal"] },
  { id: "reportes", titulo: "Reportes", grupo: "Reportes", C: Reportes, i: "reportes", p: ["admin.reportes"] },
  { id: "empresa", titulo: "Datos de la empresa", grupo: "Negocio", C: DatosEmpresa, i: "ajustes", p: ["admin.config"] },
  { id: "sucursales", titulo: "Sucursales y terminales", grupo: "Negocio", C: Sucursales, i: "sucursales", p: ["admin.config"] },
  { id: "usuarios", titulo: "Usuarios y permisos", grupo: "Negocio", C: Usuarios, i: "usuarios", p: ["admin.usuarios"] },
  { id: "marca", titulo: "Apariencia", grupo: "Negocio", C: Marca, i: "marca", p: ["admin.config"] },
  { id: "correo", titulo: "Correo y envíos", grupo: "Negocio", C: Correo, i: "correo", p: ["admin.config"] },
  { id: "equipos", titulo: "Equipos de la caja", grupo: "Cajas y equipos", C: EquiposCaja, i: "ticket", p: ["admin.config"] },
  { id: "formatos", titulo: "Formatos de impresión", grupo: "Cajas y equipos", C: FormatosImpresion, i: "ticket", p: ["admin.config"] },
  { id: "pantallacliente", titulo: "Pantalla del cliente", grupo: "Cajas y equipos", C: PantallaCliente, i: "resumen", p: ["admin.config"] },
  { id: "equiposred", titulo: "Equipos en la red", grupo: "Cajas y equipos", C: EquiposRed, i: "web", p: ["admin.config"] },
  { id: "versiones", titulo: "Versiones de los equipos", grupo: "Cajas y equipos", C: VersionesEquipos, i: "actualizaciones", p: ["admin.config"] },
  { id: "instaladores", titulo: "Instaladores", grupo: "Instaladores", C: Instaladores, i: "actualizaciones", p: ["admin.config"] },
  { id: "accesoremoto", titulo: "Acceso remoto", grupo: "Sistema", C: AccesoRemoto, i: "web", p: ["*"] },
  { id: "movil", titulo: "Configuración móvil", grupo: "Sistema", C: ConfigMovil, i: "menu-lateral", p: ["admin.config"] },
  { id: "seguridad", titulo: "Seguridad", grupo: "Sistema", C: Seguridad, i: "llave", p: ["*"] },
  { id: "respaldos", titulo: "Respaldos", grupo: "Sistema", C: Respaldos, i: "actualizaciones", p: ["admin.config"] },
  { id: "licencia", titulo: "Licencia", grupo: "Sistema", C: Licencia, i: "licencia", p: ["admin.config"] },
  { id: "actualizaciones", titulo: "Actualizaciones", grupo: "Sistema", C: Actualizaciones, i: "actualizaciones", p: ["admin.config"] },
  { id: "incidentes", titulo: "Incidentes y soporte", grupo: "Sistema", C: Incidentes, i: "incidentes", p: ["admin.config"] },
] as const;
/** Versión celular (pantalla angosta): solo lo que el dueño necesita en el día a día. */
const SECCIONES_MOVIL_BASE = ["resumen", "productos", "compras", "inventario", "ajustes", "conteos", "traspasos", "kardex", "precios", "ofertas", "clientela", "cotizaciones", "facturas", "pedidos", "cxc", "cierres", "caja", "reportes"];
interface CfgMovil { habilitada: boolean; secciones: string[]; aplica: boolean }
const lee = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const guarda = (k: string, v: string | null) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };
function useVersionMovil(cfg: CfgMovil | null) {
  const [angosta, setAngosta] = useState(() => matchMedia("(max-width: 760px)").matches);
  const [completa, setCompleta] = useState(() => lee("factpos.versionCompleta") === "1");
  useEffect(() => {
    const m = matchMedia("(max-width: 760px)");
    const f = () => setAngosta(m.matches);
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  const admin = puede("*");
  const activa = cfg ? cfg.habilitada : true; // sin configurar: la versión celular viene activa
  const permitido = !cfg || cfg.aplica || admin; // los administradores siempre entran
  return { admin, angosta, activa, bloqueado: angosta && activa && !permitido, secciones: new Set(cfg?.secciones ?? SECCIONES_MOVIL_BASE),
    movil: angosta && activa && !(admin && completa), puedeAlternar: angosta && admin && activa, alternar: () => { guarda("factpos.versionCompleta", completa ? null : "1"); setCompleta(!completa); } };
}
/** En el portal del proveedor solo hay clientes/licencias y su propio equipo. */
const SECCIONES_PORTAL = [
  { id: "clientes", titulo: "Clientes y licencias", grupo: "Portal FactPOS", C: Portal, i: "clientes", p: ["*"] },
  { id: "certificacion", titulo: "Certificación DGII", grupo: "Portal FactPOS", C: CertificacionDgii, i: "fiscal", p: ["*"] },
  { id: "ecfplanes", titulo: "Facturación electrónica", grupo: "Portal FactPOS", C: FacturacionElectronica, i: "fiscal", p: ["*"] },
  { id: "mseller", titulo: "MSeller", grupo: "Portal FactPOS", C: PanelMseller, i: "fiscal", p: ["*"] },
  { id: "instaladores", titulo: "Instaladores", grupo: "Portal FactPOS", C: InstaladoresPortal, i: "actualizaciones", p: ["*"] },
  { id: "envios", titulo: "Envío de actualizaciones", grupo: "Portal FactPOS", C: ActualizacionesPortal, i: "actualizaciones", p: ["*"] },
  { id: "usuarios", titulo: "Usuarios del portal", grupo: "Portal FactPOS", C: Usuarios, i: "usuarios", p: ["admin.usuarios"] },
  { id: "correo", titulo: "Correo del portal", grupo: "Portal FactPOS", C: Correo, i: "correo", p: ["admin.config"] },
] as const;
type Seccion = (typeof SECCIONES)[number]["id"] | (typeof SECCIONES_PORTAL)[number]["id"];
type Item = { id: string; titulo: string; grupo: string; C: ComponentType | LazyExoticComponent<ComponentType>; i: NombreIcono; p: readonly string[] };

/** Qué hace cada opción (se ve en su recuadro). */
const DESCRIPCION: Record<string, string> = {
  puesta: "Lo que falta para empezar a vender: empresa, comprobantes, productos, cajas y usuarios",
  ecfplanes: "Rango de e-CF por cliente, uso del mes, costo y margen",
  pantallacliente: "Segunda pantalla de la caja: productos, total y ofertas del negocio",
  mseller: "Clientes que facturan con MSeller: plan, conexión y comprobantes del mes",
  certificacion: "Avance de la certificación de FactPOS como software ante la DGII",
  facturas: "Buscar facturas, reimprimir, modificar y anular (con permiso de supervisor)",
  pedidos: "Pedidos al por mayor: se envían a una caja, se alistan y se facturan",
  resumen: "Ventas del día, alertas y existencias por reponer",
  productos: "Ficha, códigos de barra, precios y combos",
  accesoremoto: "Quién entra desde internet: reglas, equipos autorizados, enlaces y la app",
  movil: "Qué se ve y quién entra desde el celular",
  seguridad: "Habilitar o deshabilitar funciones sensibles",
  versiones: "Qué versión tiene cada servidor y verificador, y cuáles están desactualizados",
  instaladores: "Descargar el servidor, las cajas, el verificador y las apps de administración",
  compras: "Entrada de mercancía de los proveedores",
  inventario: "Existencia de cada producto por sucursal",
  ajustes: "Corregir existencias: mermas, daños, sobrantes",
  conteos: "Inventario físico y sus diferencias",
  traspasos: "Mover mercancía entre sucursales y almacenes",
  kardex: "Historial de entradas y salidas de un producto",
  precios: "Cambiar precios por nivel y por sucursal",
  verificador: "Dirección y pasos para los verificadores Android y Windows",
  ofertas: "Promociones, combos y descuentos con tope",
  clientela: "Clientes y el nivel de precio de cada uno",
  cotizaciones: "Preparar cotizaciones y enviarlas por correo",
  delivery: "Pedidos a domicilio y repartidores",
  cxc: "Clientes a crédito, abonos y estados de cuenta",
  cierres: "Cuadre de cada turno, revisión de diferencias y depósitos",
  caja: "Retiros, gastos y movimientos de caja",
  fiscal: "e-CF, envíos a la DGII y certificado digital",
  ncf: "Rangos NCF (serie B) y secuencias e-NCF por sucursal",
  padron: "Consulta de RNC y cédulas de la DGII",
  reportes: "Ventas, cierres, inventario, impuestos y más",
  sucursales: "Tiendas, cajas y servidores de cada local",
  incidentes: "Fallas, caídas de conexión y soporte",
  usuarios: "Cuentas, roles y permisos del personal",
  equipos: "Impresora, gaveta, báscula y datáfono de cada terminal",
  correo: "Envío de reportes y facturas por correo",
  empresa: "Nombre, RNC, dirección, teléfono y correo de la empresa",
  marca: "Logo de su empresa y colores: los de su logo o los de FactPOS",
  formatos: "Diseño del ticket: papel, logo, encabezado, pie y datos",
  respaldos: "Copias de seguridad: en este equipo, USB/OneDrive y la nube",
  licencia: "Plan, vigencia y activación de FactPOS",
  actualizaciones: "Nuevas versiones del sistema",
  clientes: "Empresas, licencias y sus instalaciones",
};
/** Las funciones principales del inicio, en este orden. */
const GRUPOS: Record<string, { slug: string; i: NombreIcono; color: string; d: string }> = {
  "General": { slug: "general", i: "resumen", color: "#1d4ed8", d: "Cómo va el día en todas las sucursales" },
  "Ventas": { slug: "ventas", i: "venta", color: "#d97706", d: "Facturas, cotizaciones, pedidos, delivery y clientes" },
  "Inventario": { slug: "inventario", i: "productos", color: "#2563eb", d: "Productos, existencias, compras y traspasos" },
  "Precios": { slug: "precios", i: "precios", color: "#db2777", d: "Precios por nivel, ofertas y verificadores" },
  "Finanzas": { slug: "finanzas", i: "cxc", color: "#16a34a", d: "Cuentas por cobrar, cierres, retiros y gastos" },
  "Fiscal": { slug: "fiscal", i: "fiscal", color: "#7c3aed", d: "Facturación electrónica, NCF y padrón de la DGII" },
  "Reportes": { slug: "reportes", i: "reportes", color: "#0891b2", d: "Todos los informes del negocio" },
  "Negocio": { slug: "negocio", i: "sucursales", color: "#475569", d: "Empresa, sucursales, usuarios, apariencia y correo" },
  "Instaladores": { slug: "instaladores", i: "actualizaciones", color: "#ea580c", d: "Caja, servidor, verificador de precios y conexión remota" },
  "Cajas y equipos": { slug: "equipos", i: "ticket", color: "#0d9488", d: "Impresoras, ticket, pantalla del cliente y versiones" },
  "Sistema": { slug: "sistema", i: "ajustes", color: "#64748b", d: "Acceso remoto, seguridad, respaldos, licencia y actualizaciones" },
  "Portal FactPOS": { slug: "portal", i: "clientes", color: "#1d4ed8", d: "Clientes, licencias y equipo del portal" },
};
/** Cada opción lleva su propio color (en orden, para que las vecinas no se parezcan): así la pantalla no queda toda del mismo tono. */
const PALETA_OPCIONES = ["#1d4ed8", "#2563eb", "#d97706", "#7c3aed", "#16a34a", "#db2777", "#0891b2", "#ea580c", "#4f46e5", "#65a30d"];
const datosGrupo = (g: string) => GRUPOS[g] ?? { slug: g.toLowerCase(), i: "resumen" as NombreIcono, color: "#475569", d: "" };

const CATALOGO_VACIO: CatalogoAdmin = { sucursales: [], productos: [], categorias: [], usuarios: [] };

function AppInterna() {
  const [sesion, setSesion] = useState<Sesion | null>(leerSesion());
  const [catalogo, setCatalogo] = useState<CatalogoAdmin | null>(null);
  const ALIAS_ANTIGUOS: Record<string, string> = { conexionweb: "accesoremoto", dispositivos: "accesoremoto" };
  const [seccion, setSeccionCruda] = useState<string>(() => ALIAS_ANTIGUOS[location.hash.slice(1)] ?? (location.hash.slice(1) || "inicio"));
  const setSeccion = (v: string) => setSeccionCruda(ALIAS_ANTIGUOS[v] ?? v);
  const [menu, setMenu] = useState(false);
  const [forma, setForma] = useState<Forma>(leerForma);
  const cambiarForma = (f: Forma) => { setForma(f); guardarForma(f); };
  const [colapsado, setColapsado] = useState<boolean>(leerColapsado);
  const alternarColapso = () => { const v = !colapsado; setColapsado(v); guardarColapsado(v); };
  const [error, setError] = useState("");
  const [logo, setLogo] = useState<string | null>(null);
  const [cambiarClave, setCambiarClave] = useState(false);
  /** Entró con la contraseña inicial: tiene que crear la suya antes de usar nada. */
  const [debeCambiar, setDebeCambiar] = useState(false);
  const [buscaOpcion, setBuscaOpcion] = useState("");
  const [menuUsuario, setMenuUsuario] = useState(false);
  const [, setRefresco] = useState(0);
  const [cfgMovil, setCfgMovil] = useState<CfgMovil | null>(null);

  const salir = () => { fijarSesion(null); setSesion(null); setCatalogo(null); };
  useEffect(() => {
    const f = () => { salir(); setError("Su sesión terminó: entre de nuevo"); };
    window.addEventListener("factpos:sesion-vencida", f);
    return () => window.removeEventListener("factpos:sesion-vencida", f);
  }, []);

  useEffect(() => {
    if (!sesion) return;
    // Permisos al día (si el administrador cambió el rol, se refleja al abrir)
    api<{ usuario: { permisos: string[]; nombre: string; sucursales: string[] | null }; modo?: string; debeCambiarClave?: boolean }>("/central/sesion")
      .then((r) => { setDebeCambiar(!!r.debeCambiarClave); fijarModoServidor(r.modo ?? null); fijarSesion({ ...sesion, permisos: r.usuario.permisos, nombre: r.usuario.nombre, sucursales: r.usuario.sucursales }); setRefresco((x) => x + 1); })
      .catch(() => {});
    if (enPortal) { setCatalogo(CATALOGO_VACIO); return; }
    api<CatalogoAdmin>("/central/catalogo").then(setCatalogo).catch((e) => setError(e.message));
    // Otras pantallas (p. ej. Compras al crear un producto) piden refrescar el catálogo
    const recargarCatalogo = () => { api<CatalogoAdmin>("/central/catalogo").then(setCatalogo).catch(() => {}); };
    window.addEventListener("factpos:catalogo", recargarCatalogo);
    api<CfgMovil>("/central/movil").then(setCfgMovil).catch(() => {});
    api<{ logo: string | null; primario: string; secundario: string | null; nombre: string; usarColores?: boolean }>("/central/marca")
      .then((m) => { aplicarTemaAdmin(m); setLogo(m.logo); })
      .catch(() => {});
    return () => window.removeEventListener("factpos:catalogo", recargarCatalogo);
  }, [sesion]);
  useEffect(() => { if (location.hash.slice(1).split("?")[0] !== seccion) location.hash = seccion; window.scrollTo(0, 0); document.querySelector(".contenido")?.scrollTo(0, 0); }, [seccion]);
  // Enlaces internos (#seccion) desde cualquier pantalla, y atrás/adelante del navegador
  useEffect(() => {
    const f = () => { const h = location.hash.slice(1).split("?")[0]; setSeccion(h || "inicio"); };
    addEventListener("hashchange", f);
    return () => removeEventListener("hashchange", f);
  }, []);

  const vm = useVersionMovil(cfgMovil);
  const enEntrada = !sesion || (!catalogo && !!error);
  useEffect(() => {
    try { (window as unknown as { factpos?: { ventana?: (m: string) => void } }).factpos?.ventana?.(enEntrada ? "entrar" : "app"); } catch { /* fuera de la app de escritorio */ }
  }, [enEntrada]);
  if (!sesion || !catalogo && error) {
    return <Entrar error={error} onListo={(s) => { fijarSesion(s); setError(""); setSesion(s); }} />;
  }
  if (!catalogo) return <div className="cargando">Cargando…</div>;
  if (vm.bloqueado && !enPortal) {
    return (
      <div className="bloqueo-movil"><div>
        <SimboloFactPOS tamano={56} fondo />
        <h2>Sin acceso desde el celular</h2>
        <p className="suave">Su usuario no está autorizado para usar FactPOS desde el celular. Pídale acceso a un administrador o entre desde una computadora.</p>
        <button className="boton primario" onClick={salir}>Salir</button>
      </div></div>
    );
  }

  const visibles = ((enPortal ? SECCIONES_PORTAL : SECCIONES) as readonly Item[]).filter((s) => s.p.some(puede) && (enPortal || !vm.movil || vm.admin || vm.secciones.has(s.id)));
  const grupos = [...new Set(visibles.map((s) => s.grupo))];
  const enGrupo = (g: string) => visibles.filter((s) => s.grupo === g);
  // Buscador del inicio: sin acentos ni mayúsculas, por nombre de la opción, su módulo o su descripción
  const plano = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const opcionesBuscadas = (() => {
    const q = plano(buscaOpcion.trim());
    if (!q) return [] as { s: Item; g: string }[];
    const palabras = q.split(/\s+/);
    return visibles.map((s) => ({ s, g: s.grupo, texto: plano(`${s.titulo} ${s.grupo} ${DESCRIPCION[s.id] ?? ""}`), ini: plano(s.titulo).startsWith(q) }))
      .filter((x) => palabras.every((w) => x.texto.includes(w)))
      .sort((a, b) => Number(b.ini) - Number(a.ini));
  })();
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
      <div className={"app " + (forma === "lateral" ? "app-lateral" + (colapsado ? " app-colapsado" : "") : "app-cuadricula")}>
        {forma === "lateral" && (
          <aside className={"lateral" + (menu ? " abierto" : "")}>
            {logo
              ? <div className="marca-logo"><img src={logo} alt="Logo" /><small>FactPOS · Administración</small></div>
              : <div className="marca con-icono"><SimboloFactPOS tamano={36} fondo /><span className="texto"><span className="nombre">Fact<b>POS</b></span><small>{enPortal ? "Portal de licencias" : CONFIG.cliente ?? "Administración"}</small></span></div>}
            <nav>
              <div className="grupo">
                <button className={vista === "inicio" ? "activo" : ""} title="Inicio" onClick={() => { setSeccion("inicio"); setMenu(false); }}><Icono n="inicio" /><span>Inicio</span></button>
              </div>
              {grupos.map((g) => (
                <div key={g} className="grupo">
                  <span className="grupo-titulo">{g}</span>
                  {enGrupo(g).map((x) => (
                    <button key={x.id} className={actualId === x.id ? "activo" : ""} aria-current={actualId === x.id ? "page" : undefined} title={x.titulo}
                      onClick={() => { setSeccion(x.id); setMenu(false); }}>
                      <Icono n={x.i} /><span>{x.titulo}</span>
                    </button>
                  ))}
                </div>
              ))}
            </nav>
            <button type="button" className="lateral-colapsar" onClick={alternarColapso} aria-expanded={!colapsado}
              aria-label={colapsado ? "Expandir menú" : "Contraer menú"} title={colapsado ? "Expandir menú" : "Contraer menú"}>
              <svg className="icono" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                <path d={colapsado ? "m9 6 6 6-6 6" : "m15 6-6 6 6 6"} />
              </svg>
              <span>Contraer menú</span>
            </button>
          </aside>
        )}
        {forma === "lateral" && menu && <div className="velo-menu" onClick={() => setMenu(false)} />}
        <div className="contenido">
          <header className="barra-superior">
            {forma === "lateral" && <button className="boton-icono solo-movil" aria-label="Menú" onClick={() => setMenu(!menu)}><Icono n="menu" /></button>}
            {vista !== "inicio" && (
              <button className="boton-icono" title="Volver" aria-label="Volver"
                onClick={() => (vista === "seccion" && grupoActual && enGrupo(grupoActual).length > 1 ? setSeccion("g-" + datosGrupo(grupoActual).slug) : setSeccion("inicio"))}>
                <Icono n="atras" />
              </button>
            )}
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
            {!enPortal && !esLocal() && <FranjaEmpresa />}
            {!enPortal && !esLocal() && <SelectorEmpresa />}
            {!enPortal && puede("*") && <AvisoAcceso irAAcceso={() => setSeccion("accesoremoto")} />}
            <div className="menu-usuario">
              <button className="chip-usuario" title="Mi cuenta" aria-haspopup="menu" aria-expanded={menuUsuario} onClick={() => setMenuUsuario((v) => !v)}>
                <span className="avatar" aria-hidden="true">{iniciales}</span><span className="solo-escritorio">{sesion.nombre.split(" ")[0]}</span>
              </button>
              {menuUsuario && (
                <>
                  <div className="menu-usuario-fondo" onClick={() => setMenuUsuario(false)} />
                  <div className="menu-usuario-lista" role="menu">
                    <div className="menu-usuario-nombre"><b>{sesion.nombre}</b><span className="suave pequeno">{sesion.empresa}</span></div>
                    <button role="menuitem" onClick={() => { setMenuUsuario(false); setCambiarClave(true); }}>Cambiar mi contraseña</button>
                    <button role="menuitem" onClick={() => { setMenuUsuario(false); salir(); }}>Cambiar de usuario</button>
                    <button role="menuitem" onClick={() => { setMenuUsuario(false); salir(); }}>Salir</button>
                  </div>
                </>
              )}
            </div>
            {vm.puedeAlternar && !enPortal && <button className="boton-icono" title={vm.movil ? "Ver versión completa" : "Ver versión celular"} aria-label={vm.movil ? "Ver versión completa" : "Ver versión celular"} onClick={vm.alternar}><Icono n={vm.movil ? "menu-lateral" : "menu"} /></button>}
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
            {!enPortal && actualId !== "licencia" && <AvisoLicencia irA={() => setSeccion("licencia")} />}
            {!enPortal && vista === "inicio" && <BarraPuesta />}
            {vista === "inicio" && <TarjetaAgregar />}

            {vista === "inicio" && (
              <>
                <div className="saludo">
                  <h1>{saludo()}, {sesion.nombre.split(" ")[0]}</h1>
                  <p className="suave">{enPortal ? "Esto es lo que pasa hoy en el portal." : "¿Qué desea hacer hoy? Elija una función."}</p>
                </div>
                <div className="buscador-inicio">
                  <span className="buscador-lupa" aria-hidden="true"><Icono n="buscar" tamano={18} /></span>
                  <input type="search" value={buscaOpcion} onChange={(e) => setBuscaOpcion(e.target.value)} placeholder="Buscar una opción: productos, facturas, NCF, precios…" aria-label="Buscar una opción"
                    onKeyDown={(e) => { if (e.key === "Escape") setBuscaOpcion(""); if (e.key === "Enter" && opcionesBuscadas[0]) setSeccion(opcionesBuscadas[0].s.id); }} />
                </div>
                {buscaOpcion.trim() ? (
                  <div className="cuadricula cuadricula-opciones">
                    {opcionesBuscadas.map(({ s, g }, k) => (
                      <button key={s.id} className="mosaico mosaico-opcion" style={{ "--c": PALETA_OPCIONES[k % PALETA_OPCIONES.length] } as React.CSSProperties} onClick={() => setSeccion(s.id)}>
                        <span className="mosaico-icono"><Icono n={s.i} tamano={24} /></span>
                        <span className="mosaico-texto"><b>{s.titulo}</b><small>{g}{DESCRIPCION[s.id] ? " · " + DESCRIPCION[s.id] : ""}</small></span>
                        <span className="mosaico-flecha" aria-hidden="true">›</span>
                      </button>
                    ))}
                    {!opcionesBuscadas.length && <p className="suave">Ninguna opción coincide con “{buscaOpcion.trim()}”.</p>}
                  </div>
                ) : enPortal ? (
                  <InicioPortal irA={setSeccion} accesos={visibles.map((v) => ({ id: v.id, titulo: v.titulo, i: v.i, texto: DESCRIPCION[v.id] ?? "" }))} />
                ) : (<>
                <h2 className="titulo-seccion">Módulos</h2>
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
                            {items.length > 3 && <i className="mas">+{items.length - 3} más</i>}
                          </span>
                        )}
                      </button>
                    );
                  })}
                  {!enPortal && <EstadoSistema />}
                </div>
                </>)}
              </>
            )}

            {vista === "grupo" && grupoAbierto && (
              <>
                <div className="saludo con-icono" style={{ "--c": datosGrupo(grupoAbierto).color } as React.CSSProperties}>
                  <button className="boton-icono volver" aria-label="Volver al inicio" title="Volver al inicio" onClick={() => setSeccion("inicio")}>‹</button>
                  <span className="mosaico-icono"><Icono n={datosGrupo(grupoAbierto).i} tamano={26} /></span>
                  <div><h1>{grupoAbierto}</h1><p className="suave">{datosGrupo(grupoAbierto).d}</p></div>
                </div>
                <div className="cuadricula cuadricula-opciones">
                  {enGrupo(grupoAbierto).map((s, k) => (
                    <button key={s.id} className="mosaico mosaico-opcion" style={{ "--c": PALETA_OPCIONES[k % PALETA_OPCIONES.length] } as React.CSSProperties} onClick={() => setSeccion(s.id)}>
                      <span className="mosaico-icono"><Icono n={s.i} tamano={24} /></span>
                      <span className="mosaico-texto"><b>{s.titulo}</b><small>{DESCRIPCION[s.id] ?? ""}</small></span>
                      <span className="mosaico-flecha" aria-hidden="true">›</span>
                    </button>
                  ))}
                </div>
              </>
            )}

            {vista === "seccion" && <Suspense fallback={<p className="suave" style={{ padding: 24 }}>Cargando…</p>}><Actual /></Suspense>}
          </main>
          {(cambiarClave || debeCambiar) && <CambiarClave obligatorio={debeCambiar} onCerrar={() => { setCambiarClave(false); setDebeCambiar(false); }} />}
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
/** Menú lateral contraído (solo íconos) en este equipo. */
function leerColapsado(): boolean {
  try { return localStorage.getItem("factpos.admin.colapsado") === "1"; } catch { return false; }
}
function guardarColapsado(v: boolean) {
  try { localStorage.setItem("factpos.admin.colapsado", v ? "1" : "0"); } catch { /* sin almacenamiento */ }
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
  const [empresas, setEmpresas] = useState<{ rnc: string; nombre: string; sucursales?: string[] }[] | null>(null);
  const [pedirRnc, setPedirRnc] = useState(false);
  const [pedirCodigo, setPedirCodigo] = useState(false);
  const [codigo, setCodigo] = useState("");
  const [msg, setMsg] = useState(error);
  const [entrando, setEntrando] = useState(false);
  const [recuperando, setRecuperando] = useState(false);
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
      const r = await api<{ requiere2fa?: boolean; elegirEmpresa?: boolean; empresas?: { rnc: string; nombre: string; sucursales?: string[] }[]; token: string; usuario: { id: string; nombre: string; permisos: string[] }; empresa: { id: string; nombre: string } }>(
        "/central/entrar", { servidor, cuerpo: { usuario, clave, rnc: rnc || undefined, codigo: codigo || undefined } });
      if (r.elegirEmpresa && r.empresas) { setEmpresas(r.empresas); setRnc(r.empresas[0].rnc); setMsg("Elija la empresa a la que va a entrar."); return; }
      if (r.requiere2fa) { setPedirCodigo(true); setMsg("Escriba el código de su app de verificación (o un código de recuperación)."); return; }
      onListo({ servidor, token: r.token, empresaId: r.empresa.id, empresa: r.empresa.nombre, usuarioId: r.usuario.id, nombre: r.usuario.nombre, permisos: r.usuario.permisos });
    } catch (e) {
      const t = (e as Error).message;
      if (/RNC/.test(t)) setPedirRnc(true);
      setMsg(t);
    } finally { setEntrando(false); }
  };

  const seguro = typeof location !== "undefined" && location.protocol === "https:";
  const host = typeof location !== "undefined" ? location.host : "";
  const rol = enPortal ? "Portal de licencias" : CONFIG.cliente ?? "Administración";
  return (
    <div className="entrar entrar-dividida">
      <aside className="entrar-lado" aria-hidden="true">
        <div className="entrar-lado-marca"><SimboloFactPOS tamano={40} fondo /><span>Fact<b>POS</b></span></div>
        <div className="entrar-lado-centro">
          <h2>Ventas, inventario y facturación electrónica en un solo panel.</h2>
          <p>Controla todas tus tiendas y cajas desde cualquier lugar, con respaldo y trabajo sin internet en cada sucursal.</p>
          <pre className="entrar-consola"><code>
<span className="c-suave">$</span> conectar <span className="c-acento">{host || "servidor"}</span>{"\n"}
<span className={seguro ? "c-ok" : "c-alerta"}>{seguro ? "✔" : "!"}</span> {seguro ? "canal cifrado (TLS)" : "canal sin cifrar"}{"\n"}
<span className="c-ok">✔</span> verificación en 2 pasos disponible{"\n"}
<span className="c-suave">›</span> esperando credenciales<span className="cursor">_</span>
          </code></pre>
        </div>
        <ul className="entrar-etiquetas">
          <li>e-CF · DGII</li><li>Multi-sucursal</li><li>Funciona sin internet</li><li>Respaldos cifrados</li>
        </ul>
      </aside>
      <main className="entrar-forma">
        {recuperando ? <RecuperarClave servidor={servidor} usuarioInicial={usuario} onVolver={(m) => { setRecuperando(false); if (m) setMsg(m); }} /> : (
        <form className="tarjeta-entrar" onSubmit={entrar}>
          <span className="entrar-movil"><SimboloFactPOS tamano={56} fondo /></span>
          <div className="entrar-titulo">
            <small>{rol}</small>
            <h1>Iniciar sesión</h1>
          </div>
          <label className="campo"><span>{enPortal ? "Correo" : "Usuario"}</span><input autoFocus value={usuario} onChange={(e) => setUsuario(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} /></label>
          <label className="campo"><span>Contraseña</span><input type="password" value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="current-password" /></label>
          {empresas && <label className="campo"><span>Empresa</span>
            <select value={rnc} onChange={(e) => setRnc(e.target.value)}>
              {empresas.map((x) => <option key={x.rnc} value={x.rnc}>{x.sucursales?.length ? `${x.nombre} · ${x.sucursales.join(", ")}` : `${x.nombre} · RNC ${x.rnc}`}</option>)}
            </select>
          </label>}
          {pedirRnc && !empresas && <label className="campo"><span>RNC de la empresa</span><input value={rnc} onChange={(e) => setRnc(e.target.value)} inputMode="numeric" /></label>}
          {pedirCodigo && <label className="campo"><span>Código de verificación</span><input autoFocus value={codigo} onChange={(e) => setCodigo(e.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" /></label>}
          {verServidor && <label className="campo"><span>Dirección de la central</span><input value={servidor} onChange={(e) => setServidor(e.target.value)} /></label>}
          <button className="boton primario ancho" disabled={!usuario || !clave || entrando || (pedirCodigo && !codigo)}>{entrando ? "Entrando…" : "Entrar"}</button>
          {msg && <p className={/^Listo/.test(msg) ? "suave" : "error"}>{msg}</p>}
          <button type="button" className="enlace pequeno" onClick={() => { setMsg(""); setRecuperando(true); }}>¿Olvidó su contraseña?</button>
          <AgregarAInicio />
          {!verServidor && !CONFIG.modo && <button type="button" className="enlace pequeno" onClick={() => setVerServidor(true)}>Otra central…</button>}
          <p className="entrar-pie">{seguro ? "Conexión cifrada" : "Conexión sin cifrar"} · {host}</p>
        </form>
        )}
      </main>
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
    if (d.clave.length < 8) return setMsg("La contraseña debe tener al menos 8 caracteres");
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
          <label className="campo"><span>Contraseña (8 o más caracteres)</span><input type="password" minLength={8} maxLength={200} value={d.clave} onChange={(e) => set("clave", e.target.value)} autoComplete="new-password" /></label>
          <label className="campo"><span>Repita la contraseña</span><input type="password" minLength={8} maxLength={200} value={d.repetir} onChange={(e) => set("repetir", e.target.value)} autoComplete="new-password" /></label>
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

function SinPermisos() {
  return <p className="suave">Su usuario no tiene secciones habilitadas. Pídale al administrador que revise su rol.</p>;
}

function CambiarClave({ onCerrar, obligatorio = false }: { onCerrar: () => void; obligatorio?: boolean }) {
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [repetir, setRepetir] = useState("");
  const [msg, setMsg] = useState<{ t: string; ok?: boolean } | null>(null);
  const [dosPasos, setDosPasos] = useState(false);
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
    <div className="fondo-modal" onMouseDown={obligatorio ? undefined : onCerrar}>
      <form className="modal" onMouseDown={(e) => e.stopPropagation()} onSubmit={guardar}>
        <h2 style={{ marginTop: 0 }}>{obligatorio ? "Cree su contraseña" : "Cambiar mi contraseña"}</h2>
        {obligatorio && <p className="suave">Entró con la contraseña inicial. Escriba esa misma como «actual» y elija una nueva, de 8 o más caracteres, que no sea fácil de adivinar.</p>}
        <label className="campo"><span>Contraseña actual</span><input type="password" autoFocus value={actual} onChange={(e) => setActual(e.target.value)} autoComplete="current-password" /></label>
        <label className="campo"><span>Nueva (8 o más caracteres)</span><input type="password" value={nueva} onChange={(e) => setNueva(e.target.value)} autoComplete="new-password" /></label>
        <label className="campo"><span>Repita la nueva</span><input type="password" value={repetir} onChange={(e) => setRepetir(e.target.value)} autoComplete="new-password" /></label>
        {msg && <p className={msg.ok ? "ok" : "error"}>{msg.t}</p>}
        <div className="acciones-modal">
          <button type="button" className="boton fantasma" onClick={() => setDosPasos(true)}>Verificación en dos pasos…</button>
          <span className="pr-espacio" />
          {!obligatorio && <button type="button" className="boton" onClick={onCerrar}>Cancelar</button>}
          <button className="boton primario" disabled={!actual || !nueva}>Guardar</button>
        </div>
      </form>
      {dosPasos && <DosPasos onCerrar={() => setDosPasos(false)} />}
    </div>
  );
}

/** Aplicación + pantalla de actualización (que tapa todo mientras el servidor se actualiza y cierra la sesión al terminar). */
/** En el celular las tablas «apiladas» se ven como tarjetas: cada celda lleva el nombre de su columna. */
function useTablasApiladas() {
  useEffect(() => {
    const poner = () => document.querySelectorAll<HTMLTableElement>("table.apilada").forEach((t) => {
      const cab = Array.from(t.tHead?.rows[0]?.cells ?? []).map((h) => h.textContent?.trim() ?? "");
      t.querySelectorAll("tbody > tr").forEach((tr) => Array.from(tr.children).forEach((td, i) => {
        const e = td as HTMLElement;
        if (!e.hasAttribute("colspan") && cab[i] && e.dataset.label !== cab[i]) e.dataset.label = cab[i];
      }));
    });
    poner();
    const o = new MutationObserver(poner);
    o.observe(document.body, { childList: true, subtree: true });
    return () => o.disconnect();
  }, []);
}

/** En la ventana de escritorio (Chromium) el calendario de un campo de fecha solo se abre con su iconito, que en pantallas táctiles
 *  casi no se ve ni se acierta: al tocar el campo se abre el calendario (showPicker). Escribir la fecha con el teclado sigue funcionando. */
function useCalendarioAlTocar() {
  useEffect(() => {
    const f = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.("input[type=date],input[type=datetime-local],input[type=month],input[type=time]") as HTMLInputElement | null;
      if (!el || el.disabled || el.readOnly) return;
      try { el.showPicker?.(); } catch { /* el navegador no lo permite aquí: queda el iconito de siempre */ }
    };
    // En la fase de captura: así también funciona dentro de ventanas y tarjetas que detienen el clic antes de que suba
    document.addEventListener("click", f, true);
    return () => document.removeEventListener("click", f, true);
  }, []);
}

export function App() {
  useTablasApiladas();
  useCalendarioAlTocar();
  const servidor = () => leerSesion()?.servidor || (CONFIG.api !== undefined ? CONFIG.api || location.origin : location.origin);
  const listo = usePreparado(servidor, () => fijarSesion(null));
  const [dispositivo, setDispositivo] = useState<{ estado: string; servidor: string; ruta?: string; credencial?: boolean } | null>(null);
  useEffect(() => {
    // La solicitud va al MISMO servidor que respondió «no autorizado» (puede diferir de uno guardado en una sesión vieja)
    const f = (e: Event) => { const d = (e as CustomEvent).detail ?? {}; setDispositivo({ estado: String(d.estado ?? "DESCONOCIDO"), servidor: String(d.servidor || servidor()), ruta: d.ruta ? String(d.ruta) : undefined, credencial: typeof d.credencial === "boolean" ? d.credencial : undefined }); };
    window.addEventListener("factpos:dispositivo", f);
    return () => window.removeEventListener("factpos:dispositivo", f);
  }, []);
  if (CONFIG.modo === "cliente" && location.hash === "#instalar") return <PaginaInstalar />;
  if (dispositivo) return <SolicitarDispositivo servidor={dispositivo.servidor} estado={dispositivo.estado} ruta={dispositivo.ruta} credencial={dispositivo.credencial} />;
  return (
    <>
      {listo ? <AppInterna /> : <div className="cargando">Iniciando…</div>}
      <PantallaActualizacion servidor={servidor} alCambiarVersion={() => fijarSesion(null)} />
    </>
  );
}
