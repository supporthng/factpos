import { useState } from "react";
import { api, fijarSesion, sesionActual } from "../api";
import { Aviso, useDatos } from "../ui";

interface EmpresaGrupo { id: string; rnc: string; razonSocial: string; nombre: string; actual: boolean }

async function pasarA(id: string) {
  const r = await api<{ token: string; usuario: { id: string; nombre: string; permisos: string[] }; empresa: { id: string; nombre: string } }>("/central/empresas/cambiar", { cuerpo: { empresaId: id } });
  fijarSesion({ ...sesionActual(), token: r.token, empresaId: r.empresa.id, empresa: r.empresa.nombre, usuarioId: r.usuario.id, nombre: r.usuario.nombre, permisos: r.usuario.permisos, sucursales: null });
  location.reload();
}

/** Selector de empresa en la barra superior (solo si hay más de una enlazada). */
export function SelectorEmpresa() {
  const { datos } = useDatos<EmpresaGrupo[]>("/central/empresas");
  if (!datos || datos.length < 2) return null;
  return (
    <select aria-label="Empresa" title="Cambiar de empresa" value={datos.find((e) => e.actual)?.id} style={{ maxWidth: 190 }}
      onChange={(e) => pasarA(e.target.value).catch((x) => alert((x as Error).message))}>
      {datos.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
    </select>
  );
}

/** Empresas enlazadas (cada RNC es una compañía aparte, con su catálogo, usuarios y NCF). */
export function EmpresasEnlazadas() {
  const { datos, recargar } = useDatos<EmpresaGrupo[]>("/central/empresas");
  const [abrir, setAbrir] = useState(false);
  const [f, setF] = useState({ rnc: "", razonSocial: "", nombreComercial: "", sucursal: "Principal", clave: "" });
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const crear = async () => {
    setOcupado(true); setMsg(null);
    try {
      const r = await api<{ id: string; nombre: string }>("/central/empresas", { cuerpo: { ...f, rnc: f.rnc.replace(/\D/g, "") } });
      setMsg({ t: `Empresa «${r.nombre}» creada. Cámbiese a ella para cargar su certificado, rangos NCF y catálogo.`, tipo: "ok" });
      setAbrir(false); setF({ rnc: "", razonSocial: "", nombreComercial: "", sucursal: "Principal", clave: "" }); recargar();
    } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
    setOcupado(false);
  };
  return (
    <div className="panel">
      <h3 style={{ marginTop: 0 }}>Empresas enlazadas</h3>
      <p className="suave pequeno">Cada RNC es una compañía aparte (catálogo, usuarios, NCF y reportes propios) que usted maneja con el mismo usuario. Cambie de empresa desde el selector de la barra superior.</p>
      {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}
      <ul style={{ listStyle: "none", padding: 0, margin: "8px 0" }}>
        {(datos ?? []).map((e) => (
          <li key={e.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "4px 0" }}>
            <b>{e.nombre}</b> <span className="suave">RNC {e.rnc}</span>
            {e.actual ? <span className="pastilla">actual</span> : <button className="enlace" onClick={() => pasarA(e.id).catch((x) => setMsg({ t: (x as Error).message, tipo: "error" }))}>Cambiarme a esta</button>}
          </li>
        ))}
      </ul>
      {!abrir ? <button className="boton" onClick={() => setAbrir(true)}>Crear nueva empresa (otro RNC)</button> : (
        <div className="fila-acciones" style={{ flexWrap: "wrap" }}>
          <input placeholder="RNC" inputMode="numeric" value={f.rnc} onChange={(e) => setF({ ...f, rnc: e.target.value })} />
          <input placeholder="Razón social" value={f.razonSocial} onChange={(e) => setF({ ...f, razonSocial: e.target.value })} />
          <input placeholder="Nombre comercial" value={f.nombreComercial} onChange={(e) => setF({ ...f, nombreComercial: e.target.value })} />
          <input placeholder="Primera sucursal" value={f.sucursal} onChange={(e) => setF({ ...f, sucursal: e.target.value })} />
          <input type="password" autoComplete="current-password" placeholder="Su contraseña" value={f.clave} onChange={(e) => setF({ ...f, clave: e.target.value })} />
          <button className="boton primario" disabled={ocupado || !f.rnc || f.razonSocial.length < 2 || f.nombreComercial.length < 2 || !f.clave} onClick={crear}>Crear empresa</button>
          <button className="enlace" onClick={() => setAbrir(false)}>Cancelar</button>
        </div>
      )}
    </div>
  );
}
