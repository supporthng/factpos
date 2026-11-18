import { useState } from "react";
import { api } from "../api";
import { Aviso } from "../ui";
import { leerHojasXlsx, type Tabla } from "../leerTabla";
import { armarSimulacion, type DatosEmisor } from "../simulacionDgii";

/**
 * Set de pruebas de la DGII: se sube el Excel que la DGII genera para la empresa (hojas «ECF» y «RFCE») y cada caso se arma
 * con sus datos exactos, se firma con el certificado de la empresa y se envía a TesteCF/CerteCF. El set de cada empresa
 * trae su propio RNC y sus propios e-NCF: aquí no hay nada fijo.
 */
interface Caso { clave: string; tipo: string; encf: string; ecf: Record<string, string>; rfce?: Record<string, string> }
interface Resultado { estado: string; trackId?: string; mensajes?: unknown; aviso?: string; sinUsar?: string[]; xmlFirmado?: string; xmlCompleto?: string; modo?: string; enviado?: boolean }

/** Orden que pide la DGII: 31, 32, 41, 43, 44, 45, 46, 47; luego 33 y 34 (referencian comprobantes ya aceptados). */
const ORDEN = ["31", "32", "41", "43", "44", "45", "46", "47", "33", "34"];

const aFilas = (t: Tabla): Record<string, string>[] => {
  const [cab, ...datos] = t;
  if (!cab) return [];
  return datos.map((f) => {
    const o: Record<string, string> = {};
    cab.forEach((h, i) => { const v = (f[i] ?? "").trim(); if (h && v !== "" && v !== "#e") o[h.trim()] = v; });
    return o;
  }).filter((o) => o["ENCF"]);
};

const descargar = (nombre: string, xml: string) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([xml], { type: "application/xml" }));
  a.download = nombre; a.click(); URL.revokeObjectURL(a.href);
};

/** Representación impresa (PDF con QR) del e-CF completo del caso: paso 5 de la certificación. */
async function descargarPdf(r: Resultado): Promise<void> {
  const xml = r.xmlCompleto ?? r.xmlFirmado;
  if (!xml) throw new Error("Primero arme el caso.");
  const x = await api<{ nombre: string; pdfBase64: string }>("/central/fiscal/representacion-pdf", { cuerpo: { xml } });
  const bytes = Uint8Array.from(atob(x.pdfBase64), (c) => c.charCodeAt(0));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  a.download = x.nombre; a.click(); URL.revokeObjectURL(a.href);
}

export function SetPruebasDgii() {
  const [casos, setCasos] = useState<Caso[]>([]);
  const [res, setRes] = useState<Record<string, Resultado>>({});
  const [error, setError] = useState<string | null>(null);
  const [corriendo, setCorriendo] = useState<string | null>(null);
  const [archivo, setArchivo] = useState("");
  /** Casos tal como vienen del Excel; la simulación se arma a partir de ellos */
  const [base, setBase] = useState<Caso[]>([]);
  const [sim, setSim] = useState(false);
  const [inicio, setInicio] = useState("101");

  const cargar = async (f: File | undefined) => {
    if (!f) return;
    setError(null); setRes({}); setCasos([]); setBase([]); setSim(false); setArchivo(f.name);
    try {
      const hojas = await leerHojasXlsx(f);
      const nombre = (n: string) => Object.keys(hojas).find((k) => k.trim().toUpperCase() === n);
      const hEcf = nombre("ECF");
      if (!hEcf) throw new Error("El archivo no tiene la hoja «ECF». Suba el Excel del set de pruebas tal como lo descargó del portal de la DGII.");
      const rfce = new Map(aFilas(hojas[nombre("RFCE") ?? ""] ?? []).map((r) => [r["ENCF"]!, r]));
      const lista = aFilas(hojas[hEcf]!).map((e) => ({ clave: e["ENCF"]!, tipo: String(e["TipoeCF"] ?? "").padStart(2, "0"), encf: e["ENCF"]!, ecf: e, rfce: rfce.get(e["ENCF"]!) }));
      lista.sort((a, b) => ORDEN.indexOf(a.tipo) - ORDEN.indexOf(b.tipo) || a.encf.localeCompare(b.encf));
      if (!lista.length) throw new Error("La hoja «ECF» no trae casos.");
      setBase(lista); setCasos(lista);
    } catch (e) { setError((e as Error).message); }
  };

  const ultimo: Record<string, string> = {};
  const resultadoDe = (clave: string) => ultimo[clave];
  const correr = async (lista: Caso[], enviar: boolean) => {
    setError(null);
    for (const c of lista) {
      setCorriendo(c.clave);
      try {
        const r = await api<Resultado>("/central/fiscal/set-pruebas/caso", { cuerpo: { ecf: c.ecf, rfce: c.rfce, enviar } });
        ultimo[c.clave] = r.estado;
        setRes((x) => ({ ...x, [c.clave]: r }));
      } catch (e) {
        setRes((x) => ({ ...x, [c.clave]: { estado: "ERROR", mensajes: (e as Error).message } }));
        // Sin certificado o ambiente mal configurado: no tiene caso seguir con los demás
        if (enviar) break;
      }
      // En la simulación la DGII no deja repetir números: si rechaza uno, se detiene para no gastar los demás
      if (enviar && sim && resultadoDe(c.clave) === "RECHAZADO") { setError("La DGII rechazó un comprobante de la simulación. Revise el detalle, corrija y use «Reiniciar simulación»."); break; }
    }
    setCorriendo(null);
  };

  const convertirEnSimulacion = async () => {
    setError(null);
    try {
      const e = await api<{ rnc: string; razonSocial: string; nombreComercial: string; direccion: string; telefono: string; correo: string }>("/central/empresa");
      const datos: DatosEmisor = { rnc: e.rnc, razonSocial: e.razonSocial, nombreComercial: e.nombreComercial, direccion: e.direccion, telefono: e.telefono, correo: e.correo };
      const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santo_Domingo" }).format(new Date());
      const n = Math.max(1, Math.floor(Number(inicio) || 101));
      setRes({}); setCasos(armarSimulacion(base, datos, hoy, n)); setSim(true);
    } catch (err) { setError((err as Error).message); }
  };
  const volverAlSet = () => { setRes({}); setCasos(base); setSim(false); };

  const rnc = casos[0]?.ecf["RNCEmisor"];
  const ok = Object.values(res).filter((r) => r.estado === "ACEPTADO" || r.estado === "ACEPTADO_COND" || r.estado === "ARMADO").length;
  const txt = (m: unknown) => (m == null ? "" : typeof m === "string" ? m : JSON.stringify(m)).slice(0, 300);

  return (
    <div className="panel">
      <h3 style={{ marginTop: 0 }}>Set de pruebas de la DGII</h3>
      <p className="suave pequeno">Suba el Excel del set de pruebas (con las hojas «ECF» y «RFCE») que la DGII generó para esta empresa. Cada caso se arma con sus datos exactos, se firma con el certificado de la empresa y se envía al ambiente de pruebas (TesteCF) o certificación (CerteCF). Requiere el transmisor «DGII», el ambiente de pruebas y el certificado cargado. No crea ventas ni gasta e-NCF de la sucursal.</p>
      <div className="fila-acciones">
        <input type="file" accept=".xlsx" onChange={(e) => void cargar(e.target.files?.[0])} />
        {archivo && <span className="suave pequeno">{archivo}</span>}
      </div>
      {error && <Aviso texto={error} />}
      {casos.length > 0 && (
        <>
          <p className="suave pequeno">{casos.length} casos{rnc ? ` · RNC emisor del set: ${rnc}` : ""}. {Object.keys(res).length ? `${ok} de ${Object.keys(res).length} correctos.` : ""}</p>
          {sim ? (
            <Aviso tipo="info" texto="Modo simulación: los comprobantes salen con los datos y el RNC de esta empresa, con numeración propia (aparte de sus secuencias reales) y fecha de hoy, en el orden que pide la DGII. Si la DGII rechaza uno, el envío se detiene." />
          ) : (
            <div className="fila-acciones" style={{ alignItems: "flex-end" }}>
              <label className="campo"><span>Simulación: empezar en el número</span><input className="numero" inputMode="numeric" value={inicio} onChange={(e) => setInicio(e.target.value.replace(/\D/g, ""))} style={{ width: 90 }} /></label>
              <button className="boton" disabled={!!corriendo || !base.length} onClick={() => void convertirEnSimulacion()}>Convertir en simulación con los datos de mi empresa</button>
            </div>
          )}
          <div className="fila-acciones">
            {sim && <button className="boton" disabled={!!corriendo} onClick={() => { if (confirm("¿Reiniciar la simulación? Se vuelve al set y, si ya envió comprobantes, use un número de inicio más alto (la DGII no deja repetir números).")) volverAlSet(); }}>Reiniciar simulación</button>}
            <button className="boton" disabled={!!corriendo} onClick={() => void correr(casos, false)}>Armar y firmar (sin enviar)</button>
            <button className="boton" disabled={!!corriendo || !Object.values(res).some((r) => r.xmlFirmado)} onClick={async () => { for (const c of casos) { const r = res[c.clave]; if (r?.xmlFirmado) { try { await descargarPdf(r); } catch (e) { setError((e as Error).message); break; } await new Promise((ok) => setTimeout(ok, 400)); } } }}>Descargar todos los PDF</button>
            <button className="boton primario" disabled={!!corriendo} onClick={() => { if (confirm(`¿Enviar los ${casos.length} casos a la DGII?`)) void correr(casos, true); }}>{corriendo ? "Procesando…" : "Enviar todo a la DGII"}</button>
          </div>
          <table className="tabla">
            <thead><tr><th>Tipo</th><th>e-NCF</th><th>Envío</th><th>Resultado</th><th>Detalle</th><th /></tr></thead>
            <tbody>{casos.map((c) => {
              const r = res[c.clave];
              return (
                <tr key={c.clave}>
                  <td>E{c.tipo}</td><td>{c.encf}</td><td>{c.rfce ? "Resumen (RFCE)" : "e-CF completo"}</td>
                  <td>{corriendo === c.clave ? "…" : r ? <span className={"pastilla " + (r.estado === "ACEPTADO" || r.estado === "ACEPTADO_COND" || r.estado === "ARMADO" ? "ok" : r.estado === "ERROR" || r.estado === "RECHAZADO" ? "alerta" : "")}>{r.estado}</span> : <span className="suave">—</span>}</td>
                  <td className="pequeno">{r?.trackId ? `TrackId ${r.trackId}. ` : ""}{r?.aviso ? `${r.aviso} ` : ""}{r?.sinUsar?.length ? `Columnas sin usar: ${r.sinUsar.join(", ")}. ` : ""}{txt(r?.mensajes)}</td>
                  <td className="der">
                    <button className="boton chico" disabled={!!corriendo} onClick={() => void correr([c], true)}>Enviar</button>{" "}
                    {r?.xmlFirmado && <button className="boton chico" onClick={() => descargar(`${c.encf}.xml`, r.xmlFirmado!)}>XML</button>}{" "}
                    {r?.xmlFirmado && <button className="boton chico" onClick={() => descargarPdf(r).catch((e) => setError((e as Error).message))}>PDF</button>}
                  </td>
                </tr>
              );
            })}</tbody>
          </table>
        </>
      )}
    </div>
  );
}
