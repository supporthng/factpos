/** En la administración local: escrituras que solo se hacen en la nube. */
export function soloEnLaNube(metodo: string, ruta: string) {
  // Liberar la PC de una caja se hace en ESTE servidor: la asignación PC↔caja (cajas_equipos) vive aquí, no en la nube.
  if (/^\/central\/terminales\/[^/]+\/liberar-equipo$/.test(ruta)) return false;
  if (/^\/central\/(alta|cxc|empresa|pedidos-sucursal|traspasos|terminales|licencia)(\/|$)/.test(ruta)) return true;
  if (/^\/central\/fiscal\//.test(ruta) && !/^\/central\/fiscal\/documentos\/[^/]+\/reintentar$/.test(ruta)) return true;
  if (ruta === "/central/incidentes/prueba") return true;
  if (ruta === "/central/sucursales" || /^\/central\/sucursales\/[^/]+(\/(clave-conexion|terminales|tipo))?$/.test(ruta)) return true;
  void metodo;
  return false;
}

