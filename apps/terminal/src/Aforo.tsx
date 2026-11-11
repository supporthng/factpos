import { useCallback, useEffect, useState } from "react";
import { api, type Ajustes } from "./api";
import { Modal } from "./Venta";
import { PinSupervisor } from "./Operaciones";

/** Entradas y aforo (bar o discoteca): cuántas personas hay dentro. Solo existe si la empresa lo activó. */
export interface EstadoAforo { maximo: number | null; desde: string; pagadas: number; sinCobro: number; entradas: number; salidas: number; dentro: number; sinCategoria: boolean }

/** El contador de la caja: se refresca solo cada 15 segundos. */
export function useAforo(ajustes: Ajustes, activo: boolean) {
  const [a, setA] = useState<EstadoAforo | null>(null);
  const cargar = useCallback(async () => {
    if (!activo) return;
    try { setA(await api<EstadoAforo>(ajustes.servidor, `/cajas/${ajustes.cajaId}/aforo`)); } catch { /* sin servidor: se queda el último dato */ }
  }, [ajustes.servidor, ajustes.cajaId, activo]);
  useEffect(() => {
    if (!activo) return;
    void cargar();
    const t = window.setInterval(() => void cargar(), 15000);
    return () => window.clearInterval(t);
  }, [cargar, activo]);
  return { aforo: a, recargar: cargar, poner: setA };
}

export const etiquetaAforo = (a: EstadoAforo | null) => (a ? `Aforo ${a.dentro}${a.maximo ? ` / ${a.maximo}` : ""}` : "Aforo");
export const aforoLleno = (a: EstadoAforo | null) => !!a && !!a.maximo && a.dentro >= a.maximo;

export function Aforo({ ajustes, aforo, onCambio, onCerrar }: { ajustes: Ajustes; aforo: EstadoAforo | null; onCambio: (a: EstadoAforo) => void; onCerrar: () => void }) {
  const [cantidad, setCantidad] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [reiniciando, setReiniciando] = useState(false);
  const n = Math.max(1, Math.min(500, Number(cantidad) || 1));
  const evento = async (tipo: "SALIDA" | "ENTRADA_SIN_COBRO" | "REINICIO", extra: Record<string, unknown> = {}) => {
    try { onCambio(await api<EstadoAforo>(ajustes.servidor, `/cajas/${ajustes.cajaId}/aforo/evento`, { cuerpo: { tipo, cantidad: n, ...extra } })); setError(null); setCantidad("1"); }
    catch (e) { setError((e as Error).message); }
  };
  if (reiniciando) {
    return (
      <Modal titulo="Nueva noche" onCerrar={() => setReiniciando(false)}>
        <p>El contador vuelve a 0 y empieza una noche nueva. Hágalo al cerrar el local. Requiere un supervisor.</p>
        <PinSupervisor ajustes={ajustes} permiso="venta.anular" textoBoton="Autorizar y reiniciar" enfocar
          onAprobado={(a) => { setReiniciando(false); void evento("REINICIO", { autorizacion: a.token }); }} />
      </Modal>
    );
  }
  const lleno = aforoLleno(aforo);
  return (
    <Modal titulo="Entradas y aforo" onCerrar={onCerrar}>
      {error && <p className="error">{error}</p>}
      {aforo?.sinCategoria && <p className="error">Falta elegir la categoría de las entradas (Administración › Datos de la empresa), por eso las entradas cobradas no se cuentan.</p>}
      <div className="cobro-total" style={lleno ? { color: "var(--error)" } : undefined}>
        <span>Dentro{aforo?.maximo ? ` (máximo ${aforo.maximo})` : ""}</span><b>{aforo ? aforo.dentro : "…"}</b>
      </div>
      {lleno && <p className="error">Se llegó al aforo máximo.</p>}
      {aforo && <p className="suave">Entradas cobradas {aforo.pagadas} · sin cobro {aforo.sinCobro} · salidas {aforo.salidas}</p>}
      <label>Cantidad de personas<input inputMode="numeric" value={cantidad} onChange={(e) => setCantidad(e.target.value.replace(/\D/g, "").slice(0, 3))} /></label>
      <div className="pv-atajos pv-atajos-min" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
        <button onClick={() => void evento("SALIDA")}>− Salen {n}</button>
        <button onClick={() => void evento("ENTRADA_SIN_COBRO")}>+ Entran {n} sin cobro</button>
      </div>
      <p className="suave" style={{ marginTop: 10 }}>Las entradas que se cobran en la caja se cuentan solas. «Sin cobro» es para la lista, los invitados o el personal.</p>
      <button className="enlace" onClick={() => setReiniciando(true)}>Nueva noche (reiniciar el contador)</button>
    </Modal>
  );
}
