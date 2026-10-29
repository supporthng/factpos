import type { PoolClient } from "pg";
import { Decimal } from "decimal.js";
import { uuidv7 } from "@factpos/compartido";
import { ErrorNegocio } from "../db.js";
import { construirEcf, construirRfce, LIMITE_RFCE, type DatosEcf } from "./xml.js";
import { firmarXml, codigoSeguridad, certificado } from "./firma.js";
import { urlQr } from "./qr.js";

export interface ResultadoFiscal {
  encf: string;
  codigoSeguridad: string;
  fechaFirma: string;
  urlQr: string;
  modo: "ECF" | "RFCE";
  venceSecuencia: string;
}

/**
 * Toma el siguiente e-NCF del bloque asignado a la sucursal.
 * El bloqueo de la fila hace que dos cajas nunca reciban el mismo número.
 */
export async function asignarEncf(c: PoolClient, sucursalId: string, tipo: string) {
  const r = await c.query<{ id: string; siguiente: string; vence_en: string }>(
    `SELECT id, siguiente, vence_en FROM ecf_rangos
      WHERE sucursal_id = $1 AND tipo_ecf = $2 AND activo AND siguiente <= hasta AND vence_en >= CURRENT_DATE
      ORDER BY desde LIMIT 1 FOR UPDATE`,
    [sucursalId, tipo],
  );
  if (!r.rowCount) {
    throw new ErrorNegocio(`No hay secuencias e-NCF ${tipo} disponibles en esta sucursal. Solicítelas a la administración.`, 409);
  }
  const rg = r.rows[0];
  await c.query("UPDATE ecf_rangos SET siguiente = siguiente + 1 WHERE id = $1", [rg.id]);
  return { rangoId: rg.id, encf: `${tipo}${String(rg.siguiente).padStart(10, "0")}`, venceSecuencia: rg.vence_en };
}

/**
 * Emite el e-CF de una venta dentro de su misma transacción:
 * número → XML → firma → código de seguridad → QR → cola de envío.
 */
export async function emitirEcfVenta(
  c: PoolClient, ventaId: string,
  /** Venta de contingencia: usa el e-NCF que la caja ya imprimió y su fecha real */
  reservado?: { encf: string; rangoId: string; fecha: string },
): Promise<ResultadoFiscal> {
  const v = (await c.query(
    `SELECT v.*, e.rnc AS emisor_rnc, e.razon_social, e.nombre_comercial,
            COALESCE(cf.direccion_emisor, '') AS direccion, COALESCE(cf.ambiente, 'SIMULADO') AS ambiente,
            cl.documento AS cliente_doc, cl.tipo_documento AS cliente_tipo_doc, cl.nombre AS cliente_nombre
       FROM ventas v
       JOIN sucursales s ON s.id = v.sucursal_id
       JOIN empresas e ON e.id = s.empresa_id
       LEFT JOIN configuracion_fiscal cf ON cf.empresa_id = e.id
       LEFT JOIN clientes cl ON cl.id = v.cliente_id
      WHERE v.id = $1`,
    [ventaId],
  )).rows[0];
  const items = (await c.query(
    `SELECT i.descripcion, i.cantidad, i.precio_unitario, i.descuento, i.tasa_itbis, i.itbis, i.total,
            NOT p.controla_stock AS es_servicio
       FROM venta_items i JOIN presentaciones pr ON pr.id = i.presentacion_id JOIN productos p ON p.id = pr.producto_id
      WHERE i.venta_id = $1 ORDER BY i.linea`,
    [ventaId],
  )).rows;
  const pagos = (await c.query("SELECT forma_pago, monto FROM venta_pagos WHERE venta_id = $1", [ventaId])).rows;

  if (certificado().prueba && v.ambiente !== "SIMULADO") {
    throw new ErrorNegocio("Esta sucursal no tiene el certificado digital activado: actívelo en Administración › Facturación electrónica › Certificado digital", 503);
  }
  const { rangoId, encf, venceSecuencia } = reservado
    ? { ...reservado, venceSecuencia: (await c.query("SELECT vence_en FROM ecf_rangos WHERE id = $1", [reservado.rangoId])).rows[0].vence_en }
    : await asignarEncf(c, v.sucursal_id, v.tipo_documento);
  const ahora = new Date();
  const emision = reservado ? new Date(reservado.fecha) : ahora;
  const rncComprador = v.cliente_tipo_doc === "RNC" || v.cliente_tipo_doc === "CEDULA" ? v.cliente_doc : null;

  const datos: DatosEcf = {
    tipo: v.tipo_documento,
    encf,
    venceSecuencia,
    fechaEmision: emision,
    emisor: { rnc: v.emisor_rnc, razonSocial: v.razon_social, nombreComercial: v.nombre_comercial, direccion: v.direccion || "N/D" },
    comprador: v.cliente_id ? { rnc: rncComprador, nombre: v.cliente_nombre } : null,
    condicion: v.condicion,
    pagos: pagos.map((p) => ({ formaPago: p.forma_pago, monto: p.monto })),
    lineas: items.map((i) => ({
      nombre: i.descripcion, cantidad: i.cantidad, precioUnitario: i.precio_unitario, descuento: i.descuento,
      tasaItbis: i.tasa_itbis, base: new Decimal(i.total).minus(i.itbis).toFixed(2), itbis: i.itbis, total: i.total,
      esServicio: i.es_servicio,
    })),
    totales: { subtotal: v.subtotal, itbis: v.itbis, total: v.total },
  };

  // Nota de crédito: referencia al e-CF que anula
  if (v.tipo_documento === "E34") {
    const o = (await c.query("SELECT encf, fecha_firma FROM ecf_documentos WHERE venta_id = $1", [v.venta_origen_id])).rows[0];
    if (!o?.encf) throw new ErrorNegocio("La factura original no tiene e-NCF");
    datos.referencia = { encf: o.encf, fecha: new Date(o.fecha_firma), codigoModificacion: "1", razon: v.motivo ?? "Anulación" };
  }

  // Las notas de crédito (E34) se envían siempre completas
  const modo: "ECF" | "RFCE" = v.tipo_documento === "E32" && new Decimal(v.total).lt(LIMITE_RFCE) ? "RFCE" : "ECF";
  const { xmlFirmado, signatureValue } = firmarXml(construirEcf(datos, ahora));
  const codigo = codigoSeguridad(signatureValue);
  const qr = urlQr({
    rncEmisor: v.emisor_rnc, rncComprador, encf, fechaEmision: emision, montoTotal: v.total,
    fechaFirma: ahora, codigoSeguridad: codigo, modo, ambiente: v.ambiente,
  });

  // Lo que se transmite: el resumen (RFCE) para consumo < 250 mil; el e-CF completo para lo demás.
  // El e-CF firmado siempre se conserva.
  const aTransmitir = modo === "RFCE" ? firmarXml(construirRfce(datos, codigo)).xmlFirmado : xmlFirmado;

  await c.query(
    `INSERT INTO ecf_documentos (id, sucursal_id, venta_id, tipo_ecf, encf, rango_id, modo_envio, monto_total,
                                 rnc_comprador, fecha_emision, fecha_firma, xml, codigo_seguridad, url_qr, xml_envio)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [uuidv7(), v.sucursal_id, ventaId, v.tipo_documento, encf, rangoId, modo, v.total, rncComprador,
     new Date(emision.getTime() - 4 * 3600e3).toISOString().slice(0, 10), ahora, xmlFirmado, codigo, qr,
     aTransmitir],
  );

  return { encf, codigoSeguridad: codigo, fechaFirma: ahora.toISOString(), urlQr: qr, modo, venceSecuencia };
}
