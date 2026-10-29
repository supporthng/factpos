import { useEffect, useState } from "react";
import { api, rd, num } from "../api";
import { Aviso, Encabezado, Tabla, useCatalogo, useDatos } from "../ui";

/** Activar o desactivar el delivery por sucursal, cargo de envío y repartidores. */
export function Delivery() {
  const { sucursales } = useCatalogo();
  const reporte = useDatos<any[]>("/central/reportes/delivery");
  return (
    <>
      <Encabezado titulo="Delivery" descripcion="Módulo opcional: se activa por sucursal. Si está apagado, la terminal no muestra el botón de delivery." />
      <div className="tarjetas-sucursal">
        {sucursales.map((s) => <ConfigSucursal key={s.id} sucursalId={s.id} nombre={s.nombre} />)}
      </div>
      <h2>Desempeño</h2>
      <Tabla
        filas={reporte.datos ?? []}
        clave={(f, i) => String(i)}
        vacio="Todavía no hay pedidos"
        columnas={[
          { titulo: "Fecha", valor: (f) => f.fecha },
          { titulo: "Sucursal", valor: (f) => sucursales.find((s) => s.id === f.sucursal_id)?.nombre ?? "" },
          { titulo: "Repartidor", valor: (f) => f.repartidor ?? "Sin asignar" },
          { titulo: "Pedidos", valor: (f) => num(f.pedidos), der: true },
          { titulo: "Cancelados", valor: (f) => num(f.cancelados), der: true },
          { titulo: "Venta", valor: (f) => rd(f.venta), der: true },
          { titulo: "Min. promedio", valor: (f) => f.minutos_promedio_entrega ?? "—", der: true },
        ]}
      />
    </>
  );
}

function ConfigSucursal({ sucursalId, nombre }: { sucursalId: string; nombre: string }) {
  const { productos } = useCatalogo();
  const [cfg, setCfg] = useState<any>(null);
  const reps = useDatos<any[]>(`/central/sucursales/${sucursalId}/repartidores`);
  const [nuevo, setNuevo] = useState("");
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" } | null>(null);
  useEffect(() => {
    api(`/central/sucursales/${sucursalId}/modulos`).then((m) => setCfg(m.delivery));
  }, [sucursalId]);
  if (!cfg) return <div className="tarjeta"><p className="suave">Cargando…</p></div>;

  // Producto de servicio "Cargo de envío": cualquier producto cuyo nombre lo indique
  const envios = productos.filter((p) => /env[ií]o|delivery/i.test(p.nombre));

  const guardar = async (cambio: any) => {
    const d = { ...cfg, ...cambio };
    try {
      const r = await api(`/central/sucursales/${sucursalId}/modulos`, {
        metodo: "PUT",
        cuerpo: { delivery: { activo: d.activo, cargoEnvio: d.cargoEnvio || undefined, productoEnvioId: d.productoEnvioId || undefined, tiempoEstimadoMin: d.tiempoEstimadoMin ? Number(d.tiempoEstimadoMin) : undefined } },
      });
      setCfg(r.delivery);
      setMsg({ t: "Guardado", tipo: "ok" });
    } catch (e) {
      setMsg({ t: (e as Error).message, tipo: "error" });
    }
  };
  const agregar = async () => {
    if (nuevo.trim().length < 2) return;
    await api(`/central/sucursales/${sucursalId}/repartidores`, { cuerpo: { nombre: nuevo.trim() } });
    setNuevo("");
    reps.recargar();
  };

  return (
    <div className={"tarjeta" + (cfg.activo ? " activa" : "")}>
      <div className="encabezado-sub">
        <h3>{nombre}</h3>
        <label className="interruptor">
          <input type="checkbox" checked={!!cfg.activo} onChange={(e) => guardar({ activo: e.target.checked })} />
          <span>{cfg.activo ? "Activo" : "Apagado"}</span>
        </label>
      </div>
      {cfg.activo && (
        <>
          <div className="dos-col">
            <label className="campo"><span>Cargo de envío</span>
              <input inputMode="decimal" defaultValue={cfg.cargoEnvio ?? ""} onBlur={(e) => e.target.value !== (cfg.cargoEnvio ?? "") && guardar({ cargoEnvio: e.target.value })} />
            </label>
            <label className="campo"><span>Tiempo estimado (min)</span>
              <input inputMode="numeric" defaultValue={cfg.tiempoEstimadoMin ?? ""} onBlur={(e) => guardar({ tiempoEstimadoMin: e.target.value })} />
            </label>
          </div>
          <label className="campo"><span>Producto que factura el envío</span>
            <select value={cfg.productoEnvioId ? productos.flatMap((p) => p.presentaciones).find((x) => x.id === cfg.productoEnvioId)?.id ?? "" : ""}
              onChange={(e) => guardar({ productoEnvioId: e.target.value })}>
              <option value="">— Elegir —</option>
              {envios.flatMap((p) => p.presentaciones.map((x) => <option key={x.id} value={x.id}>{p.nombre} · {x.nombre}</option>))}
            </select>
          </label>
          <h4>Repartidores</h4>
          {(reps.datos ?? []).map((r) => (
            <div key={r.id} className="dato">
              <span className={r.activo ? "" : "suave tachado"}>{r.nombre}{Number(r.monto_pendiente) > 0 && <em className="texto-alerta"> · debe {rd(r.monto_pendiente)}</em>}</span>
              <button className="enlace" onClick={async () => { await api(`/central/repartidores/${r.id}`, { metodo: "PATCH", cuerpo: { activo: !r.activo } }); reps.recargar(); }}>
                {r.activo ? "Desactivar" : "Activar"}
              </button>
            </div>
          ))}
          <div className="fila-acciones">
            <input placeholder="Nombre del repartidor" value={nuevo} onChange={(e) => setNuevo(e.target.value)} onKeyDown={(e) => e.key === "Enter" && agregar()} />
            <button className="boton" onClick={agregar}>Agregar</button>
          </div>
        </>
      )}
      {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}
    </div>
  );
}
