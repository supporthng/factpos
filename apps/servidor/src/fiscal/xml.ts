import { Decimal } from "decimal.js";

/**
 * Construcción del XML del e-CF y del Resumen de Factura de Consumo (RFCE)
 * según los formatos v1.0 de la DGII.
 *
 * IMPORTANTE: la estructura sigue los nombres de los formatos publicados por la
 * DGII ("Formato Comprobante Fiscal Electrónico (e-CF) V1.0" y "Formato Resumen
 * Factura Consumo Electrónica v1.0"). Antes de producción se valida contra los
 * XSD oficiales y el set de pruebas de certificación; cualquier ajuste de campos
 * se hace aquí, en un solo lugar.
 */

/** Tipos de e-CF que este generador sabe construir. */
export const TIPOS_ECF_SOPORTADOS = ["E31", "E32", "E34"] as const;

export interface DatosEcf {
  tipo: "E31" | "E32" | "E34";
  encf: string;
  venceSecuencia: string;          // AAAA-MM-DD
  fechaEmision: Date;
  emisor: { rnc: string; razonSocial: string; nombreComercial?: string | null; direccion: string };
  comprador?: { rnc: string | null; nombre: string | null } | null;
  condicion: "CONTADO" | "CREDITO";
  pagos: { formaPago: string; monto: string }[];
  lineas: {
    nombre: string;
    cantidad: string;
    precioUnitario: string;        // con ITBIS incluido
    descuento: string;
    tasaItbis: string;             // 0.18, 0.16, 0
    base: string;
    itbis: string;
    total: string;
    esServicio?: boolean;
  }[];
  totales: { subtotal: string; itbis: string; total: string };
  /** Solo notas de crédito (E34): comprobante que se modifica */
  referencia?: { encf: string; fecha: Date; codigoModificacion: "1" | "2" | "3" | "4"; razon: string };
}

const FORMA_PAGO_DGII: Record<string, string> = {
  EFECTIVO: "1", TRANSFERENCIA: "2", TARJETA: "3", CREDITO: "4", DELIVERY: "1", OTRO: "8",
};

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** Fechas en hora de República Dominicana (UTC-4). */
function partesRD(d: Date) {
  const l = new Date(d.getTime() - 4 * 3600e3);
  const p = (n: number) => String(n).padStart(2, "0");
  return {
    fecha: `${p(l.getUTCDate())}-${p(l.getUTCMonth() + 1)}-${l.getUTCFullYear()}`,
    hora: `${p(l.getUTCHours())}:${p(l.getUTCMinutes())}:${p(l.getUTCSeconds())}`,
  };
}
export const fechaDGII = (d: Date) => partesRD(d).fecha;
export const fechaHoraDGII = (d: Date) => `${partesRD(d).fecha} ${partesRD(d).hora}`;
const fechaIso = (iso: string) => iso.split("-").reverse().join("-");

/** Etiqueta simple: omite valores vacíos (los campos opcionales no se envían vacíos). */
const t = (nombre: string, valor: string | number | null | undefined) =>
  valor === null || valor === undefined || valor === "" ? "" : `<${nombre}>${esc(String(valor))}</${nombre}>`;

/** 1 = ITBIS 18 %, 2 = ITBIS 16 %, 3 = ITBIS 0 %, 4 = exento */
function indicadorFacturacion(tasa: string) {
  const v = Number(tasa);
  if (v === 0.18) return "1";
  if (v === 0.16) return "2";
  return "4";
}

function totalesPorTasa(d: DatosEcf) {
  const acc = { g1: new Decimal(0), g2: new Decimal(0), ex: new Decimal(0), i1: new Decimal(0), i2: new Decimal(0) };
  for (const l of d.lineas) {
    const ind = indicadorFacturacion(l.tasaItbis);
    if (ind === "1") { acc.g1 = acc.g1.plus(l.base); acc.i1 = acc.i1.plus(l.itbis); }
    else if (ind === "2") { acc.g2 = acc.g2.plus(l.base); acc.i2 = acc.i2.plus(l.itbis); }
    else acc.ex = acc.ex.plus(l.base);
  }
  const f = (x: Decimal) => x.toFixed(2);
  const gravado = acc.g1.plus(acc.g2);
  return {
    MontoGravadoTotal: gravado.gt(0) ? f(gravado) : null,
    MontoGravadoI1: acc.g1.gt(0) ? f(acc.g1) : null,
    MontoGravadoI2: acc.g2.gt(0) ? f(acc.g2) : null,
    MontoExento: acc.ex.gt(0) ? f(acc.ex) : null,
    ITBIS1: acc.g1.gt(0) ? "18" : null,
    ITBIS2: acc.g2.gt(0) ? "16" : null,
    TotalITBIS: gravado.gt(0) ? f(acc.i1.plus(acc.i2)) : null,
    TotalITBIS1: acc.g1.gt(0) ? f(acc.i1) : null,
    TotalITBIS2: acc.g2.gt(0) ? f(acc.i2) : null,
    MontoTotal: d.totales.total,
  };
}

function bloqueTotales(d: DatosEcf) {
  const x = totalesPorTasa(d);
  return `<Totales>${Object.entries(x).map(([k, v]) => t(k, v)).join("")}</Totales>`;
}

function bloquePagos(d: DatosEcf) {
  // Agrupar por forma de pago DGII
  const m = new Map<string, Decimal>();
  for (const p of d.pagos) {
    const k = FORMA_PAGO_DGII[p.formaPago] ?? "8";
    m.set(k, (m.get(k) ?? new Decimal(0)).plus(p.monto));
  }
  return `<TablaFormasPago>${[...m.entries()]
    .map(([k, v]) => `<FormaDePago>${t("FormaPago", k)}${t("MontoPago", v.toFixed(2))}</FormaDePago>`)
    .join("")}</TablaFormasPago>`;
}

/** XML del e-CF sin firmar (la firma se agrega al final del documento). */
export function construirEcf(d: DatosEcf, fechaFirma: Date): string {
  const tipo = d.tipo.slice(1);
  const idDoc = [
    t("TipoeCF", tipo),
    t("eNCF", d.encf),
    tipo !== "32" && tipo !== "34" ? t("FechaVencimientoSecuencia", fechaIso(d.venceSecuencia)) : "",
    // Nota de crédito: 0 = dentro de los 30 días de la factura original, 1 = después.
    // Según el formato de la DGII va justo después de FechaVencimientoSecuencia (el XSD exige ese orden).
    tipo === "34" && d.referencia
      ? t("IndicadorNotaCredito", (d.fechaEmision.getTime() - d.referencia.fecha.getTime()) / 86400e3 > 30 ? "1" : "0")
      : "",
    t("IndicadorMontoGravado", "1"), // los precios unitarios incluyen ITBIS
    t("TipoIngresos", "01"),         // 01 = ingresos por operaciones (no financieros)
    tipo !== "34" ? t("TipoPago", d.condicion === "CREDITO" ? "2" : "1") : "",
    tipo !== "34" && d.condicion === "CONTADO" ? bloquePagos(d) : "",
  ].join("");

  // 1 = anula el comprobante, 2 = corrige texto, 3 = corrige montos, 4 = reemplazo por contingencia
  const referencia = d.referencia
    ? `<InformacionReferencia>${t("NCFModificado", d.referencia.encf)}${t("FechaNCFModificado", fechaDGII(d.referencia.fecha))}` +
      `${t("CodigoModificacion", d.referencia.codigoModificacion)}${t("RazonModificacion", d.referencia.razon.slice(0, 90))}</InformacionReferencia>`
    : "";

  const emisor = [
    t("RNCEmisor", d.emisor.rnc),
    t("RazonSocialEmisor", d.emisor.razonSocial),
    t("NombreComercial", d.emisor.nombreComercial),
    t("DireccionEmisor", d.emisor.direccion),
    t("FechaEmision", fechaDGII(d.fechaEmision)),
  ].join("");

  const comprador = d.comprador?.rnc || d.comprador?.nombre
    ? `<Comprador>${t("RNCComprador", d.comprador.rnc)}${t("RazonSocialComprador", d.comprador.nombre)}</Comprador>`
    : "";

  const items = d.lineas.map((l, i) => [
    "<Item>",
    t("NumeroLinea", i + 1),
    t("IndicadorFacturacion", indicadorFacturacion(l.tasaItbis)),
    t("NombreItem", l.nombre.slice(0, 80)),
    t("IndicadorBienoServicio", l.esServicio ? "2" : "1"),
    t("CantidadItem", new Decimal(l.cantidad).toFixed(Number(l.cantidad) % 1 ? 3 : 2)),
    t("PrecioUnitarioItem", new Decimal(l.precioUnitario).toFixed(2)),
    Number(l.descuento) > 0 ? t("DescuentoMonto", new Decimal(l.descuento).toFixed(2)) : "",
    t("MontoItem", l.total),
    "</Item>",
  ].join("")).join("");

  return `<?xml version="1.0" encoding="utf-8"?>` +
    `<ECF><Encabezado>${t("Version", "1.0")}<IdDoc>${idDoc}</IdDoc><Emisor>${emisor}</Emisor>${comprador}${bloqueTotales(d)}</Encabezado>` +
    `<DetallesItems>${items}</DetallesItems>${referencia}${t("FechaHoraFirma", fechaHoraDGII(fechaFirma))}</ECF>`;
}

/** Resumen de Factura de Consumo (E32 menor a RD$250,000): es lo que se envía a la DGII. */
export function construirRfce(d: DatosEcf, codigoSeguridad: string): string {
  const idDoc = [
    t("TipoeCF", "32"),
    t("eNCF", d.encf),
    t("TipoIngresos", "01"),
    t("TipoPago", d.condicion === "CREDITO" ? "2" : "1"),
    d.condicion === "CONTADO" ? bloquePagos(d) : "",
  ].join("");
  const emisor = [t("RNCEmisor", d.emisor.rnc), t("RazonSocialEmisor", d.emisor.razonSocial), t("FechaEmision", fechaDGII(d.fechaEmision))].join("");
  const comprador = d.comprador?.rnc
    ? `<Comprador>${t("RNCComprador", d.comprador.rnc)}${t("RazonSocialComprador", d.comprador.nombre)}</Comprador>`
    : "";
  return `<?xml version="1.0" encoding="utf-8"?>` +
    `<RFCE><Encabezado>${t("Version", "1.0")}<IdDoc>${idDoc}</IdDoc><Emisor>${emisor}</Emisor>${comprador}` +
    `${bloqueTotales(d)}${t("CodigoSeguridadeCF", codigoSeguridad)}</Encabezado></RFCE>`;
}

export const LIMITE_RFCE = new Decimal("250000");
