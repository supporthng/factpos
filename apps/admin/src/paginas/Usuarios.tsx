import { useState } from "react";
import { api, sesionActual } from "../api";
import { Aviso, Encabezado, Tabla, useCatalogo, useDatos } from "../ui";

interface Usuario { id: string; nombre: string; usuario: string; activo: boolean; rolId: string; rol: string; tienePin: boolean; tieneClave: boolean; sucursales: string[] | null }
interface Rol { id: string; nombre: string; permisos: string[]; usuarios: number }
interface Permiso { id: string; grupo: "Caja" | "Administración"; nombre: string }

/**
 * Quién entra y qué puede hacer.
 *  - Contraseña: para la Administración.
 *  - PIN (4 a 6 números): para entrar a la caja y para aprobar como supervisor.
 */
export function Usuarios() {
  const [pestana, setPestana] = useState<"usuarios" | "roles">("usuarios");
  return (
    <>
      <Encabezado titulo="Usuarios y permisos" descripcion="La contraseña sirve para la Administración; el PIN, para entrar a la caja y aprobar como supervisor." />
      <div className="pestanas">
        <button className={pestana === "usuarios" ? "activa" : ""} onClick={() => setPestana("usuarios")}>Usuarios</button>
        <button className={pestana === "roles" ? "activa" : ""} onClick={() => setPestana("roles")}>Roles</button>
      </div>
      {pestana === "usuarios" ? <ListaUsuarios /> : <Roles />}
    </>
  );
}

function ListaUsuarios() {
  const usuarios = useDatos<Usuario[]>("/central/usuarios");
  const roles = useDatos<Rol[]>("/central/roles");
  const [editar, setEditar] = useState<Usuario | "nuevo" | null>(null);
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" } | null>(null);
  const { sucursales } = useCatalogo();
  const nombresSucursales = (ids: string[] | null) =>
    !ids ? <span className="suave">Todas</span> : ids.map((id) => sucursales.find((s) => s.id === id)?.nombre ?? "otra").join(", ");
  return (
    <>
      <div className="fila-acciones" style={{ marginTop: 0, marginBottom: 12 }}>
        <span className="flex" />
        <button className="boton primario" onClick={() => setEditar("nuevo")}>Nuevo usuario</button>
      </div>
      {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}
      <Tabla
        filas={usuarios.datos ?? []}
        clave={(u) => u.id}
        columnas={[
          { titulo: "Nombre", valor: (u) => <span className={u.activo ? "" : "suave"}><b>{u.nombre}</b>{!u.activo && " (inactivo)"}</span> },
          { titulo: "Usuario", valor: (u) => <span className="mono">{u.usuario}</span> },
          { titulo: "Rol", valor: (u) => u.rol },
          { titulo: "Sucursales", valor: (u) => nombresSucursales(u.sucursales) },
          { titulo: "Administración", valor: (u) => (u.tieneClave ? "Con contraseña" : <span className="suave">Sin contraseña</span>) },
          { titulo: "Caja", valor: (u) => (u.tienePin ? "Con PIN" : <span className="suave">Sin PIN</span>) },
          { titulo: "", valor: (u) => <button className="enlace" onClick={() => setEditar(u)}>Editar</button> },
        ]}
      />
      {editar && roles.datos && (
        <EditarUsuario
          usuario={editar === "nuevo" ? null : editar}
          roles={roles.datos}
          onCerrar={() => setEditar(null)}
          onListo={(t) => { setEditar(null); setMsg({ t, tipo: "ok" }); usuarios.recargar(); }}
        />
      )}
    </>
  );
}

function EditarUsuario({ usuario, roles, onCerrar, onListo }: { usuario: Usuario | null; roles: Rol[]; onCerrar: () => void; onListo: (t: string) => void }) {
  const [nombre, setNombre] = useState(usuario?.nombre ?? "");
  const [nick, setNick] = useState(usuario?.usuario ?? "");
  const [rolId, setRolId] = useState(usuario?.rolId ?? roles.find((r) => !r.permisos.includes("*"))?.id ?? roles[0]?.id ?? "");
  const [clave, setClave] = useState("");
  const [pin, setPin] = useState("");
  const [quitarPin, setQuitarPin] = useState(false);
  const [activo, setActivo] = useState(usuario?.activo ?? true);
  const { sucursales: todas } = useCatalogo();
  const [soloAlgunas, setSoloAlgunas] = useState(!!usuario?.sucursales);
  const [elegidas, setElegidas] = useState<Set<string>>(new Set(usuario?.sucursales ?? []));
  const alternarSucursal = (id: string) => { const n = new Set(elegidas); if (n.has(id)) n.delete(id); else n.add(id); setElegidas(n); };
  const sucursalesElegidas = soloAlgunas ? [...elegidas] : null;
  const [error, setError] = useState("");
  const yo = usuario?.id === sesionActual().usuarioId;
  const rol = roles.find((r) => r.id === rolId);
  const usaCaja = rol?.permisos.some((p) => p === "*" || !p.startsWith("admin."));
  const usaAdmin = rol?.permisos.some((p) => p === "*" || p.startsWith("admin."));

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      if (!usuario) {
        await api("/central/usuarios", { cuerpo: { nombre, usuario: nick, rolId, clave: clave || undefined, pin: pin || undefined, sucursales: sucursalesElegidas } });
        onListo(`${nombre} creado.${pin ? " Ya puede entrar a la caja con su PIN." : ""}`);
      } else {
        await api(`/central/usuarios/${usuario.id}`, {
          metodo: "PATCH",
          cuerpo: {
            nombre, ...(yo ? {} : { rolId, activo, sucursales: sucursalesElegidas }),
            ...(clave ? { clave } : {}),
            ...(quitarPin ? { pin: null } : pin ? { pin } : {}),
          },
        });
        onListo(`Cambios de ${nombre} guardados.`);
      }
    } catch (e) { setError((e as Error).message); }
  };

  return (
    <div className="fondo-modal" onMouseDown={onCerrar}>
      <form className="modal" onMouseDown={(e) => e.stopPropagation()} onSubmit={guardar}>
        <h2 style={{ marginTop: 0 }}>{usuario ? `Editar ${usuario.nombre}` : "Nuevo usuario"}</h2>
        <div className="dos-col">
          <label className="campo"><span>Nombre completo</span><input autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} /></label>
          <label className="campo"><span>Usuario</span><input value={nick} disabled={!!usuario} onChange={(e) => setNick(e.target.value.toLowerCase().replace(/\s/g, ""))} autoCapitalize="none" placeholder="maria.perez" /></label>
        </div>
        <label className="campo"><span>Rol</span>
          <select value={rolId} disabled={yo} onChange={(e) => setRolId(e.target.value)}>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
          </select>
        </label>
        <div className="dos-col">
          <label className="campo">
            <span>{usuario?.tieneClave ? "Nueva contraseña (vacía = no cambia)" : "Contraseña de la Administración"}</span>
            <input type="password" value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="new-password" disabled={!usaAdmin} placeholder={usaAdmin ? "8 o más, con letras y números" : "Su rol no usa la Administración"} />
          </label>
          <label className="campo">
            <span>{usuario?.tienePin ? "Nuevo PIN (vacío = no cambia)" : "PIN de caja"}</span>
            <input inputMode="numeric" value={pin} disabled={quitarPin || !usaCaja} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder={usaCaja ? "4 a 6 números" : "Su rol no usa la caja"} autoComplete="off" />
          </label>
        </div>
        <fieldset className="grupo-permisos acceso-sucursales" disabled={yo}>
          <legend>Sucursales a las que tiene acceso</legend>
          <label className="interruptor"><input type="radio" name="acceso" checked={!soloAlgunas} onChange={() => setSoloAlgunas(false)} /><span>Todas, incluidas las que se creen después</span></label>
          <label className="interruptor"><input type="radio" name="acceso" checked={soloAlgunas} onChange={() => setSoloAlgunas(true)} /><span>Solo estas:</span></label>
          {soloAlgunas && (
            <div className="lista-sucursales">
              {todas.map((s) => (
                <label key={s.id} className="interruptor"><input type="checkbox" checked={elegidas.has(s.id)} onChange={() => alternarSucursal(s.id)} /><span>{s.nombre}{s.tipo === "ALMACEN" ? " (almacén)" : ""}</span></label>
              ))}
            </div>
          )}
          <p className="suave pequeno" style={{ margin: "4px 0 0" }}>
            {yo ? "Su propio acceso lo cambia otro administrador." : "Solo podrá entrar a las cajas de esas sucursales y, en la Administración, solo verá y operará esas sucursales."}
          </p>
        </fieldset>
        {usuario?.tienePin && <label className="interruptor"><input type="checkbox" checked={quitarPin} onChange={(e) => setQuitarPin(e.target.checked)} /><span>Quitarle el PIN (ya no entra a la caja)</span></label>}
        {usuario && !yo && <label className="interruptor"><input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} /><span>{activo ? "Activo" : "Inactivo: no puede entrar"}</span></label>}
        {error && <Aviso texto={error} />}
        <div className="acciones-modal">
          <button type="button" className="boton" onClick={onCerrar}>Cancelar</button>
          <button className="boton primario" disabled={nombre.trim().length < 2 || nick.length < 3 || !rolId || (soloAlgunas && !elegidas.size)}>{usuario ? "Guardar" : "Crear usuario"}</button>
        </div>
      </form>
    </div>
  );
}

function Roles() {
  const roles = useDatos<Rol[]>("/central/roles");
  const permisos = useDatos<Permiso[]>("/central/roles/permisos");
  const [editar, setEditar] = useState<Rol | "nuevo" | null>(null);
  const nombreDe = (id: string) => permisos.datos?.find((p) => p.id === id)?.nombre ?? id;
  return (
    <>
      <div className="fila-acciones" style={{ marginTop: 0, marginBottom: 12 }}>
        <span className="suave">Un rol es un conjunto de permisos. Cada usuario tiene un rol.</span>
        <span className="flex" />
        <button className="boton primario" onClick={() => setEditar("nuevo")}>Nuevo rol</button>
      </div>
      <div className="lista-roles">
        {(roles.datos ?? []).map((r) => (
          <div key={r.id} className="panel">
            <div className="encabezado-sub">
              <h3>{r.nombre} <span className="suave pequeno">· {r.usuarios} usuario(s)</span></h3>
              {!r.permisos.includes("*") && <button className="enlace" onClick={() => setEditar(r)}>Editar</button>}
            </div>
            <p className="suave pequeno">{r.permisos.includes("*") ? "Todos los permisos" : r.permisos.map(nombreDe).join(" · ") || "Sin permisos"}</p>
          </div>
        ))}
      </div>
      {editar && permisos.datos && (
        <EditarRol rol={editar === "nuevo" ? null : editar} permisos={permisos.datos} onCerrar={() => setEditar(null)} onListo={() => { setEditar(null); roles.recargar(); }} />
      )}
    </>
  );
}

function EditarRol({ rol, permisos, onCerrar, onListo }: { rol: Rol | null; permisos: Permiso[]; onCerrar: () => void; onListo: () => void }) {
  const [nombre, setNombre] = useState(rol?.nombre ?? "");
  const [marcados, setMarcados] = useState<Set<string>>(new Set(rol?.permisos ?? ["venta.crear"]));
  const [error, setError] = useState("");
  const alternar = (id: string) => { const n = new Set(marcados); if (n.has(id)) n.delete(id); else n.add(id); setMarcados(n); };
  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (rol) await api(`/central/roles/${rol.id}`, { metodo: "PATCH", cuerpo: { nombre, permisos: [...marcados] } });
      else await api("/central/roles", { cuerpo: { nombre, permisos: [...marcados] } });
      onListo();
    } catch (e) { setError((e as Error).message); }
  };
  return (
    <div className="fondo-modal" onMouseDown={onCerrar}>
      <form className="modal ancho" onMouseDown={(e) => e.stopPropagation()} onSubmit={guardar}>
        <h2 style={{ marginTop: 0 }}>{rol ? `Rol ${rol.nombre}` : "Nuevo rol"}</h2>
        <label className="campo"><span>Nombre del rol</span><input autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Encargado de tienda" /></label>
        <div className="dos-col">
          {(["Caja", "Administración"] as const).map((g) => (
            <fieldset key={g} className="grupo-permisos">
              <legend>{g}</legend>
              {permisos.filter((p) => p.grupo === g).map((p) => (
                <label key={p.id} className="interruptor"><input type="checkbox" checked={marcados.has(p.id)} onChange={() => alternar(p.id)} /><span>{p.nombre}</span></label>
              ))}
            </fieldset>
          ))}
        </div>
        {error && <Aviso texto={error} />}
        <div className="acciones-modal">
          <button type="button" className="boton" onClick={onCerrar}>Cancelar</button>
          <button className="boton primario" disabled={nombre.trim().length < 2}>Guardar rol</button>
        </div>
      </form>
    </div>
  );
}
