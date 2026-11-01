import { useState } from "react";
import { api, puede, rd } from "../api";
import { Aviso, Encabezado, Tabla, useDatos } from "../ui";

/**
 * Clientes de la tienda. Al crear uno hay que elegir su nivel de precio (1, 2 o 3).
 * Desde la caja los clientes nacen con el precio 1 (el cajero no decide el precio).
 */
interface Cliente {
  id: string; nombre: string; tipoDocumento: "RNC" | "CEDULA" | "PASAPORTE" | "NINGUNO"; documento: string | null; telefono: string | null;
  correo: string | null; direccion: string | null; nivel: number | null; limiteCredito: string; activo: boolean;
}
const NIVELES = [
  { n: 1, t: "Precio 1 · normal" },
  { n: 2, t: "Precio 2" },
  { n: 3, t: "Precio 3" },
];

export function Clientes() {
  const [q, setQ] = useState("");
  const [nivel, setNivel] = useState("");
  const [inactivos, setInactivos] = useState(false);
  const [editar, setEditar] = useState<Cliente | "nuevo" | null>(null);
  const [recarga, setRecarga] = useState(0);
  const lista = useDatos<Cliente[]>(
    `/central/clientes?${new URLSearchParams({ ...(q.trim().length >= 2 ? { q: q.trim() } : {}), ...(nivel ? { nivel } : {}), ...(inactivos ? { inactivos: "1" } : {}) })}`, [recarga]);
  const edita = puede("admin.clientes");

  return (
    <>
      <Encabezado titulo="Clientes" descripcion="Clientes de la tienda y el nivel de precio que se les cobra.">
        {edita && <button className="boton primario" onClick={() => setEditar("nuevo")}>Nuevo cliente</button>}
      </Encabezado>
      <div className="fila-acciones" style={{ marginBottom: 12 }}>
        <input placeholder="Buscar por nombre, documento o teléfono" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 320 }} />
        <select value={nivel} onChange={(e) => setNivel(e.target.value)}>
          <option value="">Todos los niveles</option>
          {NIVELES.map((x) => <option key={x.n} value={x.n}>{x.t}</option>)}
        </select>
        <label className="interruptor"><input type="checkbox" checked={inactivos} onChange={(e) => setInactivos(e.target.checked)} /><span>Mostrar inactivos</span></label>
      </div>
      {lista.error && <Aviso texto={lista.error} />}
      <Tabla
        filas={lista.datos ?? []}
        clave={(f) => f.id}
        vacio="No hay clientes con esos filtros"
        columnas={[
          { titulo: "Cliente", valor: (f) => (edita ? <button className="enlace" onClick={() => setEditar(f)}><b>{f.nombre}</b></button> : <b>{f.nombre}</b>) },
          { titulo: "Documento", valor: (f) => (f.documento ? `${f.tipoDocumento} ${f.documento}` : <span className="suave">—</span>) },
          { titulo: "Teléfono", valor: (f) => f.telefono ?? <span className="suave">—</span> },
          { titulo: "Nivel de precio", valor: (f) => <span className={f.nivel && f.nivel > 1 ? "texto-ok" : "suave"}>{f.nivel ? `Precio ${f.nivel}` : "Precio 1"}</span> },
          { titulo: "Límite de crédito", valor: (f) => (Number(f.limiteCredito) ? rd(f.limiteCredito) : <span className="suave">—</span>), der: true },
          { titulo: "Estado", valor: (f) => (f.activo ? "Activo" : <span className="suave">Inactivo</span>) },
        ]}
      />
      {editar && <FormCliente cliente={editar === "nuevo" ? null : editar} onCerrar={() => setEditar(null)} onListo={() => { setEditar(null); setRecarga((x) => x + 1); }} />}
    </>
  );
}

function FormCliente({ cliente, onCerrar, onListo }: { cliente: Cliente | null; onCerrar: () => void; onListo: () => void }) {
  const [f, setF] = useState({
    nombre: cliente?.nombre ?? "", tipoDocumento: cliente?.tipoDocumento ?? "NINGUNO", documento: cliente?.documento ?? "", telefono: cliente?.telefono ?? "",
    correo: cliente?.correo ?? "", direccion: cliente?.direccion ?? "", limiteCredito: cliente?.limiteCredito && Number(cliente.limiteCredito) ? cliente.limiteCredito : "",
    activo: cliente?.activo ?? true,
    // Cliente nuevo: sin nivel elegido; hay que escogerlo
    nivel: cliente ? String(cliente.nivel ?? 1) : "",
  });
  const [msg, setMsg] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [confirmarDocumento, setConfirmarDocumento] = useState(false);

  const guardar = async () => {
    if (f.nombre.trim().length < 3) return setMsg("Escriba el nombre o la razón social.");
    if (!f.nivel) return setMsg("Elija el nivel de precio del cliente: es obligatorio.");
    setGuardando(true); setMsg(null);
    try {
      const cuerpo = {
        nombre: f.nombre.trim(), tipoDocumento: f.tipoDocumento, documento: f.tipoDocumento === "NINGUNO" ? null : f.documento.trim() || null,
        telefono: f.telefono.trim() || null, correo: f.correo.trim() || null, direccion: f.direccion.trim() || null,
        nivel: Number(f.nivel), limiteCredito: f.limiteCredito.trim() || "0", confirmarDocumento,
        ...(cliente ? { activo: f.activo } : {}),
      };
      await api(cliente ? `/central/clientes/${cliente.id}` : "/central/clientes", { metodo: cliente ? "PUT" : "POST", cuerpo });
      onListo();
    } catch (e) {
      const t = (e as Error).message;
      if (/no coincide/i.test(t) && /cédula/i.test(t)) setConfirmarDocumento(true);
      setMsg(t);
    } finally { setGuardando(false); }
  };

  return (
    <div className="fondo-modal" onMouseDown={onCerrar}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <h2 style={{ marginTop: 0 }}>{cliente ? "Editar cliente" : "Nuevo cliente"}</h2>
        <label className="campo"><span>Nombre o razón social</span><input autoFocus value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></label>
        <div className="dos-col">
          <label className="campo"><span>Documento</span>
            <select value={f.tipoDocumento} onChange={(e) => setF({ ...f, tipoDocumento: e.target.value as Cliente["tipoDocumento"] })}>
              <option value="NINGUNO">Sin documento</option><option value="RNC">RNC</option><option value="CEDULA">Cédula</option><option value="PASAPORTE">Pasaporte</option>
            </select></label>
          <label className="campo"><span>Número</span><input disabled={f.tipoDocumento === "NINGUNO"} value={f.documento} onChange={(e) => { setConfirmarDocumento(false); setF({ ...f, documento: e.target.value }); }} /></label>
        </div>
        <div className="dos-col">
          <label className="campo"><span>Teléfono</span><input value={f.telefono} onChange={(e) => setF({ ...f, telefono: e.target.value })} /></label>
          <label className="campo"><span>Correo</span><input type="email" value={f.correo} onChange={(e) => setF({ ...f, correo: e.target.value })} /></label>
        </div>
        <label className="campo"><span>Dirección</span><input value={f.direccion} onChange={(e) => setF({ ...f, direccion: e.target.value })} /></label>
        <div className="dos-col">
          <label className="campo"><span>Nivel de precio <b className="texto-alerta">*</b></span>
            <select value={f.nivel} onChange={(e) => setF({ ...f, nivel: e.target.value })} aria-required="true">
              {!cliente && <option value="">Elija el nivel…</option>}
              {NIVELES.map((x) => <option key={x.n} value={x.n}>{x.t}</option>)}
            </select></label>
          <label className="campo"><span>Límite de crédito (RD$)</span><input className="numero" inputMode="decimal" value={f.limiteCredito} placeholder="0.00" onChange={(e) => setF({ ...f, limiteCredito: e.target.value.replace(/[^\d.]/g, "") })} /></label>
        </div>
        {cliente && <label className="interruptor"><input type="checkbox" checked={f.activo} onChange={(e) => setF({ ...f, activo: e.target.checked })} /><span>Cliente activo</span></label>}
        {msg && <Aviso texto={msg} />}
        {confirmarDocumento && <p className="suave pequeno">Si la cédula está bien escrita, pulse Guardar de nuevo para confirmarla.</p>}
        <div className="acciones-modal">
          <button className="boton" onClick={onCerrar}>Cancelar</button>
          <button className="boton primario" disabled={guardando} onClick={guardar}>{guardando ? "Guardando…" : "Guardar"}</button>
        </div>
      </div>
    </div>
  );
}
