import { useDatos } from "./ui";

export interface FuncionSeguridad {
  clave: string; titulo: string; descripcion: string; habilitada: boolean; porDefecto: boolean; cambiadaEn: string | null; cambiadaPor: string | null;
}
/** ¿Está habilitada esta función en Configuración › Seguridad? (el servidor igual la vuelve a comprobar) */
export function useFuncionSeguridad(clave: string) {
  const { datos, recargar } = useDatos<{ funciones: FuncionSeguridad[] }>("/central/seguridad");
  return { habilitada: !!datos?.funciones.find((f) => f.clave === clave)?.habilitada, cargando: !datos, recargar };
}
