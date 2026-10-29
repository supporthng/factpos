import { useEffect, useRef, useState } from "react";
import { api, num, sesionActual, encabezados } from "../api";
import { Aviso, Encabezado } from "../ui";

interface Info { actualizadoEn: string | null; registros: number; fuente: string | null; estado: "VACIO" | "CARGANDO" | "LISTO" | "ERROR"; mensaje: string | null; enVercel: boolean }

/**
 * Padrón de contribuyentes de la DGII: con él, la caja completa el nombre al
 * escribir el RNC o la cédula, sin internet. Se actualiza solo cada semana.
 */
export function Padron() {
  const [info, setInfo] = useState<Info | null>(null);
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" | "info" } | null>(null);
  const [prueba, setPrueba] = useState("");
  const [resultado, setResultado] = useState<any>(undefined);
  const [subiendo, setSubiendo] = useState(false);
  const archivo = useRef<HTMLInputElement>(null);

  const cargar = () => api<Info>("/central/padron").then(setInfo).catch((e) => setMsg({ t: e.message, tipo: "error" }));
  useEffect(() => { cargar(); }, []);
  // Mientras carga, se consulta el estado cada 3 s
  useEffect(() => {
    if (info?.estado !== "CARGANDO") return;
    const t = setInterval(cargar, 3000);
    return () => clearInterval(t);
  }, [info?.estado]);

  const descargar = async () => {
    setMsg(null);
    try {
      await api("/central/padron/actualizar", { cuerpo: {} });
      setMsg({ t: "Descargando el padrón de la DGII. Tarda unos minutos; puede seguir trabajando.", tipo: "info" });
      setTimeout(cargar, 1500);
    } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
  };

  const subir = async (f: File) => {
    setSubiendo(true);
    setMsg({ t: `Cargando ${f.name}…`, tipo: "info" });
    try {
      const s = sesionActual();
      const r = await fetch(`${s.servidor.replace(/\/$/, "")}/central/padron/archivo`, {
        method: "POST", body: f,
        headers: { "content-type": "application/octet-stream", ...encabezados() },
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `Error ${r.status}`);
      setMsg({ t: `Listo: ${num(d.registros)} contribuyentes cargados.`, tipo: "ok" });
      cargar();
    } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
    finally { setSubiendo(false); if (archivo.current) archivo.current.value = ""; }
  };

  const consultar = async () => {
    try { setResultado((await api(`/central/rnc/${prueba.replace(/\D/g, "")}`)).encontrado); } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
  };

  const fecha = info?.actualizadoEn ? new Date(info.actualizadoEn).toLocaleString("es-DO", { dateStyle: "long", timeStyle: "short" }) : null;
  return (
    <>
      <Encabezado titulo="Padrón de RNC (DGII)" descripcion="Con el listado de contribuyentes de la DGII, la caja completa el nombre al escribir el RNC o la cédula, sin internet y al instante." />
      <div className="panel padron-estado">
        <div>
          <span className="suave">Estado</span>
          <b className={"estado-padron " + (info?.estado ?? "").toLowerCase()}>
            {info?.estado === "LISTO" ? "Al día" : info?.estado === "CARGANDO" ? "Cargando…" : info?.estado === "ERROR" ? "Error en la última carga" : "Sin cargar"}
          </b>
        </div>
        <div><span className="suave">Contribuyentes</span><b>{info ? num(info.registros) : "—"}</b></div>
        <div><span className="suave">Última actualización</span><b>{fecha ?? "Nunca"}</b>{info?.fuente && <small className="suave">{info.fuente}</small>}</div>
      </div>
      {info?.estado === "ERROR" && info.mensaje && <Aviso texto={info.mensaje} />}
      {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}

      <div className="dos-col">
        <div className="panel">
          <h3>Descargar de la DGII</h3>
          <p className="suave pequeno">El servidor baja el archivo oficial (DGII_RNC.zip) y lo carga. Los servidores de las sucursales lo hacen solos una vez por semana cuando hay internet.</p>
          {info?.enVercel
            ? <p className="pequeno">En la nube lo carga la tarea <b>Padrón DGII</b> de GitHub Actions el día 1 de cada mes (o a mano desde la pestaña Actions del repositorio).</p>
            : <button className="boton primario" disabled={info?.estado === "CARGANDO"} onClick={descargar}>Descargar ahora</button>}
        </div>
        <div className="panel">
          <h3>Subir el archivo</h3>
          <p className="suave pequeno">Si el servidor no tiene internet: descargue <b>DGII_RNC.zip</b> desde la página de la DGII (Herramientas › Consultas › RNC) y súbalo aquí, tal como viene o el .txt de adentro.</p>
          <input ref={archivo} type="file" accept=".zip,.txt" hidden onChange={(e) => e.target.files?.[0] && subir(e.target.files[0])} />
          <button className="boton" disabled={subiendo || info?.enVercel} onClick={() => archivo.current?.click()}>{subiendo ? "Cargando…" : "Elegir archivo"}</button>
        </div>
      </div>

      <div className="panel">
        <h3>Probar una consulta</h3>
        <div className="filtros">
          <input value={prueba} onChange={(e) => setPrueba(e.target.value)} placeholder="RNC o cédula" inputMode="numeric" onKeyDown={(e) => e.key === "Enter" && consultar()} style={{ width: 240 }} />
          <button className="boton" onClick={consultar} disabled={prueba.replace(/\D/g, "").length < 9}>Consultar</button>
        </div>
        {resultado === null && <p className="suave">No está en el padrón.</p>}
        {resultado && (
          <div className="resultado-rnc">
            <b>{resultado.nombre}</b>
            {resultado.nombreComercial && <span>{resultado.nombreComercial}</span>}
            <span className="suave pequeno">{[resultado.actividad, resultado.regimen].filter(Boolean).join(" · ")}</span>
            <span className={"pastilla " + (resultado.estado === "ACTIVO" ? "aplicado" : "con_diferencia")}>{resultado.estado}</span>
          </div>
        )}
      </div>
    </>
  );
}
