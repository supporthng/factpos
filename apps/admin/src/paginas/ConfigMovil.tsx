import { useEffect, useState } from "react";
import { api, puede } from "../api";
import { Aviso, Encabezado, useCatalogo, useDatos } from "../ui";

/**
 * Versión celular: activarla o desactivarla, elegir qué secciones se ven desde el celular
 * y qué usuarios pueden entrar. Solo un administrador cambia estas opciones.
 */
interface Config { habilitada: boolean; secciones: string[]; todosUsuarios: boolean; usuarios: string[]; conSucursales: boolean; cambiadaEn: string | null; cambiadaPor: string | null }
export const SECCIONES_ELEGIBLES: { id: string; titulo: string; grupo: string }[] = [
  { id: "resumen", titulo: "Resumen", grupo: "General" },
  { id: "productos", titulo: "Productos", grupo: "Inventario" }, { id: "compras", titulo: "Compras", grupo: "Inventario" },
  { id: "inventario", titulo: "Existencias", grupo: "Inventario" }, { id: "ajustes", titulo: "Ajustes", grupo: "Inventario" },
  { id: "conteos", titulo: "Conteos físicos", grupo: "Inventario" }, { id: "traspasos", titulo: "Traspasos", grupo: "Inventario" }, { id: "kardex", titulo: "Kardex", grupo: "Inventario" },
  { id: "precios", titulo: "Precios", grupo: "Comercial" }, { id: "ofertas", titulo: "Ofertas", grupo: "Comercial" }, { id: "facturas", titulo: "Facturas", grupo: "Comercial" }, { id: "pedidos", titulo: "Pedidos de clientes", grupo: "Comercial" }, { id: "delivery", titulo: "Delivery", grupo: "Comercial" },
  { id: "cxc", titulo: "Cuentas por cobrar", grupo: "Finanzas" }, { id: "caja", titulo: "Retiros y gastos", grupo: "Finanzas" },
  { id: "fiscal", titulo: "Facturación electrónica", grupo: "Fiscal" }, { id: "padron", titulo: "Padrón de RNC (DGII)", grupo: "Fiscal" },
  { id: "reportes", titulo: "Reportes", grupo: "Reportes" },
];

export function ConfigMovil() {
  const { datos, error, recargar } = useDatos<Config>("/central/movil");
  const { usuarios } = useCatalogo();
  const [c, setC] = useState<Config | null>(null);
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const admin = puede("*");
  useEffect(() => { if (datos) setC(datos); }, [datos]);
  if (!c) return <><Encabezado titulo="Configuración móvil" /><Aviso texto={error} /></>;

  const sucio = JSON.stringify([datos?.habilitada, [...(datos?.secciones ?? [])].sort(), datos?.todosUsuarios, [...(datos?.usuarios ?? [])].sort(), datos?.conSucursales])
    !== JSON.stringify([c.habilitada, [...c.secciones].sort(), c.todosUsuarios, [...c.usuarios].sort(), c.conSucursales]);
  const alternar = (lista: string[], id: string) => (lista.includes(id) ? lista.filter((x) => x !== id) : [...lista, id]);
  const grupos = [...new Set(SECCIONES_ELEGIBLES.map((s) => s.grupo))];

  const guardar = async () => {
    if (c.habilitada && c.secciones.length === 0) return setMsg({ t: "Elija al menos una sección para el celular.", tipo: "error" });
    if (c.habilitada && !c.todosUsuarios && c.usuarios.length === 0 && !confirm("No eligió ningún usuario: solo los administradores podrán entrar desde el celular. ¿Guardar así?")) return;
    setGuardando(true); setMsg(null);
    try {
      await api("/central/movil", { metodo: "PUT", cuerpo: { habilitada: c.habilitada, secciones: c.secciones, todosUsuarios: c.todosUsuarios, usuarios: c.usuarios, conSucursales: c.conSucursales } });
      await recargar();
      setMsg({ t: "Configuración móvil guardada. Se aplica la próxima vez que cada persona abra el sistema.", tipo: "ok" });
    } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
    finally { setGuardando(false); }
  };

  return (
    <>
      <Encabezado titulo="Configuración móvil" descripcion="Controle qué se ve y quién entra cuando se usa FactPOS desde el celular (pantalla angosta). Los permisos de cada rol siguen aplicando." />
      <Aviso texto={error} />
      {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}
      {!admin && <Aviso tipo="info" texto="Solo un administrador puede cambiar esta configuración." />}

      <div className="panel">
        <div className="seg-fila" style={{ paddingTop: 0 }}>
          <div>
            <b>Versión celular</b>
            <p className="suave pequeno" style={{ margin: "4px 0 0", maxWidth: "70ch" }}>Activada: en el celular solo se ven las secciones elegidas y solo entran los usuarios autorizados. Desactivada: el sistema se ve completo en cualquier pantalla, sin restricciones.</p>
            {datos?.cambiadaEn && <p className="suave pequeno" style={{ margin: "6px 0 0" }}>Último cambio: {new Date(datos.cambiadaEn).toLocaleString("es-DO")}{datos.cambiadaPor ? ` · ${datos.cambiadaPor}` : ""}</p>}
          </div>
          <label className="interruptor">
            <input type="checkbox" role="switch" checked={c.habilitada} disabled={!admin} onChange={(e) => setC({ ...c, habilitada: e.target.checked })} aria-label="Versión celular" />
            <i /><span>{c.habilitada ? "Activada" : "Desactivada"}</span>
          </label>
        </div>
      </div>

      <fieldset className="panel" disabled={!admin || !c.habilitada} style={{ border: 0, opacity: c.habilitada ? 1 : 0.55 }}>
        <div className="encabezado-sub">
          <h3>Secciones visibles desde el celular</h3>
          <span className="en-linea">
            <button className="enlace" onClick={() => setC({ ...c, secciones: SECCIONES_ELEGIBLES.map((s) => s.id) })}>Todas</button>
            <button className="enlace" onClick={() => setC({ ...c, secciones: [] })}>Ninguna</button>
          </span>
        </div>
        <div className="mov-grupos">
          {grupos.map((g) => (
            <div key={g}>
              <h4 className="suave" style={{ margin: "0 0 6px" }}>{g}</h4>
              {SECCIONES_ELEGIBLES.filter((s) => s.grupo === g).map((s) => (
                <label key={s.id} className="pr-check"><input type="checkbox" checked={c.secciones.includes(s.id)} onChange={() => setC({ ...c, secciones: alternar(c.secciones, s.id) })} /><span>{s.titulo}</span></label>
              ))}
            </div>
          ))}
        </div>
        <p className="suave pequeno" style={{ marginBottom: 0 }}>La configuración del sistema (usuarios, licencia, seguridad…) nunca se muestra en el celular.</p>
      </fieldset>

      <fieldset className="panel" disabled={!admin || !c.habilitada} style={{ border: 0, opacity: c.habilitada ? 1 : 0.55 }}>
        <h3 style={{ marginTop: 0 }}>Usuarios con acceso desde el celular</h3>
        <label className="pr-check"><input type="radio" name="mov-usr" checked={c.todosUsuarios} onChange={() => setC({ ...c, todosUsuarios: true })} /><span>Todos los usuarios</span></label>
        <label className="pr-check"><input type="radio" name="mov-usr" checked={!c.todosUsuarios} onChange={() => setC({ ...c, todosUsuarios: false })} /><span>Solo los usuarios que elija</span></label>
        {!c.todosUsuarios && (
          <div className="mov-usuarios">
            {usuarios.map((u) => (
              <label key={u.id} className="pr-check"><input type="checkbox" checked={c.usuarios.includes(u.id)} onChange={() => setC({ ...c, usuarios: alternar(c.usuarios, u.id) })} /><span>{u.nombre}</span></label>
            ))}
            {usuarios.length === 0 && <p className="suave">No hay usuarios.</p>}
          </div>
        )}
        <label className="pr-check" style={{ marginTop: 10 }}><input type="checkbox" checked={c.conSucursales} onChange={(e) => setC({ ...c, conSucursales: e.target.checked })} /><span><b>Usuarios con sucursales asignadas</b> <span className="suave">· entran y administran solo las sucursales que tienen asignadas</span></span></label>
        <p className="suave pequeno" style={{ marginBottom: 0 }}>Los administradores siempre pueden entrar. Quien no tenga acceso verá un aviso en lugar del sistema cuando lo abra desde el celular.</p>
      </fieldset>

      <div className="acciones-modal" style={{ justifyContent: "flex-start" }}>
        <button className="boton primario" disabled={!admin || !sucio || guardando} onClick={guardar}>{guardando ? "Guardando…" : "Guardar cambios"}</button>
        {sucio && <button className="boton fantasma" onClick={() => datos && setC(datos)}>Descartar</button>}
      </div>
    </>
  );
}
