import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Aviso, Encabezado } from "../ui";

/**
 * Videos promocionales (solo portal, solo el administrador): el guion de cada escena, la voz con IA (ElevenLabs, la
 * clave está en el servidor) y el reproductor. «Grabar» graba la pestaña con su sonido y descarga el archivo (Chrome o
 * Edge en computadora); en el celular se reproduce y se usa la grabación de pantalla del teléfono, o se bajan las voces.
 */
interface Escena { tipo: string; dur: number; voz?: string; titulo?: string; [k: string]: unknown }
interface Guion { marca: unknown; escenas: Escena[]; [k: string]: unknown }
type Guiones = Record<string, Guion>;
interface Estado { configurado: boolean; vozPorDefecto: string | null; modelo: string }

const url = (r: string) => new URL(r, document.baseURI).href;
const aBlob = (b64: string) => { const bin = atob(b64); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return new Blob([a], { type: "audio/mpeg" }); };

export function VideosPortal() {
  const [guiones, setGuiones] = useState<Guiones | null>(null);
  const [negocio, setNegocio] = useState("");
  const [estado, setEstado] = useState<Estado | null>(null);
  const [vozId, setVozId] = useState("");
  const [audios, setAudios] = useState<Record<number, string>>({});     // escena -> dirección blob del mp3
  const [ocupada, setOcupada] = useState<number | 0 | -1>(0);           // escena en proceso (-1 = todas)
  const [msg, setMsg] = useState(""); const [ok, setOk] = useState("");
  const [listo, setListo] = useState(false); const [grabando, setGrabando] = useState(false);
  const marco = useRef<HTMLIFrameElement>(null);
  const grab = useRef<{ rec: MediaRecorder; trozos: Blob[]; pista: MediaStream } | null>(null);

  useEffect(() => {
    fetch(url("video/guiones.json")).then((r) => r.json()).then((g: Guiones) => { setGuiones(g); setNegocio(Object.keys(g)[0] ?? ""); }).catch(() => setMsg("No se pudo leer el guion de los videos"));
    api<Estado>("/central/portal/videos/estado").then(setEstado).catch((e) => setMsg(e.message));
  }, []);

  const enviarAlMarco = (m: unknown) => marco.current?.contentWindow?.postMessage(m, location.origin);
  useEffect(() => {
    const f = (ev: MessageEvent) => {
      if (ev.origin !== location.origin) return;
      if (ev.data?.tipo === "listo") setListo(true);
      if (ev.data?.tipo === "fin") terminarGrabacion();
    };
    addEventListener("message", f); return () => removeEventListener("message", f);
  });
  useEffect(() => { if (listo && guiones) enviarAlMarco({ tipo: "guion", guiones, negocio }); }, [listo, guiones, negocio]);
  useEffect(() => { if (listo) enviarAlMarco({ tipo: "voces", urls: audios }); }, [listo, audios]);

  const g = guiones?.[negocio];
  const cambiarTexto = (i: number, texto: string) => setGuiones((x) => x && ({ ...x, [negocio]: { ...x[negocio]!, escenas: x[negocio]!.escenas.map((e, k) => (k === i ? { ...e, voz: texto } : e)) } }));

  async function generar(n: number) {
    const e = g?.escenas[n - 1]; if (!e?.voz?.trim()) return;
    const r = await api<{ audio: string }>("/central/portal/videos/voz", { cuerpo: { texto: e.voz, ...(vozId.trim() ? { vozId: vozId.trim() } : {}) } });
    const u = URL.createObjectURL(aBlob(r.audio));
    setAudios((a) => { if (a[n]) URL.revokeObjectURL(a[n]!); return { ...a, [n]: u }; });
  }
  async function generarUna(n: number) {
    setMsg(""); setOk(""); setOcupada(n);
    try { await generar(n); setOk(`Voz de la escena ${n} lista`); } catch (e) { setMsg((e as Error).message); } finally { setOcupada(0); }
  }
  async function generarTodas() {
    if (!g) return; setMsg(""); setOk(""); setOcupada(-1);
    try { for (let i = 1; i <= g.escenas.length; i++) await generar(i); setOk("Voces listas. Pulse «Reproducir con voz IA»."); } catch (e) { setMsg((e as Error).message); } finally { setOcupada(0); }
  }
  // Si cambia el texto de una escena, su voz ya no corresponde: se quita para no grabar una voz que dice otra cosa
  const textoCambiado = (i: number, t: string) => { cambiarTexto(i, t); setAudios((a) => { const { [i + 1]: viejo, ...resto } = a; if (viejo) URL.revokeObjectURL(viejo); return resto; }); };

  const reproducir = () => { setMsg(""); enviarAlMarco({ tipo: "guion", guiones, negocio }); enviarAlMarco({ tipo: "reproducir" }); };
  const detener = () => enviarAlMarco({ tipo: "detener" });

  async function grabar() {
    setMsg(""); setOk("");
    if (!navigator.mediaDevices?.getDisplayMedia) { setMsg("Este navegador no puede grabar la pestaña. Use Chrome o Edge en una computadora; en el celular, reproduzca y use la grabación de pantalla del teléfono."); return; }
    try {
      const pista = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: "browser" }, audio: true, preferCurrentTab: true, selfBrowserSurface: "include" } as DisplayMediaStreamOptions);
      if (!pista.getAudioTracks().length) setMsg("No se grabará el sonido: al elegir la pestaña marque «Compartir audio de la pestaña».");
      const tipo = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t));
      const rec = new MediaRecorder(pista, tipo ? { mimeType: tipo, videoBitsPerSecond: 6_000_000 } : undefined);
      const trozos: Blob[] = []; rec.ondataavailable = (e) => e.data.size && trozos.push(e.data);
      grab.current = { rec, trozos, pista }; rec.start(1000); setGrabando(true);
      await new Promise((r) => setTimeout(r, 600));
      enviarAlMarco({ tipo: "guion", guiones, negocio }); enviarAlMarco({ tipo: "reproducir" });
    } catch (e) { setGrabando(false); setMsg((e as Error).name === "NotAllowedError" ? "Grabación cancelada" : (e as Error).message); }
  }
  function terminarGrabacion() {
    const g2 = grab.current; if (!g2) return; grab.current = null;
    setTimeout(() => {
      g2.rec.onstop = () => {
        g2.pista.getTracks().forEach((t) => t.stop());
        const blob = new Blob(g2.trozos, { type: "video/webm" });
        const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `video-${negocio.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.webm`; a.click();
        setGrabando(false); setOk("Video descargado (.webm). Se abre en el navegador, WhatsApp y la mayoría de editores.");
      };
      g2.rec.stop();
    }, 1200);
  }

  const hayVoces = Object.keys(audios).length;
  return (
    <div>
      <Encabezado titulo="Videos promocionales" descripcion="Voz con IA para los videos de FactPOS. Escriba o ajuste el texto de cada escena, genere las voces y reproduzca o grabe el video." />
      <Aviso texto={msg} />
      <Aviso texto={ok} tipo="ok" />
      {estado && !estado.configurado && <Aviso tipo="info" texto="Falta conectar ElevenLabs: en las variables del servidor del portal (Vercel) agregue ELEVENLABS_API_KEY y ELEVENLABS_VOZ_ID, y vuelva a desplegar. Mientras tanto el video usa la voz del navegador." />}
      <div className="tarjeta" style={{ display: "grid", gap: 12, gridTemplateColumns: "minmax(0,1fr) minmax(0,360px)", alignItems: "start" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            <select value={negocio} onChange={(e) => setNegocio(e.target.value)}>{Object.keys(guiones ?? {}).map((n) => <option key={n}>{n}</option>)}</select>
            <input placeholder={estado?.vozPorDefecto ? "Voz (por defecto la del servidor)" : "ID de la voz de ElevenLabs"} value={vozId} onChange={(e) => setVozId(e.target.value)} style={{ minWidth: 220 }} />
            <button className="boton primario" disabled={!estado?.configurado || !!ocupada} onClick={generarTodas}>{ocupada === -1 ? "Generando…" : "Generar todas las voces"}</button>
          </div>
          {g?.escenas.map((e, i) => (
            <div key={i} style={{ borderTop: "1px solid var(--borde, #e5e7eb)", padding: "8px 0" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <b>Escena {i + 1}</b>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {audios[i + 1] && <><audio controls src={audios[i + 1]} style={{ height: 30, maxWidth: 190 }} /><a className="boton" href={audios[i + 1]} download={`${String(i + 1).padStart(2, "0")}.mp3`}>mp3</a></>}
                  <button className="boton" disabled={!estado?.configurado || !!ocupada || !e.voz?.trim()} onClick={() => generarUna(i + 1)}>{ocupada === i + 1 ? "…" : audios[i + 1] ? "Rehacer" : "Generar voz"}</button>
                </span>
              </div>
              <textarea rows={2} value={e.voz ?? ""} onChange={(ev) => textoCambiado(i, ev.target.value)} style={{ width: "100%", marginTop: 6 }} />
            </div>
          ))}
        </div>
        <div style={{ position: "sticky", top: 8 }}>
          <div style={grabando ? { position: "fixed", inset: 0, zIndex: 9999, background: "#000" } : { aspectRatio: "9 / 16", width: "100%", maxWidth: 360, margin: "0 auto", border: "1px solid var(--borde, #e5e7eb)", borderRadius: 12, overflow: "hidden" }}>
            <iframe ref={marco} src={url("video/index.html?incrustado")} title="Video" style={{ width: "100%", height: "100%", border: 0, background: "#0e1b26" }} allow="autoplay" />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "center", marginTop: 10 }}>
            <button className="boton primario" disabled={!listo || grabando} onClick={reproducir}>{hayVoces ? "▶ Reproducir con voz IA" : "▶ Reproducir"}</button>
            <button className="boton" disabled={!listo || grabando} onClick={detener}>■ Detener</button>
            <button className="boton" disabled={!listo || grabando} onClick={grabar}>● Grabar y descargar</button>
          </div>
          <p className="suave" style={{ fontSize: 12, marginTop: 8 }}>«Grabar» (Chrome o Edge en computadora): elija esta pestaña y marque «Compartir audio de la pestaña». En el celular: reproduzca y use la grabación de pantalla del teléfono.</p>
        </div>
      </div>
    </div>
  );
}
