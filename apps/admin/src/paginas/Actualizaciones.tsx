import { useState } from "react";
import { api, puede } from "../api";
import { Aviso, Encabezado, Kpi, useDatos } from "../ui";

/** Versión instalada de FactPOS y actualización con un clic (servidor principal o de sucursal). */
interface Estado {
  actual: string; disponible: string | null; notas: string | null; publicada: string | null; hayNueva: boolean; puedeInstalar: boolean; modo: string; licenciaActiva?: boolean; pruebaActualiza?: boolean;
  proceso: { estado: "DESCARGANDO" | "INSTALANDO" | "ERROR"; version: string; mensaje: string | null; desde: string } | null;
}

export function Actualizaciones() {
  const [ruta, setRuta] = useState("/central/actualizacion");
  const { datos: d, error, recargar } = useDatos<Estado>(ruta);
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" | "info" } | null>(null);
  const [trabajando, setTrabajando] = useState(false);

  const instalar = async () => {
    if (!confirm(`¿Instalar FactPOS ${d?.disponible}? El servidor se reinicia (1 a 3 minutos). Las cajas siguen vendiendo mientras tanto.`)) return;
    setTrabajando(true); setMsg(null);
    try {
      await api("/central/actualizacion/instalar", { cuerpo: {} });
      setMsg({ t: "Instalando… el servidor se reinicia. Recargue esta página en 2 minutos.", tipo: "info" });
    } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
    finally { setTrabajando(false); }
  };

  const sinPermiso = d ? d.licenciaActiva === false && !d.pruebaActualiza : false;
  return (
    <>
      <Encabezado titulo="Actualizaciones" descripcion="Versión de FactPOS de este servidor. Las cajas y la administración web se actualizan solas con él; las sucursales siguen al servidor principal.">
        <button className="boton" onClick={() => { setRuta(`/central/actualizacion?revisar=1&t=${Date.now()}`); recargar(); }}>Buscar ahora</button>
      </Encabezado>
      <Aviso texto={error} />
      {d && (
        <>
          <div className="kpis">
            <Kpi titulo="Versión instalada" valor={d.actual} />
            <Kpi titulo="Última publicada" valor={d.disponible ?? "—"} tono={d.hayNueva ? "alerta" : "ok"}
              detalle={d.publicada ? new Date(d.publicada).toLocaleDateString("es-DO", { day: "numeric", month: "long", year: "numeric" }) : "No se pudo consultar la versión publicada"} />
          </div>
          {d.proceso && (
            <Aviso tipo={d.proceso.estado === "ERROR" ? "error" : "info"}
              texto={d.proceso.estado === "ERROR" ? `La actualización a ${d.proceso.version} falló: ${d.proceso.mensaje}` : `Actualizando a ${d.proceso.version}…`} />
          )}
          {d.hayNueva ? (
            <div className="panel">
              <h3 style={{ marginTop: 0 }}>Hay una versión nueva: {d.disponible}</h3>
              {d.notas && <pre className="notas-version">{d.notas}</pre>}
              {d.puedeInstalar
                ? <button className="boton primario" disabled={trabajando || !puede("*") || sinPermiso} onClick={instalar}>{trabajando ? "Preparando…" : `Instalar ${d.disponible}`}</button>
                : <p className="suave">Esta instalación se actualiza desde su proveedor.</p>}
              {!puede("*") && <p className="suave pequeno">Solo un administrador puede instalarla.</p>}
              {d.puedeInstalar && sinPermiso && (
                <p className="suave pequeno">Las actualizaciones desde aquí requieren la licencia activa (durante la versión de prueba no están disponibles). <a href="#licencia">Activar licencia</a></p>
              )}
              {d.modo === "central" && <p className="suave pequeno">Después, cada sucursal se actualiza sola en un momento sin ventas.</p>}
            </div>
          ) : d.disponible ? (
            <p className="suave">Tiene la versión más reciente publicada.</p>
          ) : (
            <Aviso tipo="info" texto="No se ha podido verificar si hay actualizaciones. Compruebe la conexión del servidor con el portal y que exista una publicación de instalador completada en GitHub Releases." />
          )}
          {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}
        </>
      )}
    </>
  );
}
