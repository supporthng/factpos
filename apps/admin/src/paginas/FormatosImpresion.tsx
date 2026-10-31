import { useEffect, useState } from "react";
import { FORMATO_TICKET_BASE, formatoTicket, medidasTicket, type FormatoTicket } from "@factpos/compartido";
import { api } from "../api";
import { Aviso, Encabezado } from "../ui";

/**
 * Diseño del ticket impreso: papel, tamaño de letra y de logo, qué datos salen y los textos del encabezado y el pie.
 * La vista previa se actualiza al instante; al guardar, todas las cajas usan el formato nuevo.
 */
interface Marca { nombre: string; logo: string | null; logoEnTicket: boolean; formato: Partial<FormatoTicket> }

export function FormatosImpresion() {
  const [m, setM] = useState<Marca | null>(null);
  const [f, setF] = useState<FormatoTicket>(FORMATO_TICKET_BASE);
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" } | null>(null);
  const [guardando, setGuardando] = useState(false);
  useEffect(() => { api<Marca>("/central/marca").then((d) => { setM(d); setF(formatoTicket(d.formato)); }).catch((e) => setMsg({ t: e.message, tipo: "error" })); }, []);
  if (!m) return <Aviso texto={msg?.t ?? ""} />;

  const set = (p: Partial<FormatoTicket>) => setF({ ...f, ...p });
  const med = medidasTicket(f);
  const guardar = async () => {
    setGuardando(true); setMsg(null);
    try { await api("/central/marca/formato", { metodo: "PUT", cuerpo: f }); setMsg({ t: "Formato guardado. Las cajas lo usan en el próximo ticket (si una caja está abierta, cierre y abra su turno o recargue su catálogo).", tipo: "ok" }); }
    catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); } finally { setGuardando(false); }
  };
  const Op = ({ k, texto }: { k: keyof FormatoTicket; texto: string }) => (
    <label className="interruptor"><input type="checkbox" checked={f[k] as boolean} onChange={(e) => set({ [k]: e.target.checked } as Partial<FormatoTicket>)} /><span>{texto}</span></label>
  );

  return (
    <>
      <Encabezado titulo="Formatos de impresión" descripcion="Diseñe el ticket que imprimen las cajas: papel, logo, datos del negocio, encabezado y pie." />
      <div className="detalle-grid" style={{ alignItems: "start" }}>
        <div>
          <div className="panel">
            <h3>Logo de la empresa</h3>
            {m.logo ? <img src={m.logo} alt="Logo" style={{ maxHeight: 70, maxWidth: "100%", background: "#fff", padding: 6, borderRadius: 8 }} /> : <p className="suave">Todavía no hay logo.</p>}
            <div className="fila-acciones">
              <button className="boton" onClick={() => { location.hash = "marca"; }}>{m.logo ? "Cambiar el logo" : "Subir el logo"}</button>
              <span className="suave pequeno">Se sube en «Logo y colores».</span>
            </div>
            <label className="campo" style={{ marginTop: 12 }}><span>Tamaño del logo en el ticket</span>
              <select value={f.logoTamano} onChange={(e) => set({ logoTamano: e.target.value as FormatoTicket["logoTamano"] })}>
                <option value="pequeno">Pequeño</option><option value="mediano">Mediano</option><option value="grande">Grande</option>
              </select>
            </label>
            <p className="suave pequeno">Para que el logo salga en el ticket, active «Imprimir el logo en el ticket» en «Logo y colores».</p>
          </div>

          <div className="panel">
            <h3>Papel y letra</h3>
            <div className="dos-col">
              <label className="campo"><span>Ancho del papel</span>
                <select value={f.papel} onChange={(e) => set({ papel: e.target.value as FormatoTicket["papel"] })}><option value="80">80 mm (el más común)</option><option value="58">58 mm</option></select></label>
              <label className="campo"><span>Tamaño de la letra</span>
                <select value={f.letra} onChange={(e) => set({ letra: e.target.value as FormatoTicket["letra"] })}><option value="pequena">Pequeña</option><option value="normal">Normal</option><option value="grande">Grande</option></select></label>
            </div>
          </div>

          <div className="panel">
            <h3>Encabezado</h3>
            <Op k="mostrarRnc" texto="RNC de la empresa" />
            <Op k="mostrarSucursal" texto="Nombre de la sucursal" />
            <Op k="mostrarDireccion" texto="Dirección de la sucursal" />
            <Op k="mostrarTelefono" texto="Teléfono de la sucursal" />
            <label className="campo" style={{ marginTop: 10 }}><span>Líneas extra bajo el nombre (una por renglón)</span>
              <textarea rows={3} maxLength={240} value={f.encabezadoExtra} onChange={(e) => set({ encabezadoExtra: e.target.value })} placeholder={"www.minegocio.com\nLunes a sábado 8:00 a. m. – 8:00 p. m."} /></label>
          </div>

          <div className="panel">
            <h3>Cuerpo y pie</h3>
            <Op k="mostrarCajero" texto="Nombre del cajero" />
            <Op k="mostrarCliente" texto="Datos del cliente (si lo hay)" />
            <Op k="mostrarAhorro" texto="«Usted ahorró» cuando hay descuentos" />
            <Op k="mostrarQr" texto="Código QR de la factura electrónica" />
            <label className="campo" style={{ marginTop: 10 }}><span>Mensaje final</span>
              <input maxLength={120} value={f.pie} onChange={(e) => set({ pie: e.target.value })} /></label>
            <label className="campo"><span>Texto adicional al final (devoluciones, garantía…)</span>
              <textarea rows={3} maxLength={400} value={f.pieExtra} onChange={(e) => set({ pieExtra: e.target.value })} placeholder="Cambios y devoluciones dentro de 7 días con este ticket." /></label>
          </div>

          <div className="fila-acciones">
            <button className="boton primario" disabled={guardando} onClick={guardar}>Guardar formato</button>
            <button className="enlace" onClick={() => setF(FORMATO_TICKET_BASE)}>Volver al formato original</button>
          </div>
          {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}
        </div>

        <div className="panel" style={{ position: "sticky", top: 76 }}>
          <h3>Vista previa</h3>
          <p className="suave pequeno">Ticket de {f.papel} mm con una venta de ejemplo.</p>
          <div className="vista-ticket" style={{ width: med.ancho, fontSize: med.letra }}>
            <div className="vt-centro">
              {m.logo && m.logoEnTicket && <img src={m.logo} alt="" style={{ maxWidth: med.logoAncho, maxHeight: med.logoAlto }} />}
              <b style={{ fontSize: "1.25em" }}>{m.nombre}</b>
              {f.mostrarRnc && <div>RNC 1-31-00000-0</div>}
              {f.mostrarSucursal && <div>Sucursal Principal</div>}
              {f.mostrarDireccion && <div>Calle Principal #1, Santo Domingo</div>}
              {f.mostrarTelefono && <div>Tel. 809-555-0100</div>}
              {f.encabezadoExtra.split("\n").filter((l) => l.trim()).map((l, i) => <div key={i}>{l}</div>)}
            </div>
            <div className="vt-linea" />
            <div className="vt-centro"><b>Factura de Consumo Electrónica</b></div>
            <div className="vt-fila"><span>e-NCF</span><b>E320000000001</b></div>
            <div className="vt-fila"><span>Fecha</span><span>31/10/2026 17:30</span></div>
            <div className="vt-fila"><span>Caja 1 · #1024</span>{f.mostrarCajero && <span>María</span>}</div>
            {f.mostrarCliente && <div className="vt-fila"><span>Cliente</span><span>Cliente de ejemplo</span></div>}
            <div className="vt-linea" />
            <div>Arroz selecto 25 lb</div><div className="vt-fila"><span>2 × 1,150.00</span><span>2,300.00</span></div>
            <div>Aceite 1 L</div><div className="vt-fila"><span>3 × 210.00</span><span>630.00</span></div>
            <div className="vt-linea" />
            <div className="vt-fila"><span>Subtotal</span><span>2,930.00</span></div>
            <div className="vt-fila"><span>ITBIS</span><span>0.00</span></div>
            {f.mostrarAhorro && <div className="vt-fila"><span>Usted ahorró</span><span>60.00</span></div>}
            <div className="vt-fila" style={{ fontWeight: 800, fontSize: "1.25em" }}><span>TOTAL</span><span>2,930.00</span></div>
            <div className="vt-linea" />
            <div className="vt-centro">
              {f.mostrarQr && <div className="vt-qr">QR</div>}
              <div>Código de seguridad: <b>A1B2C3</b></div>
              {f.pie && <div style={{ marginTop: 6 }}>{f.pie}</div>}
              {f.pieExtra && <div style={{ marginTop: 4, fontSize: ".92em" }}>{f.pieExtra}</div>}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
