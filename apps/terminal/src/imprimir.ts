/**
 * Imprime la pantalla actual (ticket, reporte). En la caja de escritorio sale DIRECTO por la impresora elegida, sin el cuadro
 * de imprimir de Windows (la app lo hace por su puente); en un navegador se abre el cuadro normal.
 * Una comanda pasa el id de su estación: si esta terminal le asignó una impresora (Configuración › Impresoras por estación),
 * sale por esa; si no, por la impresora de la caja.
 */
export function imprimir(estacionId?: string) {
  const puente = (window as unknown as { factpos?: { imprimir?: (estacionId?: string) => void } }).factpos;
  if (puente?.imprimir) puente.imprimir(estacionId); else window.print();
}
