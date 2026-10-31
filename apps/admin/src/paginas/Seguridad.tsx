import { useState } from "react";
import { api, puede } from "../api";
import { Aviso, Encabezado } from "../ui";
import { type FuncionSeguridad } from "../seguridad";
import { useDatos } from "../ui";

/**
 * Seguridad: funciones sensibles que se pueden habilitar o deshabilitar.
 * Solo un administrador cambia los interruptores; el servidor comprueba cada una al ejecutarla.
 */
export function Seguridad() {
  const { datos, error, recargar } = useDatos<{ funciones: FuncionSeguridad[] }>("/central/seguridad");
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" } | null>(null);
  const [trabajando, setTrabajando] = useState<string | null>(null);
  const admin = puede("*");
  const cambiar = async (f: FuncionSeguridad, habilitada: boolean) => {
    setTrabajando(f.clave); setMsg(null);
    try {
      await api(`/central/seguridad/${f.clave}`, { metodo: "PUT", cuerpo: { habilitada } });
      await recargar();
      setMsg({ t: `«${f.titulo}» ${habilitada ? "activada" : "desactivada"}.`, tipo: "ok" });
    } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
    finally { setTrabajando(null); }
  };
  return (
    <>
      <Encabezado titulo="Seguridad" descripcion="Funciones sensibles que usted decide si se pueden usar. Mientras estén desactivadas, el botón no aparece y el servidor las rechaza." />
      <Aviso texto={error} />
      {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}
      {!admin && <Aviso tipo="info" texto="Solo un administrador puede cambiar estas opciones." />}
      <div className="panel">
        {(datos?.funciones ?? []).map((f) => (
          <div key={f.clave} className="seg-fila">
            <div>
              <b>{f.titulo}</b>
              <p className="suave pequeno" style={{ margin: "4px 0 0", maxWidth: "70ch" }}>{f.descripcion}</p>
              {f.cambiadaEn && <p className="suave pequeno" style={{ margin: "6px 0 0" }}>Último cambio: {new Date(f.cambiadaEn).toLocaleString("es-DO")}{f.cambiadaPor ? ` · ${f.cambiadaPor}` : ""}</p>}
            </div>
            <label className="interruptor" title={admin ? "" : "Solo un administrador"}>
              <input type="checkbox" role="switch" checked={f.habilitada} disabled={!admin || trabajando === f.clave} onChange={(e) => cambiar(f, e.target.checked)} aria-label={f.titulo} />
              <i /><span>{f.habilitada ? "Activada" : "Desactivada"}</span>
            </label>
          </div>
        ))}
        {!datos && !error && <p className="suave">Cargando…</p>}
      </div>
      <DosPasosUsuarios admin={admin} />
    </>
  );
}

/** Quién tiene verificación en dos pasos; el administrador la restablece si alguien pierde su teléfono. */
function DosPasosUsuarios({ admin }: { admin: boolean }) {
  const { datos, recargar } = useDatos<{ id: string; nombre: string; usuario: string; activo: boolean }[]>("/central/usuarios-2fa");
  const [msg, setMsg] = useState<string | null>(null);
  if (!admin) return null;
  const restablecer = async (u: { id: string; nombre: string }) => {
    if (!confirm(`¿Quitar la verificación en dos pasos de ${u.nombre}? Podrá entrar solo con su contraseña y volver a activarla.`)) return;
    try { await api(`/central/usuarios-2fa/${u.id}`, { metodo: "DELETE" }); await recargar(); setMsg(`Se restableció la verificación de ${u.nombre}.`); }
    catch (e) { setMsg((e as Error).message); }
  };
  return (
    <div className="panel">
      <h3 style={{ marginTop: 0 }}>Verificación en dos pasos</h3>
      <p className="suave pequeno">Cada persona la activa desde su nombre (arriba a la derecha) › Verificación en dos pasos. Se recomienda para todos los administradores.</p>
      {msg && <Aviso texto={msg} tipo="ok" />}
      <table className="tabla">
        <thead><tr><th>Usuario</th><th>Estado</th><th /></tr></thead>
        <tbody>
          {(datos ?? []).map((u) => (
            <tr key={u.id}>
              <td><b>{u.nombre}</b> <span className="suave">· {u.usuario}</span></td>
              <td><span className={"pastilla " + (u.activo ? "ok" : "")}>{u.activo ? "Activa" : "No activada"}</span></td>
              <td className="der">{u.activo && <button className="enlace" onClick={() => restablecer(u)}>Restablecer</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
