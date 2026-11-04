#!/usr/bin/env node
// Importador FactPOS (app): una sola pantalla. Se elige el respaldo, se procesa y se carga a FactPOS.
// Sirve la pantalla solo en esta computadora (127.0.0.1) y la abre como ventana de aplicación.
import http from "node:http";
import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { tmpdir, homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { importar } from "./nucleo.mjs";
import PAGINA from "./app.html";

const datosApp = join(process.env.APPDATA || join(homedir(), ".config"), "ImportadorFactPOS");
mkdirSync(datosApp, { recursive: true });
const rutaConexion = join(datosApp, "conexion.json");
const trabajo = join(tmpdir(), "importador-factpos-" + randomBytes(4).toString("hex"));
mkdirSync(trabajo, { recursive: true });
const archivo = join(trabajo, "respaldo.sql");
const salida = join(homedir(), "Importacion-FactPOS");
let hayArchivo = false, corriendo = false;

const json = (r, c, o) => { r.writeHead(c, { "content-type": "application/json; charset=utf-8" }); r.end(JSON.stringify(o)); };
const conexion = () => { try { return JSON.parse(readFileSync(rutaConexion, "utf8")); } catch { return {}; } };

const srv = http.createServer((q, r) => {
  const u = new URL(q.url, "http://x");
  if (q.method === "GET" && u.pathname === "/") { r.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return r.end(PAGINA); }
  if (q.method === "GET" && u.pathname === "/detectar") {
    // Busca un servidor FactPOS en esta misma PC o con el nombre factpos.local
    Promise.all(["http://127.0.0.1:3000", "http://localhost:3000", "http://factpos.local:3000"].map((url) =>
      fetch(url + "/descubrir", { signal: AbortSignal.timeout(1500) }).then((x) => x.json()).then((d) => (d?.producto === "FactPOS" ? { servidor: url, empresa: d.empresa ?? null } : null)).catch(() => null)))
      .then((hallado) => json(r, 200, hallado.find(Boolean) ?? {}));
    return;
  }
  if (q.method === "GET" && u.pathname === "/estado") {
    return json(r, 200, { conexion: conexion(), salida, archivos: existsSync(salida) ? readdirSync(salida).filter((f) => f.endsWith(".csv") || f.endsWith(".md")) : [] });
  }
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
    q.on("end", async () => {
      if (corriendo) return json(r, 409, { error: "Ya hay una importación corriendo" });
      if (!hayArchivo) return json(r, 400, { error: "Primero elija el archivo de respaldo" });
      let o; try { o = JSON.parse(b); } catch { return json(r, 400, { error: "Datos inválidos" }); }
      if (o.aplicar) {
        for (const [k, n] of [["servidor", "la dirección del servidor"], ["usuario", "el usuario"], ["clave", "la contraseña"]]) if (!String(o[k] ?? "").trim()) return json(r, 400, { error: `Falta ${n}` });
        // Se recuerdan el servidor y el usuario para la próxima vez (la contraseña nunca se guarda)
        try { writeFileSync(rutaConexion, JSON.stringify({ servidor: String(o.servidor).trim(), usuario: String(o.usuario).trim() })); } catch { /* sin permiso */ }
      }
      // nosniff + relleno inicial: sin esto el navegador espera ~1 KB antes de mostrar nada y parece que está trabado
      r.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
      r.write(" ".repeat(2048) + "\nIniciando…\n");
      corriendo = true;
      try {
        await importar({ fuente: "wilpos", archivo, salida, aplicar: !!o.aplicar, sinFotos: !!o.sinFotos, reemplazar: !!o.reemplazar,
          servidor: String(o.servidor ?? "").trim(), usuario: String(o.usuario ?? "").trim(), clave: String(o.clave ?? ""),
          rnc: String(o.rnc ?? "").trim() || undefined, codigo: String(o.codigo ?? "").trim() || undefined, sucursal: String(o.sucursal ?? "").trim() || undefined },
        (t) => r.write(t + "\n"));
        r.end("\n[LISTO]");
      } catch (e) { r.end(`\n[ERROR] ${e.message}`); }
      corriendo = false;
    });
    return;
  }
  json(r, 404, { error: "No encontrado" });
});

srv.listen(Number(process.env.IMPORTADOR_PUERTO) || 0, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${srv.address().port}/`;
  console.log(`Importador FactPOS abierto en ${url}\nCierre esta ventana para terminar.`);
  const intentos = process.platform === "win32"
    ? [["cmd", ["/c", "start", "", "msedge", `--app=${url}`]], ["cmd", ["/c", "start", "", url]]]
    : process.platform === "darwin" ? [["open", [url]]] : [["xdg-open", [url]]];
  const abrir = (i) => { // primero como ventana de aplicación (Edge); si no se puede, en el navegador normal
    if (i >= intentos.length) return;
    try { const p = spawn(intentos[i][0], intentos[i][1], { stdio: "ignore", detached: true }); p.on("error", () => abrir(i + 1)); p.on("exit", (c) => { if (c) abrir(i + 1); }); p.unref(); } catch { abrir(i + 1); }
  };
  if (!process.env.IMPORTADOR_SIN_VENTANA) abrir(0); // la variable existe para las pruebas automáticas
});
