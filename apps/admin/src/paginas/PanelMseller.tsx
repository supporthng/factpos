import { Aviso, Encabezado, Kpi, Tabla, useDatos } from "../ui";

/**
 * Portal de FactPOS: clientes que facturan electrónicamente con MSeller (ecf.mseller.app).
 * Plan y cupo del mes, cómo está conectado cada cliente (lo reporta su sistema al renovar la licencia),
 * resultados del mes (aceptados, rechazados, pendientes) y cuánto cuesta frente a lo que se cobra.
 */
interface Conexion { transmisor: string; ambiente: string; proveedor: "mseller" | "otro" | null; credenciales: boolean; aceptados: number; rechazados: number; pendientes: number }
interface Fila {
  clienteId: string; slug: string; cliente: string; planId: string | null; plan: string | null; maxMes: number | null;
  precioUsd: number; costoUsd: number; margenUsd: number; actual: number; pct: number | null;
  estado: "sin-plan" | "ok" | "cerca" | "excedido" | "sin-datos"; ultimoReporte: string | null;
  conexion: Conexion | null; conexionEn: string | null; esMseller: boolean;
}
interface Resumen { mes: string; clientes: Fila[]; totales: { ingresoUsd: number; costoUsd: number; margenUsd: number } }

const usd = (n: number) => "US$ " + n.toLocaleString("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (n: number) => n.toLocaleString("es-DO");
const AMBIENTE: Record<string, string> = { SIMULADO: "Simulado", TESTECF: "Pruebas (TesteCF)", CERTECF: "Certificación (CerteCF)", ECF: "Producción" };
const fecha = (s: string | null) => (s ? new Date(s).toLocaleString("es-DO", { dateStyle: "short", timeStyle: "short" }) : "—");

/** Qué le falta a la conexión de un cliente, en una frase. */
function problema(f: Fila): string | null {
  const c = f.conexion;
  if (!c) return f.esMseller ? "Aún no ha reportado su conexión (necesita la versión nueva y renovar la licencia)" : null;
  if (c.proveedor !== "mseller") return "Tiene plan de MSeller pero su sistema no está configurado con MSeller";
  if (!c.credenciales) return "Falta pegar el correo, la clave y la API key de MSeller";
  if (c.ambiente === "SIMULADO") return "Está en modo simulado: no envía nada";
  if (c.rechazados > 0) return `${c.rechazados} comprobante(s) rechazado(s) este mes`;
  return null;
}

export function PanelMseller() {
  const { datos, error, recargar } = useDatos<Resumen>("/central/portal/ecf-resumen");
  const filas = (datos?.clientes ?? []).filter((c) => c.esMseller);
  const conectados = filas.filter((f) => f.conexion?.proveedor === "mseller" && f.conexion.credenciales && f.conexion.ambiente !== "SIMULADO").length;
  const enProduccion = filas.filter((f) => f.conexion?.proveedor === "mseller" && f.conexion.ambiente === "ECF").length;
  const conProblema = filas.filter((f) => problema(f)).length;
  const costo = filas.reduce((a, f) => a + (f.planId ? f.costoUsd : 0), 0);
  const cobrado = filas.reduce((a, f) => a + (f.planId ? f.precioUsd : 0), 0);

  return (
    <>
      <Encabezado titulo="MSeller" descripcion="Clientes que facturan electrónicamente con MSeller: su plan, su conexión y cómo van los comprobantes del mes. Cada cliente tiene su propia cuenta en MSeller.">
        <a className="boton" href="https://ecf.mseller.app" target="_blank" rel="noopener noreferrer">Abrir MSeller</a>
        <button className="boton" onClick={recargar}>Actualizar</button>
      </Encabezado>
      {error && <Aviso texto={error} />}
      <div className="tres-col" style={{ marginBottom: 12 }}>
        <Kpi titulo="Clientes con MSeller" valor={String(filas.length)} detalle={`${conectados} conectado(s) · ${enProduccion} en producción`} />
        <Kpi titulo="Costo de MSeller (mes)" valor={usd(costo)} detalle={`Cobrado a clientes: ${usd(cobrado)}`} />
        <Kpi titulo="Con algo por resolver" valor={String(conProblema)} tono={conProblema ? "alerta" : "ok"} detalle={conProblema ? "Mira la columna «Qué falta»" : "Todo en orden"} />
      </div>
      <Tabla
        filas={filas}
        clave={(f) => f.clienteId}
        tarjetas
        vacio="Aún no hay clientes con un plan de MSeller. Asigna uno en Facturación electrónica."
        columnas={[
          { titulo: "Cliente", valor: (f) => <><b>{f.cliente}</b><br /><span className="mono pequeno suave">/{f.slug}/</span></> },
          { titulo: "Plan", valor: (f) => f.plan ?? "Sin plan" },
          { titulo: `Uso ${datos?.mes ?? ""}`, valor: (f) => <span className={f.estado === "excedido" || f.estado === "cerca" ? "texto-alerta" : ""}>{f.maxMes ? `${num(f.actual)} de ${num(f.maxMes)} (${f.pct}%)` : num(f.actual)}</span> },
          { titulo: "Conexión", valor: (f) => f.conexion
              ? <>{f.conexion.proveedor === "mseller" ? "MSeller" : f.conexion.proveedor === "otro" ? "Otro proveedor" : f.conexion.transmisor === "DGII" ? "Directo a la DGII" : "Sin configurar"}<br /><span className="suave pequeno">{AMBIENTE[f.conexion.ambiente] ?? f.conexion.ambiente}</span></>
              : <span className="suave">Sin reporte</span> },
          { titulo: "Resultado del mes", valor: (f) => f.conexion
              ? <span className="pequeno">{num(f.conexion.aceptados)} aceptados · <span className={f.conexion.rechazados ? "texto-alerta" : ""}>{num(f.conexion.rechazados)} rechazados</span> · {num(f.conexion.pendientes)} pendientes</span>
              : "—" },
          { titulo: "Qué falta", valor: (f) => { const p = problema(f); return p ? <span className="texto-alerta pequeno">{p}</span> : <span className="texto-ok pequeno">Todo en orden</span>; } },
          { titulo: "Último reporte", valor: (f) => <span className="suave pequeno">{fecha(f.conexionEn ?? f.ultimoReporte)}</span>, ocultoMovil: true },
        ]}
      />
      <div className="panel" style={{ marginTop: 14 }}>
        <h3 style={{ marginTop: 0 }}>Para dar de alta a un cliente con MSeller</h3>
        <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
          <li>Crea su cuenta en MSeller con el plan que le corresponde (cada cliente tiene su propia cuenta y API key).</li>
          <li>En MSeller, sube el certificado digital del cliente y pide la autorización de su RNC ante la DGII.</li>
          <li>Asigna aquí el mismo plan en <b>Facturación electrónica</b>.</li>
          <li>En la administración del cliente: <b>Fiscal › Configuración › MSeller</b>. Pega el correo, la clave y la API key de MSeller, y pulsa «Probar conexión».</li>
          <li>Empieza en <b>Pruebas</b>; pasa a <b>Producción</b> cuando la DGII lo apruebe.</li>
        </ol>
        <p className="suave pequeno" style={{ marginBottom: 0 }}>La conexión se muestra aquí cuando el sistema del cliente renueva su licencia (cada vez que se conecta al portal). Nunca se envían claves al portal: solo el estado.</p>
      </div>
    </>
  );
}
