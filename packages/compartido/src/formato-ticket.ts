/**
 * Formato de impresión del ticket: lo diseña el administrador (Configuración › Formatos de impresión)
 * y lo usan la caja al imprimir y la vista previa de la administración.
 */
export interface FormatoTicket {
  papel: "58" | "80";
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
  mostrarRnc: true, mostrarSucursal: true, mostrarDireccion: false, mostrarTelefono: false, encabezadoExtra: "",
  mostrarCajero: true, mostrarCliente: true, mostrarAhorro: true, mostrarQr: true,
  pie: "¡Gracias por su compra!", pieExtra: "",
};

export const formatoTicket = (guardado?: Partial<FormatoTicket> | null): FormatoTicket => ({ ...FORMATO_TICKET_BASE, ...(guardado ?? {}) });

/** Medidas CSS del formato (ancho del papel, tamaño de letra y del logo). */
export function medidasTicket(f: FormatoTicket) {
  return {
    ancho: f.papel === "58" ? "48mm" : "72mm",
    letra: { pequena: "10.5px", normal: "12px", grande: "14px" }[f.letra],
    logoAlto: { pequeno: "12mm", mediano: "20mm", grande: "30mm" }[f.logoTamano],
    logoAncho: f.papel === "58" ? "40mm" : { pequeno: "34mm", mediano: "46mm", grande: "64mm" }[f.logoTamano],
  };
}
