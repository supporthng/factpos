/** En la administración local: escrituras que solo se hacen en la nube. */
export function soloEnLaNube(metodo: string, ruta: string) {
  if (/^\/central\/(alta|cxc|empresa|pedidos-sucursal|traspasos|terminales|licencia)(\/|$)/.test(ruta)) return true;
  if (/^\/central\/fiscal\//.test(ruta) && !/^\/central\/fiscal\/documentos\/[^/]+\/reintentar$/.test(ruta)) return true;
  if (ruta === "/central/incidentes/prueba") return true;
  if (ruta === "/central/sucursales" || /^\/central\/sucursales\/[^/]+(\/(clave-conexion|terminales|tipo))?$/.test(ruta)) return true;
  void metodo;
  return false;
}

