import { useState } from "react";
import { api, rd } from "../api";
import { Aviso, Encabezado, useDatos } from "../ui";

/**
 * Incidentes: servidores de sucursal sin comunicación, cajas que vendieron sin
 * servidor, servidores que estuvieron apagados. Soporte los revisa y anota qué pasó.
 */
const TIPO: Record<string, string> = {
  SUCURSAL_SIN_COMUNICACION: "Servidor sin comunicación",
  CAJA_SIN_SERVIDOR: "Caja sin servidor",
  SERVIDOR_APAGADO: "Servidor apagado",
};
const fecha = (v: string) => new Date(v).toLocaleString("es-DO", { dateStyle: "short", timeStyle: "short" });
const duracion = (s: number) => (s < 3600 ? `${Math.max(1, Math.round(s / 60))} min` : `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`);

export function Incidentes() {
  const [abiertos, setAbiertos] = useState(false);
  const { datos, recargar } = useDatos<{ canales: string[]; incidentes: any[] }>(`/central/incidentes${abiertos ? "?abiertos=1" : ""}`);
  const [resolver, setResolver] = useState<string | null>(null);
  const [nota, setNota] = useState("");
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" } | null>(null);

  const probar = async () => {
    try {
      const r = await api("/central/incidentes/prueba", { cuerpo: {} });
      setMsg(r.errores.length ? { t: `Falló: ${r.errores.join("; ")}`, tipo: "error" } : { t: `Aviso de prueba enviado por ${r.canales.join(", ")}`, tipo: "ok" });
    } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
  };
  const guardar = async (id: string) => {
    try { await api(`/central/incidentes/${id}/resolver`, { cuerpo: { nota } }); setResolver(null); setNota(""); recargar(); }
    catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
  };
  const lista = datos?.incidentes ?? [];
  const activos = lista.filter((i) => !i.hasta);

  return (
    <>
      <Encabezado titulo="Incidentes y soporte" descripcion="Cuando un servidor de tienda se cae o una caja trabaja sin servidor, queda aquí y se avisa al servicio técnico.">
        <button className="boton" onClick={probar}>Enviar aviso de prueba</button>
      </Encabezado>
      <div className={"aviso-linea " + (datos?.canales.length ? "info" : "error")}>
        {datos?.canales.length
          ? <>Los avisos a soporte salen por: <b>{datos.canales.join(", ")}</b>.</>
          : <>No hay canal de aviso configurado: los incidentes solo se ven aquí. Configure Telegram, correo o un webhook (README › Avisos al servicio técnico).</>}
      </div>
      {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}
      {activos.length > 0 && (
        <div className="incidentes-activos">
          {activos.map((i) => (
            <div key={i.id} className="incidente-activo" role="alert">
              <b>{i.titulo}</b>
              <span>Desde {fecha(i.desde)} · {duracion(i.segundos)}{i.detalle?.pendientes ? ` · ${i.detalle.pendientes} por subir` : ""}</span>
            </div>
          ))}
        </div>
      )}
      <label className="interruptor" style={{ margin: "12px 0" }}><input type="checkbox" checked={abiertos} onChange={(e) => setAbiertos(e.target.checked)} /><span>Solo los que falta revisar</span></label>
      <div className="lista-incidentes">
        {lista.map((i) => (
          <div key={i.id} className={"panel incidente" + (!i.hasta ? " activo" : i.resueltoEn ? " revisado" : "")}>
            <div className="encabezado-sub">
              <div>
                <span className={"pastilla " + (!i.hasta ? "con_diferencia" : i.resueltoEn ? "recibida" : "en_transito")}>
                  {!i.hasta ? "Pasando ahora" : i.resueltoEn ? "Revisado" : "Por revisar"}
                </span>{" "}
                <b>{i.titulo}</b>
              </div>
              <span className="suave pequeno">{TIPO[i.tipo] ?? i.tipo}</span>
            </div>
            <div className="suave pequeno">
              {fecha(i.desde)}{i.hasta ? ` → ${fecha(i.hasta)}` : ""} · {duracion(i.segundos)}
              {typeof i.detalle?.ventas === "number" && ` · ${i.detalle.ventas} venta(s) sin servidor${i.detalle.monto ? ` por ${rd(i.detalle.monto)}` : ""}`}
              {i.notificadoEn ? " · soporte avisado" : ""}
            </div>
            {i.nota && <p style={{ margin: "8px 0 0" }}>📝 {i.nota} <span className="suave pequeno">— {i.resueltoPor}</span></p>}
            {!i.resueltoEn && (resolver === i.id ? (
              <div className="fila-acciones">
                <input autoFocus style={{ flex: 1 }} placeholder="¿Qué pasó y qué se hizo? (ej. se fue la luz, el UPS no aguantó)" value={nota} onChange={(e) => setNota(e.target.value)} />
                <button className="boton primario" disabled={nota.trim().length < 3} onClick={() => guardar(i.id)}>Guardar</button>
                <button className="boton" onClick={() => setResolver(null)}>Cancelar</button>
              </div>
            ) : <button className="enlace" onClick={() => { setResolver(i.id); setNota(""); }}>Marcar como revisado</button>)}
          </div>
        ))}
        {datos && !lista.length && <p className="suave">Sin incidentes. Todo en orden.</p>}
      </div>
    </>
  );
}
