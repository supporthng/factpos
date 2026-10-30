import { useEffect, useState } from "react";
import { api, rd, num, sesionActual, encabezados } from "../api";
import { Aviso, Encabezado, Kpi, SelectorSucursal, Tabla, useCatalogo, useDatos } from "../ui";

const ESTADOS: Record<string, string> = {
  ACEPTADO: "Aceptado", ACEPTADO_COND: "Aceptado condicional", RECHAZADO: "Rechazado", EN_PROCESO: "En proceso",
  PENDIENTE: "Pendiente", CONTINGENCIA: "Contingencia (sin conexión)", ENVIADO: "Enviado",
};
const TIPOS: Record<string, string> = {
  E31: "Crédito fiscal", E32: "Consumo", E33: "Nota de débito", E34: "Nota de crédito", E41: "Compras",
  E43: "Gastos menores", E44: "Regímenes especiales", E45: "Gubernamental", E46: "Exportaciones", E47: "Pagos al exterior",
};

/** Facturación electrónica: estado de envíos a la DGII, secuencias e-NCF y configuración. */
export function Fiscal() {
  const [vista, setVista] = useState<"envios" | "secuencias" | "ncf" | "certificado" | "config">("envios");
  return (
    <>
      <Encabezado titulo="Gestión fiscal" descripcion="Comprobantes e-CF, rangos NCF serie B y certificados digitales." />
      <div className="pestanas">
        <button className={vista === "envios" ? "activa" : ""} onClick={() => setVista("envios")}>Envíos a la DGII</button>
        <button className={vista === "secuencias" ? "activa" : ""} onClick={() => setVista("secuencias")}>Secuencias e-NCF</button>
        <button className={vista === "ncf" ? "activa" : ""} onClick={() => setVista("ncf")}>Rangos NCF B01/B02</button>
        <button className={vista === "ncf" ? "activa" : ""} onClick={() => setVista("ncf")}>Rangos NCF B01/B02</button>
        <button className={vista === "certificado" ? "activa" : ""} onClick={() => setVista("certificado")}>Certificado digital</button>
        <button className={vista === "config" ? "activa" : ""} onClick={() => setVista("config")}>Configuración</button>
      </div>
      {vista === "envios" && <Envios />}
      {vista === "secuencias" && <Secuencias />}
      {vista === "ncf" && <RangosNCF />}
      {vista === "ncf" && <RangosNcf />}
      {vista === "certificado" && <CertificadoDigital />}
      {vista === "config" && <Configuracion />}
    </>
  );
}

function Envios() {
  const [estado, setEstado] = useState("");
  const [sucursalId, setSucursalId] = useState("");
  const [encf, setEncf] = useState("");
  const resumen = useDatos<{ estado: string; documentos: string; monto: string }[]>("/central/fiscal/resumen");
  const ruta = `/central/fiscal/documentos?${new URLSearchParams({ ...(estado ? { estado } : {}), ...(sucursalId ? { sucursalId } : {}), ...(encf.length === 13 ? { encf } : {}) })}`;
  const docs = useDatos<any[]>(ruta);
  const cuenta = (e: string) => Number(resumen.datos?.find((r) => r.estado === e)?.documentos ?? 0);
  const pendientes = cuenta("PENDIENTE") + cuenta("CONTINGENCIA") + cuenta("EN_PROCESO") + cuenta("ENVIADO");

  const descargar = async (id: string, nombre: string) => {
    const s = sesionActual();
    const r = await fetch(`${s.servidor}/central/fiscal/documentos/${id}/xml`, { headers: encabezados() });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(await r.blob());
    a.download = `${nombre}.xml`;
    a.click();
  };

  return (
    <>
      <div className="kpis">
        <Kpi titulo="Aceptados" valor={num(cuenta("ACEPTADO") + cuenta("ACEPTADO_COND"))} tono="ok" />
        <Kpi titulo="Pendientes de envío" valor={num(pendientes)} detalle={cuenta("CONTINGENCIA") ? `${cuenta("CONTINGENCIA")} en contingencia` : undefined} tono={cuenta("CONTINGENCIA") ? "alerta" : undefined} />
        <Kpi titulo="Rechazados" valor={num(cuenta("RECHAZADO"))} tono={cuenta("RECHAZADO") ? "alerta" : undefined} />
      </div>
      <div className="filtros">
        <input placeholder="Buscar e-NCF (13 caracteres)" value={encf} onChange={(e) => setEncf(e.target.value.toUpperCase().trim())} />
        <select value={estado} onChange={(e) => setEstado(e.target.value)}>
          <option value="">Todos los estados</option>
          {Object.entries(ESTADOS).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </select>
        <SelectorSucursal valor={sucursalId} onCambio={setSucursalId} />
        <button className="boton fantasma" onClick={() => { docs.recargar(); resumen.recargar(); }}>Actualizar</button>
      </div>
      <Tabla
        filas={docs.datos ?? []}
        clave={(f) => f.id}
        vacio="No hay comprobantes con este filtro"
        columnas={[
          { titulo: "e-NCF", valor: (f) => <b className="mono">{f.encf}</b> },
          { titulo: "Tipo", valor: (f) => <>{TIPOS[f.tipo] ?? f.tipo}<br /><span className="suave pequeno">{f.modo === "RFCE" ? "Resumen (consumo < 250 mil)" : "e-CF completo"}</span></> },
          { titulo: "Sucursal", valor: (f) => f.sucursal },
          { titulo: "Firmado", valor: (f) => new Date(f.fechaFirma).toLocaleString("es-DO") },
          { titulo: "Total", valor: (f) => rd(f.total), der: true },
          { titulo: "Código", valor: (f) => <span className="mono">{f.codigoSeguridad}</span> },
          { titulo: "Estado", valor: (f) => <span className={"pastilla e-" + f.estado.toLowerCase()} title={f.mensajes ? JSON.stringify(f.mensajes) : ""}>{ESTADOS[f.estado] ?? f.estado}</span> },
          {
            titulo: "", valor: (f) => (
              <span className="acciones-fila">
                <a className="enlace" href={f.urlQr} target="_blank" rel="noreferrer">Consultar DGII</a>
                <button className="enlace" onClick={() => descargar(f.id, f.encf)}>XML</button>
                {["PENDIENTE", "CONTINGENCIA", "EN_PROCESO"].includes(f.estado) && (
                  <button className="enlace" onClick={async () => { await api(`/central/fiscal/documentos/${f.id}/reintentar`, { metodo: "POST" }); setTimeout(docs.recargar, 1500); }}>Reintentar</button>
                )}
              </span>
            ),
          },
        ]}
      />
    </>
  );
}

function Secuencias() {
  const { sucursales } = useCatalogo();
  const sec = useDatos<any[]>("/central/fiscal/secuencias");
  const aut = useDatos<any[]>("/central/fiscal/autorizaciones");
  const [nueva, setNueva] = useState({ tipo: "E32", desde: "", hasta: "", venceEn: "" });
  const [asignar, setAsignar] = useState({ autorizacionId: "", sucursalId: sucursales[0]?.id ?? "", cantidad: "5000" });
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" } | null>(null);

  const registrar = async () => {
    try {
      await api("/central/fiscal/autorizaciones", { cuerpo: { tipo: nueva.tipo, desde: Number(nueva.desde), hasta: Number(nueva.hasta), venceEn: nueva.venceEn } });
      setMsg({ t: "Rango registrado. Ahora asígnelo por bloques a las sucursales.", tipo: "ok" });
      setNueva({ ...nueva, desde: "", hasta: "" });
      aut.recargar();
    } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
  };
  const darBloque = async () => {
    try {
      const r = await api("/central/fiscal/rangos", { cuerpo: { ...asignar, cantidad: Number(asignar.cantidad) } });
      setMsg({ t: `Bloque ${r.tipo} ${r.desde}–${r.hasta} (${num(r.cantidad)} e-NCF) asignado.`, tipo: "ok" });
      aut.recargar(); sec.recargar();
    } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
  };

  return (
    <>
      <h2>Disponibles por sucursal</h2>
      <Tabla
        filas={sec.datos ?? []}
        clave={(f) => f.sucursal_id + f.tipo_ecf}
        vacio="No hay secuencias asignadas"
        columnas={[
          { titulo: "Sucursal", valor: (f) => f.sucursal },
          { titulo: "Tipo", valor: (f) => `${f.tipo_ecf} · ${TIPOS[f.tipo_ecf] ?? ""}` },
          { titulo: "Último usado", valor: (f) => f.ultimo_usado ? <span className="mono">{f.tipo_ecf}{String(f.ultimo_usado).padStart(10, "0")}</span> : "—" },
          { titulo: "Disponibles", der: true, valor: (f) => <b className={Number(f.disponibles ?? 0) < Number(f.alerta) ? "texto-alerta" : ""}>{num(f.disponibles ?? 0)}</b> },
          { titulo: "Vencen", valor: (f) => f.proximo_vencimiento ?? "—" },
        ]}
      />
      <p className="suave pequeno">Cada sucursal numera con su propio bloque: así factura sin internet y nunca repite un e-NCF de otra sucursal.</p>

      <div className="dos-col" style={{ marginTop: 20 }}>
        <div className="panel">
          <h3>1. Registrar rango autorizado por la DGII</h3>
          <div className="dos-col">
            <label className="campo"><span>Tipo</span><select value={nueva.tipo} onChange={(e) => setNueva({ ...nueva, tipo: e.target.value })}>{Object.entries(TIPOS).map(([v, t]) => <option key={v} value={v}>{v} · {t}</option>)}</select></label>
            <label className="campo"><span>Vence</span><input type="date" value={nueva.venceEn} onChange={(e) => setNueva({ ...nueva, venceEn: e.target.value })} /></label>
            <label className="campo"><span>Desde (secuencial)</span><input inputMode="numeric" value={nueva.desde} onChange={(e) => setNueva({ ...nueva, desde: e.target.value.replace(/\D/g, "") })} /></label>
            <label className="campo"><span>Hasta</span><input inputMode="numeric" value={nueva.hasta} onChange={(e) => setNueva({ ...nueva, hasta: e.target.value.replace(/\D/g, "") })} /></label>
          </div>
          <button className="boton" disabled={!nueva.desde || !nueva.hasta || !nueva.venceEn} onClick={registrar}>Registrar rango</button>
        </div>
        <div className="panel">
          <h3>2. Asignar bloque a una sucursal</h3>
          <label className="campo"><span>Rango</span>
            <select value={asignar.autorizacionId} onChange={(e) => setAsignar({ ...asignar, autorizacionId: e.target.value })}>
              <option value="">— Elegir —</option>
              {(aut.datos ?? []).map((a) => <option key={a.id} value={a.id}>{a.tipo} · {num(a.desde)}–{num(a.hasta)} · sin asignar {num(a.sinAsignar)}</option>)}
            </select>
          </label>
          <div className="dos-col">
            <label className="campo"><span>Sucursal</span><SelectorSucursal valor={asignar.sucursalId} onCambio={(v) => setAsignar({ ...asignar, sucursalId: v })} todas={false} /></label>
            <label className="campo"><span>Cantidad</span><input inputMode="numeric" value={asignar.cantidad} onChange={(e) => setAsignar({ ...asignar, cantidad: e.target.value.replace(/\D/g, "") })} /></label>
          </div>
          <button className="boton primario" disabled={!asignar.autorizacionId || !asignar.cantidad} onClick={darBloque}>Asignar bloque</button>
        </div>
      </div>
      {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}
    </>
  );
}

function Configuracion() {
  const [c, setC] = useState<any>(null);
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" } | null>(null);
  useEffect(() => { api("/central/fiscal/config").then(setC); }, []);
  if (!c) return <p className="suave">Cargando…</p>;
  const guardar = async () => {
    try {
      await api("/central/fiscal/config", { metodo: "PUT", cuerpo: { direccionEmisor: c.direccionEmisor, ambiente: c.ambiente, transmisor: c.transmisor, pseUrl: c.pseUrl || null, alertaRestantes: Number(c.alertaRestantes) } });
      setMsg({ t: "Configuración guardada", tipo: "ok" });
    } catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
  };
  return (
    <div className="panel" style={{ maxWidth: 760 }}>
      <div className="dos-col">
        <label className="campo"><span>RNC emisor</span><input value={c.rnc} disabled /></label>
        <label className="campo"><span>Razón social</span><input value={c.razonSocial} disabled /></label>
      </div>
      <label className="campo"><span>Dirección del emisor (aparece en el e-CF)</span><input value={c.direccionEmisor} onChange={(e) => setC({ ...c, direccionEmisor: e.target.value })} /></label>
      <div className="dos-col">
        <label className="campo"><span>Ambiente</span>
          <select value={c.ambiente} onChange={(e) => setC({ ...c, ambiente: e.target.value, transmisor: e.target.value === "SIMULADO" ? "SIMULADO" : c.transmisor === "SIMULADO" ? "PSE" : c.transmisor })}>
            <option value="SIMULADO">Simulado (pruebas internas)</option>
            <option value="TESTECF">Pruebas DGII (TesteCF)</option>
            <option value="CERTECF">Certificación DGII (CerteCF)</option>
            <option value="ECF">Producción</option>
          </select>
        </label>
        <label className="campo"><span>Envío</span>
          <select value={c.transmisor} disabled={c.ambiente === "SIMULADO"} onChange={(e) => setC({ ...c, transmisor: e.target.value })}>
            {c.ambiente === "SIMULADO" && <option value="SIMULADO">Simulado</option>}
            <option value="PSE">Proveedor de servicios (PSE)</option>
            <option value="DGII">Directo a la DGII</option>
          </select>
        </label>
      </div>
      {c.transmisor === "PSE" && <label className="campo"><span>Dirección del API del PSE</span><input value={c.pseUrl ?? ""} onChange={(e) => setC({ ...c, pseUrl: e.target.value })} placeholder="https://api.proveedor.com" /></label>}
      <label className="campo"><span>Avisar cuando queden menos de (e-NCF)</span><input inputMode="numeric" value={c.alertaRestantes} onChange={(e) => setC({ ...c, alertaRestantes: e.target.value.replace(/\D/g, "") })} /></label>
      <button className="boton primario" onClick={guardar}>Guardar</button>
      {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}
    </div>
  );
}

// ------------------------------------------------------------ CERTIFICADO
interface DatosCertificado {
  certificado: { titular: string; emisor: string | null; numeroSerie: string | null; validoDesde: string; vence: string; huella: string; subidoEn: string; subidoPor: string | null } | null;
  sucursales: { id: string; nombre: string; tipo?: string; habilitado: boolean; estado: "CARGADO" | "PENDIENTE" | "ERROR" | "SIN_SERVIDOR" | "DESACTIVADO" | "QUITANDO"; error: string | null; revisadoEn: string | null }[];
  servidorPropio: { huella: string | null } | null;
}
const fechaLarga = (v: string) => new Date(v).toLocaleDateString("es-DO", { day: "numeric", month: "long", year: "numeric" });
const ESTADO_CERT: Record<string, { texto: string; clase: string }> = {
  CARGADO: { texto: "Cargado", clase: "recibida" },
  PENDIENTE: { texto: "Se carga en la próxima sincronización", clase: "en_transito" },
  ERROR: { texto: "No se pudo cargar", clase: "con_diferencia" },
  SIN_SERVIDOR: { texto: "Activado · falta conectar su servidor", clase: "" },
  DESACTIVADO: { texto: "Desactivado", clase: "" },
  QUITANDO: { texto: "Se retira en la próxima sincronización", clase: "en_transito" },
};

/**
 * El certificado digital (.p12) se sube una vez aquí. Se guarda cifrado y cada
 * servidor de sucursal lo baja y firma con él al vender, aunque no haya internet.
 */
function CertificadoDigital() {
  const { datos, recargar } = useDatos<DatosCertificado>("/central/fiscal/certificado");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [clave, setClave] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" } | null>(null);
  const [reemplazar, setReemplazar] = useState(false);
  const c = datos?.certificado ?? null;
  const tiendas = (datos?.sucursales ?? []).filter((s) => s.tipo !== "ALMACEN");
  const apagadas = tiendas.filter((s) => !s.habilitado);
  const cambiarUso = async (ids: string[], habilitado: boolean) => {
    setMsg(null);
    try { await api("/central/fiscal/certificado/sucursales", { metodo: "PUT", cuerpo: { sucursalIds: ids, habilitado } }); recargar(); }
    catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
  };
  const dias = c ? Math.floor((new Date(c.vence).getTime() - Date.now()) / 86400e3) : 0;
  const tono = !c ? "" : dias < 0 ? "vencido" : dias <= 30 ? "pronto" : dias <= 60 ? "atento" : "bien";

  const subir = async () => {
    if (!archivo) return;
    setEnviando(true); setMsg(null);
    try {
      const base64 = await new Promise<string>((ok, mal) => {
        const r = new FileReader();
        r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, ""));
        r.onerror = () => mal(new Error("No se pudo leer el archivo"));
        r.readAsDataURL(archivo);
      });
      const r = await api("/central/fiscal/certificado", { cuerpo: { archivo: base64, clave } });
      setMsg({ t: `Certificado de ${r.titular} guardado. Las sucursales activadas lo cargan solas en su próxima sincronización; active abajo las que deben usarlo.`, tipo: "ok" });
      setArchivo(null); setClave(""); setReemplazar(false);
      recargar();
    } catch (e) {
      setMsg({ t: (e as Error).message, tipo: "error" });
    } finally {
      setEnviando(false);
    }
  };

  const formulario = (
    <div className="cert-subir">
      <label className="campo"><span>Archivo del certificado (.p12 o .pfx)</span>
        <input type="file" accept=".p12,.pfx,application/x-pkcs12" onChange={(e) => { setArchivo(e.target.files?.[0] ?? null); setMsg(null); }} />
      </label>
      <label className="campo"><span>Contraseña del certificado</span>
        <input type="password" autoComplete="off" value={clave} onChange={(e) => setClave(e.target.value)} placeholder="La que le dio la entidad certificadora" />
      </label>
      <div className="fila-acciones">
        <button className="boton primario" disabled={!archivo || enviando} onClick={subir}>{enviando ? "Revisando…" : c ? "Reemplazar certificado" : "Subir certificado"}</button>
        {c && <button className="boton" onClick={() => { setReemplazar(false); setMsg(null); }}>Cancelar</button>}
      </div>
      <p className="suave pequeno">Se revisa la contraseña y la vigencia antes de guardarlo. Queda cifrado: nadie puede descargarlo desde aquí.</p>
    </div>
  );

  if (!datos) return null;
  return (
    <div className="cert-pagina">
      {!c ? (
        <div className="panel cert-vacio">
          <h3>Todavía no hay certificado</h3>
          <p>Mientras no lo suba, las sucursales firman con un certificado de prueba que solo sirve en el ambiente <b>Simulado</b>. Para facturar de verdad necesita el certificado digital de la empresa (.p12), emitido por una entidad autorizada por INDOTEL.</p>
          {formulario}
        </div>
      ) : (
        <div className={"panel cert-tarjeta " + tono}>
          <div className="cert-vigencia">
            <b>{dias < 0 ? "Vencido" : dias === 0 ? "Vence hoy" : `${dias} días`}</b>
            <span>{dias < 0 ? `desde el ${fechaLarga(c.vence)}` : `de vigencia · vence el ${fechaLarga(c.vence)}`}</span>
          </div>
          <div className="cert-datos">
            <h3>{c.titular}</h3>
            <dl>
              <dt>Emitido por</dt><dd>{c.emisor || "—"}</dd>
              <dt>Válido desde</dt><dd>{fechaLarga(c.validoDesde)}</dd>
              <dt>Número de serie</dt><dd className="mono-corto">{c.numeroSerie || "—"}</dd>
              <dt>Subido</dt><dd>{fechaLarga(c.subidoEn)}{c.subidoPor ? ` por ${c.subidoPor}` : ""}</dd>
            </dl>
            {dias >= 0 && dias <= 30 && <Aviso tipo="error" texto="Pida la renovación ya: cuando venza, las sucursales no podrán firmar facturas." />}
            {dias < 0 && <Aviso tipo="error" texto="Con el certificado vencido no se pueden firmar e-CF. Suba el renovado." />}
            {!reemplazar && <button className="boton" onClick={() => setReemplazar(true)}>Reemplazar por uno nuevo</button>}
          </div>
          {reemplazar && formulario}
        </div>
      )}
      {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}

      {tiendas.length > 0 && (
        <div className="panel">
          <div className="encabezado-sub">
            <h3 style={{ margin: 0 }}>Uso en cada sucursal</h3>
            {apagadas.length > 0 && <button className="boton" onClick={() => cambiarUso(apagadas.map((s) => s.id), true)}>Activar en todas</button>}
          </div>
          <p className="suave pequeno" style={{ marginTop: 6 }}>
            El certificado es de la empresa (un solo RNC). Actívelo en las sucursales que ya deben facturar ante la DGII; las desactivadas solo facturan en el ambiente Simulado.
          </p>
          {c && datos.servidorPropio && (
            <p className="suave pequeno">Este servidor: {datos.servidorPropio.huella === c.huella ? "lo tiene cargado y firma con él." : "todavía no lo usa (si tiene CERT_P12_RUTA en el .env, manda ese archivo)."}</p>
          )}
          <Tabla
            filas={tiendas}
            clave={(s) => s.id}
            vacio="No hay sucursales"
            columnas={[
              { titulo: "Sucursal", valor: (s) => s.nombre },
              { titulo: "Usar certificado", ancho: "150px", valor: (s) => (
                <label className="interruptor">
                  <input type="checkbox" checked={s.habilitado} onChange={(e) => cambiarUso([s.id], e.target.checked)} aria-label={`Usar certificado en ${s.nombre}`} />
                  <span>{s.habilitado ? "Activado" : "Desactivado"}</span>
                </label>
              ) },
              { titulo: "En su servidor", valor: (s) => s.estado === "DESACTIVADO" ? <span className="suave">—</span> : (
                <>
                  <span className={"pastilla " + ESTADO_CERT[s.estado].clase}>{s.habilitado && !c ? "Esperando que suba el certificado" : ESTADO_CERT[s.estado].texto}</span>
                  {s.error && s.habilitado && <div className="error pequeno">{s.error}</div>}
                </>
              ) },
              { titulo: "Última revisión", valor: (s) => (s.revisadoEn ? new Date(s.revisadoEn).toLocaleString("es-DO", { dateStyle: "short", timeStyle: "short" }) : "—") },
            ]}
          />
          <p className="suave pequeno">Cada servidor pregunta por el certificado al arrancar y cada 10 minutos. Lo guarda en su disco: si después se queda sin internet, sigue firmando.</p>
        </div>
      )}
    </div>
  );
}


function RangosNCF() {
  const { sucursales } = useCatalogo();
  const rangos = useDatos<any[]>("/central/fiscal/ncf/rangos");
  const [form, setForm] = useState({ sucursalId: "", tipo: "B02", desde: "", hasta: "", venceEn: "" });
  const [mensaje, setMensaje] = useState("");
  const [guardando, setGuardando] = useState(false);
  const guardar = async () => {
    setMensaje(""); setGuardando(true);
    try {
      await api("/central/fiscal/ncf/rangos", { metodo: "POST", cuerpo: {
        sucursalId: form.sucursalId, tipo: form.tipo, desde: Number(form.desde),
        hasta: Number(form.hasta), venceEn: form.venceEn,
      }});
      setMensaje("Rango registrado correctamente.");
      setForm({ ...form, desde: "", hasta: "", venceEn: "" });
      rangos.recargar();
    } catch (e) { setMensaje((e as Error).message); }
    finally { setGuardando(false); }
  };
  const cambiar = async (id: string, activo: boolean) => {
    setMensaje("");
    try { await api(`/central/fiscal/ncf/rangos/${id}`, { metodo: "PATCH", cuerpo: { activo } }); rangos.recargar(); }
    catch (e) { setMensaje((e as Error).message); }
  };
  return <>
    <h3>NCF tradicionales B01 / B02</h3>
    <p className="suave pequeno">Registre únicamente rangos autorizados por la DGII. Los rangos e-CF permanecen separados. No se permite reiniciar ni editar números consumidos.</p>
    {mensaje && <p role="status">{mensaje}</p>}
    {rangos.error && <p role="alert">{rangos.error}</p>}
    <div className="filtros">
      <label className="campo"><span>Sucursal</span><select value={form.sucursalId} onChange={e => setForm({...form,sucursalId:e.target.value})}>
        <option value="">Seleccione sucursal</option>{sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
      </select></label>
      <label className="campo"><span>Tipo</span><select value={form.tipo} onChange={e => setForm({...form,tipo:e.target.value})}><option value="B01">B01</option><option value="B02">B02</option></select></label>
      <label className="campo"><span>Desde (8 dígitos)</span><input inputMode="numeric" value={form.desde} onChange={e=>setForm({...form,desde:e.target.value.replace(/\D/g,"").slice(0,8)})}/></label>
      <label className="campo"><span>Hasta (8 dígitos)</span><input inputMode="numeric" value={form.hasta} onChange={e=>setForm({...form,hasta:e.target.value.replace(/\D/g,"").slice(0,8)})}/></label>
      <label className="campo"><span>Vence</span><input type="date" value={form.venceEn} onChange={e=>setForm({...form,venceEn:e.target.value})}/></label>
      <button className="boton" disabled={guardando || !form.sucursalId || !form.desde || !form.hasta || !form.venceEn || Number(form.hasta)<Number(form.desde)} onClick={guardar}>Registrar rango</button>
    </div>
    <Tabla filas={rangos.datos ?? []} clave={r=>r.id} vacio="No hay rangos NCF registrados" columnas={[
      {titulo:"Sucursal",valor:r=>r.sucursal}, {titulo:"Tipo",valor:r=>r.tipo},
      {titulo:"Desde",valor:r=>`${r.tipo}${String(r.desde).padStart(8,"0")}`},
      {titulo:"Hasta",valor:r=>`${r.tipo}${String(r.hasta).padStart(8,"0")}`},
      {titulo:"Próximo",valor:r=>Number(r.siguiente)>Number(r.hasta)?"Agotado":`${r.tipo}${String(r.siguiente).padStart(8,"0")}`},
      {titulo:"Restantes",valor:r=>num(r.restantes)},
      {titulo:"Vence",valor:r=>String(r.venceEn).slice(0,10)},
      {titulo:"Estado",valor:r=>r.activo?(r.vigente?"Vigente":"Vencido o agotado"):"Desactivado"},
      {titulo:"Acción",valor:r=><button className="enlace" onClick={()=>cambiar(r.id,!r.activo)}>{r.activo?"Desactivar":"Activar"}</button>},
    ]}/>
  </>;
}

function RangosNcf() {
  const { sucursales } = useCatalogo();
  const rangos = useDatos<any[]>("/central/fiscal/ncf/rangos");
  const [nuevo, setNuevo] = useState({ sucursalId: "", tipo: "B02", desde: "", hasta: "", venceEn: "" });
  const [mensaje, setMensaje] = useState<{ texto: string; tipo: "ok" | "error" } | null>(null);
  const guardar = async () => {
    try {
      if (!nuevo.sucursalId) throw new Error("Seleccione una sucursal");
      if (!nuevo.desde || !nuevo.hasta || !nuevo.venceEn) throw new Error("Complete el rango y su vencimiento");
      await api("/central/fiscal/ncf/rangos", { cuerpo: { ...nuevo, desde: Number(nuevo.desde), hasta: Number(nuevo.hasta) } });
      setMensaje({ texto: "Rango registrado correctamente", tipo: "ok" });
      setNuevo({ ...nuevo, desde: "", hasta: "" });
      rangos.recargar();
    } catch (e) { setMensaje({ texto: (e as Error).message, tipo: "error" }); }
  };
  const cambiar = async (id: string, activo: boolean) => {
    try {
      await api(`/central/fiscal/ncf/rangos/${id}/estado`, { metodo: "PATCH", cuerpo: { activo } });
      rangos.recargar();
    } catch (e) { setMensaje({ texto: (e as Error).message, tipo: "error" }); }
  };
  return <>
    <h3>Secuencias fiscales B01 / B02</h3>
    <p className="suave">Registre únicamente rangos autorizados por la DGII. El sistema asigna los números al confirmar ventas; no modifique manualmente el siguiente consecutivo.</p>
    {mensaje && <Aviso texto={mensaje.texto} tipo={mensaje.tipo} />}
    <div className="filtros">
      <select value={nuevo.sucursalId} onChange={e => setNuevo({ ...nuevo, sucursalId: e.target.value })}>
        <option value="">Seleccione sucursal</option>
        {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
      </select>
      <select value={nuevo.tipo} onChange={e => setNuevo({ ...nuevo, tipo: e.target.value })}>
        <option value="B01">B01 - Crédito fiscal</option><option value="B02">B02 - Consumo</option>
      </select>
      <input aria-label="Desde" placeholder="Desde (8 dígitos)" inputMode="numeric" value={nuevo.desde} onChange={e => setNuevo({ ...nuevo, desde: e.target.value })} />
      <input aria-label="Hasta" placeholder="Hasta (8 dígitos)" inputMode="numeric" value={nuevo.hasta} onChange={e => setNuevo({ ...nuevo, hasta: e.target.value })} />
      <input aria-label="Vencimiento" type="date" value={nuevo.venceEn} onChange={e => setNuevo({ ...nuevo, venceEn: e.target.value })} />
      <button className="boton" onClick={guardar}>Registrar rango</button>
    </div>
    <Tabla filas={rangos.datos ?? []} clave={r => r.id} vacio="No hay rangos NCF registrados" columnas={[
      { titulo: "Sucursal", valor: r => r.sucursal },
      { titulo: "Tipo", valor: r => r.tipo },
      { titulo: "Desde", valor: r => `${r.tipo}${String(r.desde).padStart(8, "0")}` },
      { titulo: "Hasta", valor: r => `${r.tipo}${String(r.hasta).padStart(8, "0")}` },
      { titulo: "Siguiente", valor: r => `${r.tipo}${String(r.siguiente).padStart(8, "0")}` },
      { titulo: "Disponibles", valor: r => num(r.disponibles) },
      { titulo: "Vence", valor: r => r.venceEn },
      { titulo: "Estado", valor: r => r.activo ? "Activo" : "Inactivo" },
      { titulo: "Acción", valor: r => <button className="enlace" onClick={() => cambiar(r.id, !r.activo)}>{r.activo ? "Desactivar" : "Activar"}</button> },
    ]} />
  </>;
}
