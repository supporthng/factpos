import { useEffect, useRef, useState } from "react";
import { rncValido, cedulaValida, formatoDocumento } from "@factpos/compartido";
import { api, rd, type Ajustes } from "./api";
import type { Usuario } from "./App";
import { Modal, type Cliente } from "./Venta";
import { PinSupervisor } from "./Operaciones";
import { AbonoCliente } from "./Caja";
import type { ConfigCaja } from "./App";

/**
 * Clientes en la caja (F4): buscar, crear y cambiar el nivel de precio.
 * - Un cliente creado en la caja siempre entra con Precio 1.
 * - Para pasarlo a Precio 2 o 3 hace falta el PIN de un supervisor.
 */
export function ClientesCaja({ ajustes, usuario, config, onElegir, onCerrar }: {
  ajustes: Ajustes; usuario: Usuario; config?: ConfigCaja; onElegir: (c: Cliente) => void; onCerrar: () => void;
}) {
  const [vista, setVista] = useState<"buscar" | "nuevo" | { precio: Cliente } | { abono: Cliente }>("buscar");
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Cliente[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) return setRes([]);
    const t = setTimeout(() => {
      api<Cliente[]>(ajustes.servidor, `/cajas/${ajustes.cajaId}/clientes?q=${encodeURIComponent(q.trim())}`).then(setRes).catch(() => setRes([]));
    }, 150);
    return () => clearTimeout(t);
  }, [q, ajustes]);

  if (vista === "nuevo") return <NuevoCliente ajustes={ajustes} usuario={usuario} inicial={q} onCreado={onElegir} onVolver={() => setVista("buscar")} onCerrar={onCerrar} />;
  if (typeof vista === "object" && "abono" in vista) return <AbonoCliente ajustes={ajustes} config={config} cliente={vista.abono} onVolver={() => setVista("buscar")} onCerrar={onCerrar} />;
  if (typeof vista === "object") return <CambiarPrecio ajustes={ajustes} usuario={usuario} cliente={vista.precio} onListo={onElegir} onVolver={() => setVista("buscar")} onCerrar={onCerrar} />;

  return (
    <Modal titulo="Cliente" onCerrar={onCerrar}>
      <div className="buscar-cliente">
        <input autoFocus className="entrada-grande" value={q} placeholder="Nombre, teléfono, cédula o RNC"
          onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && res[0] && onElegir(res[0])} />
        <button className="boton" onClick={() => setVista("nuevo")}>+ Nuevo cliente</button>
      </div>
      <div className="resultados">
        {res.map((c) => (
          <div key={c.id} className="resultado-cliente">
            <button className="resultado" onClick={() => onElegir(c)}>
              <span><b>{c.nombre}</b> <span className="suave">{c.documento ?? ""} {c.telefono ?? ""}</span></span>
              <span className="suave">{Number(c.saldo) > 0 ? `debe ${rd(c.saldo)}` : ""}</span>
            </button>
            {Number(c.saldo) > 0 && <button className="boton chico" onClick={() => setVista({ abono: c })}>Cobrar abono</button>}
            <span className={"nivel-precio n" + (c.nivel ?? 1)}>Precio {c.nivel ?? 1}</span>
            <button className="boton fantasma chico" onClick={() => setVista({ precio: c })} title="Requiere PIN de supervisor">Cambiar precio</button>
          </div>
        ))}
        {q.trim().length >= 2 && !res.length && (
          <div className="sin-resultados">
            <span className="suave">No hay clientes con “{q}”.</span>
            <button className="boton primario" onClick={() => setVista("nuevo")}>Crear cliente</button>
          </div>
        )}
      </div>
    </Modal>
  );
}

/**
 * Cliente nuevo. Lo normal es que lo pida para factura con comprobante fiscal
 * (crédito fiscal, E31): entonces el RNC o la cédula son obligatorios y se
 * revisa el dígito verificador. Sin comprobante, el documento es opcional.
 */
function NuevoCliente({ ajustes, usuario, inicial, onCreado, onVolver, onCerrar }: {
  ajustes: Ajustes; usuario: Usuario; inicial: string; onCreado: (c: Cliente) => void; onVolver: () => void; onCerrar: () => void;
}) {
  // Si lo que se buscó parece un documento, se usa como documento; si no, como nombre
  const soloDigitos = inicial.replace(/\D/g, "");
  const esDoc = soloDigitos.length >= 9;
  const [comprobante, setComprobante] = useState(true);
  const [c, setC] = useState({
    nombre: esDoc ? "" : inicial,
    tipoDocumento: soloDigitos.length === 11 ? "CEDULA" : "RNC" as string,
    documento: esDoc ? soloDigitos : "",
    telefono: "",
  });
  const [confirmado, setConfirmado] = useState(false);
  const [msg, setMsg] = useState("");
  const [enviando, setEnviando] = useState(false);
  const numerico = c.tipoDocumento === "RNC" || c.tipoDocumento === "CEDULA";
  const d = numerico ? c.documento.replace(/\D/g, "") : c.documento.trim().toUpperCase();
  const largo = c.tipoDocumento === "RNC" ? 9 : c.tipoDocumento === "CEDULA" ? 11 : 20;
  const completo = numerico ? d.length === largo : d.length >= 5;
  const verificado = numerico && completo && (c.tipoDocumento === "RNC" ? rncValido(d) : cedulaValida(d));
  // El RNC tiene que ser válido; una cédula con verificador raro se acepta si el cajero la confirma
  const docOk = c.tipoDocumento === "NINGUNO"
    || (!numerico && completo)
    || verificado || (completo && c.tipoDocumento === "CEDULA" && confirmado)
    || (!comprobante && !d);   // sin comprobante, el documento puede quedar en blanco
  const valido = c.nombre.trim().length >= 3 && docOk && (!comprobante || numerico);

  // Padrón de la DGII: con el RNC o la cédula completos, se busca el nombre (en el servidor local, sin internet)
  const [padron, setPadron] = useState<{ estado: "buscando" | "no" | "si"; nombre?: string; comercial?: string | null; situacion?: string | null } | null>(null);
  const autollenado = useRef("");
  useEffect(() => {
    setPadron(null);
    if (!numerico || !completo) return;
    let vigente = true;
    setPadron({ estado: "buscando" });
    api<{ encontrado: { nombre: string; nombreComercial: string | null; estado: string | null } | null }>(ajustes.servidor, `/cajas/${ajustes.cajaId}/rnc/${d}`)
      .then((r) => {
        if (!vigente) return;
        if (!r.encontrado) return setPadron({ estado: "no" });
        setPadron({ estado: "si", nombre: r.encontrado.nombre, comercial: r.encontrado.nombreComercial, situacion: r.encontrado.estado });
        // Solo se reemplaza el nombre si está vacío o lo había puesto el padrón
        const previo = autollenado.current;
        setC((x) => (!x.nombre.trim() || x.nombre === previo ? { ...x, nombre: r.encontrado!.nombre } : x));
        autollenado.current = r.encontrado.nombre;
      })
      .catch(() => vigente && setPadron(null));
    return () => { vigente = false; };
  }, [d, numerico, completo, ajustes]); // eslint-disable-line react-hooks/exhaustive-deps

  const crear = async () => {
    if (!valido || enviando) return;
    setEnviando(true);
    setMsg("");
    try {
      const r = await api<Cliente>(ajustes.servidor, `/cajas/${ajustes.cajaId}/clientes`, {
        cuerpo: {
          usuarioId: usuario.id, nombre: c.nombre.trim(), paraComprobante: comprobante,
          tipoDocumento: d || c.tipoDocumento === "NINGUNO" ? c.tipoDocumento : "NINGUNO", documento: d || null,
          telefono: c.telefono || null, confirmarDocumento: confirmado,
        },
      });
      onCreado({ ...r, nuevoParaFiscal: comprobante } as Cliente);
    } catch (e) {
      setMsg((e as Error).message);
      setEnviando(false);
    }
  };

  return (
    <Modal titulo="Nuevo cliente" onCerrar={onCerrar}>
      <form onSubmit={(e) => { e.preventDefault(); crear(); }}>
        <label className={"interruptor-comprobante" + (comprobante ? " activo" : "")}>
          <input type="checkbox" checked={comprobante} onChange={(e) => {
            setComprobante(e.target.checked);
            if (e.target.checked && !["RNC", "CEDULA"].includes(c.tipoDocumento)) setC({ ...c, tipoDocumento: "RNC", documento: "" });
          }} />
          <span><b>Factura con comprobante fiscal</b><small>{comprobante ? "RNC o cédula obligatorio · la factura sale de crédito fiscal" : "Factura de consumo · el documento es opcional"}</small></span>
        </label>
        <div className={"tipo-doc" + (comprobante ? "" : " cuatro")}>
          {(comprobante ? ["RNC", "CEDULA"] : ["CEDULA", "RNC", "PASAPORTE", "NINGUNO"]).map((t) => (
            <button type="button" key={t} className={c.tipoDocumento === t ? "activo" : ""} onClick={() => { setC({ ...c, tipoDocumento: t, documento: t === "NINGUNO" ? "" : c.documento }); setConfirmado(false); }}>
              {({ RNC: comprobante ? "RNC (empresa)" : "RNC", CEDULA: comprobante ? "Cédula (persona)" : "Cédula", PASAPORTE: "Pasaporte", NINGUNO: "Sin documento" } as Record<string, string>)[t]}
            </button>
          ))}
        </div>
        {c.tipoDocumento !== "NINGUNO" && <label className="campo"><span>{c.tipoDocumento === "RNC" ? "RNC · 9 dígitos" : c.tipoDocumento === "CEDULA" ? "Cédula · 11 dígitos" : "Pasaporte"}{!comprobante && " (opcional)"}</span>
          <div className="doc-con-estado">
            <input autoFocus={esDoc ? false : undefined} className="entrada-grande" inputMode={numerico ? "numeric" : "text"} value={numerico ? formatoDocumento(c.tipoDocumento, c.documento) : c.documento}
              onChange={(e) => { setC({ ...c, documento: numerico ? e.target.value.replace(/\D/g, "").slice(0, largo) : e.target.value.slice(0, 20) }); setConfirmado(false); }} />
            {numerico && completo && <span className={"estado-doc " + (verificado ? "ok" : "mal")}>{verificado ? "✓ Válido" : "✗ No coincide"}</span>}
          </div>
        </label>}
        {numerico && completo && !verificado && (c.tipoDocumento === "RNC"
          ? <p className="error">El último dígito no coincide con el verificador de la DGII. Revise el RNC: así la DGII rechazaría la factura.</p>
          : <label className="check confirmar-doc"><input type="checkbox" checked={confirmado} onChange={(e) => setConfirmado(e.target.checked)} />
              El último dígito no coincide. Lo revisé con la cédula y está bien escrito.</label>)}
        {padron?.estado === "si" && (
          <p className={"padron-dgii " + (padron.situacion && padron.situacion !== "ACTIVO" ? "inactivo" : "")}>
            {padron.situacion && padron.situacion !== "ACTIVO"
              ? <>Según la DGII este contribuyente está <b>{padron.situacion}</b>{comprobante ? ": la DGII podría rechazar la factura de crédito fiscal." : "."}</>
              : <>Encontrado en el padrón de la DGII{padron.comercial ? ` · ${padron.comercial}` : ""}</>}
          </p>
        )}
        {padron?.estado === "no" && <p className="padron-dgii no">No está en el padrón de la DGII: escriba el nombre.</p>}
        <label className="campo"><span>{c.tipoDocumento === "RNC" ? "Razón social" : "Nombre completo"}</span>
          <input autoFocus={esDoc} className="entrada-media" value={c.nombre} onChange={(e) => setC({ ...c, nombre: e.target.value })} /></label>
        <label className="campo"><span>Teléfono (opcional)</span><input className="entrada-media" inputMode="tel" value={c.telefono} onChange={(e) => setC({ ...c, telefono: e.target.value })} /></label>
        <p className="nota-precio">{comprobante && <>La factura saldrá con <b>comprobante de crédito fiscal</b>. </>}El cliente entra con <b>Precio 1</b>; para Precio 2 o 3 se necesita el PIN de un supervisor.</p>
        {msg && <p className="error">{msg}</p>}
        <div className="dos-columnas">
          <button type="button" className="boton fantasma" onClick={onVolver}>Volver</button>
          <button className="boton primario" disabled={!valido || enviando}>{enviando ? "Creando…" : "Crear y usar"}</button>
        </div>
      </form>
    </Modal>
  );
}

function CambiarPrecio({ ajustes, usuario, cliente, onListo, onVolver, onCerrar }: {
  ajustes: Ajustes; usuario: Usuario; cliente: Cliente; onListo: (c: Cliente) => void; onVolver: () => void; onCerrar: () => void;
}) {
  const actual = cliente.nivel ?? 1;
  const [nivel, setNivel] = useState(actual === 1 ? 2 : 1);
  const [msg, setMsg] = useState("");
  const NOMBRES = ["", "Precio 1 · Detalle", "Precio 2 · Mayorista", "Precio 3 · Distribuidor"];
  return (
    <Modal titulo="Cambiar precio del cliente" onCerrar={onCerrar}>
      <p><b>{cliente.nombre}</b> <span className="suave">· hoy tiene {NOMBRES[actual]}</span></p>
      <div className="selector-nivel">
        {[1, 2, 3].map((n) => (
          <button key={n} className={nivel === n ? "activo" : ""} disabled={n === actual} onClick={() => setNivel(n)}>{NOMBRES[n]}</button>
        ))}
      </div>
      {msg && <p className="error">{msg}</p>}
      <PinSupervisor ajustes={ajustes} permiso="cliente.precio" textoBoton={`Aprobar ${NOMBRES[nivel].split(" · ")[0]}`}
        onAprobado={async (a) => {
          try {
            const r = await api<Cliente>(ajustes.servidor, `/cajas/${ajustes.cajaId}/clientes/${cliente.id}/precio`, {
              metodo: "PUT", cuerpo: { usuarioId: usuario.id, nivel, autorizacion: a.token },
            });
            onListo(r);
          } catch (e) { setMsg((e as Error).message); }
        }} />
      <button className="enlace" onClick={onVolver}>Volver a la búsqueda</button>
    </Modal>
  );
}
