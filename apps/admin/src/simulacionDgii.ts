/**
 * Simulación de la DGII (paso 4): se toman los mismos casos del set de pruebas, pero emitidos por la empresa de verdad:
 * su RNC, su razón social, su dirección y su contacto; numeración propia de la simulación (desde el 101 de cada tipo, aparte
 * de las secuencias reales) y fechas corridas para que la emisión sea hoy. Los comprobantes que modifican a otro
 * (notas 33 y 34) apuntan al número nuevo de su comprobante.
 */
export type Fila = Record<string, string>;
export interface CasoSim { clave: string; tipo: string; encf: string; ecf: Fila; rfce?: Fila }
export interface DatosEmisor { rnc: string; razonSocial: string; nombreComercial: string; direccion: string; telefono: string; correo: string }

const corto = (t: string | null | undefined, n: number) => String(t ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const dmy = (iso: string) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;
const aIso = (x: string) => `${x.slice(6, 10)}-${x.slice(3, 5)}-${x.slice(0, 2)}`;
const esFecha = (v: string) => /^\d{2}-\d{2}-\d{4}$/.test(v);

/** Agrupa como lo pide la DGII: 1) facturas y demás e-CF, 2) notas de crédito y débito, 3) resúmenes de consumo. */
const ORDEN_TIPOS = ["31", "32", "41", "43", "44", "45", "46", "47", "33", "34"];
export const grupoSim = (c: { tipo: string; rfce?: unknown }) => (c.rfce ? 3 : c.tipo === "33" || c.tipo === "34" ? 2 : 1);

export function armarSimulacion(casos: CasoSim[], emp: DatosEmisor, hoy: string, inicio = 101, vence = "2028-12-31"): CasoSim[] {
  const rnc = emp.rnc.replace(/\D/g, "");
  const nuevo = new Map<string, string>(); // e-NCF del set → e-NCF de la simulación
  const usados = new Map<string, number>();
  for (const c of casos) {
    const k = usados.get(c.tipo) ?? 0;
    usados.set(c.tipo, k + 1);
    nuevo.set(c.encf, `E${c.tipo}${String(inicio + k).padStart(10, "0")}`);
  }
  const tel = (() => { const d = emp.telefono.replace(/\D/g, "").slice(-10); return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : null; })();
  const correo = /^\w+([-+.]\w+)*@\w+([-.]\w+)*\.\w+([-.]\w+)*$/.test(emp.correo.trim()) ? corto(emp.correo, 80) : null;

  const convertir = (f: Fila, encf: string): Fila => {
    // Las columnas del Excel pueden venir con cualquier mayúscula: se busca por nombre en minúsculas
    const clave = new Map(Object.keys(f).map((k) => [k.toLowerCase(), k]));
    const d: Fila = { ...f };
    const poner = (k: string, v: string) => { const real = clave.get(k); if (real) d[real] = v; };
    const quitar = (k: string) => { const real = clave.get(k); if (real) delete d[real]; };
    const tiene = (k: string) => clave.has(k);
    // Fechas: todas se corren los mismos días para que la emisión sea hoy
    const base = f[clave.get("fechaemision") ?? ""];
    // Con impuestos adicionales/selectivos la DGII valida la tasa contra la fecha de emisión: se conservan las fechas del set
    const conSelectivo = [...clave.keys()].some((k) => k.startsWith("tasaimpuestoadicional"));
    if (base && esFecha(base) && !conSelectivo) {
      const dias = Math.round((Date.parse(`${hoy}T12:00:00Z`) - Date.parse(`${aIso(base)}T12:00:00Z`)) / 86400_000);
      for (const [k, v] of Object.entries(f)) {
        const kl = k.toLowerCase();
        if (kl.startsWith("fecha") && kl !== "fechavencimientosecuencia" && esFecha(v)) {
          let iso = new Date(Date.parse(`${aIso(v)}T12:00:00Z`) + dias * 86400_000).toISOString().slice(0, 10);
          // Entregas, órdenes de compra, elaboración y embarque no pueden quedar en el futuro
          if (/^fecha(entrega|ordencompra|elaboracion|embarque)/.test(kl) && iso > hoy) iso = hoy;
          d[k] = dmy(iso);
        }
      }
    }
    poner("encf", encf); poner("casoprueba", `${rnc}${encf}`); poner("rncemisor", rnc);
    poner("razonsocialemisor", corto(emp.razonSocial, 150));
    if (tiene("nombrecomercial")) poner("nombrecomercial", corto(emp.nombreComercial || emp.razonSocial, 150));
    if (tiene("direccionemisor") && emp.direccion.trim()) poner("direccionemisor", corto(emp.direccion, 100));
    if (tiene("correoemisor")) { if (correo) poner("correoemisor", correo); else quitar("correoemisor"); }
    if (tiene("telefonoemisor[1]") && tel) poner("telefonoemisor[1]", tel);
    quitar("website");
    if (tiene("fechavencimientosecuencia")) poner("fechavencimientosecuencia", dmy(vence));
    const mod = f[clave.get("ncfmodificado") ?? ""];
    if (mod) {
      poner("ncfmodificado", nuevo.get(mod) ?? mod);
      // El comprobante modificado es de la simulación y se emite hoy
      if (tiene("fechancfmodificado")) poner("fechancfmodificado", dmy(hoy));
    }
    return d;
  };

  return casos
    .map((c) => {
      const encf = nuevo.get(c.encf)!;
      return { clave: `SIM-${encf}`, tipo: c.tipo, encf, ecf: convertir(c.ecf, encf), ...(c.rfce ? { rfce: convertir(c.rfce, encf) } : {}) } as CasoSim;
    })
    .sort((a, b) => grupoSim(a) - grupoSim(b) || ORDEN_TIPOS.indexOf(a.tipo) - ORDEN_TIPOS.indexOf(b.tipo) || a.encf.localeCompare(b.encf));
}
