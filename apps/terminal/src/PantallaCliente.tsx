import { useEffect, useMemo, useState } from "react";
import { temaTerminal } from "@factpos/compartido";
import { rd } from "./api";
import {
  escuchar, leerGuardado, type Carrito, type DatosMarca, type Gracias, type OfertaPantalla,
} from "./pantalla-cliente";

const hoy = () => { const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60000); return d.toISOString().slice(0, 10); };
const vigente = (o: OfertaPantalla) => o.activa && (!o.desde || o.desde <= hoy()) && (!o.hasta || o.hasta >= hoy());
const SEGUNDOS_GRACIAS = 8;

/**
 * Segunda pantalla, para que el cliente la vea: los productos digitados y el monto a pagar.
 * Mientras no se cobra muestra las ofertas del negocio.
 */
export function PantallaCliente() {
  const [marca, setMarca] = useState<DatosMarca | null>(() => leerGuardado<DatosMarca>("marca"));
  const [carrito, setCarrito] = useState<Carrito | null>(() => leerGuardado<Carrito>("carrito"));
  const [gracias, setGracias] = useState<Gracias | null>(() => leerGuardado<Gracias>("gracias"));
  const [ahora, setAhora] = useState(Date.now());
  const [oferta, setOferta] = useState(0);

  useEffect(() => escuchar((m) => {
    if (m.tipo === "marca") setMarca(m.d);
    else if (m.tipo === "carrito") setCarrito(m.d);
    else setGracias(m.d);
  }), []);
  useEffect(() => { const t = setInterval(() => setAhora(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => {
    if (!marca) return;
    for (const [k, v] of Object.entries(temaTerminal({ primario: marca.primario, secundario: marca.secundario }, "oscuro"))) document.documentElement.style.setProperty(k, v);
  }, [marca]);

  const dia = hoy();   // cambia al pasar la medianoche, para que venzan las ofertas
  const ofertas = useMemo(() => (marca?.pantalla.activa === false ? [] : (marca?.pantalla.ofertas ?? []).filter(vigente)), [marca, dia]);
  const segundos = Math.max(4, marca?.pantalla.segundos ?? 10);
  useEffect(() => {
    if (ofertas.length < 2) return;
    const t = setInterval(() => setOferta((x) => x + 1), segundos * 1000);
    return () => clearInterval(t);
  }, [ofertas.length, segundos]);

  const hayLineas = !!carrito && carrito.lineas.length > 0;
  const graciasVigente = !hayLineas && gracias && ahora - gracias.en < SEGUNDOS_GRACIAS * 1000;
  const nombre = marca?.empresa ?? "FactPOS";
  const logo = marca?.logo ? <img className="pc-logo" src={marca.logo} alt="" /> : null;

  if (graciasVigente) {
    return (
      <div className="pc pc-centro">
        {logo}
        <h1>¡Gracias por su compra!</h1>
        <p className="pc-monto">Total {rd(gracias!.total)}</p>
        {Number(gracias!.cambio) > 0 && <p className="pc-cambio">Su cambio: <b>{rd(gracias!.cambio)}</b></p>}
        <p className="pc-sub">{nombre}</p>
      </div>
    );
  }

  if (!hayLineas) {
    if (ofertas.length) {
      const o = ofertas[oferta % ofertas.length]!;
      return (
        <div className="pc pc-oferta" key={o.id}>
          {o.imagen && <img className="pc-oferta-img" src={o.imagen} alt="" />}
          <div className="pc-oferta-texto">
            <div className="pc-etiqueta">{logo}<span>Oferta</span></div>
            <h1>{o.titulo}</h1>
            {o.texto && <p>{o.texto}</p>}
            {o.precio && <div className="pc-oferta-precio">{o.precio}</div>}
          </div>
          {ofertas.length > 1 && <div className="pc-puntos">{ofertas.map((x, i) => <i key={x.id} className={i === oferta % ofertas.length ? "on" : ""} />)}</div>}
        </div>
      );
    }
    return (
      <div className="pc pc-centro">
        {logo}
        <h1>{marca?.pantalla.bienvenida || `Bienvenido a ${nombre}`}</h1>
      </div>
    );
  }

  const c = carrito!;
  return (
    <div className="pc pc-venta">
      <header className="pc-cab">{logo}<b>{nombre}</b>{c.cliente && <span className="pc-cliente">Cliente: {c.cliente}</span>}</header>
      <section className="pc-lineas" aria-label="Productos">
        {c.lineas.map((l, i) => (
          <div key={i} className={"pc-linea" + (i === c.lineas.length - 1 ? " nueva" : "")}>
            <div><b>{l.nombre}</b><span>{Number(l.cantidad)} × {rd(l.precio)}{Number(l.descuento) > 0 && <em> · ahorra {rd(l.descuento)}</em>}</span></div>
            <strong>{rd(l.total)}</strong>
          </div>
        ))}
      </section>
      <aside className="pc-total">
        {Number(c.descuento) > 0 && <div className="pc-fila"><span>Descuento</span><span>-{rd(c.descuento)}</span></div>}
        <div className="pc-fila"><span>ITBIS</span><span>{rd(c.itbis)}</span></div>
        <div className="pc-pagar">{c.fase === "cobro" ? "Total a pagar" : "Total"}</div>
        <div className="pc-monto grande">{rd(c.total)}</div>
      </aside>
    </div>
  );
}
