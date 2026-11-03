// Empaqueta la app en UN solo .exe portable (Node incluido): esbuild junta todo en un archivo y Node SEA lo incrusta en node.exe.
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";

mkdirSync("dist", { recursive: true });
await build({ entryPoints: ["app.mjs"], bundle: true, platform: "node", format: "cjs", target: "node20", outfile: "dist/importador.cjs", loader: { ".html": "text" }, logLevel: "info" });
writeFileSync("dist/sea-config.json", JSON.stringify({ main: "dist/importador.cjs", output: "dist/sea.blob", disableExperimentalSEAWarning: true }));
execFileSync(process.execPath, ["--experimental-sea-config", "dist/sea-config.json"], { stdio: "inherit" });
const exe = process.platform === "win32" ? "dist/Importador-FactPOS.exe" : "dist/Importador-FactPOS";
copyFileSync(process.execPath, exe);
execFileSync(process.execPath, ["node_modules/postject/dist/cli.js", exe, "NODE_SEA_BLOB", "dist/sea.blob", "--sentinel-fuse", "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"], { stdio: "inherit" });
console.log("Listo:", exe);
