import { useState } from "react";
import { api } from "../api";
import { Aviso, Encabezado, Tabla, useDatos } from "../ui";

/** Equipos (apps FactPOS Admin o navegadores) que piden entrar por internet: el administrador los autoriza o los niega. */
interface Dispositivo {
  id: string; nombre: string; plataforma: string; estado: "PENDIENTE" | "AUTORIZADO" | "DENEGADO" | "REVOCADO";
  ip: string | null; solicitadoEn: string; resueltoEn: string | null; ultimoUso: string | null; resueltoPor: string | null;
}
const fecha = (v: string | null) => (v ? new Date(v).toLocaleString("es-DO", { dateStyle: "short", timeStyle: "short" }) : "—");
const ETIQUETA: Record<Dispositivo["estado"], string> = { PENDIENTE: "Pendiente", AUTORIZADO: "Autorizado", DENEGADO: "Denegado", REVOCADO: "Revocado" };

export function DispositivosRemotos() {
  const { datos, error, recargar } = useDatos<Dispositivo[]>("/central/dispositivos");
  const seg = useDatos<{ funciones: { clave: string; habilitada: boolean }[] }>("/central/seguridad");
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" } | null>(null);
  const exigido = !!seg.datos?.funciones.find((f) => f.clave === "exigir_dispositivo")?.habilitada;

  const resolver = async (d: Dispositivo, estado: "AUTORIZADO" | "DENEGADO" | "REVOCADO") => {
    setMsg(null);
    try { await api(`/central/dispositivos/${d.id}`, { metodo: "PUT", cuerpo: { estado } }); await recargar(); }
    catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
  };
  const quitar = async (d: Dispositivo) => {
    if (!confirm(`¿Quitar «${d.nombre}» de la lista? Si vuelve a pedir acceso, tendrá que autorizarse otra vez.`)) return;
    try { await api(`/central/dispositivos/${d.id}`, { metodo: "DELETE" }); await recargar(); }
    catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
  };
  const cambiarExigido = async (habilitada: boolean) => {
    if (habilitada && !confirm("Con esto activado, desde internet solo entran los equipos autorizados aquí (incluido este navegador si está en internet). Autoriza primero los equipos que ya usas. En la red local no se pide. ¿Activar?")) return;
    try { await api("/central/seguridad/exigir_dispositivo", { metodo: "PUT", cuerpo: { habilitada } }); await seg.recargar(); }
    catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
  };
  const pendientes = (datos ?? []).filter((d) => d.estado === "PENDIENTE").length;

  return (
    <>
      <Encabezado titulo="Dispositivos remotos" descripcion="Los celulares y computadoras que entran a su administración desde internet: usted decide cuáles." />
      <Aviso texto={error || seg.error} />
      {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}
      <div className="panel">
        <label className="check" style={{ fontSize: 16 }}>
          <input type="checkbox" disabled={!seg.datos} checked={exigido} onChange={(e) => cambiarExigido(e.target.checked)} />
          {" "}Exigir dispositivo autorizado para entrar desde internet
        </label>
        <p className="suave pequeno" style={{ marginBottom: 0 }}>
          Activado: quien abra la app FactPOS Admin (o el navegador) fuera de la red local verá «Solicitando acceso» y no podrá ni escribir su clave hasta que usted lo autorice aquí.
          Instale la app, ábrala una vez para que pida acceso, y autorícela en esta lista. Desactivado: basta el usuario y la clave.
        </p>
      </div>
      {pendientes > 0 && <Aviso tipo="info" texto={`Hay ${pendientes} solicitud${pendientes === 1 ? "" : "es"} esperando su respuesta.`} />}
      <div className="panel">
        <Tabla
          filas={datos ?? []} clave={(d) => d.id} tarjetas vacio="Ningún dispositivo ha pedido acceso todavía."
          columnas={[
            { titulo: "Dispositivo", valor: (d) => <><b>{d.nombre}</b><div className="suave pequeno">{d.plataforma}</div></> },
            { titulo: "Estado", valor: (d) => <b className={d.estado === "AUTORIZADO" ? "texto-ok" : undefined}>{ETIQUETA[d.estado]}</b> },
            { titulo: "Pidió acceso", valor: (d) => <>{fecha(d.solicitadoEn)}<div className="suave pequeno">{d.ip ?? ""}</div></> },
            { titulo: "Último uso", valor: (d) => fecha(d.ultimoUso), ocultoMovil: true },
            { titulo: "Resuelto por", valor: (d) => d.resueltoPor ?? "—", ocultoMovil: true },
            { titulo: "", valor: (d) => (
              <span className="en-linea">
                {d.estado !== "AUTORIZADO" && <button className="boton primario" onClick={() => resolver(d, "AUTORIZADO")}>Autorizar</button>}
                {d.estado === "PENDIENTE" && <button className="boton" onClick={() => resolver(d, "DENEGADO")}>Negar</button>}
                {d.estado === "AUTORIZADO" && <button className="boton" onClick={() => resolver(d, "REVOCADO")}>Revocar</button>}
                {d.estado !== "PENDIENTE" && <button className="boton" onClick={() => quitar(d)}>Quitar</button>}
              </span>
            ) },
          ]}
        />
      </div>
    </>
  );
}
