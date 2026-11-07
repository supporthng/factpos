import { Fragment, useEffect, useState } from "react";
import { api, fijarSesion, sesionActual } from "../api";
import { Aviso, useDatos } from "../ui";

interface EmpresaGrupo { id: string; rnc: string; razonSocial: string; nombre: string; actual: boolean }

async function pasarA(id: string) {
  const r = await api<{ token: string; usuario: { id: string; nombre: string; permisos: string[] }; empresa: { id: string; nombre: string } }>("/central/empresas/cambiar", { cuerpo: { empresaId: id } });
  fijarSesion({ ...sesionActual(), token: r.token, empresaId: r.empresa.id, empresa: r.empresa.nombre, usuarioId: r.usuario.id, nombre: r.usuario.nombre, permisos: r.usuario.permisos, sucursales: null });
  location.reload();
}

/** Color propio de cada empresa (sale de su id, siempre el mismo): así se nota de un vistazo en cuál se está trabajando. */
export function colorEmpresa(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} 65% 42%)`;
}

/** Con más de una empresa enlazada: nombre y RNC de la empresa activa con su color, y un borde del mismo color en toda la página. */
export function FranjaEmpresa() {
  const { datos } = useDatos<EmpresaGrupo[]>("/central/empresas");
  const activa = datos && datos.length > 1 ? datos.find((e) => e.actual) : undefined;
  useEffect(() => {
    if (!activa) return;
    const anterior = document.body.style.borderTop;
    document.body.style.borderTop = `5px solid ${colorEmpresa(activa.id)}`;
    return () => { document.body.style.borderTop = anterior; };
  }, [activa?.id]);
  if (!activa) return null;
  const color = colorEmpresa(activa.id);
  return (
    <span title="Empresa en la que está trabajando" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 999, border: `1px solid ${color}`, color, fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>
      <span style={{ width: 9, height: 9, borderRadius: 999, background: color, display: "inline-block" }} />
      {activa.nombre} · RNC {activa.rnc}
    </span>
  );
}

interface PasoMarcha { id: string; titulo: string; ok: boolean; detalle: string; ir?: string }

/** Qué le falta a la empresa activa antes de poder facturar. */
export function PuestaEnMarcha() {
  const ir = (seccion: string) => { location.hash = seccion; };
  const { datos } = useDatos<{ pasos: PasoMarcha[]; listos: number; total: number }>("/central/empresas/puesta-en-marcha");
  if (!datos) return null;
  return (
    <div className="panel">
      <h3 style={{ marginTop: 0 }}>Puesta en marcha <span className="suave pequeno">{datos.listos} de {datos.total} listos</span></h3>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {datos.pasos.map((p) => (
          <li key={p.id} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "5px 0" }}>
            <span aria-hidden style={{ color: p.ok ? "#1a7f37" : "#b42318", fontWeight: 700, width: 16 }}>{p.ok ? "✓" : "○"}</span>
            <span style={{ flex: 1 }}><b>{p.titulo}</b><br /><span className="suave pequeno">{p.detalle}</span></span>
            {!p.ok && p.ir && <button className="enlace" onClick={() => ir(p.ir!)}>Resolver</button>}
          </li>
        ))}
      </ul>
    </div>
  );
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
      {(datos?.length ?? 0) > 1 && <CopiarCatalogo otras={(datos ?? []).filter((e) => !e.actual)} />}
      {(datos?.length ?? 0) > 1 && <Consolidado />}
    </div>
  );
}

const PERIODOS = [["hoy", "Hoy"], ["ayer", "Ayer"], ["semana", "Esta semana"], ["semanaPasada", "Semana pasada"], ["mes", "Este mes"]] as const;
const rd = (n: number | string) => "RD$" + Number(n).toLocaleString("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Ventas de todas las empresas enlazadas, por sucursal. */
function Consolidado() {
  const [periodo, setPeriodo] = useState<(typeof PERIODOS)[number][0]>("hoy");
  const { datos } = useDatos<{ empresaId: string; empresa: string; rnc: string; sucursalId: string; sucursal: string; venta: string; transacciones: number; ventaAnterior: string }[]>(`/central/empresas/consolidado?periodo=${periodo}`);
  const porEmpresa = new Map<string, { nombre: string; venta: number; ant: number; tx: number }>();
  (datos ?? []).forEach((x) => {
    const e = porEmpresa.get(x.empresaId) ?? { nombre: x.empresa, venta: 0, ant: 0, tx: 0 };
    e.venta += Number(x.venta); e.ant += Number(x.ventaAnterior); e.tx += x.transacciones; porEmpresa.set(x.empresaId, e);
  });
  const tot = [...porEmpresa.values()].reduce((a, e) => ({ venta: a.venta + e.venta, ant: a.ant + e.ant, tx: a.tx + e.tx }), { venta: 0, ant: 0, tx: 0 });
  return (
    <div style={{ marginTop: 16 }}>
      <h4>Ventas consolidadas</h4>
      <div className="cifras-filtro">
        {PERIODOS.map(([k, t]) => <button key={k} className={"chip-periodo" + (periodo === k ? " activo" : "")} onClick={() => setPeriodo(k)}>{t}</button>)}
      </div>
      <table className="tabla">
        <thead><tr><th>Empresa / sucursal</th><th className="num">Ventas</th><th className="num">Transacciones</th><th className="num">Periodo anterior</th></tr></thead>
        <tbody>
          {[...porEmpresa.entries()].map(([id, e]) => (
            <Fragment key={id}>
              <tr><td><b>{e.nombre}</b></td><td className="num"><b>{rd(e.venta)}</b></td><td className="num">{e.tx}</td><td className="num">{rd(e.ant)}</td></tr>
              {(datos ?? []).filter((x) => x.empresaId === id).map((x) => (
                <tr key={x.sucursalId} className="suave"><td style={{ paddingLeft: 24 }}>{x.sucursal}</td><td className="num">{rd(x.venta)}</td><td className="num">{x.transacciones}</td><td className="num">{rd(x.ventaAnterior)}</td></tr>
              ))}
            </Fragment>
          ))}
          <tr><td><b>Total del grupo</b></td><td className="num"><b>{rd(tot.venta)}</b></td><td className="num"><b>{tot.tx}</b></td><td className="num"><b>{rd(tot.ant)}</b></td></tr>
        </tbody>
      </table>
    </div>
  );
}

/** Copia el catálogo de otra empresa del grupo a la empresa actual. */
function CopiarCatalogo({ otras }: { otras: EmpresaGrupo[] }) {
  const [origen, setOrigen] = useState(otras[0]?.id ?? "");
  const [precios, setPrecios] = useState(true);
  const [clave, setClave] = useState("");
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const copiar = async () => {
    const o = otras.find((x) => x.id === origen)?.nombre ?? "";
    if (!confirm(`Se copiarán categorías, productos, códigos de barra${precios ? " y precios" : ""} de «${o}» a esta empresa. No se copian existencias, costos ni historial. Los SKU que ya existan aquí se omiten. ¿Continuar?`)) return;
    setOcupado(true); setMsg(null);
    try {
      const r = await api<{ productos: number; omitidos: number; categorias: number; codigos: number; precios: number }>("/central/empresas/copiar-catalogo", { cuerpo: { origenId: origen, clave, precios } });
      setMsg({ t: `Listo: ${r.productos} producto(s) copiados, ${r.omitidos} omitidos por existir, ${r.categorias} categoría(s) nuevas, ${r.codigos} código(s) de barra, ${r.precios} precio(s).`, tipo: "ok" });
      setClave("");
    } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
    setOcupado(false);
  };
  return (
    <div style={{ marginTop: 16 }}>
      <h4>Copiar catálogo a esta empresa</h4>
      {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}
      <div className="fila-acciones" style={{ flexWrap: "wrap" }}>
        <select value={origen} onChange={(e) => setOrigen(e.target.value)}>{otras.map((e) => <option key={e.id} value={e.id}>Desde: {e.nombre}</option>)}</select>
        <label><input type="checkbox" checked={precios} onChange={(e) => setPrecios(e.target.checked)} /> Copiar precios</label>
        <input type="password" autoComplete="current-password" placeholder="Su contraseña" value={clave} onChange={(e) => setClave(e.target.value)} />
        <button className="boton" disabled={ocupado || !origen || !clave} onClick={copiar}>Copiar catálogo</button>
      </div>
    </div>
  );
}
