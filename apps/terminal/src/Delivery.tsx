import { useCallback, useEffect, useState } from "react";
import type { Cupon } from "@factpos/compartido";
import { api, rd, type Ajustes } from "./api";
import type { Usuario } from "./App";
import { Modal, type Cliente } from "./Venta";

interface Pedido {
  id: string; numero: string; canal: string; nombreCliente: string; telefono: string; direccion: string;
  referencia: string | null; estado: string; total: string | null; cargoEnvio: string; pagaCon: string | null;
  repartidor: string | null; minutos: string;
}
interface Repartidor { id: string; nombre: string; pedidosEnCalle: string; montoPendiente: string }

/** Tablero de delivery: tomar pedidos, despachar, marcar entregados y liquidar con el repartidor. */
export function PanelDelivery({ ajustes, usuario, cliente, cupon, items, total, onPedidoCreado, onCerrar }: {
  ajustes: Ajustes; usuario: Usuario; cliente: Cliente | null; cupon: Cupon | null;
  items: { presentacionId: string; cantidad: string; precioVariable?: string }[]; total: string;
  onPedidoCreado: () => void; onCerrar: () => void;
}) {
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [repartidores, setRepartidores] = useState<Repartidor[]>([]);
  const [vista, setVista] = useState<"tablero" | "nuevo">(items.length ? "nuevo" : "tablero");
  const [msg, setMsg] = useState("");

  const recargar = useCallback(async () => {
    try {
      const [p, r] = await Promise.all([
        api<Pedido[]>(ajustes.servidor, `/cajas/${ajustes.cajaId}/delivery/pedidos`),
        api<Repartidor[]>(ajustes.servidor, `/cajas/${ajustes.cajaId}/delivery/repartidores`),
      ]);
      setPedidos(p);
      setRepartidores(r);
    } catch (e) {
      setMsg((e as Error).message);
    }
  }, [ajustes]);
  useEffect(() => {
    recargar();
    const t = setInterval(recargar, 15000);
    return () => clearInterval(t);
  }, [recargar]);

  const accion = async (ruta: string, cuerpo: unknown) => {
    setMsg("");
    try {
      const r = await api(ajustes.servidor, ruta, { cuerpo });
      await recargar();
      return r;
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  return (
    <Modal titulo="Delivery" onCerrar={onCerrar} ancho>
      <div className="pestanas">
        <button className={vista === "tablero" ? "activa" : ""} onClick={() => setVista("tablero")}>Pedidos en curso ({pedidos.length})</button>
        <button className={vista === "nuevo" ? "activa" : ""} onClick={() => setVista("nuevo")} disabled={!items.length}>
          Nuevo pedido con el carrito {items.length ? `(${rd(total)})` : ""}
        </button>
      </div>
      {msg && <p className="error">{msg}</p>}

      {vista === "nuevo" ? (
        <NuevoPedido cliente={cliente} total={total} onGuardar={async (datos) => {
          const r = await accion(`/cajas/${ajustes.cajaId}/delivery/pedidos`, {
            ...datos, usuarioId: usuario.id, clienteId: cliente?.id, cuponCodigo: cupon?.codigo, items,
          });
          if (r) { onPedidoCreado(); setVista("tablero"); }
        }} />
      ) : (
        <>
          <div className="tablero">
            {pedidos.length === 0 && <p className="suave">No hay pedidos en curso.</p>}
            {pedidos.map((p) => (
              <div key={p.id} className={"pedido estado-" + p.estado.toLowerCase()}>
                <div className="pedido-cab">
                  <b>#{p.numero} · {p.nombreCliente}</b>
                  <span className="pastilla">{p.estado}</span>
                </div>
                <div className="suave">{p.telefono} · {p.canal} · hace {p.minutos} min</div>
                <div>{p.direccion}{p.referencia ? ` — ${p.referencia}` : ""}</div>
                {p.total && <div>Total {rd(p.total)}{p.pagaCon ? ` · paga con ${rd(p.pagaCon)}` : ""}{p.repartidor ? ` · ${p.repartidor}` : ""}</div>}
                <div className="pedido-acciones">
                  {p.estado === "RECIBIDO" && (
                    <>
                      <select defaultValue="" onChange={async (e) => {
                        if (!e.target.value) return;
                        const r: any = await accion(`/delivery/pedidos/${p.id}/despachar`, { usuarioId: usuario.id, repartidorId: e.target.value });
                        if (r && Number(r.llevarCambio) > 0) setMsg(`Pedido #${r.pedido} despachado: llevar cambio de ${rd(r.llevarCambio)}`);
                      }}>
                        <option value="">Despachar con…</option>
                        {repartidores.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
                      </select>
                      <button className="enlace" onClick={() => {
                        const motivo = prompt("Motivo de la cancelación");
                        if (motivo) accion(`/delivery/pedidos/${p.id}/cancelar`, { motivo });
                      }}>Cancelar</button>
                    </>
                  )}
                  {p.estado === "DESPACHADO" && <button className="boton fantasma" onClick={() => accion(`/delivery/pedidos/${p.id}/entregar`, {})}>Marcar entregado</button>}
                </div>
              </div>
            ))}
          </div>

          <h4>Liquidar con repartidor</h4>
          <div className="repartidores">
            {repartidores.map((r) => (
              <Liquidar key={r.id} r={r} pedidos={pedidos.filter((p) => p.repartidor === r.nombre && ["DESPACHADO", "ENTREGADO"].includes(p.estado))}
                onLiquidar={(ids, monto) => accion(`/cajas/${ajustes.cajaId}/delivery/liquidar`, {
                  usuarioId: usuario.id, repartidorId: r.id, pedidos: ids, montoEntregado: monto,
                }).then((x: any) => x && setMsg(`Liquidado ${rd(x.entregado)}${Number(x.diferencia) !== 0 ? ` (diferencia ${rd(x.diferencia)})` : ""}`))} />
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}

function NuevoPedido({ cliente, total, onGuardar }: {
  cliente: Cliente | null; total: string; onGuardar: (d: Record<string, string | undefined>) => void;
}) {
  const [d, setD] = useState({
    nombreCliente: cliente?.nombre ?? "", telefono: cliente?.telefono ?? "", direccion: "", referencia: "",
    canal: "TELEFONO", pagaCon: "", nota: "",
  });
  const set = (k: keyof typeof d) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setD({ ...d, [k]: e.target.value });
  const valido = d.nombreCliente.trim().length >= 2 && d.telefono.trim().length >= 7 && d.direccion.trim().length >= 5;
  return (
    <div className="formulario">
      <div className="dos-columnas">
        <label className="campo"><span>Cliente</span><input autoFocus value={d.nombreCliente} onChange={set("nombreCliente")} /></label>
        <label className="campo"><span>Teléfono</span><input value={d.telefono} onChange={set("telefono")} /></label>
      </div>
      <label className="campo"><span>Dirección</span><input value={d.direccion} onChange={set("direccion")} /></label>
      <label className="campo"><span>Referencia</span><input value={d.referencia} onChange={set("referencia")} placeholder="Ej. frente al parque, casa verde" /></label>
      <div className="dos-columnas">
        <label className="campo"><span>Canal</span>
          <select value={d.canal} onChange={set("canal")}>
            <option value="TELEFONO">Teléfono</option><option value="WHATSAPP">WhatsApp</option><option value="OTRO">Otro</option>
          </select>
        </label>
        <label className="campo"><span>Paga con (para llevar cambio)</span><input inputMode="decimal" value={d.pagaCon} onChange={set("pagaCon")} placeholder="Ej. 2000" /></label>
      </div>
      <p className="suave">Productos: {rd(total)} + cargo de envío (se suma al despachar)</p>
      <button className="boton primario ancho" disabled={!valido}
        onClick={() => onGuardar({ ...d, pagaCon: d.pagaCon || undefined, referencia: d.referencia || undefined, nota: d.nota || undefined })}>
        Registrar pedido
      </button>
    </div>
  );
}

function Liquidar({ r, pedidos, onLiquidar }: { r: Repartidor; pedidos: Pedido[]; onLiquidar: (ids: string[], monto: string) => void }) {
  const esperado = pedidos.reduce((a, p) => a + Number(p.total ?? 0), 0);
  const [monto, setMonto] = useState("");
  return (
    <div className="repartidor">
      <b>{r.nombre}</b>
      <span className="suave">{pedidos.length} pedido(s) · debe {rd(esperado)}</span>
      {pedidos.length > 0 && (
        <div className="fila-liquidar">
          <input inputMode="decimal" placeholder={esperado.toFixed(2)} value={monto} onChange={(e) => setMonto(e.target.value.replace(/[^\d.]/g, ""))} />
          <button className="boton primario" onClick={() => onLiquidar(pedidos.map((p) => p.id), monto || esperado.toFixed(2))}>Liquidar</button>
        </div>
      )}
    </div>
  );
}
