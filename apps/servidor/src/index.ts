import "./entorno.js";
// Vercel reconoce la entrada del servidor porque este archivo importa fastify.
import type { FastifyInstance } from "fastify";
import { crearApp } from "./aplicacion.js";
import { config } from "./config.js";
import { migrar } from "./migrar.js";
import { iniciarCola } from "./fiscal/cola.js";
import { certificado } from "./fiscal/firma.js";
import { iniciarActualizacionPadron } from "./padron.js";
import { iniciarAnuncioEnRed } from "./red.js";
import { iniciarSincronizacion } from "./sync/sucursal.js";
import { iniciarLatido, iniciarVigilancia } from "./incidentes.js";

/**
 * Punto de entrada del servidor FactPOS.
 * - En una sucursal (o en una PC de prueba): aplica migraciones, escucha y
 *   arranca la cola de envío de e-CF a la DGII.
 * - En Vercel (variable VERCEL): solo atiende peticiones. Las migraciones de
 *   Supabase las aplica GitHub Actions y la central no firma e-CF.
 */
const enVercel = !!process.env.VERCEL;

if (!enVercel) await migrar((m) => console.log(`[migraciones] ${m}`));
let app: FastifyInstance;
try {
  if (enVercel && !process.env.CLAVE_ACCESO) {
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

if (!enVercel) {
  // Facturación electrónica: certificado listo y cola de envío a la DGII
  const cert = certificado();
  app.log.info(cert.prueba ? "e-CF: usando CERTIFICADO DE PRUEBA (solo ambiente simulado)" : `e-CF: certificado de ${cert.titular}, vence ${cert.vence.toISOString().slice(0, 10)}`);
  iniciarCola((m) => app.log.info(m));
  // Padrón de RNC de la DGII: se actualiza solo una vez por semana si hay internet
  iniciarActualizacionPadron((m) => app.log.info(m));
  // Las cajas encuentran este servidor solas: factpos.local y respuesta a la búsqueda por UDP
  iniciarAnuncioEnRed(config.puerto, (m) => app.log.info(m));
  // Servidor de sucursal: sube ventas y baja precios/productos/traspasos de la central
  if (config.modo === "sucursal") iniciarSincronizacion((m) => app.log.info(m));
  // Si estuvo apagado, queda registrado; la central avisa a soporte
  await iniciarLatido((m) => app.log.warn(m));
  // Central fuera de Vercel: vigila cada minuto que las sucursales se comuniquen
  if (config.modo === "central") iniciarVigilancia((m) => app.log.warn(m));
}
