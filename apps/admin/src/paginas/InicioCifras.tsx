import { useState } from "react";
import { num, puede, rd } from "../api";
import { useDatos } from "../ui";

interface FilaSucursal { venta_hoy: string; transacciones_hoy: string; productos_bajo_minimo: string }
type Periodo = "hoy" | "ayer" | "semana" | "semanaPasada" | "mes";
const PERIODOS: { id: Periodo; texto: string; titulo: string; anterior: string }[] = [
  { id: "hoy", texto: "Hoy", titulo: "Venta de hoy", anterior: "Ayer" },
  { id: "ayer", texto: "Ayer", titulo: "Venta de ayer", anterior: "Antier" },
  { id: "semana", texto: "Esta semana", titulo: "Venta de esta semana", anterior: "Misma fecha de la semana pasada" },
  { id: "semanaPasada", texto: "Semana pasada", titulo: "Venta de la semana pasada", anterior: "La semana anterior" },
  { id: "mes", texto: "Este mes", titulo: "Venta de este mes", anterior: "Mes anterior (igual tramo)" },
];
const leerPeriodo = (): Periodo => { try { const v = localStorage.getItem("factpos.inicio.periodo"); return PERIODOS.some((p) => p.id === v) ? (v as Periodo) : "hoy"; } catch { return "hoy"; } };
interface DatosPeriodo { venta: string; transacciones: string; ventaAnterior: string }
interface Atencion { ayer: string; certificado: { vence: string | null } }
interface EstadoActualizacion { actual: string; disponible: string | null; hayNueva: boolean }

/** Franja de cifras del día en el inicio. Se oculta sola si el usuario no tiene permiso de reportes o si falla la consulta. */
export function InicioCifras({ irA }: { irA: (seccion: string) => void }) {
  const conPermiso = puede("admin.reportes");
  const suc = useDatos<FilaSucursal[]>(conPermiso ? "/central/sucursales" : null);
  const [periodo, setPeriodo] = useState<Periodo>(leerPeriodo());
  const per = useDatos<DatosPeriodo>(conPermiso ? `/central/resumen/periodo?periodo=${periodo}` : null);
  if (!conPermiso || suc.error || !suc.datos) return null;
  const p = PERIODOS.find((x) => x.id === periodo)!;
  const filas = suc.datos;
  const suma = (k: keyof FilaSucursal) => filas.reduce((a, f) => a + Number(f[k]), 0);
  const bajo = suma("productos_bajo_minimo");
  // Mientras llega el periodo elegido, "hoy" ya se conoce por el resumen de sucursales
  const venta = per.datos ? Number(per.datos.venta) : periodo === "hoy" ? suma("venta_hoy") : 0;
  const trans = per.datos ? Number(per.datos.transacciones) : periodo === "hoy" ? suma("transacciones_hoy") : 0;
  const antes = per.datos ? Number(per.datos.ventaAnterior) : null;
  const cambio = antes ? ((venta - antes) / antes) * 100 : null;
  return (
    <div className="cifras">
      <div className="cifras-filtro" role="group" aria-label="Periodo">
        {PERIODOS.map((x) => (
          <button key={x.id} type="button" className={"chip-periodo" + (x.id === periodo ? " activo" : "")} aria-pressed={x.id === periodo}
            onClick={() => { setPeriodo(x.id); try { localStorage.setItem("factpos.inicio.periodo", x.id); } catch { /* sin almacenamiento */ } }}>{x.texto}</button>
        ))}
      </div>
      <div className="cifra">
        <span className="suave">{p.titulo}</span>
        <b>{rd(venta)}</b>
        <small className="suave">{antes == null ? " " : `${p.anterior}: ${rd(antes)}`}{cambio != null && <> · <span className={cambio < 0 ? "texto-alerta" : "texto-ok"}>{cambio >= 0 ? "▲" : "▼"} {Math.abs(cambio).toFixed(0)} %</span></>}</small>
      </div>
      <div className="cifra">
        <span className="suave">Ventas realizadas</span>
        <b>{num(trans)}</b>
        <small className="suave">Ticket promedio {rd(trans ? venta / trans : 0)}</small>
      </div>
      <div className="cifra">
        <span className="suave">Productos por reponer</span>
        <b>{num(bajo)}</b>
        <small className="suave">Por debajo del mínimo</small>
      </div>
      <button type="button" className="cifra cifra-enlace" onClick={() => irA("resumen")}>
        <span className="suave">Alertas y pendientes</span>
        <b>Ver resumen</b>
        <small className="suave">Cierres, DGII y existencias ›</small>
      </button>
    </div>
  );
}

/** Tarjeta de estado del servidor para el inicio: versión y certificado fiscal. */
export function EstadoSistema() {
  const act = useDatos<EstadoActualizacion>(puede("admin.config") ? "/central/actualizacion" : null);
  const at = useDatos<Atencion>(puede("admin.reportes") ? "/central/resumen/atencion" : null);
  if (!act.datos && !at.datos) return null;
  const vence = at.datos?.certificado.vence;
  return (
    <section className="mosaico estado-sistema" aria-label="Estado del sistema">
      <h2>Estado del sistema</h2>
      <dl>
        <div><dt>Servidor</dt><dd><i className="punto-ok" aria-hidden="true" />En línea</dd></div>
        {act.datos && <div><dt>Versión</dt><dd>{act.datos.actual}{act.datos.hayNueva && act.datos.disponible ? ` · nueva ${act.datos.disponible}` : ""}</dd></div>}
        {at.datos && <div><dt>Certificado e-CF</dt><dd className={vence ? "" : "aviso-texto"}>{vence ? `Vence ${new Date(vence).toLocaleDateString("es-DO")}` : "De prueba"}</dd></div>}
      </dl>
    </section>
  );
}
