/**
 * Módulos de una empresa. El tipo de negocio trae los suyos por defecto (los de mesas traen MESAS) y la empresa puede
 * encender otros: un autolavado con cafetería enciende MESAS (cuentas abiertas, comandas, barra y cocina); un bar que
 * también lava vehículos enciende LAVADO. Sin extras, todo funciona como siempre.
 */
export const MODULOS_EMPRESA = ["MESAS", "LAVADO"] as const;
export type ModuloEmpresa = (typeof MODULOS_EMPRESA)[number];

const DEL_TIPO: Readonly<Record<string, readonly ModuloEmpresa[]>> = {
  RESTAURANTE: ["MESAS"],
  BAR: ["MESAS"],
  DISCOTECA: ["MESAS"],
  COMIDA_RAPIDA: ["MESAS"],
};

/** Los módulos activos de la empresa: los de su tipo más los que encendió. Ignora lo desconocido. */
export const modulosDeEmpresa = (tipo: string | null | undefined, extras?: readonly string[] | null): ModuloEmpresa[] => {
  const activos = new Set<ModuloEmpresa>(tipo ? DEL_TIPO[tipo] ?? [] : []);
  for (const m of extras ?? []) if ((MODULOS_EMPRESA as readonly string[]).includes(m)) activos.add(m as ModuloEmpresa);
  return [...activos];
};

export const tieneModulo = (modulo: ModuloEmpresa, tipo: string | null | undefined, extras?: readonly string[] | null) =>
  modulosDeEmpresa(tipo, extras).includes(modulo);

/** ¿Usa cuentas abiertas, salón, comandas y propina? (restaurante, bar, discoteca, comida rápida, o cualquiera con el módulo MESAS) */
export const tieneMesas = (tipo: string | null | undefined, extras?: readonly string[] | null) => tieneModulo("MESAS", tipo, extras);
