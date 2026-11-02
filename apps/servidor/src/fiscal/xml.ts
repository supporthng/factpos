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
export const TIPOS_ECF_SOPORTADOS = ["E31", "E32", "E33", "E34", "E41", "E43", "E44", "E45", "E46", "E47"] as const;
export type TipoEcf = (typeof TIPOS_ECF_SOPORTADOS)[number];

export interface DatosEcf {
  tipo: TipoEcf;
  encf: string;
  venceSecuencia: string;          // AAAA-MM-DD
  fechaEmision: Date;
  emisor: { rnc: string; razonSocial: string; nombreComercial?: string | null; direccion: string };
  comprador?: { rnc: string | null; nombre: string | null; identificadorExtranjero?: string | null; pais?: string | null } | null;
  /** 01 por defecto (ingresos por operaciones) */
  tipoIngresos?: string;
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
    /** E41 y E47: retención o percepción sobre la línea */
    retencion?: { itbis?: string; isr?: string };
  }[];
  totales: { subtotal: string; itbis: string; total: string };
  /** Notas (E33 y E34): comprobante que se modifica. En otros tipos es opcional. */
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

/** 1 = ITBIS 18 %, 2 = ITBIS 16 %, 3 = ITBIS 0 % (exportación), 4 = exento */
function indicadorFacturacion(tasa: string, tipo: TipoEcf = "E32") {
  const v = Number(tasa);
  if (tipo === "E43" || tipo === "E47") return "4";   // gastos menores y pagos al exterior: sin ITBIS
  if (tipo === "E46") return "3";                    // exportación: gravado a tasa 0
  if (v === 0.18) return "1";
  if (v === 0.16) return "2";
  return "4";
}

/** Orden en el que el esquema exige los campos de Totales, y cuáles admite cada tipo. */
const ORDEN_TOTALES = ["MontoGravadoTotal", "MontoGravadoI1", "MontoGravadoI2", "MontoGravadoI3", "MontoExento", "ITBIS1", "ITBIS2", "ITBIS3",
  "TotalITBIS", "TotalITBIS1", "TotalITBIS2", "TotalITBIS3", "MontoTotal", "TotalITBISRetenido", "TotalISRRetencion"] as const;
const TOTALES_POR_TIPO: Record<TipoEcf, readonly string[]> = {
  E31: ORDEN_TOTALES, E32: ORDEN_TOTALES, E33: ORDEN_TOTALES, E34: ORDEN_TOTALES, E45: ORDEN_TOTALES,
  E41: ORDEN_TOTALES,
  E43: ["MontoExento", "MontoTotal"],
  E44: ["MontoExento", "MontoTotal"],
  E46: ["MontoGravadoTotal", "MontoGravadoI3", "ITBIS3", "TotalITBIS", "TotalITBIS3", "MontoTotal"],
  E47: ["MontoExento", "MontoTotal", "TotalISRRetencion"],
};

function totalesPorTasa(d: DatosEcf) {
  const z = () => new Decimal(0);
  const acc = { g1: z(), g2: z(), g3: z(), ex: z(), i1: z(), i2: z(), ret: z(), isr: z() };
  for (const l of d.lineas) {
    const ind = indicadorFacturacion(l.tasaItbis, d.tipo);
    if (ind === "1") { acc.g1 = acc.g1.plus(l.base); acc.i1 = acc.i1.plus(l.itbis); }
    else if (ind === "2") { acc.g2 = acc.g2.plus(l.base); acc.i2 = acc.i2.plus(l.itbis); }
    else if (ind === "3") acc.g3 = acc.g3.plus(l.base);
    else acc.ex = acc.ex.plus(l.base);
    if (l.retencion?.itbis) acc.ret = acc.ret.plus(l.retencion.itbis);
    if (l.retencion?.isr) acc.isr = acc.isr.plus(l.retencion.isr);
  }
  const f = (x: Decimal) => x.toFixed(2);
  const gravado = acc.g1.plus(acc.g2).plus(acc.g3);
  return {
    MontoGravadoTotal: gravado.gt(0) ? f(gravado) : null,
    MontoGravadoI1: acc.g1.gt(0) ? f(acc.g1) : null,
    MontoGravadoI2: acc.g2.gt(0) ? f(acc.g2) : null,
    MontoGravadoI3: acc.g3.gt(0) ? f(acc.g3) : null,
    MontoExento: acc.ex.gt(0) ? f(acc.ex) : null,
    ITBIS1: acc.g1.gt(0) ? "18" : null,
    ITBIS2: acc.g2.gt(0) ? "16" : null,
    ITBIS3: acc.g3.gt(0) ? "0" : null,
    TotalITBIS: gravado.gt(0) ? f(acc.i1.plus(acc.i2)) : null,
    TotalITBIS1: acc.g1.gt(0) ? f(acc.i1) : null,
    TotalITBIS2: acc.g2.gt(0) ? f(acc.i2) : null,
    TotalITBIS3: acc.g3.gt(0) ? "0.00" : null,
    MontoTotal: d.totales.total,
    TotalITBISRetenido: acc.ret.gt(0) ? f(acc.ret) : null,
    TotalISRRetencion: acc.isr.gt(0) ? f(acc.isr) : null,
  } as Record<string, string | null>;
}

function bloqueTotales(d: DatosEcf, resumen = false) {
  const x = totalesPorTasa(d);
  const permitidos = TOTALES_POR_TIPO[d.tipo];
  // El resumen (RFCE) no lleva las tasas ITBIS1/ITBIS2/ITBIS3 ni retenciones (el esquema no las admite)
  const fuera = resumen ? ["ITBIS1", "ITBIS2", "ITBIS3", "TotalITBISRetenido", "TotalISRRetencion"] : [];
  const claves = ORDEN_TOTALES.filter((k) => permitidos.includes(k) && !fuera.includes(k));
  return `<Totales>${claves.map((k) => t(k, x[k])).join("")}</Totales>`;
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

type Comprador = "obligatorio" | "razon" | "opcional" | "vacio" | "ninguno" | "extranjero";
interface Espec { vence: boolean; ingresos: boolean; pago: boolean; tablaPagos: boolean; montoGravado: boolean; comprador: Comprador; retencion?: boolean }
/** Qué lleva cada tipo según su esquema XSD de la DGII. */
const ESPEC: Record<TipoEcf, Espec> = {
  E31: { vence: true, ingresos: true, pago: true, tablaPagos: true, montoGravado: true, comprador: "obligatorio" },
  E32: { vence: false, ingresos: true, pago: true, tablaPagos: true, montoGravado: true, comprador: "vacio" },
  E33: { vence: true, ingresos: false, pago: true, tablaPagos: true, montoGravado: true, comprador: "opcional" },
  E34: { vence: false, ingresos: false, pago: true, tablaPagos: false, montoGravado: true, comprador: "opcional" },
  E41: { vence: true, ingresos: false, pago: true, tablaPagos: true, montoGravado: true, comprador: "obligatorio", retencion: true },
  E43: { vence: true, ingresos: false, pago: false, tablaPagos: false, montoGravado: false, comprador: "ninguno" },
  E44: { vence: true, ingresos: true, pago: true, tablaPagos: true, montoGravado: false, comprador: "razon" },
  E45: { vence: true, ingresos: true, pago: true, tablaPagos: true, montoGravado: true, comprador: "obligatorio" },
  E46: { vence: true, ingresos: true, pago: true, tablaPagos: true, montoGravado: false, comprador: "razon" },
  E47: { vence: true, ingresos: false, pago: false, tablaPagos: false, montoGravado: false, comprador: "extranjero", retencion: true },
};

function bloqueComprador(d: DatosEcf) {
  const c = d.comprador;
  const rnc = t("RNCComprador", c?.rnc), ext = t("IdentificadorExtranjero", c?.identificadorExtranjero), razon = t("RazonSocialComprador", c?.nombre);
  switch (ESPEC[d.tipo].comprador) {
    case "ninguno": return "";
    case "vacio": return c?.rnc || c?.nombre ? `<Comprador>${rnc}${razon}</Comprador>` : "<Comprador></Comprador>";
    case "opcional": return c?.rnc || c?.nombre || c?.identificadorExtranjero ? `<Comprador>${rnc}${ext}${razon}</Comprador>` : "";
    case "obligatorio": return `<Comprador>${rnc}${razon}</Comprador>`;
    case "razon": return `<Comprador>${rnc}${ext}${t("RazonSocialComprador", c?.nombre || "Cliente")}${d.tipo === "E46" ? t("PaisComprador", c?.pais) : ""}</Comprador>`;
    case "extranjero": return c?.identificadorExtranjero || c?.nombre ? `<Comprador>${ext}${razon}</Comprador>` : "";
  }
}

/** XML del e-CF sin firmar (la firma se agrega al final del documento). */
export function construirEcf(d: DatosEcf, fechaFirma: Date): string {
  const tipo = d.tipo.slice(1);
  const e = ESPEC[d.tipo];
  const idDoc = [
    t("TipoeCF", tipo),
    t("eNCF", d.encf),
    e.vence ? t("FechaVencimientoSecuencia", fechaIso(d.venceSecuencia)) : "",
    // Nota de crédito: 0 = dentro de los 30 días de la factura original, 1 = después (justo después del número, según el esquema)
    tipo === "34"
      ? t("IndicadorNotaCredito", d.referencia && (d.fechaEmision.getTime() - d.referencia.fecha.getTime()) / 86400e3 > 30 ? "1" : "0")
      : "",
    e.montoGravado ? t("IndicadorMontoGravado", "1") : "", // los precios unitarios incluyen ITBIS
    e.ingresos ? t("TipoIngresos", d.tipoIngresos ?? "01") : "", // 01 = ingresos por operaciones (no financieros)
    e.pago ? t("TipoPago", d.condicion === "CREDITO" ? "2" : "1") : "",
    e.tablaPagos && d.condicion === "CONTADO" ? bloquePagos(d) : "",
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

  const items = d.lineas.map((l, i) => [
    "<Item>",
    t("NumeroLinea", i + 1),
    t("IndicadorFacturacion", indicadorFacturacion(l.tasaItbis, d.tipo)),
    e.retencion
      ? `<Retencion>${t("IndicadorAgenteRetencionoPercepcion", "1")}${d.tipo === "E41" ? t("MontoITBISRetenido", l.retencion?.itbis) : ""}${t("MontoISRRetenido", l.retencion?.isr ?? (d.tipo === "E47" ? "0.00" : undefined))}</Retencion>`
      : "",
    t("NombreItem", l.nombre.slice(0, 80)),
    t("IndicadorBienoServicio", l.esServicio ? "2" : "1"),
    t("CantidadItem", new Decimal(l.cantidad).toFixed(Number(l.cantidad) % 1 ? 3 : 2)),
    t("PrecioUnitarioItem", new Decimal(l.precioUnitario).toFixed(2)),
    Number(l.descuento) > 0 && d.tipo !== "E43" && d.tipo !== "E47" ? t("DescuentoMonto", new Decimal(l.descuento).toFixed(2)) : "",
    t("MontoItem", l.total),
    "</Item>",
  ].join("")).join("");

  return `<?xml version="1.0" encoding="utf-8"?>` +
    `<ECF><Encabezado>${t("Version", "1.0")}<IdDoc>${idDoc}</IdDoc><Emisor>${emisor}</Emisor>${bloqueComprador(d)}${bloqueTotales(d)}</Encabezado>` +
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
  // En el resumen (RFCE) el bloque Comprador es obligatorio, aunque vaya vacío
  const comprador = d.comprador?.rnc
    ? `<Comprador>${t("RNCComprador", d.comprador.rnc)}${t("RazonSocialComprador", d.comprador.nombre)}</Comprador>`
    : "<Comprador></Comprador>";
  return `<?xml version="1.0" encoding="utf-8"?>` +
    `<RFCE><Encabezado>${t("Version", "1.0")}<IdDoc>${idDoc}</IdDoc><Emisor>${emisor}</Emisor>${comprador}` +
    `${bloqueTotales(d, true)}${t("CodigoSeguridadeCF", codigoSeguridad)}</Encabezado></RFCE>`;
}

export const LIMITE_RFCE = new Decimal("250000");
