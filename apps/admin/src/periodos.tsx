import { hoy } from "./api";

/** Períodos rápidos para filtrar por fechas (hoy, ayer, esta semana, mes actual…). La semana va de lunes a domingo. */
const dia = (d: Date) => d.toISOString().slice(0, 10);
const sumar = (f: string, n: number) => dia(new Date(new Date(`${f}T12:00:00Z`).getTime() + n * 86400e3));
const pad = (n: number) => String(n).padStart(2, "0");

export const PERIODOS: [string, string][] = [
  ["hoy", "Hoy"], ["ayer", "Ayer"],
  ["semana", "Esta semana"], ["semana-ant", "Semana pasada"], ["ult7", "Últimos 7 días"],
  ["mes", "Mes actual"], ["mes-ant", "Mes anterior"], ["ult30", "Últimos 30 días"],
  ["trimestre", "Este trimestre"], ["trimestre-ant", "Trimestre anterior"],
  ["anio", "Este año"], ["anio-ant", "Año anterior"],
];

export function rangoPeriodo(k: string): [string, string] {
  const h = hoy();
  const y = Number(h.slice(0, 4)), m = Number(h.slice(5, 7));
  const lunes = sumar(h, -((new Date(`${h}T12:00:00Z`).getUTCDay() + 6) % 7));
  const q = Math.floor((m - 1) / 3) * 3 + 1; // primer mes del trimestre
  switch (k) {
    case "hoy": return [h, h];
    case "ayer": return [sumar(h, -1), sumar(h, -1)];
    case "semana": return [lunes, h];
    case "semana-ant": return [sumar(lunes, -7), sumar(lunes, -1)];
    case "ult7": return [sumar(h, -6), h];
    case "mes": return [`${y}-${pad(m)}-01`, h];
    case "mes-ant": { const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1; return [`${py}-${pad(pm)}-01`, sumar(`${y}-${pad(m)}-01`, -1)]; }
    case "ult30": return [sumar(h, -29), h];
    case "trimestre": return [`${y}-${pad(q)}-01`, h];
    case "trimestre-ant": { const py = q === 1 ? y - 1 : y, pq = q === 1 ? 10 : q - 3; return [`${py}-${pad(pq)}-01`, sumar(`${y}-${pad(q)}-01`, -1)]; }
    case "anio-ant": return [`${y - 1}-01-01`, `${y - 1}-12-31`];
    default: return [`${y}-01-01`, h];
  }
}

/** El período que coincide con estas fechas, si alguno. */
export const periodoActivo = (desde: string, hasta: string) => PERIODOS.find(([k]) => { const [a, b] = rangoPeriodo(k); return a === desde && b === hasta; })?.[0] ?? "";

export function SelectorPeriodo({ desde, hasta, onCambio }: { desde: string; hasta: string; onCambio: (desde: string, hasta: string) => void }) {
  return (
    <select value={periodoActivo(desde, hasta)} onChange={(e) => { if (e.target.value) { const [a, b] = rangoPeriodo(e.target.value); onCambio(a, b); } }} aria-label="Período">
      <option value="">Personalizado</option>
      {PERIODOS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
    </select>
  );
}
