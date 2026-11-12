import { memo, useCallback, useMemo, useRef, useState } from "react";
import { precioPara, ofertasPara, ofertaVigente, type Catalogo, type ProductoCatalogo, type Oferta } from "@factpos/compartido";
import { rd } from "./api";
import { ImagenSinFondo } from "./ImagenSinFondo";
import { BotonTeclado } from "./Teclado";

/**
 * Modo Catálogo: tarjetas con imagen, categoría, precio y existencia.
 * Pensado para pantallas táctiles y negocios donde el cliente pide "de vista"
 * (licoreras, colmados). El lector de códigos sigue funcionando en el buscador.
 */
/** Etiqueta corta de la oferta para la tarjeta: 2x1, −15 %, 6+ a RD$135… */
function etiquetaOferta(o: Oferta) {
  switch (o.tipo) {
    case "LLEVA_PAGA": return `${o.lleva}x${o.paga}`;
    case "PORCENTAJE": return `−${Number(o.valor)} %`;
    case "POR_VOLUMEN": return `${Number(o.cantidadMinima)}+ a ${rd(o.valor ?? 0).replace(".00", "")}`;
    default: return `Especial ${rd(o.valor ?? 0).replace(".00", "")}`;
  }
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function VistaCatalogo({ catalogo, nivel, enCarrito, onAgregar, onCodigo, servidor, agotados }: {
  servidor: string;
  /** Platos que la cocina marcó como agotados hoy (presentacionId) */
  agotados?: Set<string>;
  catalogo: Catalogo;
  nivel: number;
  enCarrito: Map<string, number>;
  onAgregar: (p: ProductoCatalogo) => void;
  /** Enter en el buscador: si es un código, se agrega; devuelve true si lo procesó */
  onCodigo: (texto: string) => boolean;
}) {
  const [q, setQ] = useState("");
  const [categoria, setCategoria] = useState<string | null>(null);

  const visibles = catalogo.productos.filter((p) => p.categoria !== "Servicios");
  const categorias = useMemo(() => {
    const m = new Map<string, { nombre: string; color: string; n: number }>();
    for (const p of visibles) {
      const k = p.categoria ?? "Otros";
      const c = m.get(k) ?? { nombre: k, color: p.categoriaColor ?? "#64748b", n: 0 };
      c.n++;
      m.set(k, c);
    }
    return [...m.values()];
  }, [catalogo]);

  const lista = useMemo(() => {
    const partes = norm(q.trim()).split(/\s+/).filter(Boolean);
    return visibles.filter((p) =>
      (!categoria || (p.categoria ?? "Otros") === categoria) &&
      partes.every((x) => norm(`${p.nombre} ${p.presentacion} ${p.sku} ${p.codigos.join(" ")}`).includes(x)));
  }, [q, categoria, catalogo]);
  const buscador = useRef<HTMLInputElement>(null);
  // Función estable hacia las tarjetas memorizadas (siempre llama a la versión más reciente)
  const agregarActual = useRef(onAgregar);
  agregarActual.current = onAgregar;
  const agregarEstable = useCallback((p: ProductoCatalogo) => agregarActual.current(p), []);

  return (
    <div className="catalogo">
      <div className="catalogo-barra">
        <div className="buscador">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M20 20l-4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          <BotonTeclado campo={buscador} />
          <input
            ref={buscador}
            data-entrada-principal
            data-listo-enter=""
            data-teclado="tactil"
            value={q}
            placeholder="Buscar producto"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              if (onCodigo(q)) setQ("");
              else if (lista.length === 1) { onAgregar(lista[0]); setQ(""); }
            }}
          />
          {q && <button className="limpiar" onClick={() => setQ("")} aria-label="Limpiar">×</button>}
        </div>
        <div className="chips-categorias">
          <button className={!categoria ? "activa" : ""} onClick={() => setCategoria(null)}>Todas <span>{visibles.length}</span></button>
          {categorias.map((c) => (
            <button key={c.nombre} className={categoria === c.nombre ? "activa" : ""} style={{ "--cat": c.color } as React.CSSProperties}
              onClick={() => setCategoria(categoria === c.nombre ? null : c.nombre)}>
              <i />{c.nombre} <span>{c.n}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="rejilla">
        {lista.map((p) => (
          <TarjetaProducto key={p.presentacionId} p={p} nivel={nivel} n={enCarrito.get(p.presentacionId) ?? 0} catalogo={catalogo} servidor={servidor} onAgregar={agregarEstable} marcado={!!agotados?.has(p.presentacionId)} />
        ))}
        {!lista.length && <div className="vacio-catalogo">No hay productos que coincidan con “{q}”.</div>}
      </div>
    </div>
  );
}

/**
 * Una tarjeta del catálogo. Va memorizada: al agregar algo a la venta solo se vuelven a dibujar las tarjetas cuyo producto,
 * cantidad en el carrito, nivel de precio o catálogo cambiaron, no las cientos de tarjetas del catálogo (en cajas modestas
 * eso hacía que el producto tardara varios segundos en aparecer en el carrito).
 */
const TarjetaProducto = memo(function TarjetaProducto({ p, nivel, n, catalogo, servidor, onAgregar, marcado }: {
  /** La cocina lo marcó como agotado hoy */
  marcado?: boolean;
  p: ProductoCatalogo; nivel: number; n: number; catalogo: Catalogo; servidor: string; onAgregar: (p: ProductoCatalogo) => void;
}) {
      const precio = precioPara(p, nivel, catalogo.nivelPredeterminado).precio;
      const ahora = new Date();
      // Ofertas con tope agotadas no se anuncian
      const oferta = ofertasPara(catalogo, p, nivel).find((o) => ofertaVigente(o, ahora) && (o.restantes == null || Number(o.restantes) / Number(p.factor) >= 1));
      // La existencia ya viene expresada en la presentación (el servidor divide entre su factor): 48 tragos = 3 botellas
      const stock = Number(p.existencia ?? 0);
      const minimo = Number(p.minimo ?? 0);
      const estado = marcado ? "agotado" : !p.controlaStock ? null : stock <= 0 ? "agotado" : stock <= minimo ? "bajo" : "ok";
      return (
        <button key={p.presentacionId} className={"tarjeta-producto" + (n ? " en-carrito" : "") + (estado === "agotado" ? " agotado" : "")}
          style={{ "--cat": p.categoriaColor ?? "#64748b" } as React.CSSProperties} onClick={() => onAgregar(p)} disabled={precio === null && !p.precioVariable}>
          <div className="arte">
            {p.imagen ? <ImagenSinFondo src={p.imagen.startsWith("/") ? servidor.replace(/\/$/, "") + p.imagen : p.imagen} /> : <Arte icono={p.categoriaIcono} />}
            {p.categoria && <span className="chip-cat">{p.categoria}</span>}
            {oferta && <span className="chip-oferta" title={oferta.nombre}>{etiquetaOferta(oferta)}{oferta.restantes != null && <small> · quedan {Math.floor(Number(oferta.restantes) / Number(p.factor))}</small>}</span>}
            {n > 0 && <span className="cuenta">{p.esPesable ? "✓" : n}</span>}
          </div>
          <div className="info">
            <b className="nombre">{p.nombre}</b>
            {(Number(p.factor) > 1 || p.esPesable) && <span className="presentacion">{Number(p.factor) > 1 ? `${p.presentacion} · ${Number(p.factor)} unidades` : "Por libra"}</span>}
            <div className="pie">
              <span className="precio">{p.precioVariable ? "Precio libre" : precio ? rd(precio) : "Sin precio"}{p.esPesable && <small>/lb</small>}</span>
              {estado && (
                <span className={"stock " + estado} title={estado === "agotado" ? "Agotado" : estado === "bajo" ? "Existencia baja" : "En existencia"}>
                  <i /><b>{fmt(stock)}</b>{estado === "agotado" && " · agotado"}
                </span>
              )}
            </div>
          </div>
        </button>
      );
});

const fmt = (n: number) => (n % 1 ? n.toFixed(1) : String(n));

/** Ilustración por categoría cuando el producto no tiene foto. */
function Arte({ icono }: { icono?: string | null }) {
  const c = "var(--cat)";
  const formas: Record<string, React.ReactNode> = {
    botella: <><rect x="43" y="8" width="14" height="20" rx="3" fill={c} /><path d="M40 28h20l6 14v46a6 6 0 0 1-6 6H40a6 6 0 0 1-6-6V42z" fill={c} /><rect x="38" y="52" width="24" height="22" rx="3" fill="#fff" opacity=".85" /></>,
    vino: <><rect x="45" y="6" width="10" height="26" rx="3" fill={c} /><path d="M45 30h10c0 8 10 12 10 22v36a6 6 0 0 1-6 6H41a6 6 0 0 1-6-6V52c0-10 10-14 10-22z" fill={c} /><rect x="38" y="58" width="24" height="20" rx="3" fill="#fff" opacity=".85" /></>,
    cerveza: <><rect x="45" y="8" width="10" height="16" rx="2" fill={c} /><path d="M45 24h10l7 18v46a6 6 0 0 1-6 6H44a6 6 0 0 1-6-6V42z" fill={c} /><ellipse cx="50" cy="62" rx="10" ry="12" fill="#fff" opacity=".85" /></>,
    refresco: <><rect x="44" y="6" width="12" height="10" rx="2" fill={c} /><path d="M42 16h16c6 10 8 16 8 26v8c-4 6-4 10 0 16v22a6 6 0 0 1-6 6H40a6 6 0 0 1-6-6V66c4-6 4-10 0-16v-8c0-10 2-16 8-26z" fill={c} /><rect x="36" y="48" width="28" height="18" fill="#fff" opacity=".85" /></>,
    lata: <><rect x="32" y="16" width="36" height="76" rx="8" fill={c} /><rect x="32" y="40" width="36" height="26" fill="#fff" opacity=".85" /><rect x="36" y="12" width="28" height="6" rx="3" fill={c} /></>,
    saco: <><path d="M30 30c4-10 36-10 40 0l6 54a8 8 0 0 1-8 9H32a8 8 0 0 1-8-9z" fill={c} /><path d="M34 26c6 4 26 4 32 0" stroke="#fff" strokeWidth="3" fill="none" opacity=".7" /><rect x="36" y="52" width="28" height="18" rx="3" fill="#fff" opacity=".85" /></>,
    embutido: <><rect x="18" y="40" width="64" height="26" rx="13" fill={c} /><circle cx="82" cy="53" r="9" fill="#fff" opacity=".85" /><circle cx="82" cy="53" r="5" fill={c} opacity=".6" /></>,
    servicio: <><circle cx="50" cy="50" r="30" fill={c} /><path d="M38 50h24M50 38v24" stroke="#fff" strokeWidth="6" strokeLinecap="round" /></>,
  };
  return (
    <svg className="arte-svg" viewBox="0 0 100 100" aria-hidden="true">
      {formas[icono ?? ""] ?? <><rect x="26" y="26" width="48" height="56" rx="8" fill={c} /><path d="M36 26c0-10 28-10 28 0" stroke={c} strokeWidth="5" fill="none" /></>}
    </svg>
  );
}
