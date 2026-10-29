import { useEffect, useMemo, useState } from "react";
import { precioPara, type Catalogo, type ProductoCatalogo } from "@factpos/compartido";
import { api, rd, type Ajustes } from "./api";
import type { ConfigCaja, Usuario } from "./App";
import { Modal, TamanoPantalla, type Cliente } from "./Venta";
import { PinSupervisor, type Aprobacion } from "./Operaciones";

/**
 * Herramientas de la pantalla de venta: cambiar precio, descuento a toda la
 * factura, nota de la venta, cotización, consulta de existencias, abrir la
 * gaveta, confirmar cancelación y ajustes de la terminal.
 */

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// ---------------------------------------------------------------- cambiar precio
/**
 * Cambia el precio de la línea seleccionada (solo hacia abajo) con PIN del
 * supervisor. Se registra como un descuento aprobado, con su motivo, para que
 * la factura, el ITBIS y la auditoría cuadren.
 */
export function CambiarPrecio({ ajustes, nombre, cantidad, precioActual, onAplicar, onCerrar }: {
  ajustes: Ajustes; nombre: string; cantidad: string; precioActual: string;
  onAplicar: (nuevo: string, descuento: string, motivo: string, a: Aprobacion) => void; onCerrar: () => void;
}) {
  const [nuevo, setNuevo] = useState("");
  const [motivo, setMotivo] = useState("");
  const n = Number(nuevo || 0), actual = Number(precioActual);
  const descuento = Math.max(0, (actual - n) * Number(cantidad));
  const problema = !nuevo ? "" : n <= 0 ? "El precio debe ser mayor que cero"
    : n >= actual ? "Desde la caja solo se puede bajar el precio. Para subirlo, cámbielo en la Administración." : "";
  const valido = !!nuevo && !problema && motivo.trim().length >= 3;
  return (
    <Modal titulo="Cambiar precio" onCerrar={onCerrar}>
      <p className="suave">{nombre} · {cantidad} × {rd(precioActual)}</p>
      <div className="dos-columnas">
        <label className="campo"><span>Precio nuevo (por unidad)</span>
          <input autoFocus className="entrada-grande" inputMode="decimal" value={nuevo} placeholder={precioActual}
            onChange={(e) => setNuevo(e.target.value.replace(/[^\d.]/g, ""))} />
        </label>
        <label className="campo"><span>Motivo</span>
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej. precio de la góndola" />
        </label>
      </div>
      {problema ? <p className="error">{problema}</p> : nuevo && <p>Rebaja en la línea: <b>{rd(descuento.toFixed(2))}</b></p>}
      {valido && (
        <PinSupervisor ajustes={ajustes} permiso="venta.descuento" textoBoton="Aprobar precio"
          onAprobado={(a) => onAplicar(n.toFixed(2), descuento.toFixed(2), `Precio cambiado de ${rd(precioActual)} a ${rd(n.toFixed(2))}: ${motivo.trim()}`, a)} />
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------- descuento
/**
 * Descuento con aprobación: a la línea seleccionada o a toda la factura.
 * El de la factura se reparte entre las líneas según su importe.
 */
export function DescuentoVenta({ ajustes, linea, importeLinea, importeFactura, inicial, onAplicar, onCerrar }: {
  ajustes: Ajustes; linea: string | null; importeLinea: string; importeFactura: string; inicial: "linea" | "factura";
  onAplicar: (alcance: "linea" | "factura", monto: string, motivo: string, a: Aprobacion) => void; onCerrar: () => void;
}) {
  const [alcance, setAlcance] = useState<"linea" | "factura">(linea ? inicial : "factura");
  const [tipo, setTipo] = useState<"%" | "RD$">("%");
  const [valor, setValor] = useState("");
  const [motivo, setMotivo] = useState("");
  const importe = Number(alcance === "linea" ? importeLinea : importeFactura);
  const monto = tipo === "%" ? (importe * Number(valor || 0)) / 100 : Number(valor || 0);
  const valido = monto > 0 && monto <= importe && motivo.trim().length >= 3;
  return (
    <Modal titulo="Descuento con aprobación" onCerrar={onCerrar}>
      <div className="selector-modo ancho-completo" role="tablist" aria-label="A qué se aplica">
        <button role="tab" aria-selected={alcance === "linea"} className={alcance === "linea" ? "activo" : ""} disabled={!linea} onClick={() => setAlcance("linea")}>
          Este artículo
        </button>
        <button role="tab" aria-selected={alcance === "factura"} className={alcance === "factura" ? "activo" : ""} onClick={() => setAlcance("factura")}>
          Toda la factura
        </button>
      </div>
      <p className="suave">{alcance === "linea" ? `${linea} · importe ${rd(importeLinea)}` : `Toda la venta · importe ${rd(importeFactura)} (reemplaza los descuentos manuales que tenga)`}</p>
      <div className="dos-columnas">
        <label className="campo"><span>Tipo</span>
          <select value={tipo} onChange={(e) => setTipo(e.target.value as "%" | "RD$")}><option value="%">Porcentaje</option><option value="RD$">Monto</option></select>
        </label>
        <label className="campo"><span>{tipo === "%" ? "Porcentaje" : "Monto"}</span>
          <input autoFocus inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value.replace(/[^\d.]/g, ""))} />
        </label>
      </div>
      <label className="campo"><span>Motivo</span><input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej. cliente frecuente, empaque dañado" /></label>
      <p>Descuento: <b>{rd(monto.toFixed(2))}</b>{monto > importe && <span className="error"> · mayor que el importe</span>}</p>
      {valido && (
        <PinSupervisor ajustes={ajustes} permiso="venta.descuento" textoBoton="Aprobar descuento"
          onAprobado={(a) => onAplicar(alcance, monto.toFixed(2), motivo.trim(), a)} />
      )}
    </Modal>
  );
}

/** Reparte un monto entre importes, en centavos, sin perder ni sobrar un centavo. */
export function repartir(monto: string, importes: number[]): string[] {
  const total = importes.reduce((a, b) => a + b, 0);
  const cent = Math.round(Number(monto) * 100);
  if (!total) return importes.map(() => "0.00");
  let asignado = 0;
  const partes = importes.map((imp, i) => {
    const c = i === importes.length - 1 ? cent - asignado : Math.min(Math.round((cent * imp) / total), Math.round(imp * 100));
    asignado += c;
    return c;
  });
  return partes.map((c) => (c / 100).toFixed(2));
}

// ---------------------------------------------------------------- nota
export function NotaVenta({ inicial, onGuardar, onCerrar }: { inicial: string; onGuardar: (t: string) => void; onCerrar: () => void }) {
  const [t, setT] = useState(inicial);
  return (
    <Modal titulo="Nota de la venta" onCerrar={onCerrar}>
      <p className="suave">Sale impresa en la factura. Ej. «entregar en la puerta 2», «paga el resto mañana».</p>
      <textarea autoFocus className="nota-venta" maxLength={300} rows={4} value={t} onChange={(e) => setT(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) onGuardar(t.trim()); }} />
      <div className="fila-botones">
        <span className="suave">{t.length}/300</span>
        <span className="flex" />
        {inicial && <button className="boton fantasma" onClick={() => onGuardar("")}>Quitar nota</button>}
        <button className="boton primario" onClick={() => onGuardar(t.trim())}>Guardar nota</button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- cotización
export interface LineaCotizacion { descripcion: string; cantidad: string; precio: string; total: string; nota?: string | null }

/** Cotización impresa: no es factura, no descuenta inventario ni usa comprobante. */
export function Cotizacion({ config, usuario, cliente, lineas, totales, notas, onCerrar }: {
  config: ConfigCaja; usuario: Usuario; cliente: Cliente | null; lineas: LineaCotizacion[];
  totales: { subtotal: string; descuento: string; itbis: string; total: string }; notas: string; onCerrar: () => void;
}) {
  const [dias, setDias] = useState(7);
  const hoy = new Date();
  const vence = new Date(hoy.getTime() + dias * 86400e3);
  const f = (d: Date) => d.toLocaleDateString("es-DO", { timeZone: "America/Santo_Domingo", day: "2-digit", month: "2-digit", year: "numeric" });
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); window.print(); } };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  return (
    <div className="fondo-modal" onMouseDown={onCerrar}>
      <div className="modal ticket-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-titulo"><h3>Cotización</h3><button className="enlace" onClick={onCerrar}>Cerrar (Esc)</button></div>
        <label className="campo fila-campo"><span>Válida por</span>
          <select value={dias} onChange={(e) => setDias(Number(e.target.value))}>
            {[3, 7, 15, 30].map((d) => <option key={d} value={d}>{d} días</option>)}
          </select>
        </label>
        <div className="ticket" id="ticket">
          <div className="t-centro">
            {config.marca.logo && config.marca.logoEnTicket && <img className="t-logo" src={config.marca.logo} alt="" />}
            <b className="t-grande">{config.empresa}</b>
            <div>RNC {config.rnc}</div>
            <div>{config.sucursal}</div>
          </div>
          <div className="t-linea" />
          <div className="t-centro"><b>COTIZACIÓN</b></div>
          <div className="t-centro t-copia">Documento no fiscal · no válido como factura</div>
          <div className="t-fila"><span>Fecha</span><span>{f(hoy)}</span></div>
          <div className="t-fila"><span>Válida hasta</span><span>{f(vence)}</span></div>
          <div className="t-fila"><span>Atendido por</span><span>{usuario.nombre}</span></div>
          {cliente && <div className="t-fila"><span>Cliente</span><span>{cliente.nombre}</span></div>}
          {cliente?.documento && <div className="t-fila"><span>RNC/Cédula</span><span>{cliente.documento}</span></div>}
          <div className="t-linea" />
          {lineas.map((l, i) => (
            <div key={i} className="t-item">
              <div>{l.descripcion}</div>
              <div className="t-fila"><span>{l.cantidad} × {rd(l.precio)}</span><span>{rd(l.total)}</span></div>
              {l.nota && <div className="t-fila t-desc"><span>  {l.nota}</span><span /></div>}
            </div>
          ))}
          <div className="t-linea" />
          <div className="t-fila"><span>Subtotal</span><span>{rd(totales.subtotal)}</span></div>
          <div className="t-fila"><span>ITBIS</span><span>{rd(totales.itbis)}</span></div>
          {Number(totales.descuento) > 0 && <div className="t-fila"><span>Ahorro</span><span>{rd(totales.descuento)}</span></div>}
          <div className="t-fila t-total"><span>TOTAL</span><span>{rd(totales.total)}</span></div>
          {notas && <div className="t-nota">Nota: {notas}</div>}
          <div className="t-linea" />
          <div className="t-centro t-pie">Precios sujetos a existencia y a cambio después de la fecha de validez.</div>
        </div>
        <div className="acciones-ticket">
          <button className="boton fantasma" onClick={onCerrar}>Seguir vendiendo</button>
          <button className="boton primario" onClick={() => window.print()}>Imprimir (Enter)</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- existencias
/** Consultar precio y existencia en esta sucursal (sin agregar a la venta). */
export function Existencias({ catalogo, nivel, onAgregar, onCerrar }: {
  catalogo: Catalogo; nivel: number; onAgregar: (p: ProductoCatalogo) => void; onCerrar: () => void;
}) {
  const [q, setQ] = useState("");
  const res = useMemo(() => {
    const t = norm(q.trim());
    if (t.length < 2) return [];
    // Un código exacto (lector) va primero
    const exacto = catalogo.productos.filter((p) => p.codigos.includes(q.trim()));
    if (exacto.length) return exacto;
    const partes = t.split(/\s+/);
    return catalogo.productos.filter((p) => partes.every((x) => norm(`${p.nombre} ${p.presentacion} ${p.sku}`).includes(x))).slice(0, 30);
  }, [q, catalogo]);
  return (
    <Modal titulo="Precio y existencia" onCerrar={onCerrar} ancho>
      <input autoFocus className="entrada-grande entrada-texto" value={q} placeholder="Escanee o escriba el nombre" onChange={(e) => setQ(e.target.value)} />
      <div className="tabla-existencias">
        {res.length > 0 && <div className="te-fila te-cabeza"><span>Producto</span><span className="der">Precio</span><span className="der">En esta sucursal</span><span /></div>}
        {res.map((p) => {
          const precio = precioPara(p, nivel, catalogo.nivelPredeterminado).precio;
          const hay = Number(p.existencia ?? 0), minimo = Number(p.minimo ?? 0);
          const estado = !p.controlaStock ? "na" : hay <= 0 ? "agotado" : hay <= minimo ? "bajo" : "ok";
          return (
            <div key={p.presentacionId} className="te-fila">
              <span><b>{p.nombre}</b> <span className="suave">{p.presentacion} · {p.sku}{p.codigos[0] ? ` · ${p.codigos[0]}` : ""}</span></span>
              <span className="der">{p.precioVariable ? "Precio libre" : precio ? rd(precio) : "Sin precio"}</span>
              <span className={"der existencia " + estado}>
                {estado === "na" ? "No se controla" : estado === "agotado" ? "Agotado" : `${hay % 1 ? hay.toFixed(2) : hay}${estado === "bajo" ? " · bajo mínimo" : ""}`}
              </span>
              <button className="boton fantasma" onClick={() => onAgregar(p)}>Agregar</button>
            </div>
          );
        })}
        {q.trim().length >= 2 && !res.length && <p className="suave">No se encontró ningún producto.</p>}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- gaveta
/**
 * Abrir la gaveta sin venta: PIN del supervisor y motivo. Queda en la
 * auditoría. La gaveta la abre la impresora al imprimir (opción del driver
 * "abrir gaveta al imprimir"), por eso se imprime un ticket mínimo.
 */
export function AbrirGaveta({ ajustes, usuario, onListo, onCerrar }: { ajustes: Ajustes; usuario: Usuario; onListo: (supervisor: string) => void; onCerrar: () => void }) {
  const [motivo, setMotivo] = useState("");
  const [msg, setMsg] = useState("");
  const aprobado = async (a: Aprobacion) => {
    try {
      await api(ajustes.servidor, `/cajas/${ajustes.cajaId}/gaveta`, { cuerpo: { usuarioId: usuario.id, motivo: motivo.trim(), autorizacion: a.token } });
      onListo(a.supervisor);
      // El ticket mínimo hace que la impresora abra la gaveta
      setTimeout(() => window.print(), 50);
    } catch (e) { setMsg((e as Error).message); }
  };
  return (
    <Modal titulo="Abrir gaveta" onCerrar={onCerrar}>
      <label className="campo"><span>Motivo</span>
        <input autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej. cambiar un billete, revisar el fondo" />
      </label>
      {msg && <p className="error">{msg}</p>}
      {motivo.trim().length >= 3 && <PinSupervisor ajustes={ajustes} permiso="caja.retiro" textoBoton="Abrir gaveta" onAprobado={aprobado} />}
      <p className="nota">La gaveta se abre al imprimir. Si no abre, active «Abrir gaveta al imprimir» en el driver de la impresora térmica.</p>
      <div className="ticket solo-impresion" id="ticket"><div className="t-centro">{new Date().toLocaleString("es-DO")}</div></div>
    </Modal>
  );
}

// ---------------------------------------------------------------- cancelar
export function ConfirmarCancelar({ articulos, total, onConfirmar, onCerrar }: { articulos: number; total: string; onConfirmar: () => void; onCerrar: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); onConfirmar(); } };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onConfirmar]);
  return (
    <Modal titulo="¿Cancelar la venta?" onCerrar={onCerrar}>
      <p>Se quitan {articulos} artículo(s) por <b>{rd(total)}</b>. No se factura nada.</p>
      <div className="fila-botones">
        <button className="boton fantasma" onClick={onCerrar}>Seguir con la venta (Esc)</button>
        <span className="flex" />
        <button className="boton peligro-lleno" onClick={onConfirmar}>Sí, cancelar (Enter)</button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- ajustes
export function AjustesTerminal({ config, onCerrar }: { config: ConfigCaja; onCerrar: () => void }) {
  return (
    <Modal titulo="Configuración de esta terminal" onCerrar={onCerrar}>
      <p className="suave">{config.nombre} · {config.sucursal}</p>
      <TamanoPantalla />
      <p className="nota">Atajos: F1 catálogo · F2 buscar · F3 suspender · F4 cliente · F5 en pausa · F6 cupón · F7 descuento · F8 delivery ·
        F9 facturas y devoluciones · F10 turno y cierre · F12 cobrar · Alt+P precio · Alt+N nota · Alt+Q cotización · Alt+E existencias · Alt+G gaveta · Esc cancelar.</p>
    </Modal>
  );
}
