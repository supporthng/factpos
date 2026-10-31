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
import { TAMANOS, leerTamano, guardarTamano, leerTema, guardarTema, type Tamano, type Tema } from "./escala";
import { guardarCache, leerCache, useConexion, disponibleCupo } from "./contingencia";

/** Tamaño de letra y tema de esta terminal (además del ajuste automático a la pantalla). */
export function TamanoPantalla() {
  const [t, setT] = useState<Tamano>(leerTamano());
  const [tema, setTema] = useState<Tema>(leerTema());
  return (
    <>
      <div className="tamano-pantalla">
        <span className="suave">Tamaño de letra de esta terminal</span>
        <div className="selector-modo">
          {(Object.keys(TAMANOS) as Tamano[]).map((k) => (
            <button key={k} className={t === k ? "activo" : ""} onClick={() => { setT(k); guardarTamano(k); }}>{TAMANOS[k].nombre}</button>
          ))}
        </div>
      </div>
      <div className="tamano-pantalla">
        <span className="suave">Colores de la pantalla</span>
        <div className="selector-modo">
          <button className={tema === "claro" ? "activo" : ""} onClick={() => { setTema("claro"); guardarTema("claro"); }}>Claro</button>
          <button className={tema === "oscuro" ? "activo" : ""} onClick={() => { setTema("oscuro"); guardarTema("oscuro"); }}>Oscuro</button>
        </div>
      </div>
    </>
  );
}
import { ClientesCaja } from "./Clientes";
import { TurnoCaja } from "./Turno";
import { Facturas, Pausadas, PrecioVariable, type Aprobacion, type VentaPausada } from "./Operaciones";
import { AbrirGaveta, AjustesTerminal, CambiarPrecio, ConfirmarCancelar, Cotizacion as CotizacionImpresa, DescuentoVenta, Existencias, NotaVenta, repartir } from "./Herramientas";
import type { MetodoPago } from "./Cobro";

export interface Cliente {
  id: string; nombre: string; tipoDocumento: string; documento: string | null; telefono: string | null;
  nivel: number | null; lista: string | null; limiteCredito: string; saldo: string;
  /** Recién creado en caja para pedir comprobante fiscal: el cobro sale marcado E31 */
  nuevoParaFiscal?: boolean;
}
interface Linea {
  prod: ProductoCatalogo; cantidad: string; descuentoManual?: string; motivoDescuento?: string; precioVariable?: string;
  /** Precio bajado en caja con aprobación (se cobra como descuento) */
  precioCambiado?: string;
}

type Modal = null | "precio" | "buscar" | "cliente" | "cupon" | "cobro" | "delivery" | "turno" | "ticket" | "descuento" | "facturas" | "pausadas"
  | "cambiarPrecio" | "nota" | "cotizacion" | "existencias" | "gaveta" | "cancelar" | "ajustes";

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
  const [notas, setNotas] = useState("");
  const [metodo, setMetodo] = useState<MetodoPago>("EFECTIVO");
  const [alcanceDescuento, setAlcanceDescuento] = useState<"linea" | "factura">("linea");
  const entrada = useRef<HTMLInputElement>(null);
  const reloj = useReloj();
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
    const cupo = prod.tipo === "COMBO" ? null : disponibleCupo(prod.productoId); // sin servidor: solo su parte
    const hay = cupo ?? Number(prod.existencia);
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

  // La modalidad es una preferencia de esta caja, no de todo el navegador.
  // Se conserva F1 para alternar sin interrumpir una venta.
  const claveModo = `factpos.caja.${ajustes.cajaId}.modalidad`;
  const [modo, setModo] = useState<"escaner" | "catalogo">(() => {
    try {
      const guardado = localStorage.getItem(claveModo) ?? localStorage.getItem("factpos.modo");
      return guardado === "catalogo" ? "catalogo" : "escaner";
    } catch { return "escaner"; }
  });
  useEffect(() => {
    try {
      const guardado = localStorage.getItem(claveModo) ?? localStorage.getItem("factpos.modo");
      setModo(guardado === "catalogo" ? "catalogo" : "escaner");
    } catch { setModo("escaner"); }
  }, [claveModo]);
  useEffect(() => { try { localStorage.setItem(claveModo, modo); } catch { /* sin almacenamiento */ } }, [claveModo, modo]);
  const verCatalogo = modo === "catalogo";
  const enCarrito = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of lineas) m.set(l.prod.presentacionId, (m.get(l.prod.presentacionId) ?? 0) + Number(l.cantidad));
    return m;
  }, [lineas]);

  const [busqueda, setBusqueda] = useState("");

  const cambiarCantidad = (i: number, delta: number) => {
    if (delta > 0 && lineas[i] && !hayExistencia(lineas, lineas[i].prod, delta)) return;
    setLineas((ls) => ls.map((l, j) => (j === i ? ajustarDescuentoPorPrecio({ ...l, cantidad: String(Math.max(1, Number(l.cantidad) + delta)) }) : l)));
  };
  /** Cantidad escrita a mano en la línea */
  const fijarCantidad = (i: number, valor: string) => {
    const l = lineas[i];
    const n = Number(valor);
    if (!l || !Number.isFinite(n) || n <= 0) return;
    const entero = l.prod.esPesable ? n : Math.round(n);
    if (entero > Number(l.cantidad) && !hayExistencia(lineas, l.prod, entero - Number(l.cantidad))) return;
    setLineas((ls) => ls.map((x, j) => (j === i ? ajustarDescuentoPorPrecio({ ...x, cantidad: String(entero) }) : x)));
  };
  /** Si el precio se cambió en caja, la rebaja sigue la cantidad. */
  const ajustarDescuentoPorPrecio = (l: Linea): Linea => {
    if (!l.precioCambiado) return l;
    const actual = Number(l.precioVariable ?? precioPara(l.prod, nivelCliente, catalogo!.nivelPredeterminado).precio ?? 0);
    return { ...l, descuentoManual: Math.max(0, (actual - Number(l.precioCambiado)) * Number(l.cantidad)).toFixed(2) };
  };
  const precioDe = (l: Linea) => l.precioVariable ?? precioPara(l.prod, nivelCliente, catalogo!.nivelPredeterminado).precio ?? "0";
  const quitar = (i: number) => {
    setLineas((ls) => ls.filter((_, j) => j !== i));
    setSel((s) => Math.min(s, lineas.length - 2));
  };
  const nuevaVenta = () => {
    setLineas([]); setSel(-1); setCliente(null); setCupon(null); setAprobacion(null); setNotas(""); setMetodo("EFECTIVO"); avisadas.current = new Set();
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
      lineas, cliente, cupon, total: cot.r?.totales.total ?? "0", descuentos: aprobacion, notas,
    }]);
    nuevaVenta();
    avisar("Venta en pausa. F5 para retomarla.", "ok");
  };
  const retomar = (p: VentaPausada<Linea>) => {
    if (lineas.length) pausar(); // la actual pasa a pausa
    setPausadas((ps) => ps.filter((x) => x.id !== p.id));
    // El catálogo pudo cambiar: se toman los datos vigentes del producto
    setLineas(p.lineas.map((l) => ({ ...l, prod: idx?.porId.get(l.prod.presentacionId) ?? l.prod })));
    setCliente(p.cliente); setCupon(p.cupon); setAprobacion(p.descuentos ?? null); setNotas(p.notas ?? ""); setSel(p.lineas.length - 1);
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

  const cobrarCon = (m: MetodoPago) => { setMetodo(m); abrirCobro(); };
  const hayLinea = sel >= 0 && !!lineas[sel];
  const abrirDescuento = (alcance: "linea" | "factura") => { if (!lineas.length) return; setAlcanceDescuento(hayLinea ? alcance : "factura"); setModal("descuento"); };
  /** Bloquear: la venta en curso pasa a pausa y la caja vuelve a la pantalla del PIN. */
  const bloquear = () => { if (lineas.length) pausar(); onSalir(); };

  // Atajos de teclado
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (modal) {
        if (e.key === "Escape") setModal(null);
        return;
      }
      const conAlt: Record<string, () => void> = {
        p: () => hayLinea && setModal("cambiarPrecio"),
        n: () => setModal("nota"),
        q: () => lineas.length && setModal("cotizacion"),
        e: () => catalogo && setModal("existencias"),
        g: () => setModal("gaveta"),
      };
      if (e.altKey && conAlt[e.key.toLowerCase()]) { e.preventDefault(); conAlt[e.key.toLowerCase()](); return; }
      const mapa: Record<string, () => void> = {
        F1: () => setModo((m) => (m === "escaner" ? "catalogo" : "escaner")),
        F2: () => { setBusqueda(""); setModal("buscar"); },
        F3: () => pausar(),
        F4: () => setModal("cliente"),
        F5: () => setModal("pausadas"),
        F6: () => setModal("cupon"),
        F7: () => abrirDescuento("linea"),
        F8: () => config.modulos.delivery.activo && setModal("delivery"),
        F9: () => setModal("facturas"),
        F10: () => setModal("turno"),
        F12: () => cobrarCon("EFECTIVO"),
        Escape: () => lineas.length && setModal("cancelar"),
        Delete: () => sel >= 0 && quitar(sel),
        ArrowUp: () => setSel((s) => Math.max(0, s - 1)),
        ArrowDown: () => setSel((s) => Math.min(lineas.length - 1, s + 1)),
        "+": () => sel >= 0 && !lineas[sel]?.prod.esPesable && cambiarCantidad(sel, 1),
        "-": () => sel >= 0 && !lineas[sel]?.prod.esPesable && cambiarCantidad(sel, -1),
      };
      const f = mapa[e.key];
      const campo = document.activeElement as HTMLInputElement | null;
      const enCantidad = !!campo?.closest?.(".celda-cantidad");
      const campoVacio = !campo || !("value" in campo) || campo.value === "";
      if (f && (e.key.startsWith("F") || e.key === "Delete" || e.key === "Escape" || (e.key.startsWith("Arrow") && !enCantidad) || (campoVacio && !enCantidad))) {
        e.preventDefault();
        f();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [modal, lineas, sel, cot.error, codigo, config, cliente, cupon, aprobacion, pausadas, modo, notas, catalogo]);

  // El campo de código siempre recupera el foco
  useEffect(() => {
    if (modal) return;
    entrada.current?.focus();
  }, [modal, lineas, modo]);

  const total = cot.r?.totales.total ?? "0.00";

  const articulos = lineas.reduce((a, l) => a + (l.prod.esPesable ? 1 : Number(l.cantidad)), 0);
  const descuentoTotal = Number(cot.r?.totales.descuento ?? 0);

  return (
    <div className={"pos pos-hibrido" + (verCatalogo ? " con-catalogo" : "")}>
      <AvisoConexion />
      <header className="pv-barra">
        <div className="pv-marca">
          {config.marca.logo
            ? <img className="logo-barra" src={config.marca.logo} alt={config.empresa} />
            : <span className="marca pequena con-icono"><SimboloFactPOS tamano={28} /><span>Fact<span>POS</span></span></span>}
        </div>
        <dl className="pv-datos">
          <div><dt>Sucursal</dt><dd>{config.sucursal}</dd></div>
          <div><dt>Caja</dt><dd>{config.nombre}</dd></div>
          <div><dt>Cajero</dt><dd>{usuario.nombre}</dd></div>
          <div className="pv-fecha"><dt>{reloj.fecha}</dt><dd>{reloj.hora}</dd></div>
        </dl>
        <EstadoServidor />
        <nav className="pv-barra-acciones" aria-label="Opciones de la caja">
          <button className={"pv-icono" + (verCatalogo ? " activo" : "")} aria-pressed={verCatalogo} onClick={() => setModo(verCatalogo ? "escaner" : "catalogo")} title="Cambiar entre Caja clásica y Caja táctil (F1)">
            <Icono n="catalogo" /><span>{verCatalogo ? "Caja táctil" : "Caja clásica"}</span><kbd>F1</kbd>
          </button>
          <button className="pv-icono" onClick={() => setModal("ajustes")} title="Tamaño de letra, colores y atajos"><Icono n="ajustes" /><span>Ajustes</span></button>
          <button className="pv-icono" onClick={bloquear} title="La venta queda en pausa y se pide el PIN"><Icono n="candado" /><span>Bloquear</span></button>
          <button className="pv-icono" onClick={onSalir}><Icono n="salir" /><span>Salir</span></button>
        </nav>
      </header>

      <div className="pv-entrada">
        <div className="pv-escaner">
          <Icono n="codigo" />
          <input
            ref={entrada}
            value={codigo}
            aria-label="Código de barras, código o nombre del producto"
            placeholder={catalogo ? "Escanee o escriba código / nombre   ·   3*código = 3 unidades" : "Cargando catálogo…"}
            onChange={(e) => setCodigo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { procesarEntrada(codigo); setCodigo(""); }
            }}
          />
          <button className="pv-buscar" onClick={() => { setBusqueda(codigo.trim()); setCodigo(""); setModal("buscar"); }} title="Buscar producto (F2)">
            <Icono n="lupa" /><kbd>F2</kbd>
          </button>
        </div>
        <button className={"pv-cliente" + (cliente ? " con-cliente" : "")} onClick={() => setModal("cliente")}>
          <Icono n="persona" />
          <span className="pv-cliente-texto">
            <small>Cliente · Precio {nivelCliente}</small>
            <b>{cliente ? cliente.nombre : "Consumidor final"}</b>
            {cliente?.documento && <small>{cliente.tipoDocumento === "RNC" ? "RNC" : "Céd."} {cliente.documento}</small>}
          </span>
          <span className="pv-cliente-accion">{cliente ? "Cambiar" : "RNC / Cédula"} <kbd>F4</kbd></span>
        </button>
        {cliente && <button className="pv-quitar-cliente" aria-label="Quitar cliente" title="Volver a consumidor final" onClick={() => setCliente(null)}>×</button>}
      </div>

      <main className="pv-cuerpo">
        {verCatalogo && catalogo && (
          <section className="pv-catalogo" aria-label="Catálogo">
            <VistaCatalogo catalogo={catalogo} nivel={nivelCliente} enCarrito={enCarrito}
              onAgregar={(p) => agregar(p, "1")} onCodigo={procesarCodigo} />
          </section>
        )}

        <section className="pv-venta" aria-label="Productos de la venta">
          <header className="pv-venta-cabeza">
            <h2>Venta en curso</h2>
            <span className="suave">{lineas.length ? `${lineas.length} línea(s) · ${articulos % 1 ? articulos.toFixed(2) : articulos} artículo(s)` : "Sin productos"}</span>
            <span className="flex" />
            <button className="boton fantasma" disabled={!lineas.length} onClick={pausar}><Icono n="pausa" />Suspender <kbd>F3</kbd></button>
            <button className="boton fantasma" disabled={!lineas.length || !cot.r} onClick={() => setModal("cotizacion")}><Icono n="documento" />Cotización <kbd>Alt+Q</kbd></button>
          </header>

          <div className="pv-tabla" role="table" aria-label="Detalle de la venta">
            <div className="pv-fila pv-cabeza" role="row">
              <span role="columnheader">#</span><span role="columnheader">Descripción</span><span role="columnheader" className="centro">Cant.</span>
              <span role="columnheader" className="der">Precio</span><span role="columnheader" className="der">Desc.</span><span role="columnheader" className="der">Total</span><span />
            </div>
            {lineas.length === 0 && (
              <div className="pv-vacio">
                <Icono n="codigo" />
                <b>Escanee el primer producto</b>
                <span>o escriba su nombre arriba{verCatalogo ? ", o tóquelo en el catálogo" : " · F1 cambia a Caja táctil"}</span>
              </div>
            )}
            {lineas.map((l, i) => {
              const c = cot.r?.lineas[i];
              const precio = precioDe(l);
              const desc = c ? Number(c.calc.descuento) : 0;
              return (
                <div key={i} role="row" className={"pv-fila" + (i === sel ? " seleccionada" : "")} onClick={() => setSel(i)}>
                  <span className="pv-num">{i + 1}</span>
                  <span className="pv-desc">
                    <b>{l.prod.nombre}</b> <span className="suave">{l.prod.presentacion}</span>
                    <span className="pv-etiquetas">
                      <span className="pv-precio-mini">{rd(precio)}{l.prod.esPesable ? "/lb" : " c/u"}</span>
                      {c?.oferta && <em className="t-oferta">{c.oferta.nombre}{c.oferta.agotada && ` · solo ${Number(c.oferta.unidades)} en oferta`}</em>}
                      {l.precioCambiado && <em className="t-desc">Precio cambiado a {rd(l.precioCambiado)}</em>}
                      {l.descuentoManual && !l.precioCambiado && <em className="t-desc">Descuento aprobado</em>}
                      {c && Number(c.descuentoCupon) > 0 && <em className="t-cupon">Cupón</em>}
                      {(l.descuentoManual || l.precioCambiado) && (
                        <button className="mini-x" title="Quitar descuento o cambio de precio" onClick={(e) => { e.stopPropagation(); setLineas((ls) => ls.map((x, j) => j === i ? { ...x, descuentoManual: undefined, motivoDescuento: undefined, precioCambiado: undefined } : x)); }}>×</button>
                      )}
                    </span>
                  </span>
                  <span className="centro">
                    <CeldaCantidad linea={l} onMenos={() => (Number(l.cantidad) > 1 ? cambiarCantidad(i, -1) : quitar(i))} onMas={() => cambiarCantidad(i, 1)}
                      onFijar={(v) => fijarCantidad(i, v)} onListo={() => entrada.current?.focus()} />
                  </span>
                  <span className="der">{rd(precio)}{l.prod.esPesable && <small>/lb</small>}</span>
                  <span className={"der" + (desc > 0 ? " pv-ahorro" : " suave")}>{desc > 0 ? `−${rd(desc.toFixed(2))}` : "—"}</span>
                  <span className="der fuerte">{c ? rd(c.calc.total) : "—"}</span>
                  <button className="pv-quitar" aria-label={`Quitar ${l.prod.nombre}`} title="Quitar (Supr)" onClick={(e) => { e.stopPropagation(); quitar(i); }}><Icono n="basura" /></button>
                </div>
              );
            })}
          </div>

          <div className="pv-acciones-linea" aria-label="Acciones de la línea seleccionada">
            <button className="boton fantasma" disabled={!hayLinea} onClick={() => sel >= 0 && quitar(sel)}><Icono n="basura" />Quitar <kbd>Supr</kbd></button>
            <button className="boton fantasma" disabled={!hayLinea || !!lineas[sel]?.prod.esPesable} onClick={() => (document.querySelector(".pv-fila.seleccionada .celda-cantidad input") as HTMLInputElement | null)?.select()}>
              <Icono n="editar" />Cantidad <kbd>+</kbd><kbd>−</kbd>
            </button>
            <button className="boton fantasma" disabled={!hayLinea || !!lineas[sel]?.prod.precioVariable} onClick={() => setModal("cambiarPrecio")}><Icono n="etiqueta" />Precio <kbd>Alt+P</kbd></button>
            <button className="boton fantasma" disabled={!lineas.length} onClick={() => abrirDescuento("linea")}><Icono n="porciento" />Descuento <kbd>F7</kbd></button>
            <button className={"boton fantasma" + (notas ? " con-nota" : "")} onClick={() => setModal("nota")}><Icono n="nota" />{notas ? "Nota ✓" : "Nota"} <kbd>Alt+N</kbd></button>
            <button className={"boton fantasma" + (cupon ? " con-nota" : "")} onClick={() => (cupon ? setCupon(null) : setModal("cupon"))}><Icono n="cupon" />{cupon ? `Quitar cupón ${cupon.codigo}` : "Cupón"} <kbd>F6</kbd></button>
          </div>
          {notas && <p className="pv-nota-texto"><b>Nota:</b> {notas}</p>}
        </section>

        <aside className="pv-cobro" aria-label="Total y cobro">
          <div className="pv-total">
            <span>Total a pagar</span>
            <b aria-live="polite">{rd(total)}</b>
            {cot.r && <small>{articulos % 1 ? articulos.toFixed(2) : articulos} artículo(s){descuentoTotal > 0 ? ` · ahorra ${rd(descuentoTotal.toFixed(2))}` : ""}</small>}
          </div>
          <dl className="pv-desglose">
            <div><dt>Subtotal</dt><dd>{rd(cot.r?.totales.subtotal ?? 0)}</dd></div>
            <div className={descuentoTotal > 0 ? "ahorro" : ""}><dt>Descuentos</dt><dd>{descuentoTotal > 0 ? `−${rd(descuentoTotal.toFixed(2))}` : rd(0)}</dd></div>
            <div><dt>ITBIS</dt><dd>{rd(cot.r?.totales.itbis ?? 0)}</dd></div>
          </dl>
          {cot.error && <p className="error">{cot.error}</p>}

          <span className="pv-titulo-pago">Forma de pago</span>
          <div className="pv-metodos">
            {([["EFECTIVO", "Efectivo", "billete"], ["TARJETA", "Tarjeta", "tarjeta"], ["TRANSFERENCIA", "Transferencia", "banco"], ["MIXTO", "Mixto", "mixto"]] as const).map(([m, t, ic]) => (
              <button key={m} className="pv-metodo" disabled={!lineas.length || !!cot.error} onClick={() => cobrarCon(m)}>
                <Icono n={ic} /><span>{t}</span>
              </button>
            ))}
          </div>
          <button className="boton cobrar" disabled={!lineas.length || !!cot.error} onClick={() => cobrarCon("EFECTIVO")}>
            Cobrar <kbd>F12</kbd>
          </button>
          {ultima && (
            <div className="pv-ultima">
              <span>Última: #{ultima.numero} · {rd(ultima.total)}{Number(ultima.cambio) > 0 && <> · <b className="cambio">cambio {rd(ultima.cambio)}</b></>}</span>
              <button className="enlace" onClick={reimprimirUltima}>Reimprimir</button>
            </div>
          )}
        </aside>
      </main>

      <footer className="pv-funciones" aria-label="Funciones">
        <BotonFuncion tono="rojo" icono="x" texto="Cancelar venta" tecla="Esc" disabled={!lineas.length} onClick={() => setModal("cancelar")} />
        <BotonFuncion tono="azul" icono="lupa" texto="Buscar producto" tecla="F2" onClick={() => { setBusqueda(""); setModal("buscar"); }} />
        <BotonFuncion tono="ambar" icono="pausa" texto={`En pausa${pausadas.length ? ` (${pausadas.length})` : ""}`} tecla="F5" onClick={() => setModal("pausadas")} />
        <BotonFuncion tono="violeta" icono="devolucion" texto="Facturas y devolución" tecla="F9" onClick={() => setModal("facturas")} />
        <BotonFuncion tono="gris" icono="caja" texto="Existencias" tecla="Alt+E" disabled={!catalogo} onClick={() => setModal("existencias")} />
        <BotonFuncion tono="gris" icono="impresora" texto="Reimprimir última" tecla="" disabled={!ultima} onClick={reimprimirUltima} />
        <BotonFuncion tono="verde" icono="gaveta" texto="Abrir gaveta" tecla="Alt+G" onClick={() => setModal("gaveta")} />
        {config.modulos.delivery.activo && <BotonFuncion tono="gris" icono="moto" texto="Delivery" tecla="F8" onClick={() => setModal("delivery")} />}
        <BotonFuncion tono="tinta" icono="cierre" texto="Turno y cierre" tecla="F10" onClick={() => setModal("turno")} />
      </footer>

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
          metodo={metodo}
          notas={notas}
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
      {modal === "descuento" && cot.r && (
        <DescuentoVenta
          ajustes={ajustes}
          inicial={alcanceDescuento}
          linea={hayLinea ? `${lineas[sel].prod.nombre} × ${lineas[sel].cantidad}` : null}
          importeLinea={hayLinea ? new Decimal(lineas[sel].cantidad).mul(precioDe(lineas[sel])).toFixed(2) : "0"}
          importeFactura={lineas.reduce((a, l) => a.plus(new Decimal(l.cantidad).mul(precioDe(l))), new Decimal(0)).toFixed(2)}
          onAplicar={(alc, monto, motivo, a) => {
            if (alc === "linea") {
              setLineas((ls) => ls.map((x, j) => (j === sel ? { ...x, descuentoManual: monto, motivoDescuento: motivo, precioCambiado: undefined } : x)));
            } else {
              const partes = repartir(monto, lineas.map((l) => Number(l.cantidad) * Number(precioDe(l))));
              setLineas((ls) => ls.map((x, j) => ({ ...x, descuentoManual: Number(partes[j]) > 0 ? partes[j] : undefined, motivoDescuento: `Descuento a la factura: ${motivo}`, precioCambiado: undefined })));
            }
            setAprobacion(a);
            setModal(null);
            avisar(`Descuento aprobado por ${a.supervisor}`, "ok");
          }}
          onCerrar={() => setModal(null)}
        />
      )}
      {modal === "cambiarPrecio" && hayLinea && (
        <CambiarPrecio ajustes={ajustes} nombre={lineas[sel].prod.nombre} cantidad={lineas[sel].cantidad} precioActual={precioDe(lineas[sel])}
          onAplicar={(nuevo, descuento, motivo, a) => {
            setLineas((ls) => ls.map((x, j) => (j === sel ? { ...x, precioCambiado: nuevo, descuentoManual: descuento, motivoDescuento: motivo } : x)));
            setAprobacion(a);
            setModal(null);
            avisar(`Precio aprobado por ${a.supervisor}`, "ok");
          }}
          onCerrar={() => setModal(null)} />
      )}
      {modal === "nota" && <NotaVenta inicial={notas} onGuardar={(t) => { setNotas(t); setModal(null); }} onCerrar={() => setModal(null)} />}
      {modal === "cotizacion" && cot.r && (
        <CotizacionImpresa config={config} usuario={usuario} cliente={cliente} notas={notas} totales={cot.r.totales}
          lineas={cot.r.lineas.map((c, i) => ({
            descripcion: `${lineas[i].prod.nombre} ${lineas[i].prod.presentacion}`.trim(), cantidad: lineas[i].cantidad,
            precio: precioDe(lineas[i]), total: c.calc.total,
            nota: c.oferta?.nombre ?? (lineas[i].precioCambiado ? `Precio especial ${rd(lineas[i].precioCambiado!)}` : lineas[i].descuentoManual ? "Descuento aplicado" : null),
          }))}
          onCerrar={() => setModal(null)} />
      )}
      {modal === "existencias" && catalogo && (
        <Existencias catalogo={catalogo} nivel={nivelCliente} onAgregar={(p) => { agregar(p, "1"); setModal(null); }} onCerrar={() => setModal(null)} />
      )}
      {modal === "gaveta" && (
        <AbrirGaveta ajustes={ajustes} usuario={usuario} onListo={(sup) => { setModal(null); avisar(`Gaveta abierta · autorizó ${sup}`, "ok"); }} onCerrar={() => setModal(null)} />
      )}
      {modal === "cancelar" && (
        <ConfirmarCancelar articulos={lineas.length} total={total} onConfirmar={() => { nuevaVenta(); setModal(null); avisar("Venta cancelada", "ok"); }} onCerrar={() => setModal(null)} />
      )}
      {modal === "ajustes" && <AjustesTerminal config={config} onCerrar={() => setModal(null)} />}
      {modal === "facturas" && (
        <Facturas
          ajustes={ajustes} usuario={usuario}
          onReimprimir={reimprimirUltima}
          onAnulada={(nc) => { setTicketVista({ venta: nc, copia: false }); setModal("ticket"); avisar(`Factura anulada${nc.fiscal?.encf ? ` con ${nc.fiscal.encf}` : ""}`, "ok"); }}
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
      <input autoFocus className="entrada-grande entrada-texto" value={q} placeholder="Nombre o SKU"
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
      <input autoFocus className="entrada-grande entrada-texto mayusculas" value={codigo} placeholder="Código del cupón"
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

/** Fecha y hora de RD para la barra (se actualiza cada 20 s). */
function useReloj() {
  const [ahora, setAhora] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setAhora(new Date()), 20_000); return () => clearInterval(t); }, []);
  const z = { timeZone: "America/Santo_Domingo" } as const;
  return {
    fecha: ahora.toLocaleDateString("es-DO", { ...z, weekday: "short", day: "numeric", month: "short" }),
    hora: ahora.toLocaleTimeString("es-DO", { ...z, hour: "numeric", minute: "2-digit" }),
  };
}

/** Punto de estado del servidor de la tienda, siempre a la vista. */
function EstadoServidor() {
  const c = useConexion();
  return (
    <span className={"pv-estado" + (c.enLinea ? "" : " sin")} role="status" title={c.enLinea ? "Conectada al servidor de la tienda" : "Sin servidor: solo factura de consumo al contado"}>
      <i aria-hidden="true" />{c.enLinea ? "En línea" : "Sin servidor"}
    </span>
  );
}

/** Cantidad de la línea: − [n] +, y se puede escribir. Enter o salir del campo la confirma. */
function CeldaCantidad({ linea, onMenos, onMas, onFijar, onListo }: {
  linea: { cantidad: string; prod: ProductoCatalogo }; onMenos: () => void; onMas: () => void; onFijar: (v: string) => void; onListo: () => void;
}) {
  const [valor, setValor] = useState(linea.cantidad);
  useEffect(() => setValor(linea.cantidad), [linea.cantidad]);
  if (linea.prod.esPesable) return <span className="celda-peso">{Number(linea.cantidad).toFixed(3)} <small>lb</small></span>;
  const confirmar = () => { if (valor !== linea.cantidad) onFijar(valor); };
  return (
    <span className="celda-cantidad" onClick={(e) => e.stopPropagation()}>
      <button type="button" aria-label="Uno menos" onClick={onMenos}>−</button>
      <input inputMode="numeric" aria-label={`Cantidad de ${linea.prod.nombre}`} value={valor}
        onChange={(e) => setValor(e.target.value.replace(/[^\d]/g, "").slice(0, 5))}
        onFocus={(e) => e.target.select()}
        onBlur={confirmar}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); confirmar(); onListo(); }
          if (e.key === "Escape") { e.stopPropagation(); setValor(linea.cantidad); onListo(); }
        }} />
      <button type="button" aria-label="Uno más" onClick={onMas}>+</button>
    </span>
  );
}

function BotonFuncion({ tono, icono, texto, tecla, onClick, disabled }: {
  tono: "rojo" | "azul" | "ambar" | "violeta" | "verde" | "gris" | "tinta"; icono: string; texto: string; tecla: string; onClick: () => void; disabled?: boolean;
}) {
  return (
    <button className={"pv-funcion " + tono} onClick={onClick} disabled={disabled}>
      <Icono n={icono} />
      <span>{texto}</span>
      {tecla && <kbd>{tecla}</kbd>}
    </button>
  );
}

/** Íconos de trazo, del mismo grosor, para la pantalla de venta. */
function Icono({ n }: { n: string }) {
  const d: Record<string, React.ReactNode> = {
    catalogo: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
    ajustes: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
    candado: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>,
    salir: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5M21 12H9" /></>,
    codigo: <><path d="M3 5v14M6 5v14M10 5v14M13 5v14M17 5v14M21 5v14" /></>,
    lupa: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></>,
    persona: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
    pausa: <><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></>,
    documento: <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6M8 13h8M8 17h5" /></>,
    basura: <><path d="M3 6h18M8 6V4h8v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14" /></>,
    editar: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></>,
    etiqueta: <><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" /><circle cx="7.5" cy="7.5" r="1.5" /></>,
    porciento: <><path d="M19 5 5 19" /><circle cx="6.5" cy="6.5" r="2.5" /><circle cx="17.5" cy="17.5" r="2.5" /></>,
    nota: <><path d="M4 4h16v12l-4 4H4z" /><path d="M16 20v-4h4M8 9h8M8 13h5" /></>,
    cupon: <><path d="M3 8a2 2 0 0 0 0 4v4h18v-4a2 2 0 0 1 0-4V4H3z" transform="translate(0 2)" /><path d="M13 6v14" strokeDasharray="2 2" /></>,
    billete: <><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 12h.01M18 12h.01" /></>,
    tarjeta: <><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20M6 15h4" /></>,
    banco: <><path d="M3 10 12 4l9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18" /></>,
    mixto: <><rect x="2" y="7" width="12" height="9" rx="1.5" /><rect x="10" y="10" width="12" height="9" rx="1.5" /></>,
    x: <><path d="M6 6l12 12M18 6 6 18" /></>,
    devolucion: <><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></>,
    caja: <><path d="M21 8 12 3 3 8v8l9 5 9-5z" /><path d="M3 8l9 5 9-5M12 13v8" /></>,
    impresora: <><path d="M6 9V3h12v6" /><rect x="3" y="9" width="18" height="8" rx="2" /><path d="M6 14h12v7H6z" /></>,
    gaveta: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 12h18M10 16h4" /></>,
    moto: <><circle cx="6" cy="17" r="3" /><circle cx="18" cy="17" r="3" /><path d="M9 17h6l-3-6h-4M15 6h3l3 8" /></>,
    cierre: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  };
  return (
    <svg className="icono" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {d[n] ?? null}
    </svg>
  );
}
