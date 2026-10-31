import { useEffect, useState } from "react";
import { api } from "../api";
import { Aviso } from "../ui";

/**
 * Verificación en dos pasos del usuario actual: además de la contraseña, el sistema pide un código
 * de 6 números de su app (Google Authenticator, Microsoft Authenticator, Authy…).
 */
export function DosPasos({ onCerrar }: { onCerrar: () => void }) {
  const [estado, setEstado] = useState<{ activo: boolean; codigosRestantes: number } | null>(null);
  const [config, setConfig] = useState<{ secreto: string; uri: string } | null>(null);
  const [codigo, setCodigo] = useState("");
  const [clave, setClave] = useState("");
  const [recuperacion, setRecuperacion] = useState<string[] | null>(null);
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" } | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [copiado, setCopiado] = useState(false);

  const cargar = () => api<{ activo: boolean; codigosRestantes: number }>("/central/sesion/2fa").then(setEstado).catch((e) => setMsg({ t: e.message, tipo: "error" }));
  useEffect(() => { cargar(); }, []);

  const correr = async (f: () => Promise<void>) => {
    setTrabajando(true); setMsg(null);
    try { await f(); } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); } finally { setTrabajando(false); }
  };
  const iniciar = () => correr(async () => { setConfig(await api("/central/sesion/2fa/iniciar", { cuerpo: {} })); setCodigo(""); });
  const activar = () => correr(async () => {
    const r = await api<{ recuperacion: string[] }>("/central/sesion/2fa/activar", { cuerpo: { codigo } });
    setRecuperacion(r.recuperacion); setConfig(null); await cargar();
  });
  const desactivar = () => correr(async () => {
    await api("/central/sesion/2fa/desactivar", { cuerpo: { clave } });
    setClave(""); setMsg({ t: "Verificación en dos pasos desactivada.", tipo: "ok" }); await cargar();
  });
  const copiar = async (t: string) => { try { await navigator.clipboard.writeText(t); setCopiado(true); setTimeout(() => setCopiado(false), 2000); } catch { /* sin portapapeles */ } };
  const grupos = (s: string) => s.replace(/(.{4})/g, "$1 ").trim();

  return (
    <div className="fondo-modal" onMouseDown={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) onCerrar(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Verificación en dos pasos" style={{ maxWidth: 460 }}>
        <h2 style={{ marginTop: 0 }}>Verificación en dos pasos</h2>
        {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}
        {!estado && <p className="suave">Cargando…</p>}

        {recuperacion && (
          <>
            <Aviso tipo="ok" texto="Listo: la verificación en dos pasos está activa." />
            <p><b>Guarde estos códigos de recuperación.</b> Cada uno sirve una sola vez si pierde su teléfono. No se vuelven a mostrar.</p>
            <pre className="mono" style={{ background: "var(--suave-fondo, #f1f5f7)", padding: 12, borderRadius: 8, columns: 2 }}>{recuperacion.join("\n")}</pre>
            <div className="acciones-modal">
              <button className="boton" onClick={() => copiar(recuperacion.join("\n"))}>{copiado ? "Copiados" : "Copiar"}</button>
              <button className="boton primario" onClick={onCerrar}>Ya los guardé</button>
            </div>
          </>
        )}

        {estado && !recuperacion && !estado.activo && !config && (
          <>
            <p className="suave">Protege su cuenta aunque alguien conozca su contraseña. Necesita una app de códigos en su teléfono, como Google Authenticator o Microsoft Authenticator.</p>
            <div className="acciones-modal"><button className="boton" onClick={onCerrar}>Cerrar</button><button className="boton primario" disabled={trabajando} onClick={iniciar}>Activar</button></div>
          </>
        )}

        {estado && !recuperacion && !estado.activo && config && (
          <>
            <ol className="suave" style={{ paddingLeft: 18 }}>
              <li>En su app de códigos elija <b>Agregar cuenta › Ingresar una clave de configuración</b>.</li>
              <li>Escriba esta clave (tipo «basada en tiempo»):</li>
            </ol>
            <p className="mono" style={{ fontSize: 17, letterSpacing: 1, wordBreak: "break-all", margin: "6px 0" }}>{grupos(config.secreto)}</p>
            <p className="pequeno"><button className="enlace" onClick={() => copiar(config.secreto)}>{copiado ? "Copiada" : "Copiar clave"}</button> · <a className="enlace" href={config.uri}>Abrir en mi app (teléfono)</a></p>
            <label className="campo"><span>Escriba el código de 6 números que muestra la app</span>
              <input autoFocus className="numero" inputMode="numeric" maxLength={7} value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/[^\d ]/g, ""))} onKeyDown={(e) => e.key === "Enter" && codigo.replace(/\D/g, "").length === 6 && activar()} placeholder="123456" /></label>
            <div className="acciones-modal"><button className="boton" onClick={() => setConfig(null)}>Cancelar</button><button className="boton primario" disabled={trabajando || codigo.replace(/\D/g, "").length !== 6} onClick={activar}>Confirmar</button></div>
          </>
        )}

        {estado && !recuperacion && estado.activo && (
          <>
            <Aviso tipo="ok" texto={`Verificación en dos pasos activa. Códigos de recuperación disponibles: ${estado.codigosRestantes}.`} />
            <label className="campo"><span>Para desactivarla, escriba su contraseña</span><input type="password" value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="current-password" /></label>
            <div className="acciones-modal"><button className="boton" onClick={onCerrar}>Cerrar</button><button className="boton" disabled={trabajando || !clave} onClick={desactivar}>Desactivar</button></div>
          </>
        )}
      </div>
    </div>
  );
}
