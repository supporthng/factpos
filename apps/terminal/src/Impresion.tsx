import { useEffect, useState } from "react";

/** Puente de la caja de escritorio (Electron). En un navegador no existe y no se muestra este módulo. */
interface Puente {
  impresionEstado?: () => Promise<Estado | null>;
  impresionGuardar?: (c: { impresora: string; ancho: number; estaciones?: Record<string, string> }) => Promise<boolean>;
  impresionPrueba?: (impresora?: string) => Promise<{ ok: boolean; motivo: string; mm?: number }>;
}
interface Impresora { nombre: string; mostrar: string; descripcion: string; predeterminada: boolean; estado: number }
interface Intento { en: string; impresora: string; ancho: number; origen: string; mm: number; ok: boolean; motivo: string }
interface Estado { impresoras: Impresora[]; impresora: string; ancho: number; registro: Intento[]; estaciones?: Record<string, string> }
const puente = () => (window as unknown as { factpos?: Puente }).factpos;

export const hayModuloImpresion = () => !!puente()?.impresionEstado;

/** Impresora y papel de esta terminal, prueba de impresión y los últimos errores. */
export function ImpresionTerminal({ estaciones = [] }: { estaciones?: { id: string; nombre: string }[] }) {
  const [e, setE] = useState<Estado | null>(null);
  const [prueba, setPrueba] = useState<string>("");
  const [probando, setProbando] = useState(false);
  const cargar = () => puente()?.impresionEstado?.().then(setE).catch(() => setE(null));
  useEffect(() => { cargar(); }, []);
  if (!e) return null;

  const guardar = async (impresora: string, ancho: number) => {
    await puente()?.impresionGuardar?.({ impresora, ancho, estaciones: e?.estaciones ?? {} });
    setPrueba("");
    cargar();
  };
  const asignar = async (estacionId: string, impresora: string) => {
    const nuevas = { ...(e.estaciones ?? {}) };
    if (impresora) nuevas[estacionId] = impresora; else delete nuevas[estacionId];
    await puente()?.impresionGuardar?.({ impresora: e.impresora, ancho: e.ancho, estaciones: nuevas });
    setPrueba("");
    cargar();
  };
  const probar = async (impresora?: string) => {
    setProbando(true); setPrueba("");
    try {
      const r = await puente()!.impresionPrueba!(impresora);
      setPrueba(r.ok ? `✓ Se envió la prueba a la impresora${r.mm ? ` (largo ${r.mm + 8} mm)` : ""}. Revise que el papel salga justo.` : `✗ No se pudo imprimir: ${r.motivo}`);
    } catch (x) { setPrueba(`✗ ${(x as Error).message}`); }
    setProbando(false); cargar();
  };
  const predeterminada = e.impresoras.find((p) => p.predeterminada);
  const elegidaExiste = !e.impresora || e.impresoras.some((p) => p.nombre === e.impresora);
  const fallos = e.registro.filter((r) => !r.ok);

  return (
    <div className="campo">
      <span>Impresión</span>
      {!e.impresoras.length && <p className="error">Windows no tiene ninguna impresora instalada. Instale la impresora de tickets y vuelva a abrir esta ventana.</p>}
      {!elegidaExiste && <p className="error">La impresora elegida («{e.impresora}») ya no aparece en Windows (apagada, desconectada o desinstalada). Elija otra o use la predeterminada.</p>}
      <div className="lista-opciones">
        <button className={"opcion" + (!e.impresora ? " activo" : "")} onClick={() => guardar("", e.ancho)}>
          <b>La predeterminada de Windows</b> <span className="suave">{predeterminada ? predeterminada.mostrar : "no hay ninguna marcada"}</span>
        </button>
        {e.impresoras.map((p) => (
          <button key={p.nombre} className={"opcion" + (e.impresora === p.nombre ? " activo" : "")} onClick={() => guardar(p.nombre, e.ancho)}>
            <b>{p.mostrar}</b> <span className="suave">{p.predeterminada ? "predeterminada · " : ""}{p.estado ? `estado ${p.estado} (puede estar sin papel, offline o con error)` : "lista"}</span>
          </button>
        ))}
      </div>
      <div className="tamano-pantalla">
        <span className="suave">Ancho del papel</span>
        <div className="selector-modo">
          {[80, 58].map((a) => <button key={a} className={e.ancho === a ? "activo" : ""} onClick={() => guardar(e.impresora, a)}>{a} mm</button>)}
        </div>
      </div>
      <div><button className="boton" disabled={probando || !e.impresoras.length} onClick={() => probar()}>{probando ? "Imprimiendo…" : "Imprimir prueba"}</button></div>
      {prueba && <p className={prueba.startsWith("✓") ? "suave" : "error"}>{prueba}</p>}
      {estaciones.length > 0 && (
        <div className="campo" style={{ marginTop: 10 }}>
          <span>Impresoras por estación</span>
          <small className="suave">Si una estación (cocina, barra…) tiene su propia impresora conectada a esta computadora, elíjala aquí: las comandas de esa estación saldrán por ella, y el ticket y la cuenta siguen saliendo por la impresora de arriba.</small>
          {estaciones.map((s) => {
            const elegida = e.estaciones?.[s.id] ?? "";
            const existe = !elegida || e.impresoras.some((p) => p.nombre === elegida);
            return (
              <div key={s.id} className="fila-acciones" style={{ marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
                <b style={{ minWidth: 110 }}>{s.nombre}</b>
                <select value={elegida} onChange={(ev) => asignar(s.id, ev.target.value)}>
                  <option value="">La misma de la caja</option>
                  {e.impresoras.map((p) => <option key={p.nombre} value={p.nombre}>{p.mostrar}</option>)}
                  {!existe && <option value={elegida}>{elegida} (no aparece)</option>}
                </select>
                {elegida && <button className="boton" disabled={probando} onClick={() => probar(elegida)}>Prueba</button>}
                {!existe && <span className="error">Esa impresora ya no aparece en Windows.</span>}
              </div>
            );
          })}
        </div>
      )}
      <small className="suave">
        Si el papel sale largo: en Windows › Impresoras › esta impresora › Preferencias de impresión, ponga el papel como rollo de 80 mm de largo variable
        (sin salto de página) y repita la prueba.
      </small>
      {e.registro.length > 0 && (
        <details open={!!fallos.length}>
          <summary className="suave">Últimos intentos de impresión{fallos.length ? ` · ${fallos.length} con error` : ""}</summary>
          <ul className="registro-impresion">
            {e.registro.slice(0, 8).map((r, i) => (
              <li key={i} className={r.ok ? "" : "error"}>
                {new Date(r.en).toLocaleTimeString("es-DO")} · {r.origen === "prueba" ? "prueba" : String(r.origen).startsWith("comanda") ? r.origen : "ticket"} · {r.impresora} · {r.ok ? `enviado${r.mm ? ` (${r.mm + 8} mm)` : " (largo no medido)"}` : `ERROR: ${r.motivo}`}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
