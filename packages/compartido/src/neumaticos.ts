/**
 * Neumáticos (módulo GOMERA): la medida («205/55R16», «90/90-18», «11R22.5», «26x1.95») y el código DOT (semana y año de fabricación).
 * Con la medida se busca por ancho, perfil y rin; con el DOT se sabe qué tan viejo es cada neumático y se vende primero el más antiguo.
 */
export const TIPOS_NEUMATICO = [
  { id: "BICICLETA", nombre: "Bicicleta" },
  { id: "MOTO", nombre: "Motor" },
  { id: "CARRO", nombre: "Carro" },
  { id: "JEEPETA", nombre: "Jeepeta" },
  { id: "CAMIONETA", nombre: "Camioneta" },
  { id: "CAMION", nombre: "Camión o guagua" },
] as const;
export type TipoNeumatico = (typeof TIPOS_NEUMATICO)[number]["id"];

export interface MedidaNeumatico {
  /** Ancho en mm (205), o sección en pulgadas en camión (11) y bicicleta (1.95) */
  ancho: number;
  /** Perfil: 55 en 205/55R16; null si la medida no lo lleva (camión, bicicleta) */
  perfil: number | null;
  /** Diámetro del rin en pulgadas (16, 22.5, 26) */
  rin: number;
  /** La medida bien escrita: «205/55R16», «90/90-18», «11R22.5», «26x1.95» */
  texto: string;
}

/** Entiende cómo escribe la gente la medida: «205 55 16», «205/55 r16», «90/90-18», «11R22.5», «26 x 1.95». null si no se reconoce. */
export function leerMedida(entrada: string): MedidaNeumatico | null {
  const t = entrada.trim().replace(/,/g, ".");
  // Carro, jeepeta, camioneta y moto: ancho / perfil · rin
  let m = t.match(/^(\d{2,3})\s*[/\s]\s*(\d{2})\s*(?:[-\s]?\s*(Z?R)\s*|-\s*|\s+)(\d{2}(?:\.\d)?)\s*[A-Za-z]{0,2}$/i);
  if (m) {
    // Si la escribieron con guion (moto: 90/90-18) se respeta; si no, es radial
    const rad = !m[3] && t.includes("-") ? "-" : "R";
    return { ancho: Number(m[1]), perfil: Number(m[2]), rin: Number(m[4]), texto: `${m[1]}/${m[2]}${rad}${m[4]}` };
  }
  // Camión y guagua: sección en pulgadas · radial · rin (11R22.5, 295/80R22.5 ya lo cubre la regla de arriba)
  m = t.match(/^(\d{1,2}(?:\.\d)?)\s*R\s*(\d{2}(?:\.\d)?)$/i);
  if (m) return { ancho: Number(m[1]), perfil: null, rin: Number(m[2]), texto: `${m[1]}R${m[2]}` };
  // Bicicleta: diámetro x sección (26x1.95)
  m = t.match(/^(\d{2}(?:\.\d)?)\s*x\s*(\d(?:\.\d{1,2})?)$/i);
  if (m) return { ancho: Number(m[2]), perfil: null, rin: Number(m[1]), texto: `${m[1]}x${m[2]}` };
  return null;
}

/** DOT de 4 dígitos: semana y año de fabricación. «2324» = semana 23 de 2024. null si no es válido. */
export function leerDot(entrada: string): { semana: number; anio: number } | null {
  const m = entrada.trim().match(/^(\d{2})(\d{2})$/);
  if (!m) return null;
  const semana = Number(m[1]);
  if (semana < 1 || semana > 53) return null;
  return { semana, anio: 2000 + Number(m[2]) };
}

/** Fecha aproximada de fabricación (inicio de esa semana) en AAAA-MM-DD */
export function fechaDeFabricacion(dot: string): string | null {
  const d = leerDot(dot);
  if (!d) return null;
  return new Date(Date.UTC(d.anio, 0, 1 + (d.semana - 1) * 7)).toISOString().slice(0, 10);
}

/** Años de uso recomendados para un neumático nuevo desde su fabricación (muchos fabricantes aconsejan no pasar de 6 a 10) */
export const ANIOS_DOT = 6;

/** La fecha que se guarda como «vencimiento» del lote: la fabricación más ANIOS_DOT años. Así los viejos salen primero y se avisa de los que pasan de la edad. */
export function vencimientoDot(dot: string, anios = ANIOS_DOT): string | null {
  const f = fechaDeFabricacion(dot);
  if (!f) return null;
  return `${Number(f.slice(0, 4)) + anios}${f.slice(4)}`;
}

/** Edad en años (con un decimal) de un neumático con ese DOT, a la fecha dada */
export function edadDot(dot: string, hoy: Date = new Date()): number | null {
  const f = fechaDeFabricacion(dot);
  if (!f) return null;
  return Math.round(((hoy.getTime() - new Date(`${f}T00:00:00Z`).getTime()) / (365.25 * 86400e3)) * 10) / 10;
}
