import { useState } from "react";
import { api, CONFIG } from "../api";
import { Aviso, Encabezado, iniciarDescarga, versionCliente } from "../ui";

/** Todos los instaladores de FactPOS en un solo lugar. */
interface Item { titulo: string; para: string; plataforma: string; descarga: { tipo: "portal" | "principal"; so?: string; variante?: "caja" } }
interface Grupo { titulo: string; nota?: string; items: Item[] }

const GRUPOS: Grupo[] = [
  { titulo: "FactPOS (servidor y cajas)", nota: "La caja se instala en cada terminal de venta; el instalador completo, en la PC del servidor (pregunta qué se instala). Requieren licencia activa.",
    items: [
      { titulo: "Instalador de Caja", para: "Solo la caja de venta: encuentra sola el servidor de la tienda. No instala servidor ni base de datos (pesa mucho menos)", plataforma: "Windows", descarga: { tipo: "principal", variante: "caja" } },
      { titulo: "Instalador completo de FactPOS", para: "Servidor, cajas y administración de escritorio", plataforma: "Windows", descarga: { tipo: "principal" } },
    ] },
  { titulo: "Verificador de precios", nota: "Pantalla de consulta de precios para los clientes. Se actualiza sola desde el servidor.",
    items: [
      { titulo: "Verificador para Android", para: "Tabletas y pantallas Android", plataforma: "Android (APK)", descarga: { tipo: "portal", so: "android" } },
      { titulo: "Verificador para Windows", para: "PC con pantalla táctil", plataforma: "Windows", descarga: { tipo: "portal", so: "windows" } },
    ] },
  { titulo: "Conexión remota · FactPOS Admin", nota: "Para administrar el negocio desde fuera de la oficina. El enlace con QR que la deja configurada está en Sistema › Acceso remoto.",
    items: [
      { titulo: "FactPOS Admin para Android", para: "Celular o tableta", plataforma: "Android (APK)", descarga: { tipo: "portal", so: "admin-android" } },
      { titulo: "FactPOS Admin para Windows", para: "Computadora", plataforma: "Windows", descarga: { tipo: "portal", so: "admin-windows" } },
    ] },
  { titulo: "Importador de datos (WilPOS)", nota: "Pasa productos, clientes, proveedores, existencias e historial de ventas desde un respaldo del sistema anterior. No se instala: se abre y se usa. Con «Reemplazar lo importado antes» marcado, un respaldo nuevo deja FactPOS igual a él.",
    items: [{ titulo: "Importador de FactPOS", para: "Computadora con el respaldo del sistema anterior", plataforma: "Windows (portable)", descarga: { tipo: "portal", so: "importador" } }] },
];

export function Instaladores() {
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" } | null>(null);
  const [trabajando, setTrabajando] = useState<string | null>(null);
  const [enlace_, setEnlace] = useState<string | null>(null);
  // Desde el portal (web de la empresa) las apps se descargan del portal; desde el servidor, del propio servidor
  const enlace = (so: string) => CONFIG.modo === "cliente" ? `${location.origin}/licencias/descargar-verificador/${so}` : `${(CONFIG.api ?? "").replace(/\/$/, "")}/verificador/descarga/${so}`;

  const principal = async (clave: string, variante?: "caja") => {
    setMsg(null); setEnlace(null); setTrabajando(clave);
    try {
      const r = await api<{ url: string; version: string | null; nombre?: string | null }>("/central/instaladores/principal", { metodo: "POST", cuerpo: variante ? { tipo: variante } : {} });
      iniciarDescarga(r.url, r.nombre);
      setEnlace(r.url);
      setMsg({ t: `Descargando el instalador${r.version ? ` de la versión ${versionCliente(r.version)}` : ""}…`, tipo: "ok" });
    } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
    finally { setTrabajando(null); }
  };

  return (
    <>
      <Encabezado titulo="Instaladores" descripcion="Todos los instaladores de FactPOS en un solo lugar: siempre la versión más reciente." />
      {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}
      {enlace_ && <p className="pequeno">¿No empezó la descarga? <a href={enlace_} target="_blank" rel="noreferrer">Haz clic aquí</a> (el enlace dura unos minutos).</p>}
      {GRUPOS.map((g) => (
        <div className="panel" key={g.titulo}>
          <h3 style={{ marginTop: 0 }}>{g.titulo}</h3>
          {g.nota && <p className="suave pequeno" style={{ marginTop: 0 }}>{g.nota}</p>}
          {g.items.map((it) => (
            <div key={it.titulo} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "10px 0", borderTop: "1px solid var(--borde, #e3e8ee)" }}>
              <div><b>{it.titulo}</b><div className="suave pequeno">{it.para} · {it.plataforma}</div></div>
              {it.descarga.tipo === "principal"
                ? <button className="boton primario" disabled={trabajando !== null} onClick={() => principal(it.titulo, it.descarga.variante)}>{trabajando === it.titulo ? "Preparando…" : "Descargar"}</button>
                : <a className="boton primario" href={enlace(it.descarga.so!)}>Descargar</a>}
            </div>
          ))}
        </div>
      ))}
    </>
  );
}
