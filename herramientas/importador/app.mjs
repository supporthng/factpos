#!/usr/bin/env node
// Importador FactPOS (app portable): una ventana en el navegador, sin instalar nada.
// Sirve una página solo en esta computadora (127.0.0.1), recibe el respaldo y corre importar.mjs mostrando el avance.
import http from "node:http";
import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

const aqui = dirname(fileURLToPath(import.meta.url));
const trabajo = join(tmpdir(), "importador-factpos-" + randomBytes(4).toString("hex"));
mkdirSync(trabajo, { recursive: true });
const archivo = join(trabajo, "respaldo.sql");
const salida = join(process.env.USERPROFILE || process.env.HOME || aqui, "Importacion-FactPOS");
let hayArchivo = false, corriendo = null;

const PAGINA = readFileSync(join(aqui, "app.html"), "utf8");
const json = (r, c, o) => { r.writeHead(c, { "content-type": "application/json; charset=utf-8" }); r.end(JSON.stringify(o)); };

const srv = http.createServer((q, r) => {
  const u = new URL(q.url, "http://x");
  if (q.method === "GET" && u.pathname === "/") { r.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return r.end(PAGINA); }
  if (q.method === "GET" && u.pathname === "/estado") return json(r, 200, { hayArchivo, salida, archivos: existsSync(salida) ? readdirSync(salida).filter((f) => f.endsWith(".csv") || f.endsWith(".md")) : [] });
  if (q.method === "GET" && u.pathname.startsWith("/salida/")) {
    const n = basename(decodeURIComponent(u.pathname.slice(8)));
    const p = join(salida, n);
    if (!existsSync(p)) return json(r, 404, { error: "No existe" });
    r.writeHead(200, { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${n}"` });
    return r.end(readFileSync(p));
  }
  if (q.method === "POST" && u.pathname === "/subir") {
    const f = createWriteStream(archivo);
    q.pipe(f);
    f.on("finish", () => { hayArchivo = true; json(r, 200, { ok: true }); });
    f.on("error", () => json(r, 500, { error: "No se pudo guardar el archivo" }));
    return;
  }
  if (q.method === "POST" && u.pathname === "/ejecutar") {
    let b = ""; q.on("data", (d) => (b += d));
    q.on("end", () => {
      if (corriendo) return json(r, 409, { error: "Ya hay una importación corriendo" });
      if (!hayArchivo) return json(r, 400, { error: "Primero elija el archivo de respaldo" });
      let o; try { o = JSON.parse(b); } catch { return json(r, 400, { error: "Datos inválidos" }); }
      const a = ["importar.mjs", "--fuente", "wilpos", "--archivo", archivo, "--salida", salida];
      if (o.aplicar) {
        for (const k of ["servidor", "usuario", "clave"]) if (!String(o[k] ?? "").trim()) return json(r, 400, { error: `Falta ${k}` });
        a.push("--aplicar", "--servidor", String(o.servidor).trim(), "--usuario", String(o.usuario).trim(), "--clave", String(o.clave));
        for (const k of ["rnc", "codigo", "sucursal"]) if (String(o[k] ?? "").trim()) a.push("--" + k, String(o[k]).trim());
        if (o.sinFotos) a.push("--sin-fotos");
      }
      r.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
      const p = spawn(process.execPath, a, { cwd: aqui });
      corriendo = p;
      p.stdout.on("data", (d) => r.write(d));
      p.stderr.on("data", (d) => r.write(d));
      p.on("close", (c) => { corriendo = null; r.end(c === 0 ? "\n[LISTO]" : `\n[ERROR código ${c}]`); });
    });
    return;
  }
  json(r, 404, { error: "No encontrado" });
});

srv.listen(0, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${srv.address().port}/`;
  console.log(`Importador FactPOS abierto en ${url}\nCierre esta ventana para terminar.`);
  const [cmd, args] = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try { const p = spawn(cmd, args, { stdio: "ignore", detached: true }); p.on("error", () => {}); p.unref(); } catch { /* se abre a mano */ }
});
