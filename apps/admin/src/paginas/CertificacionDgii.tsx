import { useEffect, useState } from "react";
import { api } from "../api";
import { Aviso, Encabezado, useDatos } from "../ui";

/**
 * Portal de FactPOS: avance de la certificación del software ante la DGII (una sola para todos los clientes).
 * Sigue los 15 pasos del «Proceso de Certificación para ser Emisor Electrónico» de la DGII.
 */
type Estado = "PENDIENTE" | "EN_CURSO" | "HECHO";
interface Paso { estado: Estado; nota?: string; fecha?: string | null }
interface Datos {
  tipoRegistro: "EMISOR" | "PROVEEDOR"; softwareNombre: string; softwareVersion: string | null;
  urlRecepcion: string | null; urlAprobacion: string | null; urlAutenticacion: string | null;
  pasos: Record<string, Paso>; autorizado: boolean; autorizadoFecha: string | null; referencia: string | null; notas: string | null;
}

const PASOS: [string, string, string][] = [
  ["1", "Registrado", "Solicitud FI-GDF-016 en la Oficina Virtual y postulación en el Portal de Certificación (XML de postulación firmado)."],
  ["2", "Pruebas de datos e-CF", "Descargar el set de datos (Excel), generar los XML con los mismos campos y orden, y enviarlos al servicio de recepción."],
  ["3", "Pruebas de datos de aprobación comercial", "Descargar el set de aprobaciones y rechazos comerciales, generar sus XML y enviarlos."],
  ["4", "Pruebas de simulación e-CF", "Emitir comprobantes de cada tipo en el orden indicado (31, 32, 41, 43, 44, 45, 46, 47; luego 33 y 34; luego resumen de consumo)."],
  ["5", "Simulación de representación impresa", "Subir el PDF de la representación impresa de cada tipo (máximo 10 MB en total), con su QR."],
  ["6", "Validación de la representación impresa", "La DGII revisa los PDF: deben quedar aprobados."],
  ["7", "URL de servicios de prueba", "Confirmar las direcciones de recepción, aprobación comercial y autenticación."],
  ["8", "Inicio de prueba de recepción e-CF", "Indicar que el sistema está listo para recibir comprobantes."],
  ["9", "Recepción de e-CF", "Recibir los comprobantes de la DGII y devolver el acuse de recibo."],
  ["10", "Inicio de prueba de aprobación comercial", "Indicar que el sistema está listo para recibir aprobaciones comerciales."],
  ["11", "Recepción de aprobación comercial", "Recibir las aprobaciones o rechazos y responder OK o Error."],
  ["12", "URL de servicios de producción", "Registrar las direcciones definitivas (https://…/fe/recepcion/api/ecf, /fe/aprobacioncomercial/api/ecf, /fe/autenticacion/api/…)."],
  ["13", "Declaración jurada", "Generar el XML, firmarlo con el certificado del representante y enviarlo."],
  ["14", "Verificación del estatus del contribuyente", "La DGII revisa RNC al día, clave de Oficina Virtual, Alta NCF y representante."],
  ["15", "Finalizado", "Autorizado como emisor electrónico: se habilita el menú de facturación electrónica en la Oficina Virtual."],
];
const ROT: Record<Estado, string> = { PENDIENTE: "Pendiente", EN_CURSO: "En curso", HECHO: "Hecho" };

interface Req { id: string; titulo: string; exige: string; estado: "ok" | "falta" | "parcial"; detalle: string; pasos: string[] }
interface Verif { puedeFacturar: boolean; resumen: string; requisitos: Req[]; revisadoEn: string }

/** ¿Puede FactPOS facturar con e-CF? Cada requisito de la DGII, con lo que falta paso a paso. */
function VerificacionEcf() {
  const [n, setN] = useState(0);
  const { datos, error, cargando } = useDatos<Verif>("/central/portal/verificacion-ecf", [n]);
  const marca = { ok: "✓", falta: "✕", parcial: "!" } as const;
  const clase = { ok: "ok", falta: "alerta", parcial: "" } as const;
  const pendientes = (datos?.requisitos ?? []).filter((r) => r.estado !== "ok");
  return (
    <div className="panel">
      <div className="fila-acciones" style={{ marginTop: 0 }}>
        <h3 style={{ margin: 0 }}>¿Puede FactPOS facturar con e-CF?</h3><span className="flex" />
        <button className="boton" disabled={cargando} onClick={() => setN((x) => x + 1)}>{cargando ? "Revisando…" : "Volver a revisar"}</button>
      </div>
      <Aviso texto={error} />
      {datos && <Aviso tipo={datos.puedeFacturar ? "ok" : "error"} texto={datos.resumen} />}
      {(datos?.requisitos ?? []).map((r) => (
        <div key={r.id} className="seg-fila">
          <div style={{ flex: 1 }}>
            <b><span className={"pastilla " + clase[r.estado]} style={{ marginRight: 8 }}>{marca[r.estado]}</span>{r.titulo}</b>
            <p className="suave pequeno" style={{ margin: "4px 0 0", maxWidth: "80ch" }}>La DGII exige: {r.exige}</p>
            <p className="pequeno" style={{ margin: "4px 0 0", maxWidth: "80ch" }}>{r.detalle}</p>
            {r.pasos.length > 0 && <ol className="pequeno" style={{ margin: "6px 0 0", paddingLeft: 20, maxWidth: "80ch" }}>{r.pasos.map((p, i) => <li key={i}>{p}</li>)}</ol>}
          </div>
        </div>
      ))}
      {pendientes.length > 0 && <p className="suave pequeno" style={{ marginBottom: 0 }}>Pendientes: {pendientes.map((r) => r.titulo).join(" · ")}.</p>}
    </div>
  );
}

export function CertificacionDgii() {
  const { datos, error, recargar } = useDatos<Datos>("/central/portal/certificacion-dgii");
  const [f, setF] = useState<Datos | null>(null);
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" } | null>(null);
  const [guardando, setGuardando] = useState(false);
  useEffect(() => { if (datos) setF(datos); }, [datos]);
  if (!f) return <><Encabezado titulo="Certificación DGII" /><Aviso texto={error} /></>;

  const paso = (n: string): Paso => f.pasos[n] ?? { estado: "PENDIENTE" };
  const cambiarPaso = (n: string, x: Partial<Paso>) => setF({ ...f, pasos: { ...f.pasos, [n]: { ...paso(n), ...x } } });
  const hechos = PASOS.filter(([n]) => paso(n).estado === "HECHO").length;
  const guardar = async () => {
    setGuardando(true); setMsg(null);
    try { await api("/central/portal/certificacion-dgii", { metodo: "PUT", cuerpo: f }); setMsg({ t: "Guardado.", tipo: "ok" }); recargar(); }
    catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
    setGuardando(false);
  };

  return (
    <>
      <Encabezado titulo="Certificación DGII" descripcion="Avance de la certificación de FactPOS como software de facturación electrónica ante la DGII. Es una sola para todos los clientes.">
        <button className="boton primario" disabled={guardando} onClick={guardar}>Guardar</button>
      </Encabezado>
      {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}
      <VerificacionEcf />
      <Aviso tipo={f.autorizado ? "ok" : "info"} texto={f.autorizado ? `FactPOS está autorizado por la DGII${f.autorizadoFecha ? ` desde el ${new Date(f.autorizadoFecha + "T12:00:00").toLocaleDateString("es-DO")}` : ""}.` : `FactPOS aún no está autorizado por la DGII para emitir e-CF · ${hechos} de ${PASOS.length} pasos hechos.`} />

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Datos de la postulación</h3>
        <div className="dos-col">
          <label className="campo"><span>Tipo de registro</span>
            <select value={f.tipoRegistro} onChange={(e) => setF({ ...f, tipoRegistro: e.target.value as Datos["tipoRegistro"] })}>
              <option value="EMISOR">Emisor electrónico</option><option value="PROVEEDOR">Proveedor de servicios de facturación electrónica</option>
            </select></label>
          <label className="campo"><span>Nombre y versión del software</span>
            <div style={{ display: "flex", gap: 8 }}>
              <input value={f.softwareNombre} onChange={(e) => setF({ ...f, softwareNombre: e.target.value })} />
              <input style={{ maxWidth: 110 }} placeholder="Versión" value={f.softwareVersion ?? ""} onChange={(e) => setF({ ...f, softwareVersion: e.target.value })} />
            </div></label>
        </div>
        <label className="campo"><span>URL de recepción (termina en /fe/recepcion/api/ecf)</span><input value={f.urlRecepcion ?? ""} onChange={(e) => setF({ ...f, urlRecepcion: e.target.value })} placeholder="https://" /></label>
        <label className="campo"><span>URL de aprobación comercial (termina en /fe/aprobacioncomercial/api/ecf)</span><input value={f.urlAprobacion ?? ""} onChange={(e) => setF({ ...f, urlAprobacion: e.target.value })} placeholder="https://" /></label>
        <label className="campo"><span>URL de autenticación (termina en /fe/autenticacion/api/…)</span><input value={f.urlAutenticacion ?? ""} onChange={(e) => setF({ ...f, urlAutenticacion: e.target.value })} placeholder="https://" /></label>
      </div>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Pasos del proceso ({hechos} de {PASOS.length})</h3>
        {PASOS.map(([n, titulo, detalle]) => {
          const p = paso(n);
          return (
            <div key={n} className="seg-fila">
              <div style={{ flex: 1 }}>
                <b>{n}. {titulo}</b> <span className={"pastilla " + (p.estado === "HECHO" ? "ok" : p.estado === "EN_CURSO" ? "" : "alerta")}>{ROT[p.estado]}</span>
                <p className="suave pequeno" style={{ margin: "4px 0 0", maxWidth: "75ch" }}>{detalle}</p>
                <input style={{ marginTop: 6, width: "100%", maxWidth: 520 }} placeholder="Nota (opcional)" value={p.nota ?? ""} onChange={(e) => cambiarPaso(n, { nota: e.target.value })} />
              </div>
              <select value={p.estado} onChange={(e) => cambiarPaso(n, { estado: e.target.value as Estado, ...(e.target.value === "HECHO" && !p.fecha ? { fecha: new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10) } : {}) })}>
                {(Object.keys(ROT) as Estado[]).map((e) => <option key={e} value={e}>{ROT[e]}</option>)}
              </select>
            </div>
          );
        })}
      </div>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Autorización final</h3>
        <label className="check"><input type="checkbox" checked={f.autorizado} onChange={(e) => setF({ ...f, autorizado: e.target.checked })} /> La DGII ya autorizó a FactPOS como emisor electrónico</label>
        {f.autorizado && <div className="dos-col">
          <label className="campo"><span>Fecha de autorización</span><input type="date" value={f.autorizadoFecha ?? ""} onChange={(e) => setF({ ...f, autorizadoFecha: e.target.value || null })} /></label>
          <label className="campo"><span>Referencia (opcional)</span><input value={f.referencia ?? ""} onChange={(e) => setF({ ...f, referencia: e.target.value })} /></label>
        </div>}
        <label className="campo"><span>Notas</span><textarea value={f.notas ?? ""} onChange={(e) => setF({ ...f, notas: e.target.value })} /></label>
      </div>
    </>
  );
}
