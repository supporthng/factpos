import { useEffect, useState } from "react";
import { rncValido, cedulaValida } from "@factpos/compartido";
import { api, type Ajustes } from "./api";
import type { Usuario } from "./App";
import type { Cliente } from "./Venta";

/** Tipos de comprobante que se pueden elegir en la caja. */
export type TipoComprobante = "E32" | "E31" | "B02" | "B01" | "B14" | "B15" | "B16" | "SIN";
export type FamiliaComprobante = "ECF" | "NCF" | "SIN";

/** Tres familias, cada una con su prefijo para los reportes: E (electrónico), B (NCF serie B) y FI- (sin comprobante). */
export const FAMILIAS: { id: FamiliaComprobante; titulo: string; prefijo: string; detalle: string; tipos: { id: TipoComprobante; titulo: string; detalle: string }[] }[] = [
  { id: "ECF", titulo: "e-CF electrónico", prefijo: "E", detalle: "Comprobante fiscal electrónico (DGII)", tipos: [
    { id: "E32", titulo: "Consumo", detalle: "E32 · consumidor final" },
    { id: "E31", titulo: "Crédito fiscal", detalle: "E31 · con RNC o cédula" },
  ] },
  { id: "NCF", titulo: "NCF serie B", prefijo: "B", detalle: "Comprobante fiscal tradicional", tipos: [
    { id: "B02", titulo: "Consumo", detalle: "B02 · consumidor final" },
    { id: "B01", titulo: "Crédito fiscal", detalle: "B01 · con RNC o cédula" },
    { id: "B14", titulo: "Régimen especial", detalle: "B14 · con RNC" },
    { id: "B15", titulo: "Gubernamental", detalle: "B15 · con RNC" },
    { id: "B16", titulo: "Exportación", detalle: "B16 · cliente del exterior" },
  ] },
  { id: "SIN", titulo: "Sin comprobante", prefijo: "FI-", detalle: "Factura interna, sin valor fiscal", tipos: [] },
];

export const familiaDe = (t: TipoComprobante): FamiliaComprobante => (t.startsWith("E") ? "ECF" : t.startsWith("B") ? "NCF" : "SIN");
export const requiereDocumento = (t: TipoComprobante) => ["E31", "B01", "B14", "B15"].includes(t);
export const tieneDocumentoFiscal = (c: Cliente | null) => !!c && ["RNC", "CEDULA"].includes(c.tipoDocumento) && !!c.documento;

/** Primero la familia (e-CF · NCF · Sin comprobante) y, debajo, el tipo dentro de ella. */
export function SelectorComprobante({ tipo, onTipo, soloConsumo = false, compacto = false }: {
  tipo: TipoComprobante; onTipo: (t: TipoComprobante) => void; soloConsumo?: boolean; compacto?: boolean;
}) {
  const fam = familiaDe(tipo);
  const actual = FAMILIAS.find((f) => f.id === fam)!;
  const elegirFamilia = (f: (typeof FAMILIAS)[number]) => {
    if (f.id === fam) return;
    onTipo(f.id === "SIN" ? "SIN" : f.tipos[0].id);
  };
  return (
    <div className={"comprobantes-grupo" + (compacto ? " compacto" : "")}>
      <div className={"comprobantes" + (compacto ? " compacto" : "")} role="radiogroup" aria-label="Familia de comprobante">
        {FAMILIAS.map((f) => (
          <button key={f.id} role="radio" aria-checked={fam === f.id} className={"comprobante" + (fam === f.id ? " activo" : "")}
            disabled={soloConsumo && f.id !== "ECF"} onClick={() => elegirFamilia(f)} title={f.detalle}>
            <b>{f.titulo} <span className="prefijo">{f.prefijo}</span></b>{!compacto && <small>{f.detalle}</small>}
          </button>
        ))}
      </div>
      {actual.tipos.length > 0 && (
        <div className={"comprobantes subtipos" + (compacto ? " compacto" : "")} role="radiogroup" aria-label="Tipo de comprobante">
          {actual.tipos.map((t) => (
            <button key={t.id} role="radio" aria-checked={tipo === t.id} className={"comprobante" + (tipo === t.id ? " activo" : "")}
              disabled={soloConsumo && t.id !== "E32"} onClick={() => onTipo(t.id)} title={t.detalle}>
              <b>{t.titulo}</b>{!compacto && <small>{t.detalle}</small>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Para crédito fiscal sin cliente con RNC: se escribe el RNC o la cédula y se busca primero entre los clientes;
 * si no está, se consulta el padrón de la DGII y, con un toque, se crea el cliente con su nombre oficial.
 */
export function ClienteFiscalRapido({ ajustes, usuario, onCliente, onManual }: {
  ajustes: Ajustes; usuario: Usuario; onCliente: (c: Cliente) => void; onManual: () => void;
}) {
  const [doc, setDoc] = useState("");
  const d = doc.replace(/\D/g, "");
  const completo = d.length === 9 || d.length === 11;
  const valido = d.length === 9 ? rncValido(d) : d.length === 11 ? cedulaValida(d) : false;
  const [r, setR] = useState<{ estado: "buscando" | "dgii" | "no" | "invalido" | "error"; nombre?: string; situacion?: string | null } | null>(null);
  const [msg, setMsg] = useState("");
  const [creando, setCreando] = useState(false);

  useEffect(() => {
    setR(null); setMsg("");
    if (!completo) return;
    if (!valido) return setR({ estado: "invalido" });
    let vigente = true;
    setR({ estado: "buscando" });
    (async () => {
      try {
        // 1) ¿Ya es cliente?
        const hay = await api<Cliente[]>(ajustes.servidor, `/cajas/${ajustes.cajaId}/clientes?q=${d}`);
        const existente = hay.find((c) => (c.documento ?? "").replace(/\D/g, "") === d);
        if (!vigente) return;
        if (existente) return onCliente(existente);
        // 2) Padrón de la DGII
        const p = await api<{ encontrado: { nombre: string; estado: string | null } | null }>(ajustes.servidor, `/cajas/${ajustes.cajaId}/rnc/${d}`);
        if (!vigente) return;
        setR(p.encontrado ? { estado: "dgii", nombre: p.encontrado.nombre, situacion: p.encontrado.estado } : { estado: "no" });
      } catch { if (vigente) setR({ estado: "error" }); }
    })();
    return () => { vigente = false; };
  }, [d]); // eslint-disable-line react-hooks/exhaustive-deps

  const crear = async () => {
    if (!r?.nombre) return;
    setCreando(true); setMsg("");
    try {
      const c = await api<Cliente>(ajustes.servidor, `/cajas/${ajustes.cajaId}/clientes`, {
        cuerpo: { usuarioId: usuario.id, nombre: r.nombre, paraComprobante: true, tipoDocumento: d.length === 9 ? "RNC" : "CEDULA", documento: d, telefono: null, confirmarDocumento: false },
      });
      onCliente({ ...c, nuevoParaFiscal: true } as Cliente);
    } catch (e) { setMsg((e as Error).message); setCreando(false); }
  };

  return (
    <div className="cliente-fiscal">
      <b>Crédito fiscal: ¿a nombre de quién?</b>
      <div className="cliente-fiscal-fila">
        <input autoFocus className="entrada-grande" inputMode="numeric" placeholder="RNC (9 dígitos) o cédula (11)" value={doc} maxLength={14}
          onChange={(e) => setDoc(e.target.value.replace(/[^\d-]/g, ""))} />
        <button className="boton" onClick={onManual}>Buscar cliente por nombre</button>
      </div>
      {r?.estado === "buscando" && <p className="suave">Buscando en clientes y en la DGII…</p>}
      {r?.estado === "invalido" && <p className="error">Ese {d.length === 9 ? "RNC" : "número de cédula"} no es válido: revise los dígitos.</p>}
      {r?.estado === "dgii" && (
        <div className="cliente-fiscal-hallado">
          <span><b>{r.nombre}</b><br /><small className="suave">Padrón de la DGII{r.situacion ? ` · ${r.situacion}` : ""}</small></span>
          <button className="boton primario" disabled={creando} onClick={crear}>Usar este cliente</button>
        </div>
      )}
      {r?.estado === "no" && (
        <p className="suave">No aparece en el padrón de la DGII (puede no estar actualizado). <button className="enlace" onClick={onManual}>Crear el cliente a mano</button></p>
      )}
      {r?.estado === "error" && <p className="suave">No se pudo consultar. <button className="enlace" onClick={onManual}>Buscar o crear el cliente</button></p>}
      {msg && <p className="error">{msg}</p>}
    </div>
  );
}
