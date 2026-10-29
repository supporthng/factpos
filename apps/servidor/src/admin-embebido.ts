/**
 * Archivos de la administración web (apps/admin/dist) dentro del código del
 * servidor, para que el PORTAL los sirva también en Vercel.
 * Este archivo es solo un marcador: al compilar, scripts/embeber-admin.mjs
 * escribe dist/admin-embebido.js con los archivos reales.
 *   ruta → [tipo de contenido, contenido en base64]
 */
export const ARCHIVOS_ADMIN: Record<string, [string, string]> | null = null;
