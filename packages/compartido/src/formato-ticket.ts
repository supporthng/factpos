/**
 * Formato de impresión del ticket: lo diseña el administrador (Cajas y equipos › Formatos de impresión)
 * y lo usan la caja al imprimir y la vista previa de la administración.
 */
export interface FormatoTicket {
  /** 58 y 80 = rollo térmico (mm); mediacarta = 5½ × 8½ in; carta = 8½ × 11 in (impresora de hojas, por el driver de Windows) */
  papel: "58" | "80" | "mediacarta" | "carta";
  letra: "pequena" | "normal" | "grande";
  logoTamano: "pequeno" | "mediano" | "grande";
  mostrarRnc: boolean;
  mostrarSucursal: boolean;
  mostrarDireccion: boolean;
  mostrarTelefono: boolean;
  /** Líneas libres bajo el nombre (web, Instagram, horario…), una por renglón */
  encabezadoExtra: string;
  mostrarCajero: boolean;
  mostrarCliente: boolean;
  mostrarAhorro: boolean;
  mostrarQr: boolean;
  pie: string;
  /** Texto adicional al final (política de devoluciones, garantía…) */
  pieExtra: string;
}

export const FORMATO_TICKET_BASE: FormatoTicket = {
  papel: "80", letra: "normal", logoTamano: "mediano",
  mostrarRnc: true, mostrarSucursal: true, mostrarDireccion: true, mostrarTelefono: true, encabezadoExtra: "",
  mostrarCajero: true, mostrarCliente: true, mostrarAhorro: true, mostrarQr: true,
  pie: "¡Gracias por su compra!", pieExtra: "",
};

export const formatoTicket = (guardado?: Partial<FormatoTicket> | null): FormatoTicket => ({ ...FORMATO_TICKET_BASE, ...(guardado ?? {}) });

export const PAPELES_TICKET: { id: FormatoTicket["papel"]; nombre: string; hoja: boolean }[] = [
  { id: "80", nombre: "Rollo de 80 mm (el más común)", hoja: false },
  { id: "58", nombre: "Rollo de 58 mm", hoja: false },
  { id: "mediacarta", nombre: "Media carta (5½ × 8½ pulg.)", hoja: true },
  { id: "carta", nombre: "Carta (8½ × 11 pulg.)", hoja: true },
];

/** Hojas (media carta y carta) frente a rollos térmicos. */
export const esHoja = (f: Pick<FormatoTicket, "papel">) => f.papel === "carta" || f.papel === "mediacarta";

/** Tamaño de página para CSS @page y su margen: el rollo no tiene largo fijo; las hojas son de tamaño exacto. */
export function paginaTicket(f: Pick<FormatoTicket, "papel">) {
  if (f.papel === "carta") return { size: "215.9mm 279.4mm", margen: "10mm" };
  if (f.papel === "mediacarta") return { size: "139.7mm 215.9mm", margen: "8mm" };
  return { size: `${f.papel}mm auto`, margen: "0" };
}

/** Medidas CSS del formato (ancho del papel, tamaño de letra y del logo). */
export function medidasTicket(f: FormatoTicket) {
  const hoja = esHoja(f);
  return {
    // En hoja el contenido ocupa el ancho útil de la página (menos los márgenes de @page)
    ancho: f.papel === "carta" ? "195mm" : f.papel === "mediacarta" ? "123mm" : f.papel === "58" ? "48mm" : "72mm",
    letra: { pequena: hoja ? "12px" : "10.5px", normal: hoja ? "13.5px" : "12px", grande: hoja ? "15.5px" : "14px" }[f.letra],
    logoAlto: { pequeno: "12mm", mediano: "20mm", grande: "30mm" }[f.logoTamano],
    logoAncho: hoja ? { pequeno: "40mm", mediano: "60mm", grande: "80mm" }[f.logoTamano] : f.papel === "58" ? "40mm" : { pequeno: "34mm", mediano: "46mm", grande: "64mm" }[f.logoTamano],
  };
}
