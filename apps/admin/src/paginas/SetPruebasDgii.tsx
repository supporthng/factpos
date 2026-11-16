import { useState } from "react";
import { api } from "../api";
import { Aviso } from "../ui";
import { leerHojasXlsx, type Tabla } from "../leerTabla";

/**
 * Set de pruebas de la DGII: se sube el Excel que la DGII genera para la empresa (hojas «ECF» y «RFCE») y cada caso se arma
 * con sus datos exactos, se firma con el certificado de la empresa y se envía a TesteCF/CerteCF. El set de cada empresa
 * trae su propio RNC y sus propios e-NCF: aquí no hay nada fijo.
 */
interface Caso { clave: string; tipo: string; encf: string; ecf: Record<string, string>; rfce?: Record<string, string> }
interface Resultado { estado: string; trackId?: string; mensajes?: unknown; aviso?: string; sinUsar?: string[]; xmlFirmado?: string; modo?: string; enviado?: boolean }

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

export function SetPruebasDgii() {
  const [casos, setCasos] = useState<Caso[]>([]);
  const [res, setRes] = useState<Record<string, Resultado>>({});
  const [error, setError] = useState<string | null>(null);
  const [corriendo, setCorriendo] = useState<string | null>(null);
  const [archivo, setArchivo] = useState("");

  const cargar = async (f: File | undefined) => {
    if (!f) return;
    setError(null); setRes({}); setCasos([]); setArchivo(f.name);
    try {
      const hojas = await leerHojasXlsx(f);
      const nombre = (n: string) => Object.keys(hojas).find((k) => k.trim().toUpperCase() === n);
      const hEcf = nombre("ECF");
      if (!hEcf) throw new Error("El archivo no tiene la hoja «ECF». Suba el Excel del set de pruebas tal como lo descargó del portal de la DGII.");
      const rfce = new Map(aFilas(hojas[nombre("RFCE") ?? ""] ?? []).map((r) => [r["ENCF"]!, r]));
      const lista = aFilas(hojas[hEcf]!).map((e) => ({ clave: e["ENCF"]!, tipo: String(e["TipoeCF"] ?? "").padStart(2, "0"), encf: e["ENCF"]!, ecf: e, rfce: rfce.get(e["ENCF"]!) }));
      lista.sort((a, b) => ORDEN.indexOf(a.tipo) - ORDEN.indexOf(b.tipo) || a.encf.localeCompare(b.encf));
      if (!lista.length) throw new Error("La hoja «ECF» no trae casos.");
      setCasos(lista);
    } catch (e) { setError((e as Error).message); }
  };

  const correr = async (lista: Caso[], enviar: boolean) => {
    setError(null);
    for (const c of lista) {
      setCorriendo(c.clave);
      try {
        const r = await api<Resultado>("/central/fiscal/set-pruebas/caso", { cuerpo: { ecf: c.ecf, rfce: c.rfce, enviar } });
        setRes((x) => ({ ...x, [c.clave]: r }));
      } catch (e) {
        setRes((x) => ({ ...x, [c.clave]: { estado: "ERROR", mensajes: (e as Error).message } }));
        // Sin certificado o ambiente mal configurado: no tiene caso seguir con los demás
        if (enviar) break;
      }
    }
    setCorriendo(null);
  };

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
          <div className="fila-acciones">
            <button className="boton" disabled={!!corriendo} onClick={() => void correr(casos, false)}>Armar y firmar (sin enviar)</button>
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
                    {r?.xmlFirmado && <button className="boton chico" onClick={() => descargar(`${c.encf}.xml`, r.xmlFirmado!)}>XML</button>}
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
