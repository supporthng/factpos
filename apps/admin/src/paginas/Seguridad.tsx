import { useState } from "react";
import { api, puede } from "../api";
import { Aviso, Encabezado } from "../ui";
import { type FuncionSeguridad } from "../seguridad";
import { useDatos, SelectorSucursal, useCatalogo } from "../ui";

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
      <BorrarInventario admin={admin} habilitada={!!datos?.funciones.find((f) => f.clave === "borrar_inventario")?.habilitada} />
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

/** Zona de riesgo: dejar en cero el inventario de una sucursal. Solo con la función activada, contraseña y frase. */
function BorrarInventario({ admin, habilitada }: { admin: boolean; habilitada: boolean }) {
  const { sucursales } = useCatalogo();
  const [sucursalId, setSucursalId] = useState(sucursales[0]?.id ?? "");
  const [motivo, setMotivo] = useState("");
  const [clave, setClave] = useState("");
  const [frase, setFrase] = useState("");
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  if (!admin || !habilitada) return null;
  const borrar = async () => {
    const s = sucursales.find((x) => x.id === sucursalId)?.nombre ?? "la sucursal";
    if (!confirm(`Se dejará en CERO toda la existencia de ${s}. Esto no se puede deshacer (solo volviendo a cargar el inventario). ¿Continuar?`)) return;
    setOcupado(true); setMsg(null);
    try {
      const r = await api<{ productos: number; numero: string }>("/central/seguridad/borrar-inventario", { metodo: "POST", cuerpo: { sucursalId, motivo, clave, frase } });
      setMsg({ t: `Inventario borrado: ${r.productos} producto(s) quedaron en cero (ajuste Nº ${r.numero}).`, tipo: "ok" });
      setClave(""); setFrase(""); setMotivo("");
    } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
    setOcupado(false);
  };
  return (
    <div className="panel" style={{ borderColor: "var(--peligro, #c0392b)" }}>
      <h3 style={{ marginTop: 0 }}>Borrar inventario</h3>
      <p className="suave pequeno">Deja en cero la existencia de todos los productos de una sucursal. No borra productos ni historial: genera ajustes de salida en el kardex con su nombre. Cuando termine, desactive la función arriba.</p>
      {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}
      <div className="fila-acciones" style={{ flexWrap: "wrap" }}>
        <SelectorSucursal todas={false} valor={sucursalId} onCambio={setSucursalId} />
        <input style={{ minWidth: 260 }} placeholder="Motivo (mínimo 10 caracteres)" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        <input type="password" autoComplete="current-password" placeholder="Su contraseña" value={clave} onChange={(e) => setClave(e.target.value)} />
        <input placeholder="Escriba BORRAR INVENTARIO" value={frase} onChange={(e) => setFrase(e.target.value)} />
        <button className="boton peligro" disabled={ocupado || !sucursalId || motivo.trim().length < 10 || !clave || frase !== "BORRAR INVENTARIO"} onClick={borrar}>Borrar inventario</button>
      </div>
    </div>
  );
}
