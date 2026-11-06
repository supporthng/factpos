import { publicarMarca, publicarCarrito, publicarGracias } from "./pantalla-cliente";
import { BotonTeclado } from "./Teclado";
import { versionCliente } from "./version";
import { modoInicial } from "./vista";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  cotizarCarrito, marcaEfectiva, indexarCatalogo, precioPara, ofertasPara, leerCodigoBalanza, ErrorCarrito,
  type Catalogo, type ProductoCatalogo, type Cupon, type Cotizacion,
} from "@factpos/compartido";
import { Decimal } from "decimal.js";
import { api, rd, leerAjustes, type Ajustes } from "./api";
import type { ConfigCaja, Turno, Usuario } from "./App";
import { Cobro, type ResultadoVenta } from "./Cobro";
import { PanelDelivery } from "./Delivery";
import { Ticket, type VentaRegistrada } from "./Ticket";
import { SimboloFactPOS } from "./Logo";
import { VistaCatalogo } from "./Catalogo";
import { TAMANOS, leerTamano, guardarTamano, leerTema, guardarTema, type Tamano, type Tema } from "./escala";
import { guardarCache, leerCache, useConexion, disponibleCupo, pedirExistencia, exportarPendientes } from "./contingencia";

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
import { MovimientosCaja, PagoFactura } from "./Caja";
import { Facturas, Pausadas, PinSupervisor, PrecioVariable, type Aprobacion, type VentaPausada } from "./Operaciones";
import { AbrirGaveta, AjustesTerminal, CambiarPrecio, ConfirmarCancelar, Cotizacion as CotizacionImpresa, DescuentoVenta, Existencias, NotaVenta, repartir } from "./Herramientas";
import type { MetodoPago } from "./Cobro";
import { PanelPedidos, type PedidoDetalle } from "./Pedidos";
import { requiereDocumento, tieneDocumentoFiscal, type TipoComprobante } from "./Comprobante";

export interface Cliente {
  id: string; nombre: string; tipoDocumento: string; documento: string | null; telefono: string | null;
  nivel: number | null; lista: string | null; limiteCredito: string; diasCredito?: number; saldo: string;
  /** Recién creado en caja para pedir comprobante fiscal: el cobro sale marcado E31 */
  nuevoParaFiscal?: boolean;
}
interface Linea {
  prod: ProductoCatalogo; cantidad: string; descuentoManual?: string; motivoDescuento?: string; precioVariable?: string;
  /** Precio bajado en caja con aprobación (se cobra como descuento) */
  precioCambiado?: string;
}

type Modal = null | "precio" | "buscar" | "cliente" | "cupon" | "cobro" | "delivery" | "turno" | "ticket" | "descuento" | "facturas" | "facturasPin" | "pausadas"
  | "pedidos" | "cambiarPrecio" | "nota" | "cotizacion" | "existencias" | "gaveta" | "cancelar" | "ajustes" | "consulta" | "salida" | "pagoFactura";

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
  /** Pedido de cliente cargado en la venta: al cobrar, queda facturado */
  // Versión instalada (la del servidor), visible en la barra superior
  const [versionApp, setVersionApp] = useState("");
  useEffect(() => {
    fetch(`${ajustes.servidor.replace(/\/$/, "")}/actualizacion/estado`, { cache: "no-store" }).then((r) => r.json())
      .then((d) => setVersionApp(versionCliente(String(d.version ?? "")))).catch(() => {});
  }, [ajustes.servidor]);
  /** Tipo de comprobante de esta venta (Consumo por defecto) */
  const [tipoComp, setTipoComp] = useState<TipoComprobante>(config.funciones?.sinComprobante ? "SIN" : "E32");
  const volverACobro = useRef(false);
  /** El cajero cerró la búsqueda de cliente sin elegir: al volver al cobro no se abre otra vez sola (sería imposible cerrarla) */
  const clienteOmitido = useRef(false);
  const [pedidoActivo, setPedidoActivo] = useState<{ id: string; numero: string } | null>(null);
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
  const existenciasRef = useRef<() => Promise<void>>(async () => {});
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
  /** Pone al día solo las existencias (unos KB), sin bajar de nuevo el catálogo completo. */
  const refrescarExistencias = useCallback(async () => {
    const m = await api<Record<string, string>>(ajustes.servidor, `/cajas/${ajustes.cajaId}/existencias`);
    setCatalogo((c) => {
      if (!c) return c;
      const n = { ...c, productos: c.productos.map((p) => (m[p.presentacionId] !== undefined ? { ...p, existencia: m[p.presentacionId] } : p)) };
      guardarCache(ajustes, "catalogo", n);
      return n;
    });
  }, [ajustes]);
  existenciasRef.current = refrescarExistencias;
  useEffect(() => {
    cargarCatalogo().catch(async (e) => {
      // Sin servidor: el último catálogo guardado en esta caja
      const c = await leerCache<Catalogo>(ajustes, "catalogo");
      if (c) setCatalogo((actual) => actual ?? c);
      else setAviso({ texto: e.message, tipo: "error" });
    });
    let vuelta = 0;
    const t = setInterval(async () => {
      try {
        if (++vuelta % 3 === 0) refrescarExistencias().catch(() => {}); // cada 30 s: lo que venden las otras cajas
        const v = await api<{ version: string }>(ajustes.servidor, `/cajas/${ajustes.cajaId}/catalogo/version`);
        setCatalogo((actual) => {
          if (actual && actual.version !== v.version) cargarCatalogo();
          return actual;
        });
      } catch { /* sin conexión: se sigue vendiendo con el catálogo actual */ }
    }, 10000); // cada 10 s: así las demás cajas ven pronto una oferta agotada
    return () => clearInterval(t);
  }, [ajustes, cargarCatalogo, refrescarExistencias]);

  const nivelCliente = cliente?.nivel ?? catalogo?.nivelPredeterminado ?? 1;
  // Precios 2 y 3 como % de descuento sobre el precio 1: se muestra el precio 1 y el descuento se marca en cada línea
  const descNivelPct = catalogo?.descuentosNivel?.[String(nivelCliente)] ?? null;
  const nivelPrecio = descNivelPct && catalogo ? catalogo.nivelPredeterminado : nivelCliente;

  // Cotización local, instantánea
  const cot = useMemo((): { r: Cotizacion | null; error: string } => {
    if (!catalogo || !lineas.length) return { r: null, error: "" };
    const motor = lineas.map((l) => ({
      cantidad: l.cantidad,
      precio: l.precioVariable ?? precioPara(l.prod, nivelPrecio, catalogo.nivelPredeterminado).precio ?? "0",
      tasaItbis: l.prod.tasaItbis,
      precioIncluyeItbis: l.prod.precioIncluyeItbis,
      esPesable: l.prod.esPesable,
      nombre: l.prod.nombre,
      ofertas: ofertasPara(catalogo, l.prod, nivelCliente),
      factor: l.prod.factor,
      descuentoManual: l.descuentoManual,
      descuentoNivelPct: descNivelPct && !l.precioVariable ? descNivelPct : undefined,
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
  }, [catalogo, lineas, cupon, nivelCliente, nivelPrecio, descNivelPct]);

  // Confirmación de venta: grande y al centro; se quita sola a los 10 s o al tocar la pantalla
  const [confirmacion, setConfirmacion] = useState<{ titulo: string; cambio: string | null; nota: string | null } | null>(null);
  useEffect(() => {
    if (!confirmacion) return;
    const t = setTimeout(() => setConfirmacion(null), 10_000);
    return () => clearTimeout(t);
  }, [confirmacion]);
  const avisar = (texto: string, tipo: "error" | "ok" = "error") => {
    setAviso({ texto, tipo });
    setTimeout(() => setAviso((a) => (a?.texto === texto ? null : a)), 5000);
  };

  // Pantalla del cliente (segunda ventana): marca y ofertas, carrito en vivo y el «gracias» al terminar
  useEffect(() => {
    const ef = marcaEfectiva(config.marca); // sin «usar los colores del logo», la segunda pantalla también usa los de FactPOS
    publicarMarca({ empresa: config.empresa, logo: config.marca.logo, primario: ef.primario, secundario: ef.secundario ?? null, pantalla: config.marca.pantallaCliente ?? {} });
  }, [config]);
  useEffect(() => {
    const r = cot.r;
    publicarCarrito({
      fase: modal === "cobro" ? "cobro" : "venta",
      cliente: requiereDocumento(tipoComp) && cliente ? { nombre: cliente.nombre, documento: cliente.documento } : null,
      lineas: r ? lineas.map((l, i) => {
        const c = r.lineas[i]!.calc;
        const cant = Number(l.cantidad) || 1;
        return { nombre: l.prod.nombre, cantidad: l.cantidad, precio: (Number(c.bruto) / cant).toFixed(2), total: c.total, descuento: c.descuento };
      }) : [],
      subtotal: r?.totales.subtotal ?? "0", descuento: r?.totales.descuento ?? "0", itbis: r?.totales.itbis ?? "0", total: r?.totales.total ?? "0",
    });
  }, [cot.r, lineas, modal, tipoComp, cliente]);
  const primeraUltima = useRef(true);
  useEffect(() => {
    if (primeraUltima.current) { primeraUltima.current = false; return; }   // la última venta que se carga al abrir no es un «gracias»
    if (ultima) publicarGracias({ total: ultima.total, cambio: ultima.cambio, en: Date.now() });
  }, [ultima]);

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
  /**
   * Cuánto de lo pedido se puede agregar según la existencia (en unidades de la línea).
   * Si alcanza todo → todo; si alcanza solo una parte → esa parte y se avisa; si está agotado → 0 y se avisa.
   * Con «permitir facturar sin existencia» activo en el producto se agrega todo (con un aviso).
   */
  const cantidadPermitida = (ls: Linea[], prod: ProductoCatalogo, extra: number): number => {
    if (!prod.controlaStock || prod.existencia === undefined) return extra;
    const factor = Number(prod.factor);
    const ya = demanda(ls, prod, 0);
    const pide = ya + extra * factor;
    const cupo = prod.tipo === "COMBO" ? null : disponibleCupo(prod.productoId); // sin servidor: solo su parte
    const hay = cupo ?? Number(prod.existencia);
    if (pide <= hay) return extra;
    if (cupo !== null) void pedirExistencia(ajustes, prod.productoId, pide - hay); // la caja principal pide a las demás
    if (prod.permiteSinExistencia !== false) {
      // Se permite vender sin existencia: se agrega todo y se avisa la primera vez que pasa la existencia del sistema
      if (ya <= hay) avisar(`${prod.nombre}: el sistema no tiene existencia suficiente. Avise al encargado.`);
      return extra;
    }
    const quedan = Math.max(0, hay - ya);
    const caben = prod.esPesable ? Math.floor((quedan / factor) * 1000) / 1000 : Math.floor(quedan / factor + 1e-9);
    if (caben <= 0) {
      avisar(ya > 0 ? `${prod.nombre}: ya agregó toda la existencia (${hay})` : `${prod.nombre} está agotado: no se puede facturar sin existencia`);
      return 0;
    }
    avisar(`${prod.nombre}: existencia solo ${hay}. Se agregaron ${caben}.`);
    return caben;
  };

  const agregar = (prod: ProductoCatalogo, cantidad: string, precioDado?: string) => {
    if (!prod.precioVariable && precioPara(prod, nivelPrecio, catalogo!.nivelPredeterminado).precio === null) {
      return avisar(`${prod.nombre} no tiene precio`);
    }
    if (prod.precioVariable && !precioDado) {
      setPendiente({ prod, cantidad });
      return setModal("precio");
    }
    const permitida = cantidadPermitida(lineas, prod, Number(cantidad));
    if (permitida <= 0) return;
    if (permitida < Number(cantidad)) cantidad = String(permitida);
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
  // Abre con la vista elegida en Ajustes (Caja clásica o táctil) o, si no se eligió ninguna, con la última que se usó
  const [modo, setModo] = useState<"escaner" | "catalogo">(() => modoInicial(ajustes.cajaId));
  useEffect(() => { setModo(modoInicial(ajustes.cajaId)); }, [ajustes.cajaId]);
  useEffect(() => { try { localStorage.setItem(claveModo, modo); } catch { /* sin almacenamiento */ } }, [claveModo, modo]);
  const verCatalogo = modo === "catalogo";
  // Ancho del carrito en la Caja táctil: se arrastra el borde con el mouse o el dedo (o con las flechas) y queda guardado en esta caja
  const catRef = useRef<HTMLElement>(null);
  const ventaRef = useRef<HTMLElement>(null);
  const claveAncho = `factpos.caja.${ajustes.cajaId}.anchoCarrito`;
  const [anchoCat, setAnchoCat] = useState<number | null>(() => { try { const n = Number(localStorage.getItem(claveAncho)); return n >= 300 ? n : null; } catch { return null; } });
  const escalaActual = () => Number(getComputedStyle(document.documentElement).getPropertyValue("--escala")) || 1;
  const limitarAncho = (w: number) => Math.max(340, Math.min(w, window.innerWidth / escalaActual() - 28 - 12 - 380));
  const guardarAncho = (w: number | null) => { try { if (w == null) localStorage.removeItem(claveAncho); else localStorage.setItem(claveAncho, String(Math.round(w))); } catch { /* sin almacenamiento */ } };
  const arrastrarDivisor = (e: React.PointerEvent) => {
    e.preventDefault();
    const x0 = e.clientX, w0 = ventaRef.current?.offsetWidth ?? 440, esc = escalaActual();
    let ultimo = w0;
    const mover = (ev: PointerEvent) => { ultimo = limitarAncho(w0 + (ev.clientX - x0) / esc); setAnchoCat(ultimo); };
    const soltar = () => { window.removeEventListener("pointermove", mover); window.removeEventListener("pointerup", soltar); guardarAncho(ultimo); };
    window.addEventListener("pointermove", mover); window.addEventListener("pointerup", soltar);
  };
  const ajustarAncho = (delta: number) => { const w = limitarAncho((anchoCat ?? ventaRef.current?.offsetWidth ?? 440) + delta); setAnchoCat(w); guardarAncho(w); };
  const restablecerAncho = () => { setAnchoCat(null); guardarAncho(null); };
  const enCarrito = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of lineas) m.set(l.prod.presentacionId, (m.get(l.prod.presentacionId) ?? 0) + Number(l.cantidad));
    return m;
  }, [lineas]);

  const [busqueda, setBusqueda] = useState("");

  const cambiarCantidad = (i: number, delta: number) => {
    let d = delta;
    if (delta > 0 && lineas[i]) { d = Math.min(delta, cantidadPermitida(lineas, lineas[i].prod, delta)); if (d <= 0) return; }
    setLineas((ls) => ls.map((l, j) => (j === i ? ajustarDescuentoPorPrecio({ ...l, cantidad: String(Math.max(1, Number(l.cantidad) + d)) }) : l)));
  };
  /** Cantidad escrita a mano en la línea */
  const fijarCantidad = (i: number, valor: string) => {
    const l = lineas[i];
    const n = Number(valor);
    if (!l || !Number.isFinite(n) || n <= 0) return;
    let entero = l.prod.esPesable ? n : Math.round(n);
    if (entero > Number(l.cantidad)) {
      const extra = entero - Number(l.cantidad);
      const ok = cantidadPermitida(lineas, l.prod, extra);
      if (ok <= 0) return;
      entero = Number(l.cantidad) + Math.min(extra, ok);
    }
    setLineas((ls) => ls.map((x, j) => (j === i ? ajustarDescuentoPorPrecio({ ...x, cantidad: String(entero) }) : x)));
  };
  /** Si el precio se cambió en caja, la rebaja sigue la cantidad. */
  const ajustarDescuentoPorPrecio = (l: Linea): Linea => {
    if (!l.precioCambiado) return l;
    const actual = Number(l.precioVariable ?? precioPara(l.prod, nivelPrecio, catalogo!.nivelPredeterminado).precio ?? 0);
    return { ...l, descuentoManual: Math.max(0, (actual - Number(l.precioCambiado)) * Number(l.cantidad)).toFixed(2) };
  };
  const precioDe = (l: Linea) => l.precioVariable ?? precioPara(l.prod, nivelPrecio, catalogo!.nivelPredeterminado).precio ?? "0";
  const quitar = (i: number) => {
    setLineas((ls) => ls.filter((_, j) => j !== i));
    setSel((s) => Math.min(s, lineas.length - 2));
  };
  const nuevaVenta = () => {
    setPedidoActivo(null); setTipoComp(config.funciones?.sinComprobante ? "SIN" : "E32");
    setLineas([]); setSel(-1); setCliente(null); setCupon(null); setAprobacion(null); setNotas(""); setMetodo("EFECTIVO"); avisadas.current = new Set();
  };

  // Aprobación del supervisor para los descuentos de esta venta
  const [aprobacion, setAprobacion] = useState<Aprobacion | null>(null);
  const [ticketVista, setTicketVista] = useState<{ venta: VentaRegistrada; copia: boolean } | null>(null);
  /** Comprobante que se imprime solo al cobrar (sin vista previa) */
  const [ticketAuto, setTicketAuto] = useState<VentaRegistrada | null>(null);

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
  /** Pasa un pedido completo (alistado) a la venta: los precios son los de hoy y el nivel de su cliente. */
  const facturarPedido = async (p: PedidoDetalle) => {
    if (lineas.length) return avisar("Termine o ponga en pausa la venta actual antes de facturar el pedido.");
    const nuevas: Linea[] = [];
    const faltan: string[] = [];
    for (const it of p.items) {
      const prod = idx?.porId.get(it.presentacionId);
      if (!prod) faltan.push(it.producto); else nuevas.push({ prod, cantidad: String(Number(it.cantidad)) });
    }
    if (faltan.length) return avisar(`No están en el catálogo de esta caja: ${faltan.join(", ")}. Actualice el catálogo.`);
    let c: Cliente | null = null;
    if (p.clienteId) { try { c = await api<Cliente>(ajustes.servidor, `/cajas/${ajustes.cajaId}/clientes/${p.clienteId}`); } catch { /* se factura sin cliente registrado */ } }
    setLineas(nuevas); setSel(nuevas.length - 1); setCliente(c); setNotas(`Pedido ${p.numero} · ${p.clienteNombre}`);
    setPedidoActivo({ id: p.id, numero: p.numero });
    setModal(null);
    avisar(`Pedido ${p.numero} cargado. Revise y cobre para cerrarlo.`, "ok");
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
  // Salir cierra FactPOS. Con el turno abierto pide la aprobación de un supervisor (lo maneja la pantalla principal).
  // En el navegador no se puede cerrar la ventana: ahí vuelve a la pantalla de usuarios.
  const salirDelSistema = () => {
    window.dispatchEvent(new Event("factpos:salir-sistema"));
  };
  const bloquear = () => { if (lineas.length) pausar(); onSalir(); };
  // Si se autoriza cerrar FactPOS con una venta en curso, queda en pausa
  useEffect(() => {
    const f = () => { if (lineas.length) pausar(); };
    window.addEventListener("factpos:antes-salir", f);
    return () => window.removeEventListener("factpos:antes-salir", f);
  });

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
        o: () => setModal("pedidos"),
        c: () => catalogo && setModal("consulta"),
        s: () => setModal("salida"),
        f: () => setModal("pagoFactura"),
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
        F9: () => setModal("facturasPin"),
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

  // El campo de código siempre recupera el foco: en la Caja clásica es la barra de arriba; en la táctil, la búsqueda del catálogo (ahí escanea el lector)
  const [masAbierto, setMasAbierto] = useState(false);
  const [cdAbierto, setCdAbierto] = useState(false);
  // Doble clic / doble toque sobre el precio de una línea: abre los 3 precios definidos (el cambio pide autorización)
  const abrirPrecio = (e: React.SyntheticEvent, i: number) => {
    e.stopPropagation();
    if (lineas[i]?.prod.precioVariable) return;
    setSel(i); setModal("cambiarPrecio");
  };
  const enfocarEntrada = () => { (entrada.current ?? document.querySelector<HTMLInputElement>("[data-entrada-principal]"))?.focus(); };
  useEffect(() => {
    if (modal) return;
    enfocarEntrada();
    const t = setTimeout(enfocarEntrada, 400); // la búsqueda del catálogo aparece cuando termina de cargar
    return () => clearTimeout(t);
  }, [modal, lineas, modo, catalogo]);

  // Respaldo del lector: si el foco quedó en el fondo, el primer carácter lo devuelve a la barra de código
  useEffect(() => {
    if (modal) return;
    const h = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey || e.key.length !== 1) return;
      const a = document.activeElement as HTMLElement | null;
      if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT" || a.isContentEditable)) return;
      enfocarEntrada();
    };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [modal]);

  const total = cot.r?.totales.total ?? "0.00";

  const articulos = lineas.reduce((a, l) => a + (l.prod.esPesable ? 1 : Number(l.cantidad)), 0);
  const descuentoTotal = Number(cot.r?.totales.descuento ?? 0);

  const clienteBloque = (
      <div className="pv-cliente-panel">
        <button className={"pv-cliente" + (cliente ? " con-cliente" : "")} onClick={() => setModal("cliente")}>
          <Icono n="persona" />
          <span className="pv-cliente-texto">
            <small>Precio {nivelCliente}</small>
            <b>{cliente ? cliente.nombre : "CLIENTE GENERICO"}</b>
            {cliente?.documento && <small>{cliente.tipoDocumento === "RNC" ? "RNC" : "Céd."} {cliente.documento}</small>}
          </span>
          <span className="pv-cliente-accion">{cliente ? "Cambiar" : "RNC / Cédula"} <kbd>F4</kbd></span>
        </button>
        {cliente && <button className="pv-quitar-cliente" aria-label="Quitar cliente" title="Volver a CLIENTE GENERICO" onClick={() => setCliente(null)}>×</button>}
      </div>
  );

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
          <div className="pv-turno-estado"><dt>Turno</dt><dd><i />Caja abierta</dd></div>
          {versionApp && <div className="pv-version"><dt>Versión</dt><dd>v{versionApp}</dd></div>}
        </dl>
        <EstadoServidor />
        <nav className="pv-barra-acciones" aria-label="Opciones de la caja">
          <button className={"pv-icono" + (verCatalogo ? " activo" : "")} aria-pressed={verCatalogo} onClick={() => setModo(verCatalogo ? "escaner" : "catalogo")} title="Cambiar entre Caja clásica y Caja táctil (F1)">
            <Icono n="catalogo" /><span>{verCatalogo ? "Caja táctil" : "Caja clásica"}</span><kbd>F1</kbd>
          </button>
          <button className="pv-icono" onClick={() => setModal("ajustes")} title="Tamaño de letra, colores y atajos"><Icono n="ajustes" /><span>Ajustes</span></button>
          <button className="pv-icono" onClick={bloquear} title="La venta queda en pausa y se pide el PIN"><Icono n="candado" /><span>Bloquear</span></button>
          {verCatalogo && <button className="pv-icono pv-icono-turno" onClick={() => setModal("turno")} title="Cerrar turno (F10)"><Icono n="cierre" /><span>Cerrar turno</span></button>}
          <button className="pv-icono" onClick={salirDelSistema}><Icono n="salir" /><span>Salir</span></button>
        </nav>
      </header>

      {!verCatalogo && <div className="pv-entrada">
        <div className="pv-escaner">
          <Icono n="codigo" />
          <input
            ref={entrada}
            data-teclado="tactil"
            value={codigo}
            aria-label="Código de barras, código o nombre del producto"
            placeholder={catalogo ? "Escanee o escriba código / nombre   ·   3*código = 3 unidades" : "Cargando catálogo…"}
            onChange={(e) => setCodigo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { procesarEntrada(codigo); setCodigo(""); }
            }}
          />
          <BotonTeclado campo={entrada} className="pv-btn-teclado" />
          <button className="pv-buscar" onClick={() => { setBusqueda(codigo.trim()); setCodigo(""); setModal("buscar"); }} title="Buscar producto (F2)">
            <Icono n="lupa" /><kbd>F2</kbd>
          </button>
        </div>
      </div>}

      <main className={"pv-cuerpo" + (verCatalogo && anchoCat ? " con-ancho" : "")} style={verCatalogo && anchoCat ? ({ "--ancho-cat": anchoCat } as React.CSSProperties) : undefined}>
        {verCatalogo && catalogo && (
          <section className="pv-catalogo" aria-label="Catálogo" ref={catRef}>
            <VistaCatalogo servidor={ajustes.servidor} catalogo={catalogo} nivel={nivelPrecio} enCarrito={enCarrito}
              onAgregar={(p) => agregar(p, "1")} onCodigo={procesarCodigo} />
            <div className="pv-divisor" role="separator" aria-orientation="vertical" tabIndex={0} title="Arrastre para ampliar o reducir el carrito (doble toque: tamaño original)"
              onPointerDown={arrastrarDivisor} onDoubleClick={restablecerAncho}
              onKeyDown={(e) => { if (e.key === "ArrowLeft") { e.preventDefault(); ajustarAncho(-24); } else if (e.key === "ArrowRight") { e.preventDefault(); ajustarAncho(24); } }} />
          </section>
        )}

        <section className="pv-venta" aria-label="Productos de la venta" ref={ventaRef}>
          <header className="pv-venta-cabeza">
            <h2>{verCatalogo ? <><Icono n="carrito" />Carrito</> : "Venta en curso"}</h2>
            {verCatalogo && (
              <div className="pv-iconos-directos" role="toolbar" aria-label="Accesos directos">
                {([
                  ["recibo", "Pago de factura", () => setModal("pagoFactura"), false],
                  ["salidaEfectivo", "Salida de efectivo", () => setModal("salida"), false],
                  ["etiqueta", "Consultar precio", () => setModal("consulta"), !catalogo],
                  ["impresora", "Reimprimir última", () => reimprimirUltima(), !ultima],
                  ["gaveta", "Abrir gaveta", () => setModal("gaveta"), false],
                ] as const).map(([n, t, f, d]) => (
                  <button key={n} type="button" title={t} aria-label={t} disabled={d} onClick={f}><Icono n={n} /></button>
                ))}
              </div>
            )}
            <span className="suave">{lineas.length ? `${lineas.length} línea(s) · ${articulos % 1 ? articulos.toFixed(2) : articulos} artículo(s)` : "Sin productos"}</span>
            <span className="flex" />
            {verCatalogo && clienteBloque}
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
                <span>{verCatalogo ? "o tóquelo en el catálogo, o escriba su nombre en la búsqueda" : "o escriba su nombre arriba · F1 cambia a Caja táctil"}</span>
              </div>
            )}
            {lineas.map((l, i) => {
              const c = cot.r?.lineas[i];
              const precio = precioDe(l);
              const desc = c ? Number(c.calc.descuento) : 0;
              return (
                <div key={i} role="row" className={"pv-fila" + (i === sel ? " seleccionada" : "")} onClick={() => setSel(i)}
                  onDoubleClick={(e) => {
                    // Doble toque sobre el producto: abre el teclado numérico para digitar la cantidad (no aplica a los controles − + ni a la ×)
                    if ((e.target as HTMLElement).closest(".celda-cantidad, .pv-quitar")) return;
                    // Doble toque sobre un monto de la línea (precio c/u, precio o total): abre los 3 precios, no la cantidad
                    if ((e.target as HTMLElement).closest(".pv-precio-editable, .pv-precio-mini, .der")) { abrirPrecio(e, i); return; }
                    const campo = e.currentTarget.querySelector<HTMLInputElement>(".celda-cantidad input");
                    if (!campo) return;
                    setSel(i); campo.focus(); campo.select();
                    campo.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "touch" })); // el teclado en pantalla se abre con el toque
                  }}>
                  <span className="pv-num">{i + 1}</span>
                  <span className="pv-desc">
                    <b>{l.prod.nombre}</b> <span className="suave">{l.prod.presentacion}</span>
                    <span className="pv-etiquetas">
                      {l.prod.codigos[0] && <span className="pv-codigo" title="Código de barras">{l.prod.codigos[0]}</span>}
                      <span className="pv-precio-mini pv-precio-editable" title="Doble toque: cambiar precio" onDoubleClick={(e) => abrirPrecio(e, i)}>{rd(precio)}{l.prod.esPesable ? "/lb" : " c/u"}</span>
                      {c?.oferta && <em className="t-oferta">{c.oferta.nombre}{c.oferta.agotada && ` · solo ${Number(c.oferta.unidades)} en oferta`}</em>}
                      {l.precioCambiado && <em className="t-desc">Precio cambiado a {rd(l.precioCambiado)}</em>}
                      {l.descuentoManual && !l.precioCambiado && <em className="t-desc">Descuento aprobado</em>}
                      {c && Number(c.descuentoNivel) > 0 && <em className="t-desc">Precio {nivelCliente} · −{Number(descNivelPct)} % ({rd(c.descuentoNivel)})</em>}
                      {c && Number(c.descuentoCupon) > 0 && <em className="t-cupon">Cupón</em>}
                      {(l.descuentoManual || l.precioCambiado) && (
                        <button className="mini-x" title="Quitar descuento o cambio de precio" onClick={(e) => { e.stopPropagation(); setLineas((ls) => ls.map((x, j) => j === i ? { ...x, descuentoManual: undefined, motivoDescuento: undefined, precioCambiado: undefined } : x)); }}>×</button>
                      )}
                    </span>
                  </span>
                  <span className="centro">
                    <CeldaCantidad linea={l} onMenos={() => (Number(l.cantidad) > 1 ? cambiarCantidad(i, -1) : quitar(i))} onMas={() => cambiarCantidad(i, 1)}
                      onFijar={(v) => fijarCantidad(i, v)} onListo={enfocarEntrada} />
                  </span>
                  <span className="der pv-precio-editable" title="Doble clic: cambiar precio" onDoubleClick={(e) => abrirPrecio(e, i)}>{rd(precio)}{l.prod.esPesable && <small>/lb</small>}</span>
                  <span className={"der" + (desc > 0 ? " pv-ahorro" : " suave")}>{desc > 0 ? `−${rd(desc.toFixed(2))}` : "—"}</span>
                  <span className="der fuerte">{c ? rd(c.calc.total) : "—"}</span>
                  <button className="pv-quitar" aria-label={`Quitar ${l.prod.nombre}`} title="Quitar (Supr)" onClick={(e) => { e.stopPropagation(); quitar(i); }}>×</button>
                </div>
              );
            })}
          </div>

          <div className="pv-acciones-linea" aria-label="Acciones de la línea seleccionada">
            <button className="boton fantasma" disabled={!hayLinea || !!lineas[sel]?.prod.esPesable} onClick={() => { const q = document.querySelector(".pv-fila.seleccionada .celda-cantidad input") as HTMLInputElement | null; q?.focus(); q?.select(); if (q) window.dispatchEvent(new CustomEvent("factpos-teclado", { detail: q })); }}>
              <Icono n="editar" />Cantidad <kbd>+</kbd><kbd>−</kbd>
            </button>
            <button className="boton fantasma" disabled={!hayLinea || !!lineas[sel]?.prod.precioVariable} onClick={() => setModal("cambiarPrecio")}><Icono n="etiqueta" />Precio <kbd>Alt+P</kbd></button>
            <button className="boton fantasma" disabled={!lineas.length} onClick={() => abrirDescuento("linea")}><Icono n="porciento" />Descuento <kbd>F7</kbd></button>
            <button className="boton fantasma pv-cancelar" disabled={!lineas.length} onClick={() => setModal("cancelar")}><Icono n="x" />Cancelar venta <kbd>Esc</kbd></button>
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

          {!verCatalogo && <span className="pv-titulo-pago">Cliente</span>}
          {!verCatalogo && clienteBloque}
          {!verCatalogo ? (
            <div className="pv-atajos pv-atajos-min pv-atajos-fijos" aria-label="Acciones de la venta">
              {([
                ["Suspender", pausar, !lineas.length],
                [`Retomar${pausadas.length ? ` (${pausadas.length})` : ""}`, () => setModal("pausadas"), false],
                [cupon ? `Quitar cupón ${cupon.codigo}` : "Cupón", () => (cupon ? setCupon(null) : setModal("cupon")), false],
                ["Cotización", () => setModal("cotizacion"), !lineas.length || !cot.r],
                [notas ? "Nota ✓" : "Nota", () => setModal("nota"), false],
                ["Facturas y devolución", () => setModal("facturasPin"), false],
                ["Pago de factura", () => setModal("pagoFactura"), false],
                ["Salida de efectivo", () => setModal("salida"), false],
                ...(config.modulos.delivery.activo ? [["Delivery", () => setModal("delivery"), false] as const] : []),
                ["Cerrar turno", () => setModal("turno"), false],
              ] as const).map(([t, f, d]) => (
                <button key={t} disabled={d} onClick={f}>{t}</button>
              ))}
            </div>
          ) : (
            <div className="pv-atajos pv-atajos-min" aria-label="Acciones de la venta">
              <button disabled={!lineas.length} onClick={pausar}>Suspender</button>
              <button onClick={() => setModal("pausadas")}>Retomar{pausadas.length ? ` (${pausadas.length})` : ""}</button>
              {verCatalogo
                ? <button className={cdAbierto ? "activo" : cupon ? "con-cupon" : ""} onClick={() => { setMasAbierto(false); setCdAbierto((v) => !v); }} aria-expanded={cdAbierto}>Cupón / Desc.</button>
                : <button onClick={() => setModal("turno")}>Cerrar turno</button>}
              <button className={masAbierto ? "activo" : ""} onClick={() => { setCdAbierto(false); setMasAbierto((v) => !v); }} aria-expanded={masAbierto}>
                Más {masAbierto ? "▴" : "▾"}
              </button>
            </div>
          )}
          {verCatalogo && cdAbierto && (
            <div className="pv-mas pv-cd" role="menu">
              <button role="menuitem" onClick={() => { setCdAbierto(false); if (cupon) setCupon(null); else setModal("cupon"); }}>{cupon ? `Quitar cupón ${cupon.codigo}` : "Cupón"}</button>
              <button role="menuitem" disabled={!lineas.length} onClick={() => { setCdAbierto(false); abrirDescuento("linea"); }}>Descuento</button>
            </div>
          )}
          {verCatalogo && masAbierto && (
            <div className="pv-mas" role="menu">
              {([
                ...(verCatalogo ? [
                  ["Cambiar precio", () => setModal("cambiarPrecio"), !hayLinea || !!lineas[sel]?.prod.precioVariable] as const,
                ] : []),
                ["Cotización", () => setModal("cotizacion"), !lineas.length || !cot.r],
                ...(!verCatalogo ? [[cupon ? `Quitar cupón ${cupon.codigo}` : "Cupón", () => (cupon ? setCupon(null) : setModal("cupon")), false] as const] : []),
                [notas ? "Nota ✓" : "Nota", () => setModal("nota"), false],
                ["Facturas y devolución", () => setModal("facturasPin"), false],
                ...(config.modulos.delivery.activo ? [["Delivery", () => setModal("delivery"), false] as const] : []),
                ...(verCatalogo ? [
                  ["Pedidos", () => setModal("pedidos"), false] as const,
                  ["Existencias", () => setModal("existencias"), !catalogo] as const,
                ] : []),
              ] as const).map(([t, f, d]) => (
                <button key={t} role="menuitem" disabled={d} onClick={() => { setMasAbierto(false); f(); }}>{t}</button>
              ))}
            </div>
          )}
          {ultima && (
            <div className="pv-ultima">
              <span>Última: #{ultima.numero} · {rd(ultima.total)}{Number(ultima.cambio) > 0 && <> · <b className="cambio">cambio {rd(ultima.cambio)}</b></>}</span>
              <button className="enlace" onClick={reimprimirUltima}>Reimprimir</button>
            </div>
          )}
          {verCatalogo && <button className="boton fantasma pv-cancelar pv-cancelar-barra" disabled={!lineas.length} onClick={() => setModal("cancelar")}>Cancelar</button>}
          <button className="boton cobrar abajo" disabled={!lineas.length || !!cot.error} onClick={() => cobrarCon("EFECTIVO")}>
            Cobrar <kbd>F12</kbd>
          </button>
        </aside>
      </main>

      <footer className="pv-funciones" aria-label="Funciones">
        <BotonFuncion tono="azul" icono="etiqueta" texto="Consultar precio" tecla="Alt+C" disabled={!catalogo} onClick={() => setModal("consulta")} />
        <BotonFuncion tono="azul" icono="documento" texto="Pedidos" tecla="Alt+O" onClick={() => setModal("pedidos")} />
        <BotonFuncion tono="gris" icono="caja" texto="Existencias" tecla="Alt+E" disabled={!catalogo} onClick={() => setModal("existencias")} />
        <BotonFuncion tono="gris" icono="impresora" texto="Reimprimir última" tecla="" disabled={!ultima} onClick={reimprimirUltima} />
        <BotonFuncion tono="verde" icono="gaveta" texto="Abrir gaveta" tecla="Alt+G" onClick={() => setModal("gaveta")} />
      </footer>

      {aviso && <div className={"aviso " + aviso.tipo}>{aviso.texto}</div>}
      {confirmacion && (
        <div className="confirmacion-venta" role="status" aria-live="polite" onPointerDown={() => setConfirmacion(null)}>
          <div>
            <span className="titulo">✓ {confirmacion.titulo}</span>
            {confirmacion.cambio && <><span className="etiqueta">Cambio</span><span className="cambio">{confirmacion.cambio}</span></>}
            {confirmacion.nota && <span className="nota">{confirmacion.nota}</span>}
            <small>Toque la pantalla para cerrar</small>
          </div>
        </div>
      )}
      {ofertasAcabadas.length > 0 && (
        <AvisoOfertaAgotada ofertas={ofertasAcabadas} onCerrar={() => setOfertasAcabadas([])} />
      )}

      {modal === "buscar" && catalogo && (
        <Buscar catalogo={catalogo} inicial={busqueda} nivel={nivelPrecio}
          onElegir={(p) => { agregar(p, "1"); setModal(null); }} onCerrar={() => setModal(null)} />
      )}
      {modal === "salida" && (
        <Modal titulo="Salida de efectivo" ancho onCerrar={() => setModal(null)}>
          <p className="suave">Retiro (al banco o a la oficina) o gasto pagado con la gaveta. Necesita el PIN de un supervisor y sale impreso con firmas; queda descontado en el cuadre del turno.</p>
          <MovimientosCaja ajustes={ajustes} config={config} soloSalidas />
        </Modal>
      )}
      {modal === "pagoFactura" && <PagoFactura ajustes={ajustes} config={config} onCerrar={() => setModal(null)} />}
      {modal === "consulta" && catalogo && (
        <Buscar catalogo={catalogo} inicial="" nivel={nivelPrecio} consulta onElegir={() => {}} onCerrar={() => setModal(null)} />
      )}
      {modal === "cliente" && (
        <ClientesCaja ajustes={ajustes} usuario={usuario} config={config} fiscal={volverACobro.current && requiereDocumento(tipoComp)} onElegir={(c) => { clienteOmitido.current = false; setCliente(c); if (c.nuevoParaFiscal && tipoComp === "E32") setTipoComp("E31"); setModal(volverACobro.current ? "cobro" : null); volverACobro.current = false; }} onCerrar={() => { clienteOmitido.current = volverACobro.current; setModal(volverACobro.current ? "cobro" : null); volverACobro.current = false; }} />
      )}
      {modal === "cupon" && (
        <PedirCupon ajustes={ajustes} clienteId={cliente?.id}
          onAplicar={(c) => { setCupon(c); setModal(null); avisar(`Cupón ${c.codigo} aplicado`, "ok"); }} onCerrar={() => setModal(null)} />
      )}
      {modal === "cobro" && cot.r && (
        <Cobro
          ajustes={ajustes} usuario={usuario} cliente={cliente} cupon={cupon} total={cot.r.totales.total}
          items={lineas.map((l) => ({ presentacionId: l.prod.presentacionId, cantidad: l.cantidad, descuentoManual: l.descuentoManual, precioVariable: l.precioVariable, precioNuevo: l.precioCambiado }))}
          aprobacionDescuento={lineas.some((l) => l.descuentoManual) ? aprobacion?.token : undefined}
          motivoDescuento={lineas.filter((l) => l.motivoDescuento).map((l) => `${l.prod.nombre}: ${l.motivoDescuento}`).join("; ") || undefined}
          metodo={metodo}
          notas={notas}
          tipo={tipoComp} onTipo={setTipoComp}
          onCliente={(c) => { setCliente(c); }}
          onBuscarCliente={() => { volverACobro.current = true; setModal("cliente"); }}
          onMetodo={setMetodo}
          pedirClienteAlAbrir={!clienteOmitido.current}
          onCerrar={() => { clienteOmitido.current = false; setModal(null); }}
          alFallar={conTope ? () => { cargarCatalogo().catch(() => {}); } : undefined}
          local={{
            lineas: cot.r.lineas.map((c, i) => ({
              descripcion: `${lineas[i].prod.nombre} ${lineas[i].prod.presentacion}`.trim(), cantidad: lineas[i].cantidad,
              precio: lineas[i].precioVariable ?? precioPara(lineas[i].prod, nivelPrecio, catalogo!.nivelPredeterminado).precio ?? "0",
              total: c.calc.total, oferta: c.oferta?.nombre ?? null, descuentoOferta: c.oferta?.descuento ?? "0.00", descuentoCupon: c.descuentoCupon,
              descuentoNivel: c.descuentoNivel, nombreNivel: `Precio ${nivelCliente} (−${Number(descNivelPct ?? 0)} %)`,
            })),
            totales: cot.r.totales,
            turnoId: turno.id,
            hayDescuentos: lineas.some((l) => l.descuentoManual),
          }}
          permitirSin={!!config.funciones?.sinComprobante}
          onVendido={(r, op) => {
            clienteOmitido.current = false;
            const ped = pedidoActivo;
            if (ped) { // el pedido queda facturado; si falla el aviso se reintenta unas veces
              const avisarFacturado = (n: number) => api(ajustes.servidor, `/cajas/${ajustes.cajaId}/pedidos/${ped.id}/facturado`, { cuerpo: { ventaId: r.id } })
                .catch(() => { if (n > 0) setTimeout(() => avisarFacturado(n - 1), 5000); });
              avisarFacturado(5);
            }
            setUltima(r); setTicketVista({ venta: r, copia: false }); nuevaVenta();
            setModal(null);
            // El cambio se muestra siempre que hubo efectivo (aunque sea RD$0.00), también cuando no se imprime el comprobante
            const huboEfectivo = r.pagos.some((x) => x.formaPago === "EFECTIVO");
            const cambioAviso = huboEfectivo || Number(r.cambio) > 0 ? rd(r.cambio) : null;
            if (op?.sinImprimir) setConfirmacion({ titulo: "Venta registrada", cambio: cambioAviso, nota: "Comprobante no impreso (puede usar Reimprimir última)" });
            else { setTicketAuto(r); setConfirmacion({ titulo: "Venta registrada", cambio: cambioAviso, nota: null }); }
            existenciasRef.current().catch(() => {}); }}
        />
      )}
      {modal === "pedidos" && <PanelPedidos ajustes={ajustes} onFacturar={facturarPedido} onCerrar={() => setModal(null)} />}
      {modal === "delivery" && (
        <PanelDelivery
          ajustes={ajustes} usuario={usuario} cliente={cliente} cupon={cupon}
          items={lineas.map((l) => ({ presentacionId: l.prod.presentacionId, cantidad: l.cantidad, precioVariable: l.precioVariable }))}
          total={total}
          onPedidoCreado={() => { nuevaVenta(); avisar("Pedido de delivery registrado", "ok"); }}
          onCerrar={() => setModal(null)}
        />
      )}
      {ticketAuto && <Ticket venta={ticketAuto} auto config={config} usuario={usuario} onCerrar={() => setTicketAuto(null)} />}
      {modal === "ticket" && ticketVista && <Ticket venta={ticketVista.venta} copia={ticketVista.copia} config={config} usuario={usuario} onCerrar={() => setModal(null)} />}
      {modal === "precio" && pendiente && (
        <PrecioVariable nombre={pendiente.prod.nombre} min={pendiente.prod.precioVariableMin} max={pendiente.prod.precioVariableMax}
          sugerido={precioPara(pendiente.prod, nivelPrecio, catalogo!.nivelPredeterminado).precio}
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
              setLineas((ls) => ls.map((x, j) => ({ ...x, descuentoManual: Number(partes[j]) > 0 ? partes[j] : undefined, motivoDescuento: motivo ? `Descuento a la factura: ${motivo}` : "Descuento a la factura", precioCambiado: undefined })));
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
          niveles={Object.entries(lineas[sel].prod.precios).sort(([x], [y]) => Number(x) - Number(y)).slice(0, 3).map(([nivel, precio]) => ({ nivel, precio }))}
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
        <Existencias catalogo={catalogo} nivel={nivelPrecio} onAgregar={(p) => { agregar(p, "1"); setModal(null); }} onCerrar={() => setModal(null)} />
      )}
      {modal === "gaveta" && (
        <AbrirGaveta ajustes={ajustes} usuario={usuario} onListo={(sup) => { setModal(null); avisar(`Gaveta abierta · autorizó ${sup}`, "ok"); }} onCerrar={() => setModal(null)} />
      )}
      {modal === "cancelar" && (
        <ConfirmarCancelar articulos={lineas.length} total={total} onConfirmar={() => { nuevaVenta(); setModal(null); avisar("Venta cancelada", "ok"); }} onCerrar={() => setModal(null)} />
      )}
      {modal === "ajustes" && <AjustesTerminal config={config} onCerrar={() => setModal(null)} />}
      {modal === "facturasPin" && (
        <Modal titulo="Facturas y devolución" onCerrar={() => setModal(null)}>
          <p>Para entrar a las facturas hace falta la clave de un supervisor.</p>
          <PinSupervisor ajustes={ajustes} permiso="venta.anular" textoBoton="Autorizar y entrar" automatico onAprobado={() => setModal("facturas")} />
          <button className="boton ancho" style={{ marginTop: 8 }} onClick={() => setModal(null)}>Volver a la caja</button>
        </Modal>
      )}
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
        <Pausadas ajustes={ajustes} pausadas={pausadas} onRetomar={retomar} onCerrar={() => setModal(null)}
          onDescartar={(p, a) => {
            setPausadas((ps) => ps.filter((x) => x.id !== p.id));
            avisar(`Venta en pausa descartada · autorizó ${a.supervisor}`, "ok");
          }} />
      )}
      {modal === "turno" && (
        <TurnoCaja ajustes={ajustes} config={config} usuario={usuario} turno={turno} pausadas={pausadas.length}
          onCerrado={() => { (window as unknown as { factpos?: { turno?: (v: boolean) => void } }).factpos?.turno?.(false); onSalir(); }} onCerrar={() => setModal(null)} />
      )}
    </div>
  );
}

function Modal({ titulo, children, onCerrar, ancho, clase }: { titulo: string; children: React.ReactNode; onCerrar: () => void; ancho?: boolean; clase?: string }) {
  return (
    <div className="fondo-modal" onMouseDown={onCerrar}>
      <div className={"modal" + (ancho ? " ancho" : "") + (clase ? " " + clase : "")} onMouseDown={(e) => e.stopPropagation()}>
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

/** Consulta de precio y existencia sin venta ni turno (solo lectura): la caja sin turno abierto puede consultar, no facturar. */
export function ConsultaPrecios({ ajustes, onCerrar }: { ajustes: Ajustes; onCerrar: () => void }) {
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<Catalogo>(ajustes.servidor, `/cajas/${ajustes.cajaId}/catalogo`).then(setCatalogo).catch(async (e) => {
      const c = await leerCache<Catalogo>(ajustes, "catalogo");
      if (c) setCatalogo(c); else setError((e as Error).message);
    });
  }, [ajustes]);
  if (catalogo) return <Buscar catalogo={catalogo} inicial="" nivel={catalogo.nivelPredeterminado} consulta onElegir={() => {}} onCerrar={onCerrar} />;
  return <Modal titulo="Consultar precio" onCerrar={onCerrar}><p className={error ? "error" : "suave"}>{error || "Cargando productos…"}</p></Modal>;
}

function Buscar({ catalogo, inicial, nivel, onElegir, onCerrar, consulta = false }: {
  catalogo: Catalogo; inicial: string; nivel: number; onElegir: (p: ProductoCatalogo) => void; onCerrar: () => void;
  /** Solo consulta de precio y existencia: no agrega nada a la venta */
  consulta?: boolean;
}) {
  const [q, setQ] = useState(inicial);
  const [i, setI] = useState(0);
  const lista = useRef<HTMLDivElement>(null);
  // Sin texto se muestran TODOS los productos (ordenados por nombre); al escribir se filtran
  const todos = useMemo(() => [...catalogo.productos].sort((a, b) => a.nombre.localeCompare(b.nombre, "es") || a.presentacion.localeCompare(b.presentacion, "es")), [catalogo]);
  const res = useMemo(() => {
    const t = normalizar(q.trim());
    if (!t) return todos;
    const partes = t.split(/\s+/);
    return todos.filter((p) => {
      const h = normalizar(`${p.nombre} ${p.presentacion} ${p.sku} ${p.categoria ?? ""} ${p.codigos.join(" ")}`);
      return partes.every((x) => h.includes(x));
    });
  }, [q, todos]);
  useEffect(() => { lista.current?.querySelector(".resultado.activo")?.scrollIntoView({ block: "nearest" }); }, [i]);
  return (
    <Modal titulo={consulta ? "Consultar precio" : "Buscar producto"} onCerrar={onCerrar} clase="buscar-todos">
      <input autoFocus className={"entrada-grande entrada-texto" + (consulta ? " centrado" : "")} value={q} placeholder={consulta ? "Escanee o escriba el código" : "Escriba para filtrar por nombre, SKU, código o categoría"}
        onChange={(e) => { setQ(e.target.value); setI(0); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setI((x) => Math.min(res.length - 1, x + 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
          if (e.key === "PageDown") { e.preventDefault(); setI((x) => Math.min(res.length - 1, x + 10)); }
          if (e.key === "PageUp") { e.preventDefault(); setI((x) => Math.max(0, x - 10)); }
          if (e.key === "Enter" && res[i] && !consulta) onElegir(res[i]);
          if (e.key === "Enter" && consulta) e.currentTarget.select(); // listo para escanear el siguiente
        }} />
      {consulta && q.trim() && res[i] && (() => {
        // Verificador de precios: al escanear o escribir un producto se muestra grande su nombre y su precio
        const p = res[i];
        const ex = p.controlaStock ? Number(p.existencia ?? 0) : null;
        return (
          <div className="consulta-ficha" aria-live="polite">
            <div className="cf-nombre">{p.nombre} <span>{p.presentacion}</span></div>
            <div className="cf-precio">{rd(precioPara(p, nivel, catalogo.nivelPredeterminado).precio ?? 0)}</div>
            <div className="cf-extra">
              <span className={ex != null && ex <= 0 ? "sin-stock" : ""}>Existencia: <b>{ex == null ? "—" : ex}</b></span>
            </div>
          </div>
        );
      })()}
      <div className="resultados" ref={lista} hidden={consulta}>
        <div className="res-cab"><span>Producto</span><span>Categoría</span><span>SKU</span><span className="der">Existencia</span><span className="der">Precio</span></div>
        {res.map((p, j) => {
          const ex = p.controlaStock ? Number(p.existencia ?? 0) : null;
          return (
            <button key={p.presentacionId} className={"resultado" + (j === i ? " activo" : "")} onClick={() => !consulta && onElegir(p)} onMouseMove={() => j !== i && setI(j)}>
              <span><b>{p.nombre}</b> <span className="suave">{p.presentacion}</span></span>
              <span className="suave">{p.categoria ?? ""}</span>
              <span className="suave">{p.sku}</span>
              <span className={"der" + (ex != null && ex <= 0 ? " sin-stock" : "")}>{ex == null ? "—" : ex}</span>
              <span className="der">{rd(precioPara(p, nivel, catalogo.nivelPredeterminado).precio ?? 0)}</span>
            </button>
          );
        })}
        {!res.length && <p className="suave" style={{ padding: 12 }}>Sin resultados</p>}
      </div>
      <p className="suave buscar-pie">{res.length} de {todos.length} productos · {consulta ? "solo consulta: no se agrega a la venta · escanee o escriba el código" : "↑↓ para moverse · Enter para agregar"} · Esc para cerrar</p>
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

/** Descarga las ventas guardadas en esta caja (hoja de cálculo) para tener una copia a mano. */
function GuardarCopia() {
  const a = leerAjustes();
  if (!a) return null;
  return <button className="enlace" onClick={() => void exportarPendientes(a)}>Guardar una copia de las ventas guardadas (Excel)</button>;
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
        {c.reserva === 0
          ? <span className="poca-reserva"><b>Sin números de factura de reserva: no se puede facturar hasta que vuelva el servidor.</b></span>
          : c.reserva < 10 && <span className="poca-reserva">Quedan solo {c.reserva} números de factura de reserva. Avise al encargado.</span>}
        {c.pendientes > 0 && <GuardarCopia />}
      </div>
    );
  }
  if (c.enviando && c.pendientes) return <div className="aviso-conexion enviando" role="status"><b>Servidor de nuevo en línea</b><span>Enviando {c.pendientes} venta(s) guardadas en esta caja…</span></div>;
  if (c.pendientes && c.errores) return <div className="aviso-conexion sin" role="alert"><b>{c.errores} venta(s) guardadas no se pudieron enviar</b><span>Llame al servicio técnico. Siguen guardadas en esta caja.</span><GuardarCopia /></div>;
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
  const ms = c.enLinea ? c.latenciaMs : null;
  const calidad = ms === null ? "" : ms < 250 ? "" : ms < 800 ? " lenta" : " muy-lenta";
  const texto = !c.enLinea ? "Sin servidor" : ms === null ? "En línea" : ms < 250 ? "En línea" : ms < 800 ? "Conexión lenta" : "Conexión muy lenta";
  return (
    <span className={"pv-estado" + (c.enLinea ? calidad : " sin")} role="status"
      title={c.enLinea ? `Conectada al servidor de la tienda${ms !== null ? ` · responde en ${ms} ms` : ""}${calidad ? ". Si se pone peor, la caja sigue vendiendo y envía las ventas al volver." : ""}` : "Sin servidor: solo factura de consumo al contado"}>
      <i aria-hidden="true" />{texto}{ms !== null && <small> · {ms} ms</small>}
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
    carrito: <><circle cx="9" cy="20" r="1.6" /><circle cx="18" cy="20" r="1.6" /><path d="M2 3h3l2.4 11.2a2 2 0 0 0 2 1.6h8.2a2 2 0 0 0 2-1.5L21 7H6" /></>,
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
    recibo: <><path d="M6 2h12v20l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></>,
    salidaEfectivo: <><rect x="2" y="6" width="14" height="10" rx="2" /><circle cx="9" cy="11" r="2" /><path d="M19 9l3 3-3 3M22 12h-4" /></>,
    moto: <><circle cx="6" cy="17" r="3" /><circle cx="18" cy="17" r="3" /><path d="M9 17h6l-3-6h-4M15 6h3l3 8" /></>,
    cierre: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
    pantalla: <><rect x="2" y="4" width="20" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></>,
  };
  return (
    <svg className="icono" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {d[n] ?? null}
    </svg>
  );
}
