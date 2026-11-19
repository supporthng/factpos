import { useRef, useState } from "react";
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
  }).filter((o) => Object.entries(o).some(([k, v]) => k.toLowerCase() === "encf" && v));
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

/** Aprobación comercial del set (hoja «ACECF»): la DGII simula que un suplidor nos envió un e-CF y pide aprobarlo o rechazarlo. */
interface Aprobacion { clave: string; fila: Record<string, string> }
const ENCF_DE = (f: Record<string, string>) => Object.entries(f).find(([k]) => k.toLowerCase() === "encf")?.[1] ?? "";

/** Los números de simulación no se pueden reutilizar en la DGII: se recuerda el último usado en este navegador y se propone el siguiente bloque libre. */
const CLAVE_SIM = "factpos.certificacion.simulacion.ultimo";
const leerUltimo = () => { try { return Number(localStorage.getItem(CLAVE_SIM)) || 0; } catch { return 0; } };
const guardarUltimo = (n: number) => { try { if (n > leerUltimo()) localStorage.setItem(CLAVE_SIM, String(n)); } catch { /* sin almacenamiento: no pasa nada */ } };
const siguienteBloque = () => { const u = leerUltimo(); return u ? Math.floor(u / 100) * 100 + 101 : 101; };
const numeroDeEncf = (encf: string) => Number(encf.slice(3)) || 0;

export function SetPruebasDgii() {
  const [aprob, setAprob] = useState<Aprobacion[]>([]);
  const [resAprob, setResAprob] = useState<Record<string, Resultado>>({});

  const [casos, setCasos] = useState<Caso[]>([]);
  const [res, setRes] = useState<Record<string, Resultado>>({});
  const [error, setError] = useState<string | null>(null);
  const [corriendo, setCorriendo] = useState<string | null>(null);
  const [archivo, setArchivo] = useState("");
  /** Casos tal como vienen del Excel; la simulación se arma a partir de ellos */
  const [base, setBase] = useState<Caso[]>([]);
  const [sim, setSim] = useState(false);
  const [inicio, setInicio] = useState(String(siguienteBloque()));
  /** e-NCF ya aceptados por la DGII en esta sesión: un reintento del lote no los vuelve a enviar (reenviar reinicia las pruebas) */
  const aceptados = useRef(new Set<string>());

  const cargar = async (f: File | undefined) => {
    if (!f) return;
    setError(null); setArchivo(f.name);
    try {
      const hojas = await leerHojasXlsx(f);
      // Set de aprobaciones comerciales: hoja «ACECF» (no borra el set de e-CF ya cargado)
      const hAc = Object.keys(hojas).find((k) => /^ACE+CF/i.test(k.trim()));
      if (hAc) {
        const filas = aFilas(hojas[hAc]!);
        if (!filas.length) throw new Error("La hoja de aprobaciones comerciales no trae filas.");
        setAprob(filas.map((fila) => ({ clave: ENCF_DE(fila), fila }))); setResAprob({});
        return;
      }
      setRes({}); setCasos([]); setBase([]); setSim(false); aceptados.current.clear();
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
      // En un lote no se repite lo que la DGII ya aceptó: reenviarlo se rechaza y la DGII reinicia las pruebas
      if (enviar && lista.length > 1 && aceptados.current.has(c.clave)) continue;
      if (enviar && sim) guardarUltimo(numeroDeEncf(c.encf));
      setCorriendo(c.clave);
      try {
        const r = await api<Resultado>("/central/fiscal/set-pruebas/caso", { cuerpo: { ecf: c.ecf, rfce: c.rfce, enviar } });
        ultimo[c.clave] = r.estado;
        if (enviar && (r.estado === "ACEPTADO" || r.estado === "ACEPTADO_COND")) aceptados.current.add(c.clave);
        setRes((x) => ({ ...x, [c.clave]: r }));
      } catch (e) {
        setRes((x) => ({ ...x, [c.clave]: { estado: "ERROR", mensajes: (e as Error).message } }));
        // Sin certificado o ambiente mal configurado: no tiene caso seguir con los demás
        if (enviar) break;
      }
      // En la simulación la DGII no deja repetir números: si rechaza uno, se detiene para no gastar los demás
      if (enviar && sim && resultadoDe(c.clave) === "RECHAZADO") { setError(`La DGII rechazó un comprobante de la simulación y reinició las pruebas. Revise el detalle, use «Reiniciar simulación» (se propondrá el número ${siguienteBloque()}) y vuelva a enviar todo UNA sola vez.`); break; }
    }
    setCorriendo(null);
  };

  const correrAprobaciones = async (lista: Aprobacion[], enviar: boolean) => {
    setError(null);
    for (const a of lista) {
      setCorriendo("AC-" + a.clave);
      try {
        const r = await api<Resultado>("/central/fiscal/set-pruebas/aprobacion", { cuerpo: { fila: a.fila, enviar } });
        setResAprob((x) => ({ ...x, [a.clave]: r }));
      } catch (e) {
        setResAprob((x) => ({ ...x, [a.clave]: { estado: "ERROR", mensajes: (e as Error).message } }));
        if (enviar) break;
      }
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
      setRes({}); aceptados.current.clear(); setCasos(armarSimulacion(base, datos, hoy, n)); setSim(true);
    } catch (err) { setError((err as Error).message); }
  };
  const volverAlSet = () => { setRes({}); aceptados.current.clear(); setCasos(base); setSim(false); setInicio(String(siguienteBloque())); };

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
      {aprob.length > 0 && (
        <>
          <h4 style={{ margin: "14px 0 4px" }}>Aprobaciones comerciales ({aprob.length})</h4>
          <p className="suave pequeno">Cada fila es un e-CF que la DGII simula que un suplidor le envió: se aprueba (Estado 1) o se rechaza (Estado 2, con su motivo). Se arma el ACECF, se firma con el certificado de la empresa y se envía.</p>
          <div className="fila-acciones">
            <button className="boton" disabled={!!corriendo} onClick={() => void correrAprobaciones(aprob, false)}>Armar y firmar (sin enviar)</button>
            <button className="boton primario" disabled={!!corriendo} onClick={() => { if (confirm(`¿Enviar las ${aprob.length} aprobaciones a la DGII?`)) void correrAprobaciones(aprob, true); }}>{corriendo?.startsWith("AC-") ? "Procesando…" : "Enviar aprobaciones a la DGII"}</button>
          </div>
          <table className="tabla">
            <thead><tr><th>e-NCF</th><th>Decisión</th><th>Resultado</th><th>Detalle</th><th /></tr></thead>
            <tbody>{aprob.map((a) => {
              const r = resAprob[a.clave];
              const estado = Object.entries(a.fila).find(([k]) => k.toLowerCase() === "estado")?.[1];
              return (
                <tr key={a.clave}>
                  <td>{a.clave}</td><td>{estado === "1" ? "Aprobar" : estado === "2" ? "Rechazar" : "—"}</td>
                  <td>{corriendo === "AC-" + a.clave ? "…" : r ? <span className={"pastilla " + (r.estado === "ACEPTADO" || r.estado === "ARMADO" ? "ok" : r.estado === "ERROR" || r.estado === "RECHAZADO" ? "alerta" : "")}>{r.estado}</span> : <span className="suave">—</span>}</td>
                  <td className="pequeno">{txt(r?.mensajes)}</td>
                  <td className="der">
                    <button className="boton chico" disabled={!!corriendo} onClick={() => void correrAprobaciones([a], true)}>Enviar</button>{" "}
                    {r?.xmlFirmado && <button className="boton chico" onClick={() => descargar(`${a.clave}-ACECF.xml`, r.xmlFirmado!)}>XML</button>}
                  </td>
                </tr>
              );
            })}</tbody>
          </table>
        </>
      )}
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
                    {r?.xmlFirmado && <button className="boton chico" title={r.xmlCompleto ? "e-CF completo (el que se sube en «Facturas de consumo < 250Mil»)" : undefined} onClick={() => descargar(`${c.encf}.xml`, (r.xmlCompleto ?? r.xmlFirmado)!)}>XML</button>}{" "}
                    {r?.xmlCompleto && r.xmlFirmado && <button className="boton chico" title="Resumen (RFCE) que se envió a la DGII" onClick={() => descargar(`${c.encf}-RFCE.xml`, r.xmlFirmado!)}>Resumen</button>}{" "}
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
