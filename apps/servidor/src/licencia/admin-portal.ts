import { uuidv7 } from "@factpos/compartido";
import { enTransaccion } from "../db.js";
import { hashClave } from "../sesion.js";

/** Usuarios de la demostración que trae la base (admin / admin1234, cajera y supervisor): en el portal no deben poder entrar. */
const USUARIOS_DEMO = ["01900000-0000-7000-8000-000000000031", "01900000-0000-7000-8000-000000000032", "01900000-0000-7000-8000-000000000033"];
const EMPRESA_DEMO = "01900000-0000-7000-8000-000000000001";

let hecho: Promise<void> | null = null;

/**
 * Deja listo el acceso del dueño al portal (solo en MODO=portal).
 *  - PORTAL_ADMIN_CORREO: el correo con el que entra. PORTAL_ADMIN_CLAVE_INICIAL: su contraseña de la primera vez.
 *  - Si ese usuario no existe, lo crea como administrador total y lo marca para que cambie la contraseña al entrar.
 *    Si ya existe NO le toca la contraseña (así un reinicio no deshace el cambio que ya hizo).
 *  - Desactiva los usuarios de demostración (el portal no es una demo).
 * Se llama antes de cada inicio de sesión pero trabaja una sola vez por arranque del servidor.
 */
export function prepararAdminPortal(): Promise<void> {
  if (!hecho) hecho = trabajo().catch((e) => { hecho = null; console.warn("[portal] no se pudo preparar el acceso del administrador:", (e as Error).message); });
  return hecho;
}

async function trabajo() {
  const correo = (process.env.PORTAL_ADMIN_CORREO ?? "").trim().toLowerCase();
  const clave = process.env.PORTAL_ADMIN_CLAVE_INICIAL ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo) || correo.length > 50 || clave.length < 8) return;
  await enTransaccion(async (c) => {
    // La empresa del portal: la del usuario administrador que ya exista (si no, la primera)
    const emp = (await c.query<{ id: string }>(
      `SELECT e.id FROM empresas e ORDER BY (e.id = $1) DESC, e.id LIMIT 1`, [EMPRESA_DEMO])).rows[0];
    if (!emp) return; // base vacía: se configura con el primer uso
    const rol = (await c.query<{ id: string }>("SELECT id FROM roles WHERE empresa_id = $1 AND '*' = ANY(permisos) ORDER BY nombre LIMIT 1", [emp.id])).rows[0];
    if (!rol) return;
    const ya = await c.query("SELECT 1 FROM usuarios WHERE empresa_id = $1 AND lower(usuario) = $2", [emp.id, correo]);
    if (!ya.rowCount) {
      const id = uuidv7();
      await c.query("INSERT INTO usuarios (id, empresa_id, rol_id, nombre, usuario, clave_hash) VALUES ($1,$2,$3,'Administrador',$4,$5)", [id, emp.id, rol.id, correo, await hashClave(clave)]);
      await c.query("INSERT INTO usuarios_clave_temporal (usuario_id) VALUES ($1) ON CONFLICT DO NOTHING", [id]);
    }
    await c.query("UPDATE usuarios SET activo = FALSE WHERE id = ANY($1::uuid[]) AND activo", [USUARIOS_DEMO]);
    await c.query("UPDATE empresas SET nombre_comercial = 'FactPOS' WHERE id = $1 AND nombre_comercial = 'Supermercado Demo'", [EMPRESA_DEMO]);
  });
}
