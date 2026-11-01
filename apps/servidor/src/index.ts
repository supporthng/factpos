import "./entorno.js";
// Vercel reconoce la entrada del servidor porque este archivo importa fastify.
import type { FastifyInstance } from "fastify";
import { crearApp } from "./aplicacion.js";
import { config } from "./config.js";
import { migrar } from "./migrar.js";
import { iniciarCola } from "./fiscal/cola.js";
import { certificado } from "./fiscal/firma.js";
import { cargarCertificadoGuardado } from "./fiscal/certificado-guardado.js";
import { iniciarActualizacionPadron } from "./padron.js";
import { iniciarAnuncioEnRed } from "./red.js";
import { iniciarSincronizacion, resolverCentral, syncActiva } from "./sync/sucursal.js";
import { renovarSiToca } from "./licencia/cliente.js";
import { iniciarMaster } from "./master.js";
import { iniciarAlta } from "./sync/alta.js";
import { iniciarLatido, iniciarVigilancia } from "./incidentes.js";
import { iniciarRespaldos } from "./respaldo/respaldo.js";

/**
 * Punto de entrada del servidor FactPOS.
 * - En una sucursal (o en una PC de prueba): aplica migraciones, escucha y
 *   arranca la cola de envío de e-CF a la DGII.
 * - En Vercel (variable VERCEL): solo atiende peticiones. Las migraciones de
 *   Supabase las aplica GitHub Actions y la central no firma e-CF.
 */
const enVercel = !!process.env.VERCEL;

if (!enVercel) await migrar((m) => console.log(`[migraciones] ${m}`));
// Sucursal que conoce a su empresa pero no la dirección de su servidor principal: se la pide al portal
if (!enVercel && config.modo === "sucursal" && !process.env.CENTRAL_URL && process.env.FACTPOS_EMPRESA) {
  await resolverCentral((m) => console.log(`[sincronización] ${m}`));
}
let app: FastifyInstance;
try {
  if (enVercel && config.modo === "central" && !process.env.CLAVE_ACCESO) {
    throw new Error("Falta la variable CLAVE_ACCESO en Vercel (Settings › Environment Variables): la API en la nube no puede quedar abierta.");
  }
  app = await crearApp();
} catch (e) {
  if (!enVercel) throw e;
  // En Vercel, en vez de un 500 mudo, toda petición explica qué falta configurar
  const motivo = (e as Error).message;
  console.error(`[arranque] ${motivo}`);
  const { default: Fastify } = await import("fastify");
  app = Fastify();
  app.all("/*", async (_req, rep) => rep.code(503).send({ estado: "mal_configurado", causa: motivo }));
}
if (enVercel) {
  // Vercel intercepta listen() para quedarse con el servidor, pero nunca avisa
  // que "ya escucha": esperar ese aviso deja la función colgada y Vercel
  // responde 500 INTERNAL_FUNCTION_INVOCATION_FAILED. Se prepara la app y se
  // llama listen() sin esperarlo.
  await app.ready();
  app.listen({ port: config.puerto, host: config.host }).catch((e) => console.error(`[arranque] ${(e as Error).message}`));
} else {
  await app.listen({ port: config.puerto, host: config.host });
}

if (!enVercel && config.modo !== "portal") {
  // Facturación electrónica: certificado listo y cola de envío a la DGII
  await cargarCertificadoGuardado((m) => app.log.warn(m));
  const cert = certificado();
  app.log.info(cert.prueba ? "e-CF: usando CERTIFICADO DE PRUEBA (solo ambiente simulado)" : `e-CF: certificado de ${cert.titular}, vence ${cert.vence.toISOString().slice(0, 10)}`);
  iniciarCola((m) => app.log.info(m));
  // Padrón de RNC de la DGII: se actualiza solo una vez por semana si hay internet
  iniciarActualizacionPadron((m) => app.log.info(m));
  // Las cajas encuentran este servidor solas: factpos.local y respuesta a la búsqueda por UDP
  iniciarAnuncioEnRed(config.puerto, (m) => app.log.info(m));
  // Servidor de sucursal: sube ventas y baja precios/productos/traspasos de la central
  // (recién instalado: primero se da de alta con un código; después sincroniza solo)
  if (config.modo === "sucursal") {
    const arrancar = () => { if (!iniciarAlta((m) => app.log.warn(m))) iniciarSincronizacion((m) => app.log.info(m)); };
    // Sabe su empresa pero todavía no dónde está su servidor principal (sin internet al instalar): se reintenta
    if (!process.env.CENTRAL_URL && process.env.FACTPOS_EMPRESA) {
      const t = setInterval(async () => { if (await resolverCentral((m) => app.log.info(m))) { clearInterval(t); arrancar(); } }, 60_000);
      t.unref();
    } else arrancar();
  }
  // Si estuvo apagado, queda registrado; la central avisa a soporte
  await iniciarLatido((m) => app.log.warn(m));
  // Respaldos: automático a su hora, copia extra (USB/OneDrive), copia cifrada en la nube y aviso si se atrasan
  if (config.modo === "central" || !syncActiva()) iniciarRespaldos((m) => app.log.info(m));
  // Central fuera de Vercel: vigila cada minuto que las sucursales se comuniquen
  if (config.modo === "central") iniciarVigilancia((m) => app.log.warn(m));
  // Servidor MASTER (central instalado en el negocio): túnel, licencia y aviso al portal
  if (config.modo === "central") await iniciarMaster((m) => app.log.info(m));
  // Tienda que trabaja sola (sin nube): renueva su licencia con el portal cada hora si toca
  // Sin licencia, la instalación se anuncia al portal (solicitud de activación) poco después de arrancar
  if (config.modo === "central" || (config.modo === "sucursal" && !syncActiva())) setTimeout(() => renovarSiToca((m) => app.log.info(m)).catch(() => {}), 30_000).unref();
  if (config.modo === "sucursal" && !syncActiva()) setInterval(() => renovarSiToca((m) => app.log.info(m)).catch(() => {}), 3600_000).unref();
}
