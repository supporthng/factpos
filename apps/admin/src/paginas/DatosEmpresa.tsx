import { useEffect, useState } from "react";
import { api } from "../api";
import { Aviso, Encabezado } from "../ui";

interface Datos {
  rnc: string; razonSocial: string; nombreComercial: string; direccion: string; municipio: string; provincia: string;
  telefono: string; correo: string; sitioWeb: string; representante: string; rncBloqueado: boolean;
}

/** Datos generales de la empresa: salen en facturas, tickets, correos y comprobantes electrónicos. */
export function DatosEmpresa() {
  const [d, setD] = useState<Datos | null>(null);
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" } | null>(null);
  const [guardando, setGuardando] = useState(false);
  useEffect(() => { api<Datos>("/central/empresa").then(setD).catch((e) => setMsg({ t: (e as Error).message, tipo: "error" })); }, []);
  if (!d) return <>{msg ? <Aviso texto={msg.t} /> : <p className="suave">Cargando…</p>}</>;
  const poner = (k: keyof Datos) => (e: React.ChangeEvent<HTMLInputElement>) => setD({ ...d, [k]: e.target.value });

  const guardar = async () => {
    setGuardando(true); setMsg(null);
    try {
      const { rncBloqueado: _b, ...cuerpo } = d;
      await api("/central/empresa", { metodo: "PUT", cuerpo: { ...cuerpo, rnc: d.rnc.replace(/\D/g, "") } });
      setMsg({ t: "Datos guardados. Los verá en facturas, tickets y comprobantes nuevos.", tipo: "ok" });
    } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
    setGuardando(false);
  };

  return (
    <>
      <Encabezado titulo="Datos de la empresa" descripcion="Nombre, RNC, dirección y contacto. Salen en facturas, tickets, correos y comprobantes electrónicos." />
      <div className="tarjeta" style={{ maxWidth: 860 }}>
        <div className="rejilla" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
          <label>RNC<input value={d.rnc} onChange={poner("rnc")} inputMode="numeric" maxLength={11} disabled={d.rncBloqueado} /></label>
          <label>Razón social<input value={d.razonSocial} onChange={poner("razonSocial")} maxLength={150} /></label>
          <label>Nombre comercial<input value={d.nombreComercial} onChange={poner("nombreComercial")} maxLength={150} placeholder="Como lo conocen sus clientes" /></label>
          <label>Representante<input value={d.representante} onChange={poner("representante")} maxLength={120} /></label>
          <label style={{ gridColumn: "1 / -1" }}>Dirección<input value={d.direccion} onChange={poner("direccion")} maxLength={200} placeholder="Calle, número, sector" /></label>
          <label>Municipio<input value={d.municipio} onChange={poner("municipio")} maxLength={80} /></label>
          <label>Provincia<input value={d.provincia} onChange={poner("provincia")} maxLength={80} /></label>
          <label>Teléfono<input value={d.telefono} onChange={poner("telefono")} inputMode="tel" maxLength={20} /></label>
          <label>Correo<input value={d.correo} onChange={poner("correo")} type="email" maxLength={120} /></label>
          <label>Sitio web<input value={d.sitioWeb} onChange={poner("sitioWeb")} maxLength={120} /></label>
        </div>
        {d.rncBloqueado && <CambiarRnc actual={d.rnc} />}
        <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center" }}>
          <button className="boton primario" onClick={guardar} disabled={guardando}>{guardando ? "Guardando…" : "Guardar"}</button>
          {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}
        </div>
      </div>
      <TipoNegocio />
      <ModulosExtra />
      <UnaSolaPersona />
      <AforoEntradas />
    </>
  );
}

const TIPOS: [string, string][] = [
  ["TIENDA", "Abarrotes, supermercados y licorerías (venta directa en caja)"],
  ["RESTAURANTE", "Restaurante"],
  ["BAR", "Bar"],
  ["DISCOTECA", "Discoteca"],
  ["COMIDA_RAPIDA", "Comida rápida"],
  ["MUEBLERIA", "Mueblería y electrodomésticos (venta a plazos, apartados y entregas)"],
  ["FARMACIA", "Farmacia (vencimientos, ubicación en tramería y venta con receta)"],
];

/** El tipo de negocio lo fijan la instalación y la licencia: aquí solo se muestra. */
function TipoNegocio() {
  const [tipo, setTipo] = useState<string | null>(null);
  useEffect(() => { api<{ tipoNegocio: string }>("/central/empresa/tipo-negocio").then((r) => setTipo(r.tipoNegocio)).catch(() => setTipo("TIENDA")); }, []);
  if (tipo === null) return null;
  return (
    <div className="tarjeta" style={{ maxWidth: 860, marginTop: 14 }}>
      <h3 style={{ marginTop: 0 }}>Tipo de negocio</h3>
      <p style={{ margin: "0 0 6px" }}><b>{TIPOS.find(([v]) => v === tipo)?.[1] ?? tipo}</b></p>
      <p className="suave" style={{ margin: 0 }}>Se definió al instalar y lo confirma su licencia: solo están activas las funciones de este tipo de negocio. No se cambia desde el programa; si necesita otro, comuníquese con FactPOS.</p>
    </div>
  );
}

/** Módulos que se encienden además de los del tipo de negocio: la cafetería (cuentas abiertas, comandas, barra y cocina) y el lavado de vehículos. */
function ModulosExtra() {
  const [d, setD] = useState<{ tipoNegocio: string; extra: string[]; activos: string[] } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { api<{ tipoNegocio: string; extra: string[]; activos: string[] }>("/central/empresa/modulos").then(setD).catch(() => setD(null)); }, []);
  if (!d) return null;
  const mesasDelTipo = ["RESTAURANTE", "BAR", "DISCOTECA", "COMIDA_RAPIDA"].includes(d.tipoNegocio);
  const cambiar = async (modulo: string, v: boolean) => {
    setMsg(null);
    const extra = v ? [...new Set([...d.extra, modulo])] : d.extra.filter((m) => m !== modulo);
    try {
      const r = await api<{ extra: string[] }>("/central/empresa/modulos", { metodo: "PUT", cuerpo: { extra } });
      setD({ ...d, extra: r.extra, activos: v ? [...new Set([...d.activos, modulo])] : d.activos.filter((m) => m !== modulo || (modulo === "MESAS" && mesasDelTipo)) });
      window.dispatchEvent(new Event("factpos:modulos"));
    } catch (e) { setMsg((e as Error).message); }
  };
  return (
    <>
      {!mesasDelTipo && (
        <div className="tarjeta" style={{ maxWidth: 860, marginTop: 14 }}>
          <h3 style={{ marginTop: 0 }}>Cafetería o lounge</h3>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={d.extra.includes("MESAS")} onChange={(e) => void cambiar("MESAS", e.target.checked)} />
            <span>Este negocio también vende comida y bebida (cuentas abiertas, comandas a barra y cocina, pre-cuenta y propina)</span>
          </label>
          <p className="suave" style={{ margin: "6px 0 0" }}>Enciende en la caja «Mesas y cuentas» y «Barra». El resto del negocio sigue igual. La propina legal solo se aplica a lo que se consume en el local.</p>
        </div>
      )}
      <div className="tarjeta" style={{ maxWidth: 860, marginTop: 14 }}>
        <h3 style={{ marginTop: 0 }}>Lavado de vehículos</h3>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={d.extra.includes("LAVADO")} onChange={(e) => void cambiar("LAVADO", e.target.checked)} />
          <span>Este negocio también lava vehículos o hace auto detailing (ficha del vehículo, órdenes de lavado, lavadores con comisión por lavado)</span>
        </label>
        <p className="suave" style={{ margin: "6px 0 0" }}>Agrega la pantalla «Lavado de vehículos» en Ventas. Después de encenderlo, dé el permiso «Lavado de vehículos» a quien lo use.</p>
        {msg && <p className="suave" style={{ margin: "6px 0 0" }}>{msg}</p>}
      </div>
    </>
  );
}

/** Negocios chicos: la misma persona factura, financia, cobra y cuadra su turno desde la Administración. Apagado por defecto. */
function UnaSolaPersona() {
  const [activo, setActivo] = useState<boolean | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { api<{ activo: boolean }>("/central/empresa/modo-unico").then((r) => setActivo(r.activo)).catch(() => setActivo(null)); }, []);
  if (activo === null) return null;
  const cambiar = async (v: boolean) => {
    setMsg(null);
    try { await api("/central/empresa/modo-unico", { metodo: "PUT", cuerpo: { activo: v } }); setActivo(v); }
    catch (e) { setMsg((e as Error).message); }
  };
  return (
    <div className="tarjeta" style={{ maxWidth: 860, marginTop: 14 }}>
      <h3 style={{ marginTop: 0 }}>Una sola persona factura y cobra</h3>
      <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input type="checkbox" checked={activo} onChange={(e) => void cambiar(e.target.checked)} />
        <span>En este negocio la misma persona arma la factura, financia a plazos, recibe la inicial y cobra, en la misma computadora</span>
      </label>
      <p className="suave" style={{ margin: "6px 0 0" }}>En «Nueva factura» aparece «Mi turno» para abrir y cerrar el turno sin usar el programa de la Caja; el efectivo que cobra entra a ese turno y se cuadra al cerrar. Ya no se ofrece «Enviar a caja». Apagado, todo funciona como antes.</p>
      {msg && <p className="suave" style={{ margin: "6px 0 0" }}>{msg}</p>}
    </div>
  );
}

/** Entradas y aforo: solo para bar o discoteca. Apagado por defecto; al apagarlo la caja deja de mostrar el contador. */
function AforoEntradas() {
  const [c, setC] = useState<{ tipoNegocio: string; activo: boolean; maximo: number | null; categoriaId: string | null; categorias: { id: string; nombre: string }[] } | null>(null);
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" } | null>(null);
  useEffect(() => { api<NonNullable<typeof c>>("/central/empresa/aforo").then(setC).catch(() => setC(null)); }, []);
  if (!c || (c.tipoNegocio !== "BAR" && c.tipoNegocio !== "DISCOTECA")) return null;
  const guardar = async (n: typeof c) => {
    setMsg(null);
    try {
      await api("/central/empresa/aforo", { metodo: "PUT", cuerpo: { activo: n.activo, maximo: n.maximo, categoriaId: n.categoriaId } });
      setC(n); setMsg({ t: n.activo ? "Guardado. Las cajas muestran el contador de aforo al recargar la pantalla de venta." : "Aforo desactivado.", tipo: "ok" });
    } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
  };
  return (
    <div className="tarjeta" style={{ maxWidth: 860, marginTop: 14 }}>
      <h3 style={{ marginTop: 0 }}>Entradas y aforo</h3>
      <p className="suave">La entrada se vende como cualquier producto (con su comprobante) de una categoría que usted elige; cada unidad vendida cuenta como una persona. La caja muestra cuántas hay dentro y avisa al llegar al máximo.</p>
      <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
        <input type="checkbox" checked={c.activo} onChange={(e) => void guardar({ ...c, activo: e.target.checked })} /> Controlar entradas y aforo
      </label>
      {c.activo && (
        <div style={{ display: "grid", gap: 10, marginTop: 10, maxWidth: 420 }}>
          <label className="campo"><span>Categoría de las entradas</span>
            <select value={c.categoriaId ?? ""} onChange={(e) => void guardar({ ...c, categoriaId: e.target.value || null })}>
              <option value="">Elija…</option>
              {c.categorias.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
            </select></label>
          <label className="campo"><span>Capacidad máxima (personas)</span>
            <input className="numero" inputMode="numeric" defaultValue={c.maximo ?? ""} placeholder="Sin límite"
              onBlur={(e) => { const v = e.target.value.replace(/\D/g, ""); void guardar({ ...c, maximo: v ? Number(v) : null }); }} /></label>
        </div>
      )}
      {msg && <div style={{ marginTop: 8 }}><Aviso texto={msg.t} tipo={msg.tipo} /></div>}
    </div>
  );
}

/** El RNC está en uso fiscal: solo se corrige con confirmación y mientras la empresa no esté facturando en producción. */
function CambiarRnc({ actual }: { actual: string }) {
  const [abierto, setAbierto] = useState(false);
  const [nuevo, setNuevo] = useState("");
  const [seguro, setSeguro] = useState(false);
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" } | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const cambiar = async () => {
    setTrabajando(true); setMsg(null);
    try {
      await api("/central/empresa/cambiar-rnc", { metodo: "POST", cuerpo: { rnc: nuevo.replace(/\D/g, ""), confirmar: true } });
      setMsg({ t: "RNC cambiado. Cargue de nuevo el certificado digital que corresponde a este RNC (Fiscal › Certificado digital).", tipo: "ok" });
      setAbierto(false);
      setTimeout(() => location.reload(), 2500);
    } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
    setTrabajando(false);
  };
  return (
    <div style={{ marginTop: 8 }}>
      <p className="suave" style={{ margin: 0 }}>El RNC está bloqueado porque la empresa ya tiene un certificado cargado o comprobantes electrónicos.</p>
      {!abierto ? <button className="boton chico" style={{ marginTop: 6 }} onClick={() => setAbierto(true)}>Cambiar RNC…</button> : (
        <div className="panel" style={{ marginTop: 8 }}>
          <p style={{ margin: "0 0 8px" }}>Solo se puede mientras la empresa <b>no esté facturando en producción</b> (lo emitido hasta ahora son comprobantes de prueba). Se desactiva el certificado digital cargado, porque está firmado para el RNC {actual}, y habrá que cargar el del RNC nuevo.</p>
          <label>RNC nuevo<input value={nuevo} onChange={(e) => setNuevo(e.target.value)} inputMode="numeric" maxLength={11} /></label>
          <label style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 8 }}><input type="checkbox" checked={seguro} onChange={(e) => setSeguro(e.target.checked)} /> Entiendo que se quita el certificado actual</label>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button className="boton primario" disabled={!seguro || nuevo.replace(/\D/g, "").length < 9 || trabajando} onClick={cambiar}>{trabajando ? "Cambiando…" : "Cambiar RNC"}</button>
            <button className="boton" onClick={() => setAbierto(false)}>Cancelar</button>
          </div>
        </div>
      )}
      {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}
    </div>
  );
}
