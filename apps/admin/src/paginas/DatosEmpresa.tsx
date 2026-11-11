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
        {d.rncBloqueado && <p className="suave" style={{ marginTop: 8 }}>El RNC no se puede cambiar porque la empresa ya tiene comprobantes electrónicos o un certificado cargado. Si hay un error, escriba a soporte.</p>}
        <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center" }}>
          <button className="boton primario" onClick={guardar} disabled={guardando}>{guardando ? "Guardando…" : "Guardar"}</button>
          {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}
        </div>
      </div>
      <TipoNegocio />
    </>
  );
}

const TIPOS: [string, string][] = [
  ["TIENDA", "Tienda, colmado o licorería (venta directa en caja)"],
  ["RESTAURANTE", "Restaurante"],
  ["BAR", "Bar"],
  ["DISCOTECA", "Discoteca"],
  ["COMIDA_RAPIDA", "Comida rápida"],
];

/** Con un tipo distinto de «Tienda» las cajas muestran Cuentas: mesas o clientes con varias personas, que se dividen antes o después de ordenar. */
function TipoNegocio() {
  const [tipo, setTipo] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" } | null>(null);
  useEffect(() => { api<{ tipoNegocio: string }>("/central/empresa/tipo-negocio").then((r) => setTipo(r.tipoNegocio)).catch(() => setTipo("TIENDA")); }, []);
  if (tipo === null) return null;
  const guardar = async (nuevo: string) => {
    setMsg(null);
    try { await api("/central/empresa/tipo-negocio", { metodo: "PUT", cuerpo: { tipoNegocio: nuevo } }); setTipo(nuevo); setMsg({ t: nuevo === "TIENDA" ? "Listo: las cajas siguen como siempre." : "Guardado. En unos segundos las cajas mostrarán el botón Cuentas (al recargar la pantalla de venta).", tipo: "ok" }); }
    catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
  };
  return (
    <div className="tarjeta" style={{ maxWidth: 860, marginTop: 14 }}>
      <h3 style={{ marginTop: 0 }}>Tipo de negocio</h3>
      <p className="suave">«Tienda» deja todo como está. Los demás activan <b>Cuentas</b> en la caja: mesas o clientes con varias personas, para dividir la cuenta antes o después de ordenar.</p>
      <select value={tipo} onChange={(e) => void guardar(e.target.value)}>
        {TIPOS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
      </select>
      {msg && <div style={{ marginTop: 8 }}><Aviso texto={msg.t} tipo={msg.tipo} /></div>}
    </div>
  );
}
