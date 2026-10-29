// En cada despliegue de Vercel (portal o nube de un cliente) se aplican las
// migraciones nuevas a SU base de datos antes de publicar el código nuevo.
// Así, al actualizar FactPOS, cada cliente queda con su base al día solo.
// Si falla, el despliegue no se publica (el sistema sigue con la versión anterior).
import { execSync } from "node:child_process";

if (!process.env.DATABASE_URL) {
  console.warn("[migraciones] Sin DATABASE_URL en el build: no se migra (configúrela en Vercel › Environment Variables).");
  process.exit(0);
}
if (process.env.MIGRAR_EN_DESPLIEGUE === "0") {
  console.log("[migraciones] Desactivado con MIGRAR_EN_DESPLIEGUE=0");
  process.exit(0);
}
execSync("node apps/servidor/dist/migrar.js", { stdio: "inherit", cwd: new URL("..", import.meta.url).pathname });
