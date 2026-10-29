import { rd, num } from "../api";
import { Aviso, Encabezado, Kpi, Tabla, useDatos } from "../ui";

interface FilaSucursal {
  sucursal_id: string; sucursal: string; venta_hoy: string; transacciones_hoy: string;
  valor_inventario: string; productos_bajo_minimo: string; traspasos_por_recibir: string;
}
interface Atencion {
  ayer: string; semanaPasada: string; transaccionesAyer: string;
  cierres: { id: string; sucursal: string; caja: string; cajero: string; cerradoEn: string; diferencia: string }[];
  ecf: { rechazados: number; atrasados: number };
  incidentes: { id: string; tipo: string; titulo: string; desde: string; hasta: string | null }[];
  certificado: { vence: string | null; sinActivar: number };
  secuencias: { sucursal: string; tipo: string; disponibles: string; alerta: number }[];
  correosConError: number;
}
type Tono = "grave" | "aviso";
interface Punto { tono: Tono; texto: string; ir: string; accion: string }

const hora = (v: string) => new Date(v).toLocaleString("es-DO", { weekday: "short", hour: "numeric", minute: "2-digit" });
const ir = (seccion: string) => { location.hash = seccion; };

/** Panel de control: cómo va el día y qué hay que atender, de todas las sucursales a la vista. */
export function Resumen() {
  const { datos, error } = useDatos<FilaSucursal[]>("/central/sucursales");
  const at = useDatos<Atencion>("/central/resumen/atencion");
  const bajo = useDatos<any[]>("/central/reportes/bajo-minimo");
  const filas = datos ?? [];
  const sum = (k: keyof FilaSucursal) => filas.reduce((a, f) => a + Number(f[k]), 0);
  const a = at.datos;
  const ventaHoy = sum("venta_hoy"), transHoy = sum("transacciones_hoy");

  const puntos: Punto[] = [];
  if (a) {
    const caidos = a.incidentes.filter((i) => !i.hasta);
    if (caidos.length) puntos.push({ tono: "grave", texto: caidos.map((i) => i.titulo).join(" · "), ir: "incidentes", accion: "Ver incidentes" });
    const porRevisar = a.incidentes.length - caidos.length;
    if (porRevisar) puntos.push({ tono: "aviso", texto: `${porRevisar} incidente(s) de los últimos días sin revisar`, ir: "incidentes", accion: "Revisar" });
    const conDif = a.cierres.filter((c) => Math.abs(Number(c.diferencia)) >= 0.005);
    const faltante = conDif.filter((c) => Number(c.diferencia) < 0).reduce((s, c) => s + Number(c.diferencia), 0);
    if (conDif.length) puntos.push({ tono: faltante ? "grave" : "aviso", texto: `${conDif.length} cierre(s) de caja con diferencia desde ayer${faltante ? ` · faltante ${rd(-faltante)}` : ""}`, ir: "reportes", accion: "Ver cierres" });
    if (a.ecf.rechazados) puntos.push({ tono: "grave", texto: `${a.ecf.rechazados} comprobante(s) rechazado(s) por la DGII esta semana`, ir: "fiscal", accion: "Ver envíos" });
    if (a.ecf.atrasados) puntos.push({ tono: "aviso", texto: `${a.ecf.atrasados} comprobante(s) llevan más de una hora sin enviarse a la DGII`, ir: "fiscal", accion: "Ver envíos" });
    const dias = a.certificado.vence ? Math.floor((new Date(a.certificado.vence).getTime() - Date.now()) / 86400e3) : null;
    if (dias === null) puntos.push({ tono: "aviso", texto: "No hay certificado digital: solo se puede facturar en el ambiente Simulado", ir: "fiscal", accion: "Subir certificado" });
    else if (dias < 0) puntos.push({ tono: "grave", texto: "El certificado digital está vencido: no se pueden firmar comprobantes", ir: "fiscal", accion: "Renovar" });
    else if (dias <= 30) puntos.push({ tono: "aviso", texto: `El certificado digital vence en ${dias} día(s)`, ir: "fiscal", accion: "Ver certificado" });
    if (dias !== null && dias >= 0 && a.certificado.sinActivar) puntos.push({ tono: "aviso", texto: `${a.certificado.sinActivar} sucursal(es) sin el certificado activado`, ir: "fiscal", accion: "Activar" });
    if (a.secuencias.length) {
      const agotadas = a.secuencias.filter((q) => Number(q.disponibles) === 0);
      const detalle = a.secuencias.slice(0, 4).map((q) => `${q.sucursal} ${q.tipo}: ${num(q.disponibles)}`).join(" · ");
      puntos.push({
        tono: agotadas.length ? "grave" : "aviso",
        texto: `${a.secuencias.length === 1 ? "Una secuencia" : `${a.secuencias.length} secuencias`} de e-NCF por agotarse (${detalle}${a.secuencias.length > 4 ? "…" : ""})`,
        ir: "fiscal", accion: "Asignar números",
      });
    }
    if (a.correosConError) puntos.push({ tono: "aviso", texto: `${a.correosConError} correo(s) de reportes no se pudieron enviar`, ir: "correo", accion: "Ver correo" });
  }
  if (sum("productos_bajo_minimo")) puntos.push({ tono: "aviso", texto: `${num(sum("productos_bajo_minimo"))} producto(s) por debajo del mínimo`, ir: "inventario", accion: "Ver existencias" });
  if (sum("traspasos_por_recibir")) puntos.push({ tono: "aviso", texto: `${num(sum("traspasos_por_recibir"))} traspaso(s) en camino por recibir`, ir: "traspasos", accion: "Ver traspasos" });
  puntos.sort((x, y) => (x.tono === y.tono ? 0 : x.tono === "grave" ? -1 : 1));

  const hoyTexto = new Date().toLocaleDateString("es-DO", { weekday: "long", day: "numeric", month: "long" });
  return (
    <>
      <Encabezado titulo="Resumen" descripcion={`Hoy, ${hoyTexto}, en ${filas.length === 1 ? "la sucursal" : `las ${filas.length} sucursales`}`} />
      <Aviso texto={error} />
      <div className="kpis">
        <Kpi titulo="Venta de hoy" valor={rd(ventaHoy)} detalle={a ? `Ayer: ${rd(a.ayer)}` : `${num(transHoy)} transacciones`} />
        <Kpi titulo="Ventas de hoy" valor={num(transHoy)} detalle={`Ticket promedio ${rd(transHoy ? ventaHoy / transHoy : 0)}`} />
        <Kpi titulo="Inventario al costo" valor={rd(sum("valor_inventario"))} detalle={`${filas.length} sucursal(es)`} />
        <Kpi titulo="Para atender" valor={a ? num(puntos.length) : "…"} tono={puntos.some((p) => p.tono === "grave") ? "alerta" : puntos.length ? undefined : "ok"} detalle={a && !puntos.length ? "Todo en orden" : undefined} />
      </div>

      {a && (
        <section className="atencion" aria-label="Requiere atención">
          <h2>Requiere atención</h2>
          {puntos.length === 0
            ? <p className="atencion-vacia">Todo en orden: cierres cuadrados, comprobantes al día, servidores en línea.</p>
            : (
              <ul>
                {puntos.map((p, i) => (
                  <li key={i} className={p.tono}>
                    <span className="punto" aria-hidden="true" />
                    <span className="texto">{p.texto}</span>
                    <button className="enlace" onClick={() => ir(p.ir)}>{p.accion}</button>
                  </li>
                ))}
              </ul>
            )}
        </section>
      )}

      <h2>Por sucursal</h2>
      <div className="tarjetas-sucursal">
        {filas.map((f) => (
          <div key={f.sucursal_id} className="tarjeta">
            <h3>{f.sucursal}</h3>
            <div className="dato"><span>Venta de hoy</span><b>{rd(f.venta_hoy)}</b></div>
            <div className="dato"><span>Ventas</span><b>{num(f.transacciones_hoy)}</b></div>
            <div className="dato"><span>Ticket promedio</span><b>{rd(Number(f.transacciones_hoy) ? Number(f.venta_hoy) / Number(f.transacciones_hoy) : 0)}</b></div>
            <div className="dato"><span>Inventario</span><b>{rd(f.valor_inventario)}</b></div>
            <div className="dato"><span>Bajo mínimo</span><b className={Number(f.productos_bajo_minimo) ? "texto-alerta" : ""}>{num(f.productos_bajo_minimo)}</b></div>
          </div>
        ))}
      </div>

      {a && a.cierres.length > 0 && (
        <>
          <h2>Cierres de caja de ayer y hoy</h2>
          <Tabla
            filas={a.cierres.slice(0, 12)}
            clave={(c) => c.id}
            columnas={[
              { titulo: "Caja", valor: (c) => <><b>{c.caja}</b> <span className="suave">{c.sucursal}</span></> },
              { titulo: "Cajero", valor: (c) => c.cajero },
              { titulo: "Cerró", valor: (c) => hora(c.cerradoEn) },
              { titulo: "Resultado", der: true, valor: (c) => {
                const d = Number(c.diferencia);
                return Math.abs(d) < 0.005 ? <span className="pastilla recibida">Cuadró</span>
                  : <span className={"pastilla " + (d < 0 ? "con_diferencia" : "en_transito")}>{d < 0 ? `Faltan ${rd(-d)}` : `Sobran ${rd(d)}`}</span>;
              } },
            ]}
          />
        </>
      )}

      <h2>Reponer pronto</h2>
      <Tabla
        filas={(bajo.datos ?? []).slice(0, 10)}
        clave={(f) => f.sucursal_id + f.producto_id}
        vacio="Ningún producto está por debajo del mínimo"
        columnas={[
          { titulo: "Producto", valor: (f) => <><b>{f.nombre}</b> <span className="suave">{f.sku}</span></> },
          { titulo: "Sucursal", valor: (f) => filas.find((s) => s.sucursal_id === f.sucursal_id)?.sucursal ?? "" },
          { titulo: "Existencia", valor: (f) => num(f.cantidad, 0), der: true },
          { titulo: "Mínimo", valor: (f) => num(f.stock_minimo, 0), der: true },
          { titulo: "Sugerido comprar", valor: (f) => <b>{num(f.sugerido_comprar, 0)}</b>, der: true },
        ]}
      />
      {(bajo.datos?.length ?? 0) > 10 && <button className="enlace" onClick={() => ir("reportes")}>Ver los {bajo.datos!.length} en Reportes › Bajo mínimo</button>}
    </>
  );
}
