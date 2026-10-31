import { num, puede, rd } from "../api";
import { useDatos } from "../ui";

interface FilaSucursal { venta_hoy: string; transacciones_hoy: string; productos_bajo_minimo: string }
interface Atencion { ayer: string; certificado: { vence: string | null } }
interface EstadoActualizacion { actual: string; disponible: string | null; hayNueva: boolean }

/** Franja de cifras del día en el inicio. Se oculta sola si el usuario no tiene permiso de reportes o si falla la consulta. */
export function InicioCifras({ irA }: { irA: (seccion: string) => void }) {
  const conPermiso = puede("admin.reportes");
  const suc = useDatos<FilaSucursal[]>(conPermiso ? "/central/sucursales" : null);
  const at = useDatos<Atencion>(conPermiso ? "/central/resumen/atencion" : null);
  if (!conPermiso || suc.error || !suc.datos) return null;
  const filas = suc.datos;
  const suma = (k: keyof FilaSucursal) => filas.reduce((a, f) => a + Number(f[k]), 0);
  const venta = suma("venta_hoy"), trans = suma("transacciones_hoy"), bajo = suma("productos_bajo_minimo");
  return (
    <div className="cifras">
      <div className="cifra">
        <span className="suave">Venta de hoy</span>
        <b>{rd(venta)}</b>
        <small className="suave">{at.datos ? `Ayer: ${rd(at.datos.ayer)}` : " "}</small>
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
