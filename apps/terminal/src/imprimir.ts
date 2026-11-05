/**
 * Imprime la pantalla actual (ticket, reporte). En la caja de escritorio sale DIRECTO por la impresora predeterminada, sin el cuadro
 * de imprimir de Windows (la app lo hace por su puente); en un navegador se abre el cuadro normal.
 */
export function imprimir() {
  const puente = (window as unknown as { factpos?: { imprimir?: () => void } }).factpos;
  if (puente?.imprimir) puente.imprimir(); else window.print();
}
