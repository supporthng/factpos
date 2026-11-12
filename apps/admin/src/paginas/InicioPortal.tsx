import { useDatos } from "../ui";
import { Icono, type NombreIcono } from "../Iconos";

interface ClienteResumen { id: string; nombre: string; activo: boolean; estadoLicencia: "ACTIVA" | "SUSPENDIDA" | null; estado: "VIGENTE" | "POR_VENCER" | "GRACIA" | "VENCIDA" | null; vence: string | null; activada: boolean }
interface SolicitudResumen { id: string; empresa: string | null; equipo: string | null; solicitadaEn: string }
export interface AccesoPortal { id: string; titulo: string; i: NombreIcono; texto: string }

const ESTADO: Record<string, { t: string; c: string }> = {
  POR_VENCER: { t: "Por vencer", c: "aviso" }, GRACIA: { t: "En gracia", c: "alerta" }, VENCIDA: { t: "Vencida", c: "alerta" },
};
const rd = (v: number) => `RD$ ${v.toLocaleString("es-DO", { maximumFractionDigits: 0 })}`;
const fecha = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("es-DO", { day: "numeric", month: "short", year: "numeric" });

/**
 * Inicio del portal del proveedor: cifras del negocio, lo que necesita atención hoy y accesos a cada sección.
 * Usa los mismos datos que «Clientes y licencias»; si alguno no carga, esa parte simplemente no se muestra.
 */
export function InicioPortal({ accesos, irA }: { accesos: AccesoPortal[]; irA: (id: string) => void }) {
  const clientes = useDatos<ClienteResumen[]>("/central/portal/clientes");
  const pendientes = useDatos<SolicitudResumen[]>("/central/portal/instalaciones?estado=PENDIENTE");
  const cobros = useDatos<{ cobrado: number; renovaciones: number; anterior: number; porVencer: number }>("/central/portal/cobros-mes");
  const lista = clientes.datos ?? [];
  const activos = lista.filter((c) => c.activo && c.estadoLicencia !== "SUSPENDIDA");
  const atencion = lista.filter((c) => c.activo && (c.estado === "VENCIDA" || c.estado === "GRACIA" || c.estado === "POR_VENCER"));
  const sinActivar = lista.filter((c) => c.activo && !c.activada).length;
  const solicitudes = pendientes.datos ?? [];
  const n = (v: number | null) => (v == null ? "—" : String(v));
  const cifras = [
    { t: "Clientes activos", v: clientes.datos ? activos.length : null, c: "#1d4ed8", ir: "clientes" },
    { t: "Solicitudes por revisar", v: pendientes.datos ? solicitudes.length : null, c: "#b45309", ir: "clientes" },
    { t: "Licencias que requieren atención", v: clientes.datos ? atencion.length : null, c: "#b91c1c", ir: "clientes" },
    { t: "Sin activar", v: clientes.datos ? sinActivar : null, c: "#4f46e5", ir: "clientes" },
  ];
  return (
    <div className="inicio-portal">
      <div className="ip-cifras">
        {cifras.map((c) => (
          <button key={c.t} className="ip-cifra" style={{ "--c": c.c } as React.CSSProperties} onClick={() => irA(c.ir)}>
            <b>{n(c.v)}</b><span>{c.t}</span>
          </button>
        ))}
      </div>

      {cobros.datos && (
        <div className="ip-cifras ip-cobros">
          <div className="ip-cifra" style={{ "--c": "#1d4ed8" } as React.CSSProperties}><b>{rd(cobros.datos.cobrado)}</b><span>Cobrado este mes ({cobros.datos.renovaciones} renovación{cobros.datos.renovaciones === 1 ? "" : "es"})</span></div>
          <div className="ip-cifra" style={{ "--c": "#4f46e5" } as React.CSSProperties}><b>{rd(cobros.datos.anterior)}</b><span>Cobrado el mes pasado</span></div>
          <div className="ip-cifra" style={{ "--c": "#b45309" } as React.CSSProperties}><b>{cobros.datos.porVencer}</b><span>Licencias que vencen en 30 días</span></div>
        </div>
      )}

      <div className="ip-cuerpo">
        <section className="ip-panel">
          <h2 className="titulo-seccion">Requiere atención</h2>
          {solicitudes.slice(0, 4).map((s) => (
            <button key={s.id} className="ip-fila" onClick={() => irA("clientes")}>
              <span className="ip-punto" style={{ background: "#b45309" }} />
              <span className="ip-fila-texto"><b>{s.empresa || s.equipo || "Sin nombre"}</b><small>Pide activación</small></span>
              <span className="pastilla aviso">Nueva</span>
            </button>
          ))}
          {atencion.slice(0, 6).map((c) => (
            <button key={c.id} className="ip-fila" onClick={() => irA("clientes")}>
              <span className="ip-punto" style={{ background: c.estado === "POR_VENCER" ? "#b45309" : "#b91c1c" }} />
              <span className="ip-fila-texto"><b>{c.nombre}</b><small>{c.vence ? `Vence ${fecha(c.vence)}` : "Licencia"}</small></span>
              <span className={`pastilla ${ESTADO[c.estado!]!.c}`}>{ESTADO[c.estado!]!.t}</span>
            </button>
          ))}
          {clientes.datos && pendientes.datos && !solicitudes.length && !atencion.length && <p className="suave ip-vacio">Todo en orden: no hay solicitudes ni licencias por atender.</p>}
          {(!clientes.datos || !pendientes.datos) && <p className="suave ip-vacio">Cargando…</p>}
        </section>

        <section className="ip-panel">
          <h2 className="titulo-seccion">Accesos</h2>
          <div className="ip-accesos">
            {accesos.map((a, k) => (
              <button key={a.id} className="ip-acceso" style={{ "--c": ["#1d4ed8", "#4f46e5", "#b45309", "#0369a1", "#be185d"][k % 5] } as React.CSSProperties} onClick={() => irA(a.id)}>
                <span className="mosaico-icono"><Icono n={a.i} tamano={22} /></span>
                <span className="mosaico-texto"><b>{a.titulo}</b><small>{a.texto}</small></span>
                <span className="mosaico-flecha" aria-hidden="true">›</span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
