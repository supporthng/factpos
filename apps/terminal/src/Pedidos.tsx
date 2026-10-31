import { useCallback, useEffect, useState } from "react";
import { api, type Ajustes } from "./api";
import { Modal } from "./Venta";

/**
 * Pedidos de clientes (venta al por mayor) que la oficina envió a esta caja como comanda.
 * Se van alistando (con quien los prepara) y, cuando están completos, se facturan como una venta normal.
 */
export interface PedidoResumen {
  id: string; numero: string; clienteNombre: string; telefono: string | null; caja: string | null; estado: "PENDIENTE" | "LISTO";
  lineas: number; alistadas: number; nota: string | null; preparadoPor: string | null; creadoEn: string;
}
export interface PedidoItem { id: string; presentacionId: string; producto: string; presentacion: string; cantidad: string; nota: string | null; alistado: boolean }
export interface PedidoDetalle extends PedidoResumen { clienteId: string | null; items: PedidoItem[] }

const hora = (iso: string) => new Date(iso).toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export function PanelPedidos({ ajustes, onFacturar, onCerrar }: { ajustes: Ajustes; onFacturar: (p: PedidoDetalle) => void; onCerrar: () => void }) {
  const [lista, setLista] = useState<PedidoResumen[]>([]);
  const [abierto, setAbierto] = useState<PedidoDetalle | null>(null);
  const [msg, setMsg] = useState("");
  const ruta = `/cajas/${ajustes.cajaId}/pedidos`;

  const recargar = useCallback(async () => {
    try {
      setLista(await api<PedidoResumen[]>(ajustes.servidor, ruta));
      setAbierto((a) => a);
    } catch (e) { setMsg((e as Error).message); }
  }, [ajustes, ruta]);
  useEffect(() => { recargar(); const t = setInterval(recargar, 10000); return () => clearInterval(t); }, [recargar]);

  const abrir = async (id: string) => {
    setMsg("");
    try { setAbierto(await api<PedidoDetalle>(ajustes.servidor, `${ruta}/${id}`)); } catch (e) { setMsg((e as Error).message); }
  };
  const alistar = async (cuerpo: { itemId?: string; todos?: boolean; alistado?: boolean; preparadoPor?: string }) => {
    if (!abierto) return;
    setMsg("");
    try {
      setAbierto(await api<PedidoDetalle>(ajustes.servidor, `${ruta}/${abierto.id}/alistar`, { cuerpo }));
      recargar();
    } catch (e) { setMsg((e as Error).message); }
  };

  if (abierto) {
    const completo = abierto.items.every((i) => i.alistado);
    return (
      <Modal titulo={`Pedido ${abierto.numero}`} onCerrar={onCerrar}>
        <p><b>{abierto.clienteNombre}</b>{abierto.telefono && ` · ${abierto.telefono}`}<br />
          <span className="suave">{abierto.caja ?? "Cualquier caja"} · {hora(abierto.creadoEn)}</span></p>
        {abierto.nota && <p className="nota">{abierto.nota}</p>}
        <label className="campo"><span>Lo prepara</span>
          <input defaultValue={abierto.preparadoPor ?? ""} placeholder="Nombre del personal" onBlur={(e) => e.target.value.trim() !== (abierto.preparadoPor ?? "") && alistar({ preparadoPor: e.target.value.trim() })} />
        </label>
        <div className="tabla-contenedor"><table className="tabla"><thead><tr><th>Alistado</th><th>Producto</th><th className="der">Cantidad</th></tr></thead><tbody>
          {abierto.items.map((i) => (
            <tr key={i.id} style={i.alistado ? { opacity: 0.6 } : undefined}>
              <td><input type="checkbox" checked={i.alistado} style={{ width: 24, height: 24 }} onChange={(e) => alistar({ itemId: i.id, alistado: e.target.checked })} /></td>
              <td>{i.producto} <span className="suave">{i.presentacion}</span>{i.nota && <div className="suave">{i.nota}</div>}</td>
              <td className="der"><b>{Number(i.cantidad)}</b></td>
            </tr>
          ))}
        </tbody></table></div>
        {msg && <p className="error">{msg}</p>}
        <div className="fila-acciones">
          <button className="boton" onClick={() => { setAbierto(null); recargar(); }}>← Pedidos</button>
          <button className="boton" onClick={() => alistar({ todos: true, alistado: !completo })}>{completo ? "Desmarcar todo" : "Marcar todo como alistado"}</button>
          <span className="flex" />
          <button className="boton primario" disabled={!completo} title={completo ? "" : "Alistar todo el pedido para poder facturarlo"} onClick={() => onFacturar(abierto)}>Facturar pedido</button>
        </div>
        {!completo && <p className="suave">Cuando todo esté alistado se puede facturar.</p>}
      </Modal>
    );
  }
  return (
    <Modal titulo="Pedidos de clientes" onCerrar={onCerrar}>
      {msg && <p className="error">{msg}</p>}
      {!lista.length && <p className="suave">No hay pedidos pendientes para esta caja.</p>}
      <div className="lista-opciones">
        {lista.map((p) => (
          <button key={p.id} className="opcion" onClick={() => abrir(p.id)}>
            <b>{p.numero} · {p.clienteNombre}</b>
            <span className="suave">{p.estado === "LISTO" ? "✓ Listo para facturar" : `Alistado ${p.alistadas} de ${p.lineas}`} · {hora(p.creadoEn)}{p.preparadoPor ? ` · ${p.preparadoPor}` : ""}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
