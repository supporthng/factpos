import { DOMParser } from "@xmldom/xmldom";
import QRCode from "qrcode";
import { PdfMinimo, anchoTexto, type Color } from "./pdf-minimo.js";

/**
 * Representación impresa de un e-CF armada directamente desde su XML firmado (lo que la DGII recibió): emisor, tipo y e-NCF,
 * cliente, detalle en tabla, y abajo el QR con el código de seguridad y la fecha de firma DEBAJO del QR, y los totales a la derecha.
 * Es el formato estándar de la DGII para el paso 5 de la certificación y sirve para cualquier e-CF. Adaptado de fumio, donde la DGII
 * ya lo validó.
 */
const NOMBRES: Record<string, string> = {
  "31": "Factura de Crédito Fiscal Electrónica", "32": "Factura de Consumo Electrónica", "33": "Nota de Débito Electrónica", "34": "Nota de Crédito Electrónica",
  "41": "Comprobante Electrónico de Compras", "43": "Comprobante Electrónico para Gastos Menores", "44": "Comprobante Electrónico para Regímenes Especiales",
  "45": "Comprobante Electrónico Gubernamental", "46": "Comprobante Electrónico para Exportaciones", "47": "Comprobante Electrónico para Pagos al Exterior",
};
const MOTIVOS: Record<string, string> = {
  "1": "Anula el NCF modificado", "2": "Corrige texto del NCF modificado", "3": "Corrige montos del NCF modificado",
  "4": "Reemplazo de NCF emitido en contingencia", "5": "Referencia a factura de consumo electrónica",
};
const TEXTO: Color = [0.11, 0.14, 0.13];
const AZUL: Color = [0.16, 0.33, 0.55];
const BORDE: Color = [0.55, 0.57, 0.6];

const dinero = (v: string | null | undefined) => new Intl.NumberFormat("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v ?? 0) || 0);

/** Dirección que consulta el código QR del timbre: ConsultaTimbreFC para facturas de consumo menores de RD$250,000 y ConsultaTimbre para el resto. */
export function urlTimbre(d: { ambiente: string; rncEmisor: string; rncComprador: string; encf: string; fechaEmision: string; total: number; fechaFirma: string; codigo: string }): string {
  const env = d.ambiente === "TESTECF" ? "testecf" : d.ambiente === "CERTECF" ? "certecf" : "ecf";
  const q = (v: string | number) => encodeURIComponent(String(v));
  const monto = (Math.round(d.total * 100) / 100).toFixed(2);
  const rnc = d.rncEmisor.replace(/\D/g, "");
  if (d.encf.startsWith("E32") && d.total < 250_000) {
    return `https://fc.dgii.gov.do/${env}/consultatimbrefc?rncemisor=${q(rnc)}&encf=${q(d.encf)}&montototal=${q(monto)}&codigoseguridad=${q(d.codigo)}`;
  }
  const comprador = d.rncComprador && !/^E4[37]/.test(d.encf) ? `RncComprador=${q(d.rncComprador.replace(/\D/g, ""))}&` : "";
  return `https://ecf.dgii.gov.do/${env}/consultatimbre?rncemisor=${q(rnc)}&${comprador}encf=${q(d.encf)}&fechaemision=${q(d.fechaEmision)}&montototal=${q(monto)}&fechafirma=${q(d.fechaFirma)}&codigoseguridad=${q(d.codigo)}`;
}

function partir(texto: string, tam: number, ancho: number, negrita = false): string[] {
  const lineas: string[] = [];
  let linea = "";
  for (const palabra of texto.split(/\s+/)) {
    const prueba = linea ? `${linea} ${palabra}` : palabra;
    if (anchoTexto(prueba, tam, negrita) > ancho && linea) { lineas.push(linea); linea = palabra; } else linea = prueba;
  }
  lineas.push(linea);
  return lineas;
}

export function representacionPdf(xml: string, ambiente = "CERTECF"): { pdf: Uint8Array; encf: string; rnc: string } {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const de = (padre: Element | Document, tag: string) => padre.getElementsByTagName(tag)[0]?.textContent?.trim() ?? "";
  const seccion = (tag: string) => doc.getElementsByTagName(tag)[0] ?? null;

  const tipo = de(doc, "TipoeCF");
  const encf = de(doc, "eNCF");
  const rnc = de(doc, "RNCEmisor");
  if (!encf || !rnc) throw new Error("El XML no parece un e-CF: falta el eNCF o el RNC del emisor.");
  const fechaEmision = de(doc, "FechaEmision");
  const firma = de(doc, "SignatureValue").replace(/\s/g, "");
  if (!firma) throw new Error("El XML no está firmado: la representación impresa necesita el código de seguridad de la firma.");
  const codigo = firma.slice(0, 6);
  const fechaFirma = de(doc, "FechaHoraFirma");
  const montoTotal = de(seccion("Totales") ?? doc, "MontoTotal");
  const comprador = seccion("Comprador");
  const rncComprador = comprador ? de(comprador, "RNCComprador") : "";

  const url = urlTimbre({ ambiente, rncEmisor: rnc, rncComprador, encf, fechaEmision, total: Number(montoTotal) || 0, fechaFirma, codigo });
  const qr = QRCode.create(url, { errorCorrectionLevel: "M" }).modules;

  const pdf = new PdfMinimo();
  pdf.titulo = `${NOMBRES[tipo] ?? "e-CF"} ${encf}`;
  pdf.autor = de(doc, "RazonSocialEmisor");
  const ANCHO = 612, ALTO = 792, MARGEN = 40;
  pdf.nuevaPagina(ANCHO, ALTO);
  let y = ALTO - MARGEN;
  const escribir = (t: string, x: number, yy: number, tam = 9, negrita = false, color: Color = TEXTO) => pdf.texto(t, x, yy, tam, negrita, color);
  const derecha = (t: string, xDer: number, yy: number, tam = 9, negrita = false, color: Color = TEXTO) => escribir(t, xDer - anchoTexto(t, tam, negrita), yy, tam, negrita, color);

  // Emisor a la izquierda
  const emisor = seccion("Emisor") ?? doc;
  const nombreEmisor = de(emisor, "RazonSocialEmisor");
  const comercial = de(emisor, "NombreComercial");
  for (const l of partir(comercial || nombreEmisor, 13, 310, true)) { escribir(l, MARGEN, y, 13, true, AZUL); y -= 15; }
  const lineasEmisor: [string, number][] = [];
  if (comercial && comercial !== nombreEmisor) lineasEmisor.push([nombreEmisor, 10]);
  const sucursal = de(emisor, "Sucursal");
  if (sucursal) lineasEmisor.push([sucursal, 9]);
  lineasEmisor.push([`RNC ${rnc}`, 10]);
  const direccion = de(emisor, "DireccionEmisor");
  if (direccion) for (const l of partir(`Dirección: ${direccion}`, 8, 310)) lineasEmisor.push([l, 8]);
  for (const [t, tam] of lineasEmisor) { escribir(t, MARGEN, y, tam); y -= tam + 3; }
  escribir("Fecha Emisión:", MARGEN, y, 8.5, true);
  escribir(fechaEmision, MARGEN + anchoTexto("Fecha Emisión: ", 8.5, true), y, 8.5);
  y -= 12;

  // Tipo y e-NCF a la derecha
  let yd = ALTO - MARGEN;
  for (const l of partir(NOMBRES[tipo] ?? `e-CF tipo ${tipo}`, 12.5, 230, true)) { derecha(l, ANCHO - MARGEN, yd, 12.5, true, AZUL); yd -= 15; }
  const etiqueta = (k: string, v: string) => { derecha(v, ANCHO - MARGEN, yd, 9.5); derecha(k, ANCHO - MARGEN - anchoTexto(v, 9.5) - 3, yd, 8, true); yd -= 12; };
  etiqueta("e-NCF:", encf);
  const ref = seccion("InformacionReferencia");
  const vence = de(doc, "FechaVencimientoSecuencia");
  if (ref) {
    etiqueta("NCF Modificado:", de(ref, "NCFModificado"));
    const motivo = MOTIVOS[de(ref, "CodigoModificacion")];
    if (motivo) { derecha(motivo, ANCHO - MARGEN, yd, 9, true); yd -= 12; }
  } else if (vence) etiqueta("Fecha Vencimiento:", vence);
  y = Math.min(y, yd) - 8;
  const separador = () => pdf.linea(MARGEN, y, ANCHO - MARGEN, y, 1.2, AZUL);
  separador();
  y -= 18;

  // Cliente
  if (comprador) {
    const filas = ([["Razón Social Cliente:", de(comprador, "RazonSocialComprador")], ["RNC Cliente:", rncComprador || de(comprador, "IdentificadorExtranjero")]] as [string, string][]).filter(([, v]) => v);
    for (const [k, v] of filas) { escribir(k, MARGEN, y, 9.5, true); escribir(v.slice(0, 80), MARGEN + anchoTexto(`${k} `, 9.5, true), y, 9.5); y -= 13; }
    if (filas.length) { y -= 4; separador(); y -= 14; }
  } else y -= 4;

  // Detalle en tabla: Cantidad · Descripción · Unidad de medida · Precio · ITBIS · Valor
  const tot = seccion("Totales");
  const tasas: Record<string, number> = { "1": Number(de(tot ?? doc, "ITBIS1") || 18), "2": Number(de(tot ?? doc, "ITBIS2") || 16), "3": Number(de(tot ?? doc, "ITBIS3") || 0) };
  const incluyeItbis = de(doc, "IndicadorMontoGravado") === "1";
  const ANCHO_T = ANCHO - 2 * MARGEN;
  const cols = [
    { t: "Cantidad", w: 52, al: "c" }, { t: "Descripción", w: ANCHO_T - 52 - 58 - 72 - 72 - 86, al: "i" }, { t: "Unidad de Medida", w: 58, al: "c" },
    { t: "Precio", w: 72, al: "d" }, { t: "ITBIS", w: 72, al: "d" }, { t: "Valor", w: 86, al: "d" },
  ] as const;
  const xs: number[] = [];
  cols.reduce((x, c) => (xs.push(x), x + c.w), MARGEN);
  const celda = (txt: string, i: number, yy: number, negrita: boolean, tam: number) => {
    const c = cols[i]!;
    if (c.al === "d") escribir(txt, xs[i]! + c.w - 4 - anchoTexto(txt, tam, negrita), yy, tam, negrita);
    else if (c.al === "c") escribir(txt, xs[i]! + (c.w - anchoTexto(txt, tam, negrita)) / 2, yy, tam, negrita);
    else escribir(txt, xs[i]! + 5, yy, tam, negrita);
  };
  const filaCaja = (alto: number, fondo?: Color) => {
    pdf.rect(MARGEN, y - alto, ANCHO_T, alto, { ...(fondo ? { relleno: fondo } : {}), borde: BORDE, grosor: 0.5 });
    for (const x of xs.slice(1)) pdf.linea(x, y, x, y - alto, 0.5, BORDE);
  };
  const cabecera = () => {
    filaCaja(22, [0.86, 0.87, 0.88]);
    cols.forEach((c, i) => {
      if (c.t === "Unidad de Medida") { celda("Unidad de", i, y - 9, true, 7.5); celda("Medida", i, y - 18, true, 7.5); } else celda(c.t, i, y - 14, true, 8);
    });
    y -= 22;
  };
  cabecera();
  for (const it of Array.from(doc.getElementsByTagName("Item"))) {
    const desc = partir(de(it, "NombreItem"), 8, cols[1].w - 10);
    const alto = 6 + desc.length * 10;
    if (y - alto < 190) { pdf.nuevaPagina(ANCHO, ALTO); y = ALTO - MARGEN; cabecera(); }
    filaCaja(alto);
    const yy = y - 11;
    const monto = Number(de(it, "MontoItem")) || 0;
    const tasa = tasas[de(it, "IndicadorFacturacion")] ?? 0;
    celda(de(it, "CantidadItem"), 0, yy, false, 8);
    desc.forEach((l, k) => escribir(l, xs[1]! + 5, yy - k * 10, 8));
    celda(de(it, "UnidadMedida"), 2, yy, false, 8);
    celda(dinero(de(it, "PrecioUnitarioItem")), 3, yy, false, 8);
    // Con IndicadorMontoGravado = 1 los montos ya traen el ITBIS incluido
    const itbis = incluyeItbis ? monto - monto / (1 + tasa / 100) : (monto * tasa) / 100;
    celda(dinero(String(itbis)), 4, yy, false, 8);
    celda(dinero(String(monto)), 5, yy, false, 8);
    y -= alto;
  }
  y -= 14;
  separador();
  y -= 14;

  // Pie: QR con el código de seguridad y la fecha de firma debajo; totales a la derecha
  const lado = 82, yTop = y;
  const zona = 4; // módulos en blanco alrededor del QR
  const total = qr.size + 2 * zona;
  const paso = lado / total;
  pdf.matriz({ size: qr.size, get: (f, c) => qr.get(f, c) }, MARGEN + 10 + zona * paso, yTop - lado + zona * paso, lado - 2 * zona * paso);
  escribir(`Código de Seguridad: ${codigo}`, MARGEN + 4, yTop - lado - 12, 8.5);
  escribir(`Fecha Firma: ${fechaFirma}`, MARGEN + 4, yTop - lado - 23, 8.5);

  const lineasTotal: [string, string][] = tot
    ? ([["Subtotal Gravado:", de(tot, "MontoGravadoTotal")], ["Monto Exento:", de(tot, "MontoExento")], ["Total ITBIS:", de(tot, "TotalITBIS")],
        ["ITBIS Retenido:", de(tot, "TotalITBISRetenido")], ["ISR Retenido:", de(tot, "TotalISRRetencion")], ["Monto No Facturable:", de(tot, "MontoNoFacturable")]] as [string, string][])
        .filter(([k, v]) => k === "Total ITBIS:" || (v && Number(v) !== 0))
    : [];
  lineasTotal.push(["Total:", montoTotal]);
  let yt = yTop;
  const xCaja = ANCHO - MARGEN - 150;
  for (const [k, v] of lineasTotal) {
    derecha(k, xCaja - 4, yt - 10, 8, true);
    pdf.rect(xCaja, yt - 13, 150, 14, { relleno: [0.95, 0.95, 0.95], borde: BORDE, grosor: 0.5 });
    derecha(dinero(v), ANCHO - MARGEN - 4, yt - 10, 8.5);
    yt -= 15;
  }
  const otra = seccion("OtraMoneda");
  if (otra) derecha(`${de(otra, "TipoMoneda")} ${dinero(de(otra, "MontoTotalOtraMoneda"))} (tasa ${de(otra, "TipoCambio")})`, ANCHO - MARGEN, yt - 10, 8, false, [0.38, 0.42, 0.4]);

  return { pdf: pdf.guardar(), encf, rnc };
}
