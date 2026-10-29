import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ErrorNegocio } from "../db.js";
import { actualizarPadronDesdeDgii, buscarEnPadron, cargarPadron, infoPadron, leerArchivoPadron } from "../padron.js";

const numero = z.string().regex(/^[\d-]{9,13}$/, "Número inválido");

/** Consulta para la caja: completa el nombre al escribir el RNC o la cédula. */
export async function rutasPadronCaja(app: FastifyInstance) {
  app.get("/cajas/:cajaId/rnc/:numero", async (req) => {
    const { numero: n } = z.object({ cajaId: z.string().uuid(), numero }).parse(req.params);
    return { encontrado: await buscarEnPadron(n), padron: await infoPadron() };
  });
}

/** Administración: estado del padrón, actualizar desde la DGII o subir el archivo. */
export async function rutasPadronCentral(app: FastifyInstance) {
  const enVercel = !!process.env.VERCEL;

  app.get("/central/padron", async () => ({ ...(await infoPadron()), enVercel }));

  app.get("/central/rnc/:numero", async (req) => {
    const { numero: n } = z.object({ numero }).parse(req.params);
    return { encontrado: await buscarEnPadron(n) };
  });

  /** Descarga de la DGII en segundo plano; la pantalla consulta el estado. */
  app.post("/central/padron/actualizar", async () => {
    if (enVercel) throw new ErrorNegocio("En la nube el padrón lo carga GitHub Actions (tarea \"Padrón DGII\"), una vez al mes o a mano.");
    const i = await infoPadron();
    if (i?.estado === "CARGANDO") throw new ErrorNegocio("Ya se está cargando el padrón", 409);
    actualizarPadronDesdeDgii().catch((e) => app.log.warn(`Padrón DGII: ${e.message}`));
    return { iniciado: true };
  });

  /** Archivo DGII_RNC.zip (o el .txt) descargado a mano desde la página de la DGII. */
  await app.register(async (sub) => {
    sub.addContentTypeParser("application/octet-stream", { parseAs: "buffer", bodyLimit: 250 * 1024 * 1024 }, (_req, cuerpo, listo) => listo(null, cuerpo));
    sub.post("/central/padron/archivo", async (req) => {
      if (enVercel) throw new ErrorNegocio("En la nube el archivo es muy grande para subirlo por aquí: use la tarea \"Padrón DGII\" de GitHub Actions.");
      const datos = req.body as Buffer;
      if (!datos?.length) throw new ErrorNegocio("No llegó ningún archivo");
      let lista;
      try { lista = leerArchivoPadron(new Uint8Array(datos)); } catch (e) { throw new ErrorNegocio((e as Error).message); }
      const registros = await cargarPadron(lista, "Archivo subido");
      return { registros };
    });
  });
}
