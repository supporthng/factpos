import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { pool } from "../db.js";
import { TIPOS_ECF_SOPORTADOS } from "./xml.js";

/**
 * ¿Puede FactPOS (el software) emitir e-CF según lo que exige la DGII para certificarse?
 * Se revisa lo que el propio sistema tiene construido y, donde se puede, se detecta en ejecución
 * (rutas públicas, esquemas XSD). Lo que falta se explica paso a paso.
 * Fuente de los requisitos: «Proceso de Certificación para ser Emisor Electrónico» (DGII, julio 2025).
 */
export type EstadoReq = "ok" | "falta" | "parcial";
export interface Requisito { id: string; titulo: string; exige: string; estado: EstadoReq; detalle: string; pasos: string[] }

/** Tipos que exige el set de pruebas de simulación de la DGII. */
export const TIPOS_EXIGIDOS = ["E31", "E32", "E33", "E34", "E41", "E43", "E44", "E45", "E46", "E47"] as const;

/**
 * Lo que existe como código. Al construir cada pieza, se pone en true aquí (y esta lista deja de decir «falta»).
 * Solo se marca true lo que está construido de verdad.
 */
export const CAPACIDADES = {
  resumenConsumo: true,        // RFCE de facturas de consumo < RD$250,000
  firmaXml: true,              // XMLDSig RSA-SHA256
  codigoSeguridadQr: true,     // código de seguridad y URL del QR
  envioDgii: true,             // autenticación por semilla, recepción y consulta de resultado
  acuseRecibo: false,          // ARECF: responder a los e-CF que envía la DGII
  aprobacionComercial: false,  // ACECF: generar y recibir aprobaciones/rechazos comerciales
  anulacionSecuencias: false,  // ANECF: anular rangos de e-NCF no usados
  representacionPdf: false,    // PDF de la representación impresa por tipo (con QR)
  importadorSetPruebas: false, // leer el Excel de la DGII y generar/enviar los XML
} as const;

const RUTAS_PUBLICAS: [string, string][] = [
  ["GET", "/fe/autenticacion/api/semilla"], ["POST", "/fe/autenticacion/api/validacioncertificado"],
  ["POST", "/fe/recepcion/api/ecf"], ["POST", "/fe/aprobacioncomercial/api/ecf"],
];

function xsdDisponibles() {
  try {
    const dir = fileURLToPath(new URL("../../xsd", import.meta.url));
    return existsSync(dir) ? readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".xsd")).length : 0;
  } catch { return 0; }
}

export async function verificarSoftware(app: FastifyInstance) {
  const r: Requisito[] = [];
  const faltan = TIPOS_EXIGIDOS.filter((t) => !(TIPOS_ECF_SOPORTADOS as readonly string[]).includes(t));
  r.push({
    id: "tipos", titulo: "Tipos de comprobante electrónico", exige: "La simulación pide los 10 tipos: E31, E32, E33, E34, E41, E43, E44, E45, E46 y E47.",
    estado: faltan.length === 0 ? "ok" : "parcial",
    detalle: faltan.length === 0 ? "Se generan los 10 tipos." : `Se generan ${TIPOS_ECF_SOPORTADOS.join(", ")}. Faltan ${faltan.join(", ")}.`,
    pasos: faltan.length === 0 ? [] : [
      "Descargar de la DGII el formato (PDF) y el esquema XSD de cada tipo faltante.",
      "Construir el generador de XML de cada tipo según su formato.",
      "Validar cada XML contra su XSD hasta que no tenga errores.",
    ],
  });
  r.push({ id: "rfce", titulo: "Resumen de factura de consumo (< RD$250,000)", exige: "Cada factura de consumo menor a RD$250,000 se envía como resumen (RFCE) y la factura completa se conserva.",
    estado: CAPACIDADES.resumenConsumo ? "ok" : "falta", detalle: CAPACIDADES.resumenConsumo ? "Implementado." : "No existe.", pasos: [] });
  r.push({ id: "firma", titulo: "Firma digital del XML", exige: "Todo XML se firma con el certificado digital (XMLDSig, RSA-SHA256).",
    estado: CAPACIDADES.firmaXml ? "ok" : "falta", detalle: CAPACIDADES.firmaXml ? "Implementado." : "No existe.", pasos: [] });
  r.push({ id: "qr", titulo: "Código de seguridad y QR", exige: "La representación impresa lleva el código de seguridad y un QR legible por la DGII.",
    estado: CAPACIDADES.codigoSeguridadQr ? "ok" : "falta", detalle: CAPACIDADES.codigoSeguridadQr ? "Implementado." : "No existe.", pasos: [] });
  r.push({ id: "envio", titulo: "Envío a la DGII", exige: "Autenticarse con semilla firmada, enviar e-CF y resúmenes, y consultar el resultado por TrackId.",
    estado: CAPACIDADES.envioDgii ? "ok" : "falta",
    detalle: CAPACIDADES.envioDgii ? "Implementado; falta comprobar con el ambiente de pruebas de la DGII (CerteCF)." : "No existe.",
    pasos: [] });
  const xsd = xsdDisponibles();
  r.push({ id: "xsd", titulo: "Validación contra los esquemas XSD de la DGII", exige: "Los XML deben coincidir con los esquemas oficiales; la DGII rechaza el que no cumpla.",
    estado: xsd >= TIPOS_EXIGIDOS.length ? "ok" : xsd > 0 ? "parcial" : "falta",
    detalle: xsd ? `Hay ${xsd} esquema(s) XSD en el proyecto.` : "No hay esquemas XSD en el proyecto: el XML no se ha validado contra los oficiales.",
    pasos: xsd >= TIPOS_EXIGIDOS.length ? [] : [
      "Descargar de dgii.gov.do los XSD del e-CF (uno por tipo), del resumen de consumo, del acuse de recibo, de la aprobación comercial y de la anulación.",
      "Guardarlos en apps/servidor/xsd.",
      "Agregar una prueba automática que valide cada XML generado contra su XSD.",
    ] });
  const sin = RUTAS_PUBLICAS.filter(([m, u]) => !app.hasRoute({ method: m as "GET" | "POST", url: u }));
  r.push({ id: "urls", titulo: "Direcciones públicas que llama la DGII", exige: "Tres servicios en https: autenticación (semilla y validación de certificado), recepción de e-CF y aprobación comercial.",
    estado: sin.length === 0 ? "ok" : sin.length < RUTAS_PUBLICAS.length ? "parcial" : "falta",
    detalle: sin.length === 0 ? "Las 4 rutas existen en este servidor." : `No existen: ${sin.map(([m, u]) => `${m} ${u}`).join(" · ")}.`,
    pasos: sin.length === 0 ? [] : [
      "Construir las rutas en el servidor que tendrá la dirección pública (hoy el portal y las sucursales no las tienen).",
      "Publicarlas bajo un dominio https estable (la DGII las registra en el formulario de postulación).",
      "Probar con el botón «Enviar prueba de comprobantes» del portal de certificación de la DGII.",
    ] });
  r.push({ id: "acuse", titulo: "Acuse de recibo (ARECF)", exige: "Al recibir un e-CF de la DGII hay que responder con un acuse de recibo firmado.",
    estado: CAPACIDADES.acuseRecibo ? "ok" : "falta", detalle: CAPACIDADES.acuseRecibo ? "Implementado." : "No existe.",
    pasos: CAPACIDADES.acuseRecibo ? [] : ["Descargar el formato y el XSD del acuse de recibo.", "Construir y firmar el XML de respuesta.", "Responder desde la ruta de recepción."] });
  r.push({ id: "aprobacion", titulo: "Aprobación o rechazo comercial (ACECF)", exige: "Generar aprobaciones/rechazos comerciales (set de 11) y recibir las que envía la DGII, respondiendo OK o Error.",
    estado: CAPACIDADES.aprobacionComercial ? "ok" : "falta", detalle: CAPACIDADES.aprobacionComercial ? "Implementado." : "No existe.",
    pasos: CAPACIDADES.aprobacionComercial ? [] : ["Descargar el formato y el XSD de la aprobación comercial.", "Construir, firmar y enviar el XML al servicio de aprobación comercial.", "Recibirlas en la ruta pública de aprobación comercial."] });
  r.push({ id: "anulacion", titulo: "Anulación de secuencias (ANECF)", exige: "Informar a la DGII los rangos de e-NCF que no se usaron.",
    estado: CAPACIDADES.anulacionSecuencias ? "ok" : "falta", detalle: CAPACIDADES.anulacionSecuencias ? "Implementado." : "No existe.",
    pasos: CAPACIDADES.anulacionSecuencias ? [] : ["Descargar el formato y el XSD de anulación de e-NCF.", "Construir la pantalla y el envío en Fiscal."] });
  r.push({ id: "pdf", titulo: "Representación impresa en PDF", exige: "Subir al portal de la DGII un PDF por tipo, con el orden y los datos exigidos y el QR.",
    estado: CAPACIDADES.representacionPdf ? "ok" : "parcial",
    detalle: CAPACIDADES.representacionPdf ? "Implementado." : "El ticket de 80 mm con QR existe en la caja, pero no se genera un PDF por tipo ni se ha validado con el formato de la DGII.",
    pasos: CAPACIDADES.representacionPdf ? [] : ["Descargar el Informe Técnico e-CF v1.0 (reglas de la representación impresa).", "Generar el PDF de cada tipo con esos campos y el QR.", "Subir los PDF en el paso 5 del portal de certificación."] });
  r.push({ id: "set", titulo: "Pruebas de datos (set de la DGII)", exige: "Leer el Excel que entrega la DGII y generar los XML con los mismos campos y orden.",
    estado: CAPACIDADES.importadorSetPruebas ? "ok" : "falta", detalle: CAPACIDADES.importadorSetPruebas ? "Implementado." : "No existe.",
    pasos: CAPACIDADES.importadorSetPruebas ? [] : ["Descargar el set de pruebas del portal de certificación.", "Construir el módulo que lo lee, genera, firma y envía cada XML mostrando su estado."] });

  // Trámite en el portal
  type FilaCert = { autorizado: boolean; pasos: Record<string, { estado?: string }> };
  const c = (await pool.query<FilaCert>("SELECT autorizado, pasos FROM portal_certificacion_dgii WHERE id = 1").catch(() => ({ rows: [] as FilaCert[] }))).rows[0];
  const hechos = Object.values(c?.pasos ?? {}).filter((x) => x.estado === "HECHO").length;
  r.push({ id: "autorizacion", titulo: "Autorización de la DGII", exige: "Completar los 15 pasos del proceso y que la DGII autorice como emisor electrónico.",
    estado: c?.autorizado ? "ok" : hechos > 0 ? "parcial" : "falta",
    detalle: c?.autorizado ? "FactPOS está autorizado." : `${hechos} de 15 pasos completados.`,
    pasos: c?.autorizado ? [] : ["Marcar el avance en esta misma pantalla (Pasos del proceso).", "Completar las pruebas en el portal de certificación de la DGII.", "Presentar la declaración jurada firmada."] });

  const pendientes = r.filter((x) => x.estado !== "ok");
  return {
    puedeFacturar: pendientes.length === 0,
    resumen: pendientes.length === 0 ? "FactPOS cumple todo lo que exige la DGII para facturar con e-CF." : `FactPOS todavía no puede facturar con e-CF en producción: ${pendientes.length} requisito(s) pendiente(s).`,
    requisitos: r, revisadoEn: new Date().toISOString(),
  };
}
