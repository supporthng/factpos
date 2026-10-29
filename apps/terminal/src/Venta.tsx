import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  cotizarCarrito, indexarCatalogo, precioPara, ofertasPara, leerCodigoBalanza, ErrorCarrito,
  type Catalogo, type ProductoCatalogo, type Cupon, type Cotizacion,
} from "@factpos/compartido";
import { Decimal } from "decimal.js";
import { api, rd, type Ajustes } from "./api";
import type { ConfigCaja, Turno, Usuario } from "./App";
import { Cobro, type ResultadoVenta } from "./Cobro";
import { PanelDelivery } from "./Delivery";
import { Ticket, type VentaRegistrada } from "./Ticket";
import { SimboloFactPOS } from "./Logo";
import { VistaCatalogo } from "./Catalogo";
import { TAMANOS, leerTamano, guardarTamano, type Tamano } from "./escala";
import { guardarCache, leerCache, useConexion } from "./contingencia";

/** Tamaño de letra de esta terminal (además del ajuste automático a la pantalla). */
export function TamanoPantalla() {
  const [t, setT] = useState<Tamano>(leerTamano());
  return (
    <div className="tamano-pantalla">
      <span className="suave">Tamaño de letra de esta terminal</span>
      <div className="selector-modo">
        {(Object.keys(TAMANOS) as Tamano[]).map((k) => (
          <button key={k} className={t === k ? "activo" : ""} onClick={() => { setT(k); guardarTamano(k); }}>{TAMANOS[k].nombre}</button>
        ))}
      </div>
    </div>
  );
}
import { ClientesCaja } from "./Clientes";
import { TurnoCaja } from "./Turno";
import { Descuento, Facturas, Pausadas, PrecioVariable, type Aprobacion, type VentaPausada } from "./Operaciones";

export interface Cliente {
  id: string; nombre: string; tipoDocumento: string; documento: string | null; telefono: string | null;
  nivel: number | null; lista: string | null; limiteCredito: string; saldo: string;
  /** Recién creado en caja para pedir comprobante fiscal: el cobro sale marcado E31 */
  nuevoParaFiscal?: boolean;
}
interface Linea { prod: ProductoCatalogo; cantidad: string; descuentoManual?: string; motivoDescuento?: string; precioVariable?: string }

type Modal = null | "precio" | "buscar" | "cliente" | "cupon" | "cobro" | "delivery" | "turno" | "ticket" | "descuento" | "facturas" | "pausadas";

/**
 * Pantalla de venta. Todo lo que pasa mientras se escanea ocurre en memoria:
 * búsqueda por código, precio del nivel del cliente, ofertas e impuestos.
 * El servidor solo se usa al cobrar (y para validar cupones y buscar clientes).
 */
export function Venta({ ajustes, config, usuario, turno, onSalir }: {
  ajustes: Ajustes; config: ConfigCaja; usuario: Usuario; turno: Turno; onSalir: () => void;
}) {
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null);
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [sel, setSel] = useState(-1);
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [cupon, setCupon] = useState<Cupon | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [aviso, setAviso] = useState<{ texto: string; tipo: "error" | "ok" } | null>(null);
  const [ultima, setUltima] = useState<ResultadoVenta | null>(null);
  const [codigo, setCodigo] = useState("");
  const entrada = useRef<HTMLInputElement>(null);
  const idx = useMemo(() => (catalogo ? indexarCatalogo(catalogo) : null), [catalogo]);

  // Catálogo en memoria: se descarga al iniciar y se refresca solo si cambió
  // Ofertas con tope que se acabaron: aviso grande en el centro, en TODAS las cajas
  const [ofertasAcabadas, setOfertasAcabadas] = useState<{ id: string; nombre: string }[]>([]);
  const anunciadas = useRef(new Set<string>());
  const anunciar = useCallback((o: { id: string; nombre: string }) => {
    if (anunciadas.current.has(o.id)) return;
    anunciadas.current.add(o.id);
    setOfertasAcabadas((xs) => [...xs, o]);
  }, []);
  const restantesPrevias = useRef<Map<string, number> | null>(null);
  const cargarCatalogo = useCallback(async () => {
    const c = await api<Catalogo>(ajustes.servidor, `/cajas/${ajustes.cajaId}/catalogo`);
    const ahora = new Map(c.ofertas.filter((o) => o.restantes != null).map((o) => [o.id, Number(o.restantes)]));
    if (restantesPrevias.current) {
      // Se acabó desde la última vez que se revisó (la vendió esta u otra caja)
      for (const o of c.ofertas) {
        const antes = restantesPrevias.current.get(o.id);
        if (antes !== undefined && antes > 0 && (ahora.get(o.id) ?? 1) <= 0) anunciar({ id: o.id, nombre: o.nombre });
      }
    } else {
      // Al abrir la caja, las que ya estaban agotadas no se anuncian
      for (const [id, n] of ahora) if (n <= 0) anunciadas.current.add(id);
    }
    restantesPrevias.current = ahora;
    setCatalogo(c);
    guardarCache(ajustes, "catalogo", c); // para poder vender si se cae el servidor
  }, [ajustes, anunciar]);
  useEffect(() => {
    cargarCatalogo().catch(async (e) => {
      // Sin servidor: el último catálogo guardado en esta caja
      const c = await leerCache<Catalogo>(ajustes, "catalogo");
      if (c) setCatalogo((actual) => actual ?? c);
      else setAviso({ texto: e.message, tipo: "error" });
    });
    const t = setInterval(async () => {
      try {
        const v = await api<{ version: string }>(ajustes.servidor, `/cajas/${ajustes.cajaId}/catalogo/version`);
        setCatalogo((actual) => {
          if (actual && actual.version !== v.version) cargarCatalogo();
          return actual;
        });
      } catch { /* sin conexión: se sigue vendiendo con el catálogo actual */ }
    }, 10000); // cada 10 s: así las demás cajas ven pronto una oferta agotada
    return () => clearInterval(t);
  }, [ajustes, cargarCatalogo]);

  const nivelCliente = cliente?.nivel ?? catalogo?.nivelPredeterminado ?? 1;

  // Cotización local, instantánea
  const cot = useMemo((): { r: Cotizacion | null; error: string } => {
    if (!catalogo || !lineas.length) return { r: null, error: "" };
    const motor = lineas.map((l) => ({
      cantidad: l.cantidad,
      precio: l.precioVariable ?? precioPara(l.prod, nivelCliente, catalogo.nivelPredeterminado).precio ?? "0",
      tasaItbis: l.prod.tasaItbis,
      precioIncluyeItbis: l.prod.precioIncluyeItbis,
      esPesable: l.prod.esPesable,
      nombre: l.prod.nombre,
      ofertas: ofertasPara(catalogo, l.prod, nivelCliente),
      factor: l.prod.factor,
      descuentoManual: l.descuentoManual,
    }));
    try {
      return { r: cotizarCarrito(motor, cupon), error: "" };
    } catch (e) {
      if (!(e instanceof ErrorCarrito)) throw e;
      // Si el cupón deja de cumplir (ej. se quitó un producto), se muestra el total sin cupón y el motivo
      try {
        return { r: cotizarCarrito(motor, null), error: cupon ? `Cupón ${cupon.codigo}: ${e.message}` : e.message };
      } catch (e2) {
        return { r: null, error: (e2 as Error).message };
      }
    }
  }, [catalogo, lineas, cupon, nivelCliente]);

  const avisar = (texto: string, tipo: "error" | "ok" = "error") => {
    setAviso({ texto, tipo });
    setTimeout(() => setAviso((a) => (a?.texto === texto ? null : a)), 3500);
  };

  // Ofertas con tope: avisar una vez por venta cuando se acaban
  const avisadas = useRef(new Set<string>());
  useEffect(() => {
    for (const o of cot.r?.ofertasAgotadas ?? []) {
      if (avisadas.current.has(o.ofertaId)) continue;
      avisadas.current.add(o.ofertaId);
      anunciar({ id: o.ofertaId, nombre: o.nombre });
    }
  }, [cot.r]); // eslint-disable-line react-hooks/exhaustive-deps

  /** ¿Alguna línea depende de una oferta con tope? (otra caja pudo vender las últimas) */
  const conTope = !!catalogo && lineas.some((l) => ofertasPara(catalogo, l.prod, nivelCliente).some((o) => o.restantes != null));
  const abrirCobro = async () => {
    if (!lineas.length || cot.error) return;
    if (conTope) {
      // Se actualiza el catálogo para cobrar con las unidades que de verdad quedan
      try { await cargarCatalogo(); } catch { /* sin conexión: el servidor valida al cobrar */ }
    }
    setModal("cobro");
  };

  // Reglas de la ficha del producto, revisadas en memoria (sin ir al servidor)
  const [pendiente, setPendiente] = useState<{ prod: ProductoCatalogo; cantidad: string; precio?: string } | null>(null);

  /** Unidades base que pediría la venta de este producto si se suman `extra` unidades de la presentación. */
  const demanda = (ls: Linea[], prod: ProductoCatalogo, extra: number) =>
    ls.filter((l) => l.prod.productoId === prod.productoId).reduce((s, l) => s + Number(l.cantidad) * Number(l.prod.factor), 0) + extra * Number(prod.factor);
  /** Revisa la existencia: devuelve false si el producto no puede venderse sin existencia y no alcanza. */
  const hayExistencia = (ls: Linea[], prod: ProductoCatalogo, extra: number) => {
    if (!prod.controlaStock || prod.existencia === undefined) return true;
    const pide = demanda(ls, prod, extra);
    const hay = Number(prod.existencia);
    if (pide <= hay) return true;
    if (prod.permiteSinExistencia === false) {
      avisar(hay > 0 ? `${prod.nombre}: solo quedan ${hay} en existencia` : `${prod.nombre} está agotado y no se vende sin existencia`);
      return false;
    }
    // Se permite vender, pero se avisa la primera vez que la venta pasa la existencia del sistema
    if (pide - extra * Number(prod.factor) <= hay) avisar(`${prod.nombre}: el sistema no tiene existencia suficiente. Avise al encargado.`);
    return true;
  };

  const agregar = (prod: ProductoCatalogo, cantidad: string, precioDado?: string) => {
    if (!prod.precioVariable && precioPara(prod, nivelCliente, catalogo!.nivelPredeterminado).precio === null) {
      return avisar(`${prod.nombre} no tiene precio`);
    }
    if (prod.precioVariable && !precioDado) {
      setPendiente({ prod, cantidad });
      return setModal("precio");
    }
    if (!hayExistencia(lineas, prod, Number(cantidad))) return;
    setLineas((ls) => {
      // Mismo producto no pesable y de precio fijo: suma a la línea existente
      const i = prod.esPesable || prod.precioVariable ? -1 : ls.findIndex((l) => l.prod.presentacionId === prod.presentacionId);
      if (i >= 0) {
        const n = [...ls];
        n[i] = { ...n[i], cantidad: String(Number(n[i].cantidad) + Number(cantidad)) };
        setSel(i);
        return n;
      }
      setSel(ls.length);
      return [...ls, { prod, cantidad, ...(precioDado ? { precioVariable: precioDado } : {}) }];
    });
  };

  /** Códigos: "7460001000017", "3*7460001000017" (cantidad) o etiqueta de balanza. Devuelve true si lo procesó. */
  const procesarCodigo = (texto: string): boolean => {
    const t = texto.trim();
    if (!t || !idx) return false;
    const m = /^(\d+(?:\.\d+)?)\*(.+)$/.exec(t);
    const cant = m ? m[1] : "1";
    const cod = m ? m[2] : t;
    const p = idx.porCodigo.get(cod);
    if (p) { agregar(p, cant); return true; }
    const b = leerCodigoBalanza(cod);
    if (b) {
      const pb = idx.porCodigo.get(b.codigoProducto);
      if (pb && pb.esPesable) { agregar(pb, b.valor.toFixed(3)); return true; }
    }
    if (/^\d{6,}$/.test(cod)) { avisar(`El código ${cod} no está registrado`); return true; }
    return false;
  };

  /** Modo Escáner: código, o texto que abre la búsqueda. */
  const procesarEntrada = (texto: string) => {
    if (procesarCodigo(texto) || !texto.trim()) return;
    setBusqueda(texto.trim());
    setModal("buscar");
  };

  // Modo de venta: Escáner (lista rápida) o Catálogo (tarjetas). Cada terminal recuerda el suyo.
  const [modo, setModo] = useState<"escaner" | "catalogo">(() => {
    try { return (localStorage.getItem("factpos.modo") as "escaner" | "catalogo") || "escaner"; } catch { return "escaner"; }
  });
  useEffect(() => { try { localStorage.setItem("factpos.modo", modo); } catch { /* sin almacenamiento */ } }, [modo]);
  const enCarrito = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of lineas) m.set(l.prod.presentacionId, (m.get(l.prod.presentacionId) ?? 0) + Number(l.cantidad));
    return m;
  }, [lineas]);

  const [busqueda, setBusqueda] = useState("");

  const cambiarCantidad = (i: number, delta: number) => {
    if (delta > 0 && lineas[i] && !hayExistencia(lineas, lineas[i].prod, delta)) return;
    setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, cantidad: String(Math.max(1, Number(l.cantidad) + delta)) } : l)));
  };
  const quitar = (i: number) => {
    setLineas((ls) => ls.filter((_, j) => j !== i));
    setSel((s) => Math.min(s, lineas.length - 2));
  };
  const nuevaVenta = () => {
    setLineas([]); setSel(-1); setCliente(null); setCupon(null); setAprobacion(null); avisadas.current = new Set();
  };

  // Aprobación del supervisor para los descuentos de esta venta
  const [aprobacion, setAprobacion] = useState<Aprobacion | null>(null);
  const [ticketVista, setTicketVista] = useState<{ venta: VentaRegistrada; copia: boolean } | null>(null);

  // Ventas en pausa (sobreviven a recargar la página)
  const clavePausa = `factpos.pausadas.${ajustes.cajaId}`;
  const [pausadas, setPausadas] = useState<VentaPausada<Linea>[]>(() => {
    try { return JSON.parse(localStorage.getItem(clavePausa) ?? "[]"); } catch { return []; }
  });
  useEffect(() => {
    try { localStorage.setItem(clavePausa, JSON.stringify(pausadas)); } catch { /* sin almacenamiento */ }
  }, [pausadas, clavePausa]);
  const pausar = () => {
    if (!lineas.length) return;
    setPausadas((ps) => [...ps, {
      id: crypto.randomUUID(), hora: new Date().toLocaleTimeString("es-DO", { hour: "2-digit", minute: "2-digit" }),
      lineas, cliente, cupon, total: cot.r?.totales.total ?? "0", descuentos: aprobacion,
    }]);
    nuevaVenta();
    avisar("Venta en pausa. F5 para retomarla.", "ok");
  };
  const retomar = (p: VentaPausada<Linea>) => {
    if (lineas.length) pausar(); // la actual pasa a pausa
    setPausadas((ps) => ps.filter((x) => x.id !== p.id));
    // El catálogo pudo cambiar: se toman los datos vigentes del producto
    setLineas(p.lineas.map((l) => ({ ...l, prod: idx?.porId.get(l.prod.presentacionId) ?? l.prod })));
    setCliente(p.cliente); setCupon(p.cupon); setAprobacion(p.descuentos ?? null); setSel(p.lineas.length - 1);
    setModal(null);
  };
  const reimprimirUltima = async () => {
    try {
      const v = await api<VentaRegistrada>(ajustes.servidor, `/cajas/${ajustes.cajaId}/ventas/ultima`);
      setTicketVista({ venta: v, copia: true });
      setModal("ticket");
    } catch (e) {
      avisar((e as Error).message);
    }
  };

  // Atajos de teclado
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (modal) {
        if (e.key === "Escape") setModal(null);
        return;
      }
      const mapa: Record<string, () => void> = {
        F1: () => setModo((m) => (m === "escaner" ? "catalogo" : "escaner")),
        F2: () => { setBusqueda(""); setModal("buscar"); },
        F3: () => pausar(),
        F4: () => setModal("cliente"),
        F5: () => setModal("pausadas"),
        F7: () => sel >= 0 && lineas[sel] && setModal("descuento"),
        F9: () => setModal("facturas"),
        F6: () => setModal("cupon"),
        F8: () => config.modulos.delivery.activo && setModal("delivery"),
        F10: () => setModal("turno"),
        F12: () => { abrirCobro(); },
        Delete: () => sel >= 0 && quitar(sel),
        ArrowUp: () => setSel((s) => Math.max(0, s - 1)),
        ArrowDown: () => setSel((s) => Math.min(lineas.length - 1, s + 1)),
        "+": () => sel >= 0 && !lineas[sel]?.prod.esPesable && cambiarCantidad(sel, 1),
        "-": () => sel >= 0 && !lineas[sel]?.prod.esPesable && cambiarCantidad(sel, -1),
      };
      const f = mapa[e.key];
      const campo = document.activeElement as HTMLInputElement | null;
      const campoVacio = !campo || !("value" in campo) || campo.value === "";
      if (f && (e.key.startsWith("F") || e.key === "Delete" || e.key.startsWith("Arrow") || campoVacio)) {
        e.preventDefault();
        f();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [modal, lineas, sel, cot.error, codigo, config, cliente, cupon, aprobacion, pausadas, modo]);

  // El campo de código siempre recupera el foco
  useEffect(() => {
    if (modal) return;
    if (modo === "catalogo") (document.querySelector("[data-entrada-principal]") as HTMLInputElement | null)?.focus();
    else entrada.current?.focus();
  }, [modal, lineas, modo]);

  const total = cot.r?.totales.total ?? "0.00";

  return (
    <div className="pos">
      <AvisoConexion />
      <header className="barra">
        {config.marca.logo
          ? <img className="logo-barra" src={config.marca.logo} alt={config.empresa} />
          : <div className="marca pequena con-icono"><SimboloFactPOS tamano={30} /><span>Fact<span>POS</span></span></div>}
        <div className="barra-info">
          <b>{config.nombre} · {usuario.nombre}</b><span>{config.sucursal}</span>
        </div>
        <div className="selector-modo" role="tablist" aria-label="Modo de venta">
          <button role="tab" aria-selected={modo === "escaner"} className={modo === "escaner" ? "activo" : ""} onClick={() => setModo("escaner")}>Escáner</button>
          <button role="tab" aria-selected={modo === "catalogo"} className={modo === "catalogo" ? "activo" : ""} onClick={() => setModo("catalogo")}>Catálogo</button>
          <kbd>F1</kbd>
        </div>
        <div className="barra-acciones">
          <button className="boton fantasma" onClick={() => setModal("pausadas")}>En pausa{pausadas.length ? ` (${pausadas.length})` : ""} <kbd>F5</kbd></button>
          <button className="boton fantasma" onClick={() => setModal("facturas")}>Facturas <kbd>F9</kbd></button>
          {config.modulos.delivery.activo && <button className="boton fantasma" onClick={() => setModal("delivery")}>Delivery <kbd>F8</kbd></button>}
          <button className="boton fantasma" onClick={() => setModal("turno")}>Turno <kbd>F10</kbd></button>
          <button className="boton fantasma" onClick={onSalir}>Salir</button>
        </div>
      </header>

      <main className={"pos-cuerpo" + (modo === "catalogo" ? " modo-catalogo" : "")}>
        {modo === "catalogo" && catalogo && (
          <VistaCatalogo catalogo={catalogo} nivel={nivelCliente} enCarrito={enCarrito}
            onAgregar={(p) => agregar(p, "1")} onCodigo={procesarCodigo} />
        )}
        {modo === "escaner" && <section className="carrito">
          <div className="entrada-codigo">
            <input
              ref={entrada}
              value={codigo}
              placeholder={catalogo ? "Escanee o escriba código / nombre   (3*código = cantidad)" : "Cargando catálogo…"}
              onChange={(e) => setCodigo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  procesarEntrada(codigo);
                  setCodigo("");
                }
              }}
            />
            <span className="suave">{catalogo ? `${catalogo.productos.length} productos` : ""}</span>
          </div>

          <div className="tabla-carrito">
            <div className="fila encabezado">
              <span>Producto</span><span className="der">Cant.</span><span className="der">Precio</span><span className="der">Total</span>
            </div>
            {lineas.length === 0 && <div className="vacio">Escanee el primer producto</div>}
            {lineas.map((l, i) => {
              const c = cot.r?.lineas[i];
              const precio = l.precioVariable ?? precioPara(l.prod, nivelCliente, catalogo!.nivelPredeterminado).precio ?? "0";
              return (
                <div key={i} className={"fila" + (i === sel ? " seleccionada" : "")} onClick={() => setSel(i)}>
                  <span>
                    <b>{l.prod.nombre}</b> <span className="suave">{l.prod.presentacion}</span>
                    {c?.oferta && <span className="etiqueta-oferta">{c.oferta.nombre} −{rd(c.oferta.descuento)}{c.oferta.agotada && ` · solo ${Number(c.oferta.unidades)} en oferta`}</span>}
                    {c && Number(c.descuentoCupon) > 0 && <span className="etiqueta-cupon">Cupón −{rd(c.descuentoCupon)}</span>}
                    {l.descuentoManual && <span className="etiqueta-cupon">Descuento aprobado −{rd(l.descuentoManual)}
                      <button className="mini-x" title="Quitar descuento" onClick={(e) => { e.stopPropagation(); setLineas((ls) => ls.map((x, j) => j === i ? { ...x, descuentoManual: undefined, motivoDescuento: undefined } : x)); }}>×</button></span>}
                  </span>
                  <span className="der cantidad">
                    {!l.prod.esPesable && <button className="mini" onClick={(e) => { e.stopPropagation(); cambiarCantidad(i, -1); }}>−</button>}
                    {l.prod.esPesable ? Number(l.cantidad).toFixed(3) : l.cantidad}
                    {!l.prod.esPesable && <button className="mini" onClick={(e) => { e.stopPropagation(); cambiarCantidad(i, 1); }}>+</button>}
                  </span>
                  <span className="der">{rd(precio)}</span>
                  <span className="der fuerte">{c ? rd(c.calc.total) : "—"}</span>
                </div>
              );
            })}
          </div>
          <div className="ayuda-teclas">
            <span><kbd>F2</kbd> Buscar</span><span><kbd>F3</kbd> Pausar</span><span><kbd>F4</kbd> Cliente</span><span><kbd>F6</kbd> Cupón</span>
            <span><kbd>F7</kbd> Descuento</span><span><kbd>+</kbd><kbd>−</kbd> Cantidad</span><span><kbd>Supr</kbd> Quitar</span><span><kbd>F12</kbd> Cobrar</span>
          </div>
        </section>}

        <aside className="resumen">
          <div className="bloque" onClick={() => setModal("cliente")}>
            <span className="suave">Cliente</span>
            {cliente ? (
              <div>
                <b>{cliente.nombre}</b>
                <div className="suave">Precio: {cliente.lista ?? "Precio 1 · Detalle"}{cliente.documento ? ` · ${cliente.documento}` : ""}</div>
                <button className="enlace" onClick={(e) => { e.stopPropagation(); setCliente(null); }}>Quitar</button>
              </div>
            ) : <b>Consumidor final</b>}
          </div>
          {modo === "catalogo" && (
            <section className="carrito-lateral" aria-label="Productos en la venta">
              <header className="cl-cabecera">
                <h2>Productos en la venta</h2>
                {lineas.length > 0 && (
                  <span>{lineas.length} {lineas.length === 1 ? "artículo" : "artículos"} · {
                    lineas.reduce((a, l) => a + (l.prod.esPesable ? 1 : Number(l.cantidad)), 0)} u.</span>
                )}
              </header>
              {lineas.length > 0 && (
                <div className="cl-columnas" aria-hidden="true">
                  <span>Cant.</span><span>Producto</span><span className="der">Precio</span><span className="der">Total</span><span />
                </div>
              )}
              <div className="cl-lista">
                {lineas.length === 0 && <p className="vacio-compacto">Toque un producto o escanéelo para agregarlo</p>}
                {lineas.map((l, i) => {
                  const c = cot.r?.lineas[i];
                  const precio = l.precioVariable ?? precioPara(l.prod, nivelCliente, catalogo!.nivelPredeterminado).precio ?? "0";
                  const descuento = c ? Number(c.calc.descuento) : 0;
                  return (
                    <div key={i} className={"cl-linea" + (i === sel ? " seleccionada" : "")} onClick={() => setSel(i)}>
                      {l.prod.esPesable
                        ? <span className="cl-peso">{Number(l.cantidad).toFixed(3)}<small>lb</small></span>
                        : <span className="paso compacto">
                            <button aria-label="Quitar uno" onClick={(e) => { e.stopPropagation(); Number(l.cantidad) > 1 ? cambiarCantidad(i, -1) : quitar(i); }}>−</button>
                            <b>{l.cantidad}</b>
                            <button aria-label="Agregar uno" onClick={(e) => { e.stopPropagation(); cambiarCantidad(i, 1); }}>+</button>
                          </span>}
                      <div className="cl-texto">
                        <b>{l.prod.nombre}{Number(l.prod.factor) > 1 && <small> · {l.prod.presentacion}</small>}</b>
                        <span className="cl-sub">
                          {c?.oferta && <em className="t-oferta">{c.oferta.nombre}{c.oferta.agotada && ` · solo ${Number(c.oferta.unidades)} en oferta`}</em>}
                          {l.descuentoManual && <em className="t-desc">Descuento aprobado</em>}
                          {Number(c?.descuentoCupon ?? 0) > 0 && <em className="t-desc">Cupón</em>}
                        </span>
                      </div>
                      <span className="cl-precio">{rd(precio)}{l.prod.esPesable && <small>/lb</small>}</span>
                      <div className="cl-total">
                        <b>{c ? rd(c.calc.total) : "—"}</b>
                        {descuento > 0 && <s>{rd(c!.calc.bruto)}</s>}
                      </div>
                      <button className="cl-quitar" aria-label={`Quitar ${l.prod.nombre}`} onClick={(e) => { e.stopPropagation(); quitar(i); }}>
                        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
          {cupon && (
            <div className="bloque">
              <span className="suave">Cupón</span>
              <b>{cupon.codigo}</b> <button className="enlace" onClick={() => setCupon(null)}>Quitar</button>
            </div>
          )}
          {cot.error && <p className="error">{cot.error}</p>}
          <div className="totales">
            <div><span>Subtotal</span><span>{rd(cot.r?.totales.subtotal ?? 0)}</span></div>
            <div><span>ITBIS</span><span>{rd(cot.r?.totales.itbis ?? 0)}</span></div>
            {Number(cot.r?.totales.descuento ?? 0) > 0 && (
              <div className="ahorro"><span>Ahorro</span><span>−{rd(cot.r!.totales.descuento)}</span></div>
            )}
            <div className="gran-total"><span>Total</span><span>{rd(total)}</span></div>
          </div>
          <button className="boton cobrar" disabled={!lineas.length || !!cot.error} onClick={abrirCobro}>
            Cobrar <kbd>F12</kbd>
          </button>
          <div className="dos-botones">
            <button className="boton fantasma" disabled={!lineas.length} onClick={pausar}>Pausar <kbd>F3</kbd></button>
            <button className="boton fantasma" disabled={!lineas.length} onClick={nuevaVenta}>Cancelar venta</button>
          </div>
          {ultima && (
            <div className="ultima">
              <span className="suave">Última venta #{ultima.numero} · {ultima.fiscal.encf}</span>
              <b>{rd(ultima.total)}</b>
              {Number(ultima.cambio) > 0 && <span className="cambio">Cambio {rd(ultima.cambio)}</span>}
              <button className="enlace" onClick={reimprimirUltima}>Reimprimir última factura</button>
            </div>
          )}
        </aside>
      </main>

      {aviso && <div className={"aviso " + aviso.tipo}>{aviso.texto}</div>}
      {ofertasAcabadas.length > 0 && (
        <AvisoOfertaAgotada ofertas={ofertasAcabadas} onCerrar={() => setOfertasAcabadas([])} />
      )}

      {modal === "buscar" && catalogo && (
        <Buscar catalogo={catalogo} inicial={busqueda} nivel={nivelCliente}
          onElegir={(p) => { agregar(p, "1"); setModal(null); }} onCerrar={() => setModal(null)} />
      )}
      {modal === "cliente" && (
        <ClientesCaja ajustes={ajustes} usuario={usuario} config={config} onElegir={(c) => { setCliente(c); setModal(null); }} onCerrar={() => setModal(null)} />
      )}
      {modal === "cupon" && (
        <PedirCupon ajustes={ajustes} clienteId={cliente?.id}
          onAplicar={(c) => { setCupon(c); setModal(null); avisar(`Cupón ${c.codigo} aplicado`, "ok"); }} onCerrar={() => setModal(null)} />
      )}
      {modal === "cobro" && cot.r && (
        <Cobro
          ajustes={ajustes} usuario={usuario} cliente={cliente} cupon={cupon} total={cot.r.totales.total}
          items={lineas.map((l) => ({ presentacionId: l.prod.presentacionId, cantidad: l.cantidad, descuentoManual: l.descuentoManual, precioVariable: l.precioVariable }))}
          aprobacionDescuento={lineas.some((l) => l.descuentoManual) ? aprobacion?.token : undefined}
          motivoDescuento={lineas.filter((l) => l.motivoDescuento).map((l) => `${l.prod.nombre}: ${l.motivoDescuento}`).join("; ") || undefined}
          onCerrar={() => setModal(null)}
          alFallar={conTope ? () => { cargarCatalogo().catch(() => {}); } : undefined}
          local={{
            lineas: cot.r.lineas.map((c, i) => ({
              descripcion: `${lineas[i].prod.nombre} ${lineas[i].prod.presentacion}`.trim(), cantidad: lineas[i].cantidad,
              precio: lineas[i].precioVariable ?? precioPara(lineas[i].prod, nivelCliente, catalogo!.nivelPredeterminado).precio ?? "0",
              total: c.calc.total, oferta: c.oferta?.nombre ?? null, descuentoOferta: c.oferta?.descuento ?? "0.00", descuentoCupon: c.descuentoCupon,
            })),
            totales: cot.r.totales,
            turnoId: turno.id,
            hayDescuentos: lineas.some((l) => l.descuentoManual),
          }}
          onVendido={(r) => { setUltima(r); setTicketVista({ venta: r, copia: false }); nuevaVenta(); setModal("ticket"); cargarCatalogo().catch(() => {}); }}
        />
      )}
      {modal === "delivery" && (
        <PanelDelivery
          ajustes={ajustes} usuario={usuario} cliente={cliente} cupon={cupon}
          items={lineas.map((l) => ({ presentacionId: l.prod.presentacionId, cantidad: l.cantidad, precioVariable: l.precioVariable }))}
          total={total}
          onPedidoCreado={() => { nuevaVenta(); avisar("Pedido de delivery registrado", "ok"); }}
          onCerrar={() => setModal(null)}
        />
      )}
      {modal === "ticket" && ticketVista && <Ticket venta={ticketVista.venta} copia={ticketVista.copia} config={config} usuario={usuario} onCerrar={() => setModal(null)} />}
      {modal === "precio" && pendiente && (
        <PrecioVariable nombre={pendiente.prod.nombre} min={pendiente.prod.precioVariableMin} max={pendiente.prod.precioVariableMax}
          sugerido={precioPara(pendiente.prod, nivelCliente, catalogo!.nivelPredeterminado).precio}
          onAceptar={(precio) => { const p = pendiente; setPendiente(null); setModal(null); agregar(p.prod, p.cantidad, precio); }}
          onCerrar={() => { setPendiente(null); setModal(null); }} />
      )}
      {modal === "descuento" && sel >= 0 && lineas[sel] && cot.r && (
        <Descuento
          ajustes={ajustes}
          linea={`${lineas[sel].prod.nombre} × ${lineas[sel].cantidad}`}
          importe={new Decimal(lineas[sel].cantidad).mul(lineas[sel].precioVariable ?? precioPara(lineas[sel].prod, nivelCliente, catalogo!.nivelPredeterminado).precio ?? 0).toFixed(2)}
          onAplicar={(monto, motivo, a) => {
            setLineas((ls) => ls.map((x, j) => (j === sel ? { ...x, descuentoManual: monto, motivoDescuento: motivo } : x)));
            setAprobacion(a);
            setModal(null);
            avisar(`Descuento aprobado por ${a.supervisor}`, "ok");
          }}
          onCerrar={() => setModal(null)}
        />
      )}
      {modal === "facturas" && (
        <Facturas
          ajustes={ajustes} usuario={usuario}
          onReimprimir={reimprimirUltima}
          onAnulada={(nc) => { setTicketVista({ venta: nc, copia: false }); setModal("ticket"); avisar(`Factura anulada con ${nc.fiscal.encf}`, "ok"); }}
          onCorregir={async (nc, rec) => {
            if (lineas.length) pausar();
            const nuevas = rec.items.map((it) => ({ prod: idx!.porId.get(it.presentacionId)!, cantidad: String(Number(it.cantidad)) })).filter((l) => l.prod);
            setLineas(nuevas);
            setSel(nuevas.length - 1);
            if (rec.clienteId) {
              try { setCliente(await api<Cliente>(ajustes.servidor, `/cajas/${ajustes.cajaId}/clientes/${rec.clienteId}`)); } catch { /* sigue sin cliente */ }
            }
            setTicketVista({ venta: nc, copia: false });
            setModal("ticket");
            avisar("Factura anulada. Corrija y vuelva a cobrar.", "ok");
          }}
          onCerrar={() => setModal(null)}
        />
      )}
      {modal === "pausadas" && (
        <Pausadas pausadas={pausadas} onRetomar={retomar} onDescartar={(id) => setPausadas((ps) => ps.filter((p) => p.id !== id))} onCerrar={() => setModal(null)} />
      )}
      {modal === "turno" && (
        <TurnoCaja ajustes={ajustes} config={config} usuario={usuario} turno={turno} pausadas={pausadas.length}
          onCerrado={onSalir} onCerrar={() => setModal(null)} />
      )}
    </div>
  );
}

function Modal({ titulo, children, onCerrar, ancho }: { titulo: string; children: React.ReactNode; onCerrar: () => void; ancho?: boolean }) {
  return (
    <div className="fondo-modal" onMouseDown={onCerrar}>
      <div className={"modal" + (ancho ? " ancho" : "")} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-titulo"><h3>{titulo}</h3><button className="enlace" onClick={onCerrar}>Cerrar (Esc)</button></div>
        {children}
      </div>
    </div>
  );
}
export { Modal };

function normalizar(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function Buscar({ catalogo, inicial, nivel, onElegir, onCerrar }: {
  catalogo: Catalogo; inicial: string; nivel: number; onElegir: (p: ProductoCatalogo) => void; onCerrar: () => void;
}) {
  const [q, setQ] = useState(inicial);
  const [i, setI] = useState(0);
  const res = useMemo(() => {
    const t = normalizar(q.trim());
    if (t.length < 2) return [];
    const partes = t.split(/\s+/);
    return catalogo.productos.filter((p) => {
      const h = normalizar(`${p.nombre} ${p.presentacion} ${p.sku}`);
      return partes.every((x) => h.includes(x));
    }).slice(0, 40);
  }, [q, catalogo]);
  return (
    <Modal titulo="Buscar producto" onCerrar={onCerrar}>
      <input autoFocus className="entrada-grande" value={q} placeholder="Nombre o SKU"
        onChange={(e) => { setQ(e.target.value); setI(0); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setI((x) => Math.min(res.length - 1, x + 1));
          if (e.key === "ArrowUp") setI((x) => Math.max(0, x - 1));
          if (e.key === "Enter" && res[i]) onElegir(res[i]);
        }} />
      <div className="resultados">
        {res.map((p, j) => (
          <button key={p.presentacionId} className={"resultado" + (j === i ? " activo" : "")} onClick={() => onElegir(p)}>
            <span><b>{p.nombre}</b> <span className="suave">{p.presentacion} · {p.sku}</span></span>
            <span>{rd(precioPara(p, nivel, catalogo.nivelPredeterminado).precio ?? 0)}</span>
          </button>
        ))}
        {q.trim().length >= 2 && !res.length && <p className="suave">Sin resultados</p>}
      </div>
    </Modal>
  );
}

function PedirCupon({ ajustes, clienteId, onAplicar, onCerrar }: {
  ajustes: Ajustes; clienteId?: string; onAplicar: (c: Cupon) => void; onCerrar: () => void;
}) {
  const [codigo, setCodigo] = useState("");
  const [msg, setMsg] = useState("");
  const validar = async () => {
    try {
      const q = clienteId ? `?clienteId=${clienteId}` : "";
      onAplicar(await api<Cupon>(ajustes.servidor, `/cajas/${ajustes.cajaId}/cupones/${encodeURIComponent(codigo.trim())}${q}`));
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  return (
    <Modal titulo="Aplicar cupón" onCerrar={onCerrar}>
      <input autoFocus className="entrada-grande mayusculas" value={codigo} placeholder="Código del cupón"
        onChange={(e) => setCodigo(e.target.value)} onKeyDown={(e) => e.key === "Enter" && validar()} />
      {msg && <p className="error">{msg}</p>}
      <button className="boton primario ancho" onClick={validar}>Aplicar</button>
    </Modal>
  );
}

/**
 * Aviso grande y centrado cuando una oferta con tope se acaba (en esta o en
 * otra caja). No bloquea el escáner: se cierra solo a los 8 s o con el botón.
 */
function AvisoOfertaAgotada({ ofertas, onCerrar }: { ofertas: { id: string; nombre: string }[]; onCerrar: () => void }) {
  useEffect(() => {
    const t = setTimeout(onCerrar, 8000);
    return () => clearTimeout(t);
  }, [ofertas, onCerrar]);
  return (
    <div className="aviso-oferta-agotada" role="alert" aria-live="assertive">
      <div className="aoa-tarjeta">
        <span className="aoa-icono" aria-hidden="true">!</span>
        <div className="aoa-texto">
          <b>{ofertas.length === 1 ? "Se acabó la oferta" : "Se acabaron estas ofertas"}</b>
          {ofertas.map((o) => <span key={o.id} className="aoa-nombre">{o.nombre}</span>)}
          <span className="aoa-nota">Desde ahora se cobra a precio normal.</span>
        </div>
        <button className="boton" onClick={onCerrar}>Entendido</button>
      </div>
    </div>
  );
}

/** Barra fija y bien visible cuando la caja trabaja sin servidor (y al volver). */
function AvisoConexion() {
  const c = useConexion();
  const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-DO", { timeZone: "America/Santo_Domingo", hour: "numeric", minute: "2-digit" });
  if (!c.enLinea) {
    return (
      <div className="aviso-conexion sin" role="alert">
        <b>SIN CONEXIÓN CON EL SERVIDOR{c.desde ? ` desde las ${hora(c.desde)}` : ""}</b>
        <span>Siga vendiendo: las ventas se guardan en esta caja{c.pendientes ? ` (${c.pendientes} guardada${c.pendientes === 1 ? "" : "s"})` : ""}.
          Solo factura de consumo, al contado. Avise al encargado.</span>
        {c.reserva <= 5 && <span className="poca-reserva">Quedan {c.reserva} números de factura de reserva</span>}
      </div>
    );
  }
  if (c.enviando && c.pendientes) return <div className="aviso-conexion enviando" role="status"><b>Servidor de nuevo en línea</b><span>Enviando {c.pendientes} venta(s) guardadas en esta caja…</span></div>;
  if (c.pendientes && c.errores) return <div className="aviso-conexion sin" role="alert"><b>{c.errores} venta(s) guardadas no se pudieron enviar</b><span>Llame al servicio técnico. Siguen guardadas en esta caja.</span></div>;
  if (c.pendientes) return <div className="aviso-conexion enviando" role="status"><b>Hay {c.pendientes} venta(s) guardadas por enviar</b><span>Entre con su PIN para enviarlas.</span></div>;
  if (c.aviso) return <div className="aviso-conexion ok" role="status"><b>✓ {c.aviso}</b></div>;
  return null;
}
