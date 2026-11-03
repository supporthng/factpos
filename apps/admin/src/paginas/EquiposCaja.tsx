import { useEffect, useState } from "react";
import { api } from "../api";
import { Aviso, Encabezado, useDatos } from "../ui";

/**
 * Equipos de cada terminal: impresora de tickets, gaveta, báscula y datáfono.
 * Aquí se guarda la configuración; la terminal la usa a medida que cada equipo se conecta
 * (la gaveta por impresora y la báscula etiquetadora ya funcionan sin esta pantalla).
 */
interface Equipos {
  impresora: { modo: "DRIVER" | "ESCPOS_USB" | "ESCPOS_RED"; nombre: string; ip: string; puerto: number; papelMm: 58 | 80; cortar: boolean; copias: number };
  gaveta: { modo: "NINGUNA" | "POR_IMPRESORA" | "PULSO_DIRECTO"; abrirAlCobrarEfectivo: boolean };
  bascula: { modo: "NINGUNA" | "ETIQUETADORA" | "SERIAL"; puerto: string; baudios: number; unidad: "kg" | "lb" };
  datafono: { modo: "MANUAL" | "INTEGRADO"; marca: string; modelo: string; procesador: string; ip: string; puerto: number; terminalId: string };
}
interface Terminal { id: string; nombre: string; sucursal: string; equipos: Partial<Equipos> }

const BASE: Equipos = {
  impresora: { modo: "DRIVER", nombre: "", ip: "", puerto: 9100, papelMm: 80, cortar: true, copias: 1 },
  gaveta: { modo: "POR_IMPRESORA", abrirAlCobrarEfectivo: true },
  bascula: { modo: "ETIQUETADORA", puerto: "", baudios: 9600, unidad: "kg" },
  datafono: { modo: "MANUAL", marca: "Verifone", modelo: "", procesador: "", ip: "", puerto: 8080, terminalId: "" },
};
const completar = (e: Partial<Equipos> | undefined): Equipos => ({
  impresora: { ...BASE.impresora, ...e?.impresora }, gaveta: { ...BASE.gaveta, ...e?.gaveta },
  bascula: { ...BASE.bascula, ...e?.bascula }, datafono: { ...BASE.datafono, ...e?.datafono },
});

export function EquiposCaja() {
  const terminales = useDatos<Terminal[]>("/central/terminales/equipos");
  const [id, setId] = useState("");
  const [f, setF] = useState<Equipos | null>(null);
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" } | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => { if (!id && terminales.datos?.[0]) setId(terminales.datos[0].id); }, [terminales.datos, id]);
  useEffect(() => {
    const t = terminales.datos?.find((x) => x.id === id);
    if (t) { setF(completar(t.equipos)); setMsg(null); }
  }, [id, terminales.datos]);

  const num = (v: string) => Number(v.replace(/\D/g, "")) || 0;
  const guardar = async () => {
    if (!f) return;
    setGuardando(true); setMsg(null);
    try { await api(`/central/terminales/${id}/equipos`, { metodo: "PUT", cuerpo: f }); setMsg({ t: "Equipos guardados", tipo: "ok" }); terminales.recargar(); }
    catch (e) { setMsg({ t: (e as Error).message, tipo: "error" }); }
    setGuardando(false);
  };
  const set = <K extends keyof Equipos>(k: K, c: Partial<Equipos[K]>) => setF((x) => (x ? { ...x, [k]: { ...x[k], ...c } } : x));

  if (!terminales.datos) return <p className="suave">Cargando…</p>;
  if (!f) return <><Encabezado titulo="Equipos de la caja" /><p className="suave">No hay terminales activas.</p></>;

  return (
    <>
      <Encabezado titulo="Equipos de la caja" descripcion="Impresora de tickets, gaveta, báscula y datáfono de cada terminal.">
        <select aria-label="Terminal" value={id} onChange={(e) => setId(e.target.value)}>
          {terminales.datos.map((t) => <option key={t.id} value={t.id}>{t.sucursal} · {t.nombre}</option>)}
        </select>
      </Encabezado>
      <div className="equipos-grid">
      <div className="panel equipos-panel">
        <h3>Impresora de tickets</h3>
        <div className="equipos-campos">
          <label className="campo"><span>Cómo imprime</span>
            <select value={f.impresora.modo} onChange={(e) => set("impresora", { modo: e.target.value as Equipos["impresora"]["modo"] })}>
              <option value="DRIVER">Driver de Windows</option>
              <option value="ESCPOS_USB">ESC/POS por USB</option>
              <option value="ESCPOS_RED">ESC/POS por red (IP)</option>
            </select></label>
          <label className="campo"><span>Nombre de la impresora</span><input value={f.impresora.nombre} maxLength={80} placeholder="EPSON TM-T20" onChange={(e) => set("impresora", { nombre: e.target.value })} /></label>
          {f.impresora.modo === "ESCPOS_RED" && <>
            <label className="campo"><span>IP</span><input value={f.impresora.ip} placeholder="192.168.1.50" onChange={(e) => set("impresora", { ip: e.target.value })} /></label>
            <label className="campo"><span>Puerto</span><input className="numero" inputMode="numeric" value={f.impresora.puerto} onChange={(e) => set("impresora", { puerto: num(e.target.value) })} /></label>
          </>}
          <label className="campo"><span>Papel</span>
            <select value={f.impresora.papelMm} onChange={(e) => set("impresora", { papelMm: Number(e.target.value) as 58 | 80 })}><option value={80}>80 mm</option><option value={58}>58 mm</option></select></label>
          <label className="campo"><span>Copias del ticket</span>
            <select value={f.impresora.copias} onChange={(e) => set("impresora", { copias: Number(e.target.value) })}><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option></select></label>
          <label className="casilla-permiso"><input type="checkbox" checked={f.impresora.cortar} onChange={(e) => set("impresora", { cortar: e.target.checked })} /><span>Cortar el papel</span></label>
        </div>
      </div>

      <div className="panel equipos-panel">
        <h3>Gaveta de dinero</h3>
        <div className="equipos-campos">
          <label className="campo"><span>Cómo abre</span>
            <select value={f.gaveta.modo} onChange={(e) => set("gaveta", { modo: e.target.value as Equipos["gaveta"]["modo"] })}>
              <option value="POR_IMPRESORA">La abre la impresora</option>
              <option value="PULSO_DIRECTO">Pulso directo</option>
              <option value="NINGUNA">No tiene gaveta</option>
            </select></label>
          {f.gaveta.modo !== "NINGUNA" && <label className="casilla-permiso"><input type="checkbox" checked={f.gaveta.abrirAlCobrarEfectivo} onChange={(e) => set("gaveta", { abrirAlCobrarEfectivo: e.target.checked })} /><span>Abrir al cobrar en efectivo</span></label>}
        </div>
        {f.gaveta.modo === "POR_IMPRESORA" && <p className="suave pequeno">Hoy la gaveta abre porque el driver de la impresora tiene activada la opción «abrir gaveta al imprimir».</p>}
      </div>

      <div className="panel equipos-panel">
        <h3>Báscula</h3>
        <div className="equipos-campos">
          <label className="campo"><span>Tipo</span>
            <select value={f.bascula.modo} onChange={(e) => set("bascula", { modo: e.target.value as Equipos["bascula"]["modo"] })}>
              <option value="ETIQUETADORA">Etiquetadora (código con peso)</option>
              <option value="SERIAL">De mostrador (serial/USB)</option>
              <option value="NINGUNA">No usa báscula</option>
            </select></label>
          {f.bascula.modo === "SERIAL" && <>
            <label className="campo"><span>Puerto</span><input value={f.bascula.puerto} placeholder="COM3" onChange={(e) => set("bascula", { puerto: e.target.value.toUpperCase() })} /></label>
            <label className="campo"><span>Velocidad (baudios)</span>
              <select value={f.bascula.baudios} onChange={(e) => set("bascula", { baudios: Number(e.target.value) })}>{[1200, 2400, 4800, 9600, 19200, 38400, 115200].map((b) => <option key={b} value={b}>{b}</option>)}</select></label>
            <label className="campo"><span>Unidad</span>
              <select value={f.bascula.unidad} onChange={(e) => set("bascula", { unidad: e.target.value as "kg" | "lb" })}><option value="kg">Kilos</option><option value="lb">Libras</option></select></label>
          </>}
        </div>
        {f.bascula.modo === "ETIQUETADORA" && <p className="suave pequeno">Las etiquetas de balanza (código que empieza con 2) ya se leen en la caja.</p>}
      </div>

      <div className="panel equipos-panel">
        <h3>Datáfono (tarjetas)</h3>
        <div className="equipos-campos">
          <label className="campo"><span>Cobro con tarjeta</span>
            <select value={f.datafono.modo} onChange={(e) => set("datafono", { modo: e.target.value as "MANUAL" | "INTEGRADO" })}>
              <option value="MANUAL">Manual (digita el cajero)</option>
              <option value="INTEGRADO">Conectado (pendiente)</option>
            </select></label>
          <label className="campo"><span>Marca y modelo</span><span className="en-linea">
            <input value={f.datafono.marca} maxLength={40} onChange={(e) => set("datafono", { marca: e.target.value })} />
            <input value={f.datafono.modelo} maxLength={40} placeholder="VX520, P400…" onChange={(e) => set("datafono", { modelo: e.target.value })} /></span></label>
          <label className="campo"><span>Procesador</span><input value={f.datafono.procesador} maxLength={40} placeholder="Cardnet, Azul…" onChange={(e) => set("datafono", { procesador: e.target.value })} /></label>
          <label className="campo"><span>Terminal ID (TID)</span><input value={f.datafono.terminalId} maxLength={40} onChange={(e) => set("datafono", { terminalId: e.target.value })} /></label>
          {f.datafono.modo === "INTEGRADO" && <>
            <label className="campo"><span>IP del datáfono</span><input value={f.datafono.ip} placeholder="192.168.1.60" onChange={(e) => set("datafono", { ip: e.target.value })} /></label>
            <label className="campo"><span>Puerto</span><input className="numero" inputMode="numeric" value={f.datafono.puerto} onChange={(e) => set("datafono", { puerto: num(e.target.value) })} /></label>
          </>}
        </div>
        <p className="suave pequeno">El envío automático del monto y la aprobación depende de la integración que entregue el procesador; mientras tanto el cobro sigue siendo manual.</p>
      </div>

      </div>

      {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}
      <div className="barra-compra"><span className="flex" /><button className="boton primario" disabled={guardando} onClick={guardar}>{guardando ? "Guardando…" : "Guardar equipos"}</button></div>
    </>
  );
}
