import { useEffect, useState } from "react";
import { api, rd, type Ajustes } from "./api";
import type { Usuario } from "./App";
import { Modal } from "./Venta";
import type { VentaRegistrada } from "./Ticket";

export type Permiso = "venta.descuento" | "venta.anular" | "venta.corregir" | "cliente.precio" | "caja.retiro" | "caja.gasto";
export interface Aprobacion { token: string; supervisor: string }

/** Campo de PIN del supervisor. Devuelve la aprobación firmada por el servidor. */
export function PinSupervisor({ ajustes, permiso, onAprobado, textoBoton }: {
  ajustes: Ajustes; permiso: Permiso; onAprobado: (a: Aprobacion) => void; textoBoton: string;
}) {
  const [pin, setPin] = useState("");
  const [msg, setMsg] = useState("");
  const [enviando, setEnviando] = useState(false);
  const aprobar = async () => {
    if (pin.length < 4 || enviando) return;
    setEnviando(true);
    setMsg("");
    try {
      const r = await api<Aprobacion>(ajustes.servidor, `/cajas/${ajustes.cajaId}/autorizar`, { cuerpo: { pin, permiso } });
      onAprobado(r);
    } catch (e) {
      setMsg((e as Error).message);
      setPin("");
    } finally {
      setEnviando(false);
    }
  };
  return (
    <div className="aprobacion">
      <label className="campo">
        <span>PIN del supervisor</span>
        <input type="password" inputMode="numeric" autoComplete="off" className="entrada-grande pin" value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))} onKeyDown={(e) => e.key === "Enter" && aprobar()} />
      </label>
      {msg && <p className="error">{msg}</p>}
      <button className="boton primario ancho" disabled={pin.length < 4 || enviando} onClick={aprobar}>{textoBoton}</button>
    </div>
  );
}

/** Descuento sobre la línea seleccionada: % o monto, con motivo y aprobación. */
export function Descuento({ ajustes, linea, importe, onAplicar, onCerrar }: {
  ajustes: Ajustes; linea: string; importe: string;
  onAplicar: (monto: string, motivo: string, a: Aprobacion) => void; onCerrar: () => void;
}) {
  const [tipo, setTipo] = useState<"%" | "RD$">("%");
  const [valor, setValor] = useState("");
  const [motivo, setMotivo] = useState("");
  const monto = tipo === "%" ? (Number(importe) * Number(valor || 0)) / 100 : Number(valor || 0);
  const valido = monto > 0 && monto <= Number(importe) && motivo.trim().length >= 3;
  return (
    <Modal titulo="Descuento con aprobación" onCerrar={onCerrar}>
      <p className="suave">{linea} · importe {rd(importe)}</p>
      <div className="dos-columnas">
        <label className="campo"><span>Tipo</span>
          <select value={tipo} onChange={(e) => setTipo(e.target.value as "%" | "RD$")}><option value="%">Porcentaje</option><option value="RD$">Monto</option></select>
        </label>
        <label className="campo"><span>{tipo === "%" ? "Porcentaje" : "Monto"}</span>
          <input autoFocus inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value.replace(/[^\d.]/g, ""))} />
        </label>
      </div>
      <label className="campo"><span>Motivo</span><input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej. producto con empaque dañado" /></label>
      <p>Descuento: <b>{rd(monto.toFixed(2))}</b>{monto > Number(importe) && <span className="error"> · mayor que el importe</span>}</p>
      {valido && (
        <PinSupervisor ajustes={ajustes} permiso="venta.descuento" textoBoton="Aprobar descuento"
          onAprobado={(a) => onAplicar(monto.toFixed(2), motivo.trim(), a)} />
      )}
    </Modal>
  );
}

interface FacturaTurno { id: string; numero: string; tipo: string; total: string; fecha: string; encf: string | null; cliente: string | null; anulada: boolean }

/**
 * Facturas del turno: reimprimir la última, anular (con motivo y aprobación)
 * o corregir (anula y devuelve los productos al carrito para facturar de nuevo).
 */
export function Facturas({ ajustes, usuario, onReimprimir, onAnulada, onCorregir, onCerrar }: {
  ajustes: Ajustes; usuario: Usuario;
  onReimprimir: () => void;
  onAnulada: (notaCredito: VentaRegistrada) => void;
  onCorregir: (notaCredito: VentaRegistrada, recargar: { clienteId: string | null; items: { presentacionId: string; cantidad: string }[] }) => void;
  onCerrar: () => void;
}) {
  const [lista, setLista] = useState<FacturaTurno[]>([]);
  const [accion, setAccion] = useState<{ f: FacturaTurno; corregir: boolean } | null>(null);
  const [motivo, setMotivo] = useState("");
  const [msg, setMsg] = useState("");
  useEffect(() => {
    api<FacturaTurno[]>(ajustes.servidor, `/cajas/${ajustes.cajaId}/ventas/turno`).then(setLista).catch((e) => setMsg(e.message));
  }, [ajustes]);

  const ejecutar = async (a: Aprobacion) => {
    if (!accion) return;
    try {
      const r = await api<any>(ajustes.servidor, `/cajas/${ajustes.cajaId}/ventas/${accion.f.id}/anular`, {
        cuerpo: { usuarioId: usuario.id, motivo: motivo.trim(), autorizacion: a.token, corregir: accion.corregir },
      });
      if (accion.corregir) onCorregir(r.notaCredito, r.recargar);
      else onAnulada(r.notaCredito);
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  if (accion) {
    return (
      <Modal titulo={accion.corregir ? "Corregir factura" : "Anular factura"} onCerrar={() => setAccion(null)}>
        <p>Factura <b>#{accion.f.numero}</b> · <span className="mono">{accion.f.encf}</span> · {rd(accion.f.total)}</p>
        <p className="suave">
          {accion.corregir
            ? "Se emitirá una nota de crédito (E34) por el total y los productos volverán al carrito para facturar de nuevo con los datos correctos."
            : "Se emitirá una nota de crédito electrónica (E34) por el total. La mercancía regresa al inventario y el dinero se devuelve al cliente."}
        </p>
        <label className="campo"><span>Motivo (obligatorio)</span>
          <input autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej. cliente pidió factura con RNC" />
        </label>
        {motivo.trim().length >= 10
          ? <PinSupervisor ajustes={ajustes} permiso={accion.corregir ? "venta.corregir" : "venta.anular"} onAprobado={ejecutar}
              textoBoton={accion.corregir ? "Aprobar y corregir" : "Aprobar y anular"} />
          : <p className="nota">Escriba el motivo (mínimo 10 caracteres) para pedir la aprobación.</p>}
        {msg && <p className="error">{msg}</p>}
      </Modal>
    );
  }

  return (
    <Modal titulo="Facturas del turno" onCerrar={onCerrar} ancho>
      <div className="fila-acciones-modal">
        <button className="boton primario" autoFocus onClick={onReimprimir}>Reimprimir última factura (Enter)</button>
      </div>
      {msg && <p className="error">{msg}</p>}
      <div className="resultados">
        {lista.length === 0 && <p className="suave">Todavía no hay facturas en este turno.</p>}
        {lista.map((f) => (
          <div key={f.id} className={"factura" + (f.anulada ? " anulada" : "")}>
            <span>
              <b>#{f.numero}</b> <span className="mono">{f.encf ?? ""}</span>
              <span className="suave"> · {new Date(f.fecha).toLocaleTimeString("es-DO")} · {f.cliente ?? "Consumidor final"}</span>
              {f.tipo === "E34" && <span className="pastilla">Nota de crédito</span>}
              {f.anulada && <span className="pastilla roja">Anulada</span>}
            </span>
            <span className="factura-acciones">
              <b>{rd(f.total)}</b>
              {f.tipo !== "E34" && !f.anulada && (
                <>
                  <button className="boton fantasma" onClick={() => { setMotivo(""); setMsg(""); setAccion({ f, corregir: true }); }}>Corregir</button>
                  <button className="boton peligro" onClick={() => { setMotivo(""); setMsg(""); setAccion({ f, corregir: false }); }}>Anular</button>
                </>
              )}
            </span>
          </div>
        ))}
      </div>
    </Modal>
  );
}

export interface VentaPausada<L> { id: string; hora: string; lineas: L[]; cliente: any; cupon: any; total: string; descuentos: any; notas?: string }

/** Ventas en pausa: se retoman con un clic. */
export function Pausadas<L>({ pausadas, onRetomar, onDescartar, onCerrar }: {
  pausadas: VentaPausada<L>[]; onRetomar: (p: VentaPausada<L>) => void; onDescartar: (id: string) => void; onCerrar: () => void;
}) {
  return (
    <Modal titulo="Ventas en pausa" onCerrar={onCerrar}>
      {pausadas.length === 0 && <p className="suave">No hay ventas en pausa.</p>}
      <div className="resultados">
        {pausadas.map((p, i) => (
          <div key={p.id} className="factura">
            <span><b>{i + 1}. {p.cliente?.nombre ?? "Consumidor final"}</b> <span className="suave">· {p.lineas.length} producto(s) · {p.hora}</span></span>
            <span className="factura-acciones">
              <b>{rd(p.total)}</b>
              <button className="boton primario" autoFocus={i === 0} onClick={() => onRetomar(p)}>Retomar</button>
              <button className="enlace" onClick={() => onDescartar(p.id)}>Descartar</button>
            </span>
          </div>
        ))}
      </div>
    </Modal>
  );
}

/**
 * Evita que el Enter con que termina el lector de códigos confirme el aviso
 * que ese mismo escaneo acaba de abrir: las acciones se ignoran los primeros 400 ms.
 */
function useArmado(ms = 400) {
  const [armado, setArmado] = useState(false);
  useEffect(() => { const t = setTimeout(() => setArmado(true), ms); return () => clearTimeout(t); }, [ms]);
  return armado;
}

/** Precio variable: la cajera escribe el precio dentro del rango del producto. */
export function PrecioVariable({ nombre, min, max, sugerido, onAceptar, onCerrar }: {
  nombre: string; min: string | null | undefined; max: string | null | undefined; sugerido: string | null;
  onAceptar: (precio: string) => void; onCerrar: () => void;
}) {
  const [valor, setValor] = useState(sugerido && Number(sugerido) > 0 ? String(Number(sugerido)) : "");
  const armado = useArmado();
  const v = Number(valor || 0);
  const fuera = valor !== "" && ((min && v < Number(min)) || (max && v > Number(max)));
  const valido = v > 0 && !fuera;
  return (
    <Modal titulo="Precio del artículo" onCerrar={onCerrar}>
      <p className="suave">{nombre} · entre {rd(min ?? 0)} y {rd(max ?? 0)}</p>
      <form onSubmit={(e) => { e.preventDefault(); if (valido && armado) onAceptar(v.toFixed(2)); }}>
        <label className="campo"><span>Precio (con ITBIS)</span>
          <input className="entrada-grande" autoFocus inputMode="decimal" value={valor} onFocus={(e) => e.target.select()}
            onChange={(e) => setValor(e.target.value.replace(/[^\d.]/g, ""))} />
        </label>
        {fuera && <p className="error">Fuera del rango permitido</p>}
        <button className="boton primario ancho" disabled={!valido}>Agregar · {rd(v.toFixed(2))}</button>
      </form>
    </Modal>
  );
}
