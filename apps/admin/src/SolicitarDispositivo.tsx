import { useEffect, useState } from "react";
import { CONFIG, fijarDispositivo, leerDispositivo } from "./api";

/**
 * Pantalla que sale cuando el servidor exige un dispositivo autorizado (acceso desde internet).
 * El equipo pide acceso una vez y espera a que un administrador lo autorice en Sistema › Acceso remoto.
 */
const plataforma = () => /Android/i.test(navigator.userAgent) ? "Android" : /iPhone|iPad/i.test(navigator.userAgent) ? "iPhone/iPad" : /Windows/i.test(navigator.userAgent) ? "Windows" : /Mac/i.test(navigator.userAgent) ? "Mac" : "Otro";
const GUARDADO = "factpos.dispositivo.nombre";

export function SolicitarDispositivo({ servidor, estado }: { servidor: string; estado: string }) {
  const base = servidor.replace(/\/$/, "");
  const [nombre, setNombre] = useState(() => { try { return localStorage.getItem(GUARDADO) || ""; } catch { return ""; } });
  const [espera, setEspera] = useState<string>(estado === "PENDIENTE" ? "PENDIENTE" : estado === "DENEGADO" || estado === "REVOCADO" ? estado : "");
  const [error, setError] = useState("");

  const consultar = async () => {
    try {
      const r = await fetch(base + "/central/dispositivo/estado", { headers: { "x-dispositivo": leerDispositivo() ?? "" } });
      const d = await r.json();
      if (d.estado === "AUTORIZADO" || d.exigido === false) { location.reload(); return; }
      setEspera(d.estado === "DESCONOCIDO" ? "" : d.estado);
    } catch { /* sin conexión: reintenta */ }
  };
  useEffect(() => {
    if (espera !== "PENDIENTE") return;
    const t = setInterval(consultar, 4000);
    return () => clearInterval(t);
  }, [espera]); // eslint-disable-line react-hooks/exhaustive-deps

  const solicitar = async () => {
    setError("");
    if (!nombre.trim()) { setError("Escribe un nombre para reconocer este equipo (por ejemplo: Celular de Juan)."); return; }
    try {
      try { localStorage.setItem(GUARDADO, nombre.trim()); } catch { /* sin almacenamiento */ }
      const r = await fetch(base + "/central/dispositivo/solicitar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nombre: nombre.trim(), plataforma: plataforma() }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "No se pudo pedir el acceso");
      fijarDispositivo(d.dispositivo);
      setEspera("PENDIENTE");
    } catch (e) {
      const t = (e as Error).message;
      setError(/load failed|failed to fetch|networkerror/i.test(t) ? `No se pudo conectar con el servidor (${base.replace(/^https?:\/\//, "")}). Revisa tu internet y vuelve a intentar.` : t);
    }
  };

  const tarjeta: React.CSSProperties = { maxWidth: 460, margin: "12vh auto", padding: 28, background: "#fff", borderRadius: 16, boxShadow: "0 10px 40px rgba(0,0,0,.15)", color: "#10202e", fontFamily: "system-ui, sans-serif" };
  return (
    <div style={{ minHeight: "100vh", background: "#0E1B26", padding: 16 }}>
      <div style={tarjeta}>
        <h2 style={{ marginTop: 0 }}>{CONFIG.cliente ?? "FactPOS"}</h2>
        {espera === "PENDIENTE" ? (<>
          <p><b>Solicitando acceso…</b></p>
          <p>Un administrador debe autorizar este equipo en <i>Sistema › Acceso remoto</i>. Esta pantalla se abre sola cuando lo haga.</p>
        </>) : espera === "DENEGADO" || espera === "REVOCADO" ? (<>
          <p><b>Este equipo no tiene acceso.</b></p>
          <p>Un administrador {espera === "DENEGADO" ? "negó" : "quitó"} el permiso. Si es un error, pídele que lo autorice.</p>
          <button className="boton" onClick={() => { fijarDispositivo(null); setEspera(""); }}>Pedir acceso de nuevo</button>
        </>) : (<>
          <p><b>Este equipo necesita autorización.</b></p>
          <p>Ponle un nombre y pide acceso. Un administrador lo autoriza una sola vez.</p>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Celular de Juan" maxLength={60}
            style={{ width: "100%", fontSize: 18, padding: 12, border: "2px solid #cfd8e0", borderRadius: 10, boxSizing: "border-box" }} />
          {error && <p style={{ color: "#c0362c", fontWeight: 700 }}>{error}</p>}
          <button className="boton primario" style={{ marginTop: 14, width: "100%" }} onClick={solicitar}>Pedir acceso</button>
        </>)}
      </div>
    </div>
  );
}
