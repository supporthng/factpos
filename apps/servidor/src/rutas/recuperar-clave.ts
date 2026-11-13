import type { FastifyInstance } from "fastify";
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { pool, ErrorNegocio } from "../db.js";
import { claveSegura, hashClave } from "../sesion.js";
import { ipCliente } from "../seguridad-web.js";
import { correoRecuperacion } from "../correo/plantillas.js";
import { correoListo, enviarCorreo } from "../correo/transporte.js";
import { marcaDe } from "../correo/envios.js";
import { frenar, fallo, olvidarUsuario } from "./sesion.js";

/**
 * «¿Olvidó su contraseña?» en la pantalla de entrada de la administración.
 *  1. El usuario escribe su correo (el usuario debe ser un correo): se le envía un código de 6 dígitos que vale 15 minutos.
 *  2. Escribe el código y la contraseña nueva.
 * La respuesta de «solicitar» es siempre la misma exista o no el usuario (no revela quién tiene cuenta). Si la empresa
 * no tiene el correo configurado, no sale nada: quien administra puede restablecer la contraseña desde Usuarios.
 */
const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const huella = (codigo: string, usuarioId: string) => createHash("sha256").update(`${usuarioId}:${codigo}`).digest("hex");
const iguales = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const MENSAJE = "Si ese correo tiene cuenta y el correo del sistema está configurado, le enviamos un código. Vale 15 minutos.";

interface Candidato { id: string; nombre: string; empresa_id: string }
const buscar = (usuario: string) => pool.query<Candidato>(
  "SELECT id, nombre, empresa_id FROM usuarios WHERE lower(usuario) = $1 AND activo", [usuario]).then((r) => r.rows);

export async function rutasRecuperarClave(app: FastifyInstance) {
  app.post("/central/recuperar/solicitar", async (req) => {
    const b = z.object({ usuario: z.string().trim().toLowerCase().min(3).max(50) }).parse(req.body);
    const ip = `rec:ip:${ipCliente(req)}`, quien = `rec:u:${b.usuario}`;
    frenar(ip, 8); frenar(quien, 3);
    fallo(ip, 15); fallo(quien, 10); // cada solicitud cuenta: no se puede usar para llenar un buzón de correos
    if (!CORREO.test(b.usuario)) return { ok: true, mensaje: MENSAJE };
    for (const u of await buscar(b.usuario)) {
      try {
        if (!(await correoListo(u.empresa_id))) { console.warn(`[recuperar] la empresa ${u.empresa_id} no tiene el correo configurado`); continue; }
        const codigo = String(randomInt(0, 1_000_000)).padStart(6, "0");
        await pool.query(
          `INSERT INTO recuperacion_clave (usuario_id, huella, vence_en) VALUES ($1,$2, now() + interval '15 minutes')
           ON CONFLICT (usuario_id) DO UPDATE SET huella = EXCLUDED.huella, vence_en = EXCLUDED.vence_en, intentos = 0, creado_en = now()`,
          [u.id, huella(codigo, u.id)]);
        const c = correoRecuperacion(await marcaDe(u.empresa_id), u.nombre, codigo);
        await enviarCorreo(u.empresa_id, { para: [b.usuario], ...c });
      } catch (e) {
        console.warn("[recuperar] no se pudo enviar el código:", (e as Error).message);
      }
    }
    return { ok: true, mensaje: MENSAJE };
  });

  app.post("/central/recuperar/confirmar", async (req) => {
    const b = z.object({ usuario: z.string().trim().toLowerCase().min(3).max(50), codigo: z.string().trim().regex(/^\d{6}$/, "El código tiene 6 dígitos"), clave: z.string().min(1).max(200) }).parse(req.body);
    const ip = `rec:ip:${ipCliente(req)}`, quien = `rec:c:${b.usuario}`;
    frenar(ip, 10); frenar(quien, 6);
    const debil = claveSegura(b.clave);
    if (debil) throw new ErrorNegocio(debil, 400);
    for (const u of await buscar(b.usuario)) {
      const r = (await pool.query<{ huella: string; vence_en: Date; intentos: number }>("SELECT huella, vence_en, intentos FROM recuperacion_clave WHERE usuario_id = $1", [u.id])).rows[0];
      if (!r || r.intentos >= 5 || new Date(r.vence_en).getTime() < Date.now()) continue;
      if (!iguales(r.huella, huella(b.codigo, u.id))) { await pool.query("UPDATE recuperacion_clave SET intentos = intentos + 1 WHERE usuario_id = $1", [u.id]); continue; }
      await pool.query("UPDATE usuarios SET clave_hash = $2 WHERE id = $1", [u.id, await hashClave(b.clave)]);
      await pool.query("DELETE FROM recuperacion_clave WHERE usuario_id = $1", [u.id]);
      await pool.query("DELETE FROM usuarios_clave_temporal WHERE usuario_id = $1", [u.id]).catch(() => {});
      olvidarUsuario(u.id);
      return { ok: true };
    }
    fallo(ip, 15); fallo(quien, 10);
    throw new ErrorNegocio("El código es incorrecto o ya venció. Pida uno nuevo.", 400);
  });
}
