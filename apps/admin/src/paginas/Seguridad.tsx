import { useState } from "react";
import { api, puede } from "../api";
import { Aviso, Encabezado } from "../ui";
import { type FuncionSeguridad } from "../seguridad";
import { useDatos, SelectorSucursal, useCatalogo } from "../ui";

/**
 * Seguridad: funciones sensibles que se pueden habilitar o deshabilitar.
 * Solo un administrador cambia los interruptores; el servidor comprueba cada una al ejecutarla.
 */
/** Se administran en «Acceso remoto», junto a los equipos y los enlaces. */
const FUNCIONES_ACCESO_REMOTO = ["acceso_web", "exigir_dispositivo"];
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
      <p className="suave pequeno">El acceso desde internet (acceso web y dispositivos autorizados) se maneja en <b>Configuración › Acceso remoto</b>.</p>
      <div className="panel">
        {(datos?.funciones ?? []).filter((f) => !FUNCIONES_ACCESO_REMOTO.includes(f.clave)).map((f) => (
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
  const [alcance, setAlcance] = useState<"EXISTENCIAS" | "HISTORIAL" | "PRODUCTOS" | "CATALOGO">("EXISTENCIAS");
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  if (!admin || !habilitada) return null;
  const OPC = {
    EXISTENCIAS: { t: "Solo dejar existencias en cero", f: "BORRAR INVENTARIO", d: "Genera ajustes de salida en el kardex; productos e historial se conservan." },
    HISTORIAL: { t: "Existencias en cero + borrar historial de movimientos (kardex)", f: "BORRAR HISTORIAL", d: "Borra el kardex de la sucursal. Productos y ventas quedan." },
    PRODUCTOS: { t: "Además borrar los productos sin ventas ni compras", f: "BORRAR PRODUCTOS", d: "Lo anterior y elimina los productos sin movimientos de venta/compra; los que sí los tienen se dan de baja (inactivos)." },
    CATALOGO: { t: "Empezar de cero el catálogo completo", f: "BORRAR CATALOGO", d: "Lo anterior y además categorías. Facturas emitidas, e-CF y secuencias NCF nunca se borran." },
  } as const;
  const borrar = async () => {
    const s = sucursales.find((x) => x.id === sucursalId)?.nombre ?? "la sucursal";
    if (!confirm(`${OPC[alcance].t}\n\nSucursal: ${s}\n${OPC[alcance].d}\n\nEsto NO se puede deshacer. ¿Continuar?`)) return;
    setOcupado(true); setMsg(null);
    try {
      const r = await api<Record<string, number | string>>("/central/seguridad/borrar-inventario", { metodo: "POST", cuerpo: { sucursalId, motivo, clave, frase, alcance } });
      setMsg({ t: alcance === "EXISTENCIAS" ? `Inventario borrado: ${r.productos} producto(s) quedaron en cero (ajuste Nº ${r.numero}).`
        : `Listo: ${r.movimientos ?? 0} movimiento(s) borrados` + (r.productosBorrados !== undefined ? `, ${r.productosBorrados} producto(s) eliminados, ${r.productosDadosDeBaja} dados de baja` : "") + (r.categorias !== undefined ? `, ${r.categorias} categoría(s)` : "") + ".", tipo: "ok" });
      setClave(""); setFrase(""); setMotivo("");
    } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
    setOcupado(false);
  };
  return (
    <div className="panel" style={{ borderColor: "var(--peligro, #c0392b)" }}>
      <h3 style={{ marginTop: 0 }}>Borrar inventario</h3>
      <p className="suave pequeno">Elija qué borrar. {OPC[alcance].d} Cuando termine, desactive la función arriba.</p>
      <select value={alcance} onChange={(e) => { setAlcance(e.target.value as typeof alcance); setFrase(""); }} style={{ marginBottom: 8, maxWidth: "100%" }}>
        {(Object.keys(OPC) as (keyof typeof OPC)[]).map((k) => <option key={k} value={k}>{OPC[k].t}</option>)}
      </select>
      {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}
      <div className="fila-acciones" style={{ flexWrap: "wrap" }}>
        <SelectorSucursal todas={false} valor={sucursalId} onCambio={setSucursalId} />
        <input style={{ minWidth: 260 }} placeholder="Motivo (mínimo 10 caracteres)" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        <input type="password" autoComplete="current-password" placeholder="Su contraseña" value={clave} onChange={(e) => setClave(e.target.value)} />
        <input placeholder={`Escriba ${OPC[alcance].f}`} value={frase} onChange={(e) => setFrase(e.target.value)} />
        <button className="boton peligro" disabled={ocupado || !sucursalId || motivo.trim().length < 10 || !clave || frase !== OPC[alcance].f} onClick={borrar}>Borrar</button>
      </div>
    </div>
  );
}
