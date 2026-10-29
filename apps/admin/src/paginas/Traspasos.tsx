import { useEffect, useMemo, useState } from "react";
import { api, rd } from "../api";
import { Aviso, Encabezado, SelectorProducto, Tabla, useCatalogo, useDatos } from "../ui";

/**
 * Surtido de tiendas desde el almacén, bajo el mismo RNC:
 *   pedido (con cantidades sugeridas) → despacho con conduce → recepción contando.
 * Nada de esto es venta ni lleva comprobante fiscal: todo se mueve al costo.
 */
type Pestana = "pedidos" | "traspasos" | "nuevo" | "resumen";

const cant = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? "—" : Number(v).toLocaleString("es-DO", { maximumFractionDigits: 3 }));
const fecha = (v: string | null) => (v ? new Date(v).toLocaleString("es-DO", { dateStyle: "short", timeStyle: "short" }) : "—");
const soloNumero = (v: string) => v.replace(/[^\d.]/g, "");

export function Traspasos() {
  const [pestana, setPestana] = useState<Pestana>("pedidos");
  const [conduce, setConduce] = useState<string | null>(null);
  const [recibir, setRecibir] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ t: string; tipo: "ok" | "error" } | null>(null);
  const [recarga, setRecarga] = useState(0);
  const listo = (t: string) => { setAviso({ t, tipo: "ok" }); setRecarga((n) => n + 1); };

  return (
    <>
      <Encabezado titulo="Traspasos y pedidos" descripcion="El almacén surte a las tiendas al costo. Es un traslado interno (mismo RNC): no es venta ni lleva comprobante." />
      <div className="pestanas">
        {([["pedidos", "Pedidos de tiendas"], ["traspasos", "Traspasos"], ["nuevo", "Traspaso directo"], ["resumen", "Resumen por mes"]] as const).map(([id, t]) => (
          <button key={id} className={pestana === id ? "activa" : ""} onClick={() => { setPestana(id); setAviso(null); }}>{t}</button>
        ))}
      </div>
      {aviso && <Aviso texto={aviso.t} tipo={aviso.tipo} />}
      {pestana === "pedidos" && <Pedidos recarga={recarga} onListo={listo} onError={(t) => setAviso({ t, tipo: "error" })} verConduce={setConduce} />}
      {pestana === "traspasos" && <ListaTraspasos recarga={recarga} verConduce={setConduce} recibir={setRecibir} />}
      {pestana === "nuevo" && <TraspasoDirecto onListo={(t, id) => { listo(t); setConduce(id); }} />}
      {pestana === "resumen" && <Resumen />}
      {conduce && <Conduce id={conduce} onCerrar={() => setConduce(null)} />}
      {recibir && <Recepcion id={recibir} onCerrar={() => setRecibir(null)} onListo={(t) => { setRecibir(null); listo(t); }} />}
    </>
  );
}

// ======================================================================= Pedidos
interface Sugerido {
  productoId: string; sku: string; nombre: string; unidad: string; existencia: string; minimo: string; maximo: string | null;
  enCamino: string; yaPedido: string; enAlmacen: string; vendido30d: string; sugerida: string;
}

function Pedidos({ recarga, onListo, onError, verConduce }: { recarga: number; onListo: (t: string) => void; onError: (t: string) => void; verConduce: (id: string) => void }) {
  const { sucursales } = useCatalogo();
  const almacenes = sucursales.filter((s) => s.tipo === "ALMACEN");
  const tiendas = sucursales.filter((s) => s.tipo !== "ALMACEN");
  const [tienda, setTienda] = useState(tiendas[0]?.id ?? "");
  const [surte, setSurte] = useState(almacenes[0]?.id ?? sucursales.find((s) => s.id !== tiendas[0]?.id)?.id ?? "");
  const [todos, setTodos] = useState(false);
  const [filas, setFilas] = useState<(Sugerido & { cantidad: string })[] | null>(null);
  const [cargando, setCargando] = useState(false);
  const [extra, setExtra] = useState("");
  const [despachar, setDespachar] = useState<string | null>(null);
  const lista = useDatos<any[]>("/central/pedidos-sucursal", [recarga]);
  const { productos } = useCatalogo();

  const sugerir = async () => {
    setCargando(true);
    try {
      const r = await api<Sugerido[]>(`/central/pedidos-sucursal/sugerido?sucursalId=${tienda}&surteId=${surte}${todos ? "&todos=1" : ""}`);
      setFilas(r.map((x) => ({ ...x, cantidad: Number(x.sugerida) > 0 ? x.sugerida : "" })));
    } catch (e) { onError((e as Error).message); } finally { setCargando(false); }
  };
  // El catálogo de sucursales llega después del primer dibujo
  useEffect(() => {
    const t = tienda || tiendas[0]?.id || "";
    if (t !== tienda) setTienda(t);
    if (!surte || surte === t) setSurte(almacenes.find((a) => a.id !== t)?.id ?? sucursales.find((s) => s.id !== t)?.id ?? "");
  }, [sucursales, tienda]);
  useEffect(() => { setFilas(null); }, [tienda, surte]);

  const conCantidad = (filas ?? []).filter((f) => Number(f.cantidad) > 0);
  const crear = async () => {
    try {
      const r = await api("/central/pedidos-sucursal", {
        cuerpo: { sucursalId: tienda, surteId: surte, items: conCantidad.map((f) => ({ productoId: f.productoId, cantidad: f.cantidad, sugerida: f.sugerida })) },
      });
      setFilas(null);
      onListo(`Pedido #${r.numero} creado. El almacén lo verá en la lista para despacharlo.`);
    } catch (e) { onError((e as Error).message); }
  };
  const agregar = (id: string) => {
    if (!id || filas?.some((f) => f.productoId === id)) return;
    const p = productos.find((x) => x.id === id);
    if (!p) return;
    setFilas([...(filas ?? []), { productoId: id, sku: p.sku, nombre: p.nombre, unidad: "", existencia: "", minimo: "", maximo: null, enCamino: "", yaPedido: "", enAlmacen: "", vendido30d: "", sugerida: "0", cantidad: "" }]);
    setExtra("");
  };
  const anular = async (id: string) => {
    try { await api(`/central/pedidos-sucursal/${id}/anular`, { cuerpo: {} }); onListo("Pedido anulado"); } catch (e) { onError((e as Error).message); }
  };

  return (
    <>
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Nuevo pedido</h3>
        <div className="cuatro-col">
          <label className="campo"><span>Tienda que pide</span>
            <select value={tienda} onChange={(e) => setTienda(e.target.value)}>{sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}</select>
          </label>
          <label className="campo"><span>Lo surte</span>
            <select value={surte} onChange={(e) => setSurte(e.target.value)}>{sucursales.filter((s) => s.id !== tienda).map((s) => <option key={s.id} value={s.id}>{s.nombre}{s.tipo === "ALMACEN" ? " (almacén)" : ""}</option>)}</select>
          </label>
          <label className="interruptor" style={{ alignSelf: "center" }}>
            <input type="checkbox" checked={todos} onChange={(e) => setTodos(e.target.checked)} />
            <span>Incluir productos sin mínimo</span>
          </label>
          <div style={{ alignSelf: "center" }}>
            <button className="boton primario" disabled={!tienda || !surte || tienda === surte || cargando} onClick={sugerir}>{cargando ? "Calculando…" : "Sugerir cantidades"}</button>
          </div>
        </div>
        {!almacenes.length && <p className="suave pequeno">Consejo: marque su almacén como "Almacén" en Sucursales y terminales; así aparece primero y no se le asignan cajas.</p>}
        {filas && (
          <>
            <p className="suave pequeno">
              Se sugiere pedir cuando lo que hay (más lo que viene en camino) llega al mínimo, y completar hasta el máximo
              (o el doble del mínimo si no tiene máximo), sin pasar de lo que hay en el almacén. Puede cambiar cualquier cantidad.
            </p>
            <div className="tabla-contenedor">
              <table className="tabla tabla-edicion">
                <thead><tr>
                  <th>Producto</th><th className="der">Hay en tienda</th><th className="der">Mín / Máx</th><th className="der">En camino</th>
                  <th className="der">Vendido 30 días</th><th className="der">En almacén</th><th className="der">Sugerido</th><th className="der">Pedir</th>
                </tr></thead>
                <tbody>
                  {filas.map((f, i) => {
                    const bajo = f.minimo !== "" && Number(f.existencia) <= Number(f.minimo);
                    return (
                      <tr key={f.productoId}>
                        <td><b>{f.nombre}</b> <span className="suave pequeno mono">{f.sku}</span></td>
                        <td className={"der" + (bajo ? " texto-alerta" : "")}>{cant(f.existencia)}</td>
                        <td className="der suave">{f.minimo === "" ? "—" : `${cant(f.minimo)} / ${f.maximo ? cant(f.maximo) : "—"}`}</td>
                        <td className="der">{Number(f.enCamino) + Number(f.yaPedido) ? cant(Number(f.enCamino) + Number(f.yaPedido)) : "—"}</td>
                        <td className="der suave">{cant(f.vendido30d)}</td>
                        <td className="der">{cant(f.enAlmacen)}</td>
                        <td className="der suave">{Number(f.sugerida) ? cant(f.sugerida) : "—"}</td>
                        <td className="der"><input className="numero" inputMode="decimal" aria-label={`Pedir de ${f.nombre}`} value={f.cantidad}
                          onChange={(e) => setFilas(filas.map((x, j) => (j === i ? { ...x, cantidad: soloNumero(e.target.value) } : x)))} /></td>
                      </tr>
                    );
                  })}
                  {!filas.length && <tr><td colSpan={8} className="suave">Ningún producto llegó a su mínimo. Puede agregar productos a mano.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="fila-acciones">
              <div style={{ minWidth: 280 }}><SelectorProducto valor={extra} onCambio={agregar} placeholder="Agregar otro producto…" /></div>
              <span className="flex" />
              <span className="suave">{conCantidad.length} producto(s)</span>
              <button className="boton primario" disabled={!conCantidad.length} onClick={crear}>Crear pedido</button>
            </div>
          </>
        )}
      </div>

      <h2>Pedidos</h2>
      <Tabla
        filas={lista.datos ?? []}
        clave={(f) => f.id}
        vacio="Todavía no hay pedidos"
        columnas={[
          { titulo: "#", valor: (f) => f.numero },
          { titulo: "Fecha", valor: (f) => fecha(f.creadoEn) },
          { titulo: "Tienda", valor: (f) => f.sucursal },
          { titulo: "Surte", valor: (f) => f.surte },
          { titulo: "Productos", valor: (f) => `${f.lineas} · ${cant(f.unidades)} u.`, der: true },
          { titulo: "Estado", valor: (f) => <span className={"pastilla " + (f.estado === "PENDIENTE" ? "en_transito" : f.estado === "DESPACHADO" ? "recibida" : "")}>{f.estado.toLowerCase()}</span> },
          {
            titulo: "", valor: (f) => f.estado === "PENDIENTE"
              ? <span className="acciones-fila"><button className="boton primario chico" onClick={() => setDespachar(f.id)}>Despachar</button><button className="enlace" onClick={() => anular(f.id)}>Anular</button></span>
              : f.traspasoId ? <button className="enlace" onClick={() => verConduce(f.traspasoId)}>Conduce #{f.traspaso}</button> : null,
          },
        ]}
      />
      {despachar && <Despacho id={despachar} onCerrar={() => setDespachar(null)} onListo={(t, traspasoId) => { setDespachar(null); onListo(t); verConduce(traspasoId); }} />}
    </>
  );
}

function Despacho({ id, onCerrar, onListo }: { id: string; onCerrar: () => void; onListo: (t: string, traspasoId: string) => void }) {
  const { datos } = useDatos<any>(`/central/pedidos-sucursal/${id}`);
  const [enviar, setEnviar] = useState<Record<string, string>>({});
  const [chofer, setChofer] = useState("");
  const [vehiculo, setVehiculo] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  useEffect(() => {
    if (datos) setEnviar(Object.fromEntries(datos.items.map((i: any) => [i.productoId, String(Math.min(Number(i.cantidad), Math.max(0, Number(i.enAlmacen))))])));
  }, [datos]);
  const total = Object.values(enviar).reduce((a, v) => a + (Number(v) || 0), 0);
  const ok = async () => {
    setError(""); setEnviando(true);
    try {
      const r = await api(`/central/pedidos-sucursal/${id}/despachar`, {
        cuerpo: { chofer: chofer || undefined, vehiculo: vehiculo || undefined, items: Object.entries(enviar).map(([productoId, cantidad]) => ({ productoId, cantidad: cantidad || "0" })) },
      });
      onListo(`Pedido #${r.pedido} despachado: traspaso #${r.traspaso.numero} en tránsito (${rd(r.traspaso.valorAlCosto)} al costo). Imprima el conduce para el chofer.`, r.traspaso.id);
    } catch (e) { setError((e as Error).message); } finally { setEnviando(false); }
  };
  return (
    <div className="fondo-modal" onMouseDown={onCerrar}>
      <div className="modal ancho" onMouseDown={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>Despachar pedido {datos ? `#${datos.numero}` : ""}</h2>
        {datos && <p className="suave">{datos.surte} → {datos.sucursal}. Ajuste lo que de verdad sale si el almacén no tiene todo.</p>}
        <div className="tabla-contenedor">
          <table className="tabla tabla-edicion">
            <thead><tr><th>Producto</th><th className="der">Pedido</th><th className="der">En almacén</th><th className="der">Sale</th></tr></thead>
            <tbody>
              {(datos?.items ?? []).map((i: any) => (
                <tr key={i.productoId}>
                  <td>{i.nombre} <span className="suave pequeno mono">{i.sku}</span></td>
                  <td className="der">{cant(i.cantidad)}</td>
                  <td className={"der" + (Number(i.enAlmacen) < Number(i.cantidad) ? " texto-alerta" : "")}>{cant(i.enAlmacen)}</td>
                  <td className="der"><input className="numero" inputMode="decimal" aria-label={`Sale de ${i.nombre}`} value={enviar[i.productoId] ?? ""}
                    onChange={(e) => setEnviar({ ...enviar, [i.productoId]: soloNumero(e.target.value) })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="dos-col" style={{ marginTop: 12 }}>
          <label className="campo"><span>Chofer</span><input value={chofer} onChange={(e) => setChofer(e.target.value)} /></label>
          <label className="campo"><span>Vehículo / placa</span><input value={vehiculo} onChange={(e) => setVehiculo(e.target.value)} /></label>
        </div>
        {error && <Aviso texto={error} />}
        <div className="acciones-modal">
          <button className="boton" onClick={onCerrar}>Cancelar</button>
          <button className="boton primario" disabled={!total || enviando} onClick={ok}>{enviando ? "Despachando…" : `Despachar ${cant(total)} unidades`}</button>
        </div>
      </div>
    </div>
  );
}

// ======================================================================= Traspasos
function ListaTraspasos({ recarga, verConduce, recibir }: { recarga: number; verConduce: (id: string) => void; recibir: (id: string) => void }) {
  const [estado, setEstado] = useState("");
  const lista = useDatos<any[]>(`/central/traspasos${estado ? `?estado=${estado}` : ""}`, [recarga]);
  const enTransito = (lista.datos ?? []).filter((t) => t.estado === "EN_TRANSITO");
  return (
    <>
      <div className="chips" style={{ marginBottom: 12 }}>
        {[["", "Todos"], ["EN_TRANSITO", "En tránsito"], ["CON_DIFERENCIA", "Con diferencia"], ["RECIBIDA", "Recibidos"]].map(([v, t]) => (
          <button key={v} className={"chip" + (estado === v ? " activo" : "")} onClick={() => setEstado(v)}>{t}</button>
        ))}
        {!estado && enTransito.length > 0 && <span className="suave pequeno" style={{ alignSelf: "center" }}>{enTransito.length} en camino</span>}
      </div>
      <Tabla
        filas={lista.datos ?? []}
        clave={(f) => f.id}
        vacio="No hay traspasos con este filtro"
        columnas={[
          { titulo: "#", valor: (f) => f.numero },
          { titulo: "Enviado", valor: (f) => fecha(f.enviadoEn) },
          { titulo: "De → A", valor: (f) => `${f.origen} → ${f.destino}` },
          { titulo: "Pedido", valor: (f) => (f.pedido ? `#${f.pedido}` : "—") },
          { titulo: "Productos", valor: (f) => `${f.lineas} · ${cant(f.unidades)} u.`, der: true },
          { titulo: "Al costo", valor: (f) => rd(f.valorEnviado), der: true },
          { titulo: "Estado", valor: (f) => <span className={"pastilla " + f.estado.toLowerCase()}>{f.estado.replace("_", " ").toLowerCase()}</span> },
          { titulo: "Faltante", valor: (f) => (f.valorDiferencia === null ? "—" : <span className={Number(f.valorDiferencia) ? "texto-alerta" : ""}>{rd(f.valorDiferencia)}</span>), der: true },
          {
            titulo: "", valor: (f) => (
              <span className="acciones-fila">
                <button className="enlace" onClick={() => verConduce(f.id)}>Conduce</button>
                {f.estado === "EN_TRANSITO" && <button className="boton primario chico" onClick={() => recibir(f.id)}>Recibir</button>}
              </span>
            ),
          },
        ]}
      />
    </>
  );
}

/** Recepción contando: la tienda escribe lo que llegó; no se le muestra lo enviado hasta comparar. */
function Recepcion({ id, onCerrar, onListo }: { id: string; onCerrar: () => void; onListo: (t: string) => void }) {
  const { datos } = useDatos<any>(`/central/traspasos/${id}`);
  const [conteo, setConteo] = useState<Record<string, string>>({});
  const [comparar, setComparar] = useState(false);
  const [notas, setNotas] = useState("");
  const [error, setError] = useState("");
  const items: any[] = datos?.items ?? [];
  const faltan = items.filter((i) => conteo[i.productoId] === undefined || conteo[i.productoId] === "");
  const diferencias = items.filter((i) => Number(conteo[i.productoId] || 0) !== Number(i.enviada));
  const valorFaltante = diferencias.reduce((a, i) => a + (Number(i.enviada) - Number(conteo[i.productoId] || 0)) * Number(i.costo), 0);

  const guardar = async () => {
    setError("");
    try {
      const r = await api(`/central/traspasos/${id}/recibir`, {
        cuerpo: { notas: notas || undefined, items: items.map((i) => ({ productoId: i.productoId, cantidadRecibida: conteo[i.productoId] || "0" })) },
      });
      onListo(r.estado === "RECIBIDA"
        ? `Traspaso #${datos.numero} recibido completo. Ya está en el inventario de ${datos.destino.nombre}.`
        : `Traspaso #${datos.numero} recibido con diferencia: faltan ${rd(r.valor_diferencia)} al costo. Lo que llegó ya está en inventario.`);
    } catch (e) { setError((e as Error).message); }
  };

  return (
    <div className="fondo-modal" onMouseDown={onCerrar}>
      <div className="modal ancho" onMouseDown={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>Recibir traspaso {datos ? `#${datos.numero}` : ""}</h2>
        {datos && <p className="suave">De {datos.origen.nombre} · enviado {fecha(datos.enviadoEn)}{datos.chofer ? ` · chofer ${datos.chofer}` : ""}. Cuente lo que llegó y escríbalo.</p>}
        <div className="tabla-contenedor">
          <table className="tabla tabla-edicion">
            <thead><tr><th>Producto</th><th className="der">Llegó</th>{comparar && <><th className="der">Enviado</th><th className="der">Diferencia</th></>}</tr></thead>
            <tbody>
              {items.map((i) => {
                const d = Number(conteo[i.productoId] || 0) - Number(i.enviada);
                return (
                  <tr key={i.productoId}>
                    <td>{i.nombre} <span className="suave pequeno mono">{i.codigo ?? i.sku}</span></td>
                    <td className="der"><input className="numero" inputMode="decimal" aria-label={`Llegó de ${i.nombre}`} value={conteo[i.productoId] ?? ""}
                      onChange={(e) => setConteo({ ...conteo, [i.productoId]: soloNumero(e.target.value) })} /></td>
                    {comparar && <><td className="der">{cant(i.enviada)}</td><td className={"der" + (d ? " texto-alerta" : "")}>{d ? (d > 0 ? "+" : "") + cant(d) : "✓"}</td></>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="fila-acciones">
          <button className="enlace" onClick={() => setConteo(Object.fromEntries(items.map((i) => [i.productoId, String(Number(i.enviada))])))}>Llegó todo completo</button>
          <span className="flex" />
          {comparar && diferencias.length > 0 && <span className="texto-alerta">{diferencias.length} con diferencia · {rd(valorFaltante.toFixed(2))} al costo</span>}
        </div>
        <label className="campo" style={{ marginTop: 10 }}><span>Notas de la recepción</span><input value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Ej.: una caja llegó rota" /></label>
        {error && <Aviso texto={error} />}
        <div className="acciones-modal">
          <button className="boton" onClick={onCerrar}>Cancelar</button>
          {!comparar
            ? <button className="boton primario" disabled={faltan.length > 0} onClick={() => setComparar(true)}>{faltan.length ? `Faltan ${faltan.length} por contar` : "Comparar con lo enviado"}</button>
            : <button className="boton primario" onClick={guardar}>Confirmar recepción</button>}
        </div>
      </div>
    </div>
  );
}

// ======================================================================= Directo
interface Linea { productoId: string; cantidad: string }
function TraspasoDirecto({ onListo }: { onListo: (t: string, id: string) => void }) {
  const { sucursales } = useCatalogo();
  const [origen, setOrigen] = useState(sucursales.find((s) => s.tipo === "ALMACEN")?.id ?? sucursales[0]?.id ?? "");
  const [destino, setDestino] = useState(sucursales.find((s) => s.id !== origen)?.id ?? "");
  const [notas, setNotas] = useState("");
  const [chofer, setChofer] = useState("");
  const [vehiculo, setVehiculo] = useState("");
  const [lineas, setLineas] = useState<Linea[]>([{ productoId: "", cantidad: "" }]);
  const [error, setError] = useState("");
  const validas = lineas.filter((l) => l.productoId && Number(l.cantidad) > 0);
  useEffect(() => {
    const o = origen || sucursales.find((s) => s.tipo === "ALMACEN")?.id || sucursales[0]?.id || "";
    if (o !== origen) setOrigen(o);
    if (!destino || destino === o) setDestino(sucursales.find((s) => s.id !== o)?.id ?? "");
  }, [sucursales, origen]);

  const enviar = async () => {
    setError("");
    try {
      const r = await api("/central/traspasos", {
        cuerpo: { origenSucursalId: origen, destinoSucursalId: destino, notas: notas || undefined, chofer: chofer || undefined, vehiculo: vehiculo || undefined, items: validas },
      });
      setLineas([{ productoId: "", cantidad: "" }]);
      onListo(`Traspaso #${r.numero} enviado · ${rd(r.valorAlCosto)} al costo. Queda en tránsito hasta que la tienda lo reciba contando.`, r.id);
    } catch (e) { setError((e as Error).message); }
  };
  return (
    <div className="panel">
      <div className="tres-col">
        <label className="campo"><span>Sale de</span><select value={origen} onChange={(e) => setOrigen(e.target.value)}>{sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}</select></label>
        <label className="campo"><span>Va para</span><select value={destino} onChange={(e) => setDestino(e.target.value)}>{sucursales.filter((s) => s.id !== origen).map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}</select></label>
        <label className="campo"><span>Notas</span><input value={notas} onChange={(e) => setNotas(e.target.value)} /></label>
        <label className="campo"><span>Chofer</span><input value={chofer} onChange={(e) => setChofer(e.target.value)} /></label>
        <label className="campo"><span>Vehículo / placa</span><input value={vehiculo} onChange={(e) => setVehiculo(e.target.value)} /></label>
      </div>
      <table className="tabla tabla-edicion">
        <thead><tr><th>Producto</th><th className="der">Cantidad (unidades)</th><th></th></tr></thead>
        <tbody>
          {lineas.map((l, i) => (
            <tr key={i}>
              <td style={{ minWidth: 300 }}><SelectorProducto valor={l.productoId} onCambio={(v) => setLineas(lineas.map((x, j) => (j === i ? { ...x, productoId: v } : x)))} /></td>
              <td className="der"><input className="numero" inputMode="decimal" value={l.cantidad} onChange={(e) => setLineas(lineas.map((x, j) => (j === i ? { ...x, cantidad: soloNumero(e.target.value) } : x)))} /></td>
              <td><button className="enlace" onClick={() => setLineas(lineas.length > 1 ? lineas.filter((_, j) => j !== i) : lineas)}>Quitar</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="fila-acciones">
        <button className="boton fantasma" onClick={() => setLineas([...lineas, { productoId: "", cantidad: "" }])}>+ Agregar línea</button>
        <span className="flex" />
        <button className="boton primario" disabled={!validas.length || !destino || origen === destino} onClick={enviar}>Enviar traspaso</button>
      </div>
      {error && <Aviso texto={error} />}
    </div>
  );
}

// ======================================================================= Resumen
function Resumen() {
  const { datos } = useDatos<any[]>("/central/traspasos-resumen?meses=6");
  const meses = useMemo(() => [...new Set((datos ?? []).map((d) => d.mes))], [datos]);
  const mesTxt = (m: string) => {
    const t = new Date(m + "T12:00:00").toLocaleDateString("es-DO", { month: "long", year: "numeric" });
    return t.charAt(0).toUpperCase() + t.slice(1);
  };
  return (
    <>
      {!datos?.length && <p className="suave">Todavía no hay traspasos en los últimos 6 meses.</p>}
      {meses.map((m) => {
        const filas = datos!.filter((d) => d.mes === m);
        const tot = filas.reduce((a, f) => a + Number(f.valorEnviado ?? 0), 0);
        return (
          <div key={m} className="panel">
            <div className="encabezado-sub"><h3>{mesTxt(m)}</h3><b>{rd(tot.toFixed(2))} enviados al costo</b></div>
            <Tabla filas={filas} clave={(f) => f.origen + f.destino} columnas={[
              { titulo: "De → A", valor: (f) => `${f.origen} → ${f.destino}` },
              { titulo: "Traspasos", valor: (f) => f.traspasos, der: true },
              { titulo: "Enviado", valor: (f) => rd(f.valorEnviado), der: true },
              { titulo: "Recibido", valor: (f) => rd(f.valorRecibido ?? 0), der: true },
              { titulo: "En camino", valor: (f) => (Number(f.valorEnTransito) ? rd(f.valorEnTransito) : "—"), der: true },
              { titulo: "Faltante", valor: (f) => (Number(f.valorDiferencia) ? <span className="texto-alerta">{rd(f.valorDiferencia)}</span> : "—"), der: true },
            ]} />
          </div>
        );
      })}
    </>
  );
}

// ======================================================================= Conduce
/** Conduce de traslado interno: acompaña la mercancía. No es factura ni comprobante fiscal. */
function Conduce({ id, onCerrar }: { id: string; onCerrar: () => void }) {
  const { datos: d } = useDatos<any>(`/central/traspasos/${id}`);
  const [conCosto, setConCosto] = useState(false);
  const numero = d ? `${d.origen.codigo}-${String(d.numero).padStart(6, "0")}` : "";
  const unidades = (d?.items ?? []).reduce((a: number, i: any) => a + Number(i.enviada), 0);
  return (
    <div className="fondo-modal" onMouseDown={onCerrar}>
      <div className="modal ancho" onMouseDown={(e) => e.stopPropagation()}>
        <div className="fila-acciones no-imprimir" style={{ marginTop: 0, marginBottom: 12, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>Conduce</h2>
          <span className="flex" />
          <label className="interruptor"><input type="checkbox" checked={conCosto} onChange={(e) => setConCosto(e.target.checked)} /><span>Mostrar costo</span></label>
          <button className="boton primario" disabled={!d} onClick={() => window.print()}>Imprimir</button>
          <button className="boton" onClick={onCerrar}>Cerrar</button>
        </div>
        {d && (
          <div className="conduce imprimible">
            <header className="conduce-cabeza">
              <div>
                <div className="conduce-empresa">{d.empresa.nombre}</div>
                <div>{d.empresa.razonSocial}</div>
                <div>RNC {d.empresa.rnc}</div>
              </div>
              <div className="conduce-titulo">
                <div>Conduce de traslado</div>
                <div className="conduce-numero">No. {numero}</div>
                <div>{fecha(d.enviadoEn)}</div>
              </div>
            </header>
            <p className="conduce-leyenda">
              Documento interno, no fiscal. Traslado de mercancía entre locales de la misma empresa (mismo RNC); no constituye venta.
            </p>
            <div className="conduce-partes">
              <div><span>Sale de</span><b>{d.origen.nombre}</b><small>{[d.almacenOrigen, d.origen.direccion].filter(Boolean).join(" · ")}</small></div>
              <div><span>Va para</span><b>{d.destino.nombre}</b><small>{[d.almacenDestino, d.destino.direccion].filter(Boolean).join(" · ")}</small></div>
              <div><span>Transporte</span><b>{d.chofer || "______________________"}</b><small>{d.vehiculo ? `Vehículo ${d.vehiculo}` : "Vehículo ____________"}</small></div>
              {d.pedido && <div><span>Pedido</span><b>#{d.pedido}</b></div>}
            </div>
            <table className="conduce-tabla">
              <thead><tr>
                <th className="col-codigo">Código</th><th>Descripción</th>
                {d.items.some((i: any) => i.pedida) && <th className="der">Pedido</th>}
                <th className="der">Enviado</th><th className="der">Recibido</th>
                {conCosto && <th className="der">Costo</th>}
              </tr></thead>
              <tbody>
                {d.items.map((i: any) => (
                  <tr key={i.productoId}>
                    <td className="mono col-codigo">{i.codigo ?? i.sku}</td>
                    <td>{i.nombre}<span className="codigo-movil mono">{i.codigo ?? i.sku}</span></td>
                    {d.items.some((x: any) => x.pedida) && <td className="der">{cant(i.pedida)}</td>}
                    <td className="der"><b>{cant(i.enviada)}</b></td>
                    <td className="der">{i.recibida === null ? <span className="conduce-casilla" /> : cant(i.recibida)}</td>
                    {conCosto && <td className="der">{rd(i.valor)}</td>}
                  </tr>
                ))}
              </tbody>
              <tfoot><tr>
                <td className="col-codigo" /><td colSpan={d.items.some((i: any) => i.pedida) ? 2 : 1}>{d.items.length} producto(s)</td>
                <td className="der"><b>{cant(unidades)}</b></td><td />
                {conCosto && <td className="der"><b>{rd(d.valorAlCosto)}</b></td>}
              </tr></tfoot>
            </table>
            {(d.notas || d.notasRecepcion) && <p className="conduce-notas">{d.notas}{d.notasRecepcion ? ` · Recepción: ${d.notasRecepcion}` : ""}</p>}
            <div className="conduce-firmas">
              <div><span />Despachado por{d.enviadoPor ? `: ${d.enviadoPor}` : ""}</div>
              <div><span />Transportado por (chofer)</div>
              <div><span />Recibido por{d.recibidoPor ? `: ${d.recibidoPor}` : ""}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
