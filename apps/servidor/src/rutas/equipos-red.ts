import type { FastifyInstance } from "fastify";
import { createSocket } from "node:dgram";
import { networkInterfaces } from "node:os";
import { z } from "zod";
import { ErrorNegocio } from "../db.js";
import { tienePermiso, type SesionAdmin } from "../sesion.js";
import { config } from "../config.js";
import { direccionesLocales } from "../red.js";

/**
 * Equipos FactPOS de la red (verificadores, cajas, administración de escritorio).
 *
 * Cada app escucha en un puerto UDP propio y contesta «FACTPOS-EQUIPOS?» con quién es (tipo, nombre, versión y a qué
 * servidor apunta). Este servidor difunde la pregunta por la red local, junta las respuestas y Administración las lista.
 * «Apuntar al servidor» manda al equipo el comando «FACTPOS-APUNTAR» con la dirección de ESTE servidor; el equipo solo
 * lo acepta si el pedido viene de su misma red local y si en esa dirección responde un FactPOS.
 */
export const PUERTOS_EQUIPOS = { verificador: 41235, caja: 41236, admin: 41237 } as const;
/** Puerto fijo desde el que este servidor pregunta y por el que recibe las respuestas (así el firewall puede dejarlas pasar). */
export const PUERTO_ESCANEO_EQUIPOS = 41238;
type Tipo = keyof typeof PUERTOS_EQUIPOS;

export interface EquipoRed { ip: string; tipo: Tipo; id: string; nombre: string; version: string; plataforma: string; servidor: string; apuntaAqui: boolean }

function difusiones(): string[] {
  const salida = new Set<string>(["255.255.255.255"]);
  for (const lista of Object.values(networkInterfaces())) {
    for (const i of lista ?? []) {
      if (i.family !== "IPv4" || i.internal || i.address.startsWith("169.254.")) continue;
      const ip = i.address.split(".").map(Number), m = i.netmask.split(".").map(Number);
      salida.add(ip.map((o, k) => (o | (~m[k] & 255)) & 255).join("."));
    }
  }
  return [...salida];
}

/** Dirección de ESTE servidor tal como la deben usar los equipos de la red. */
function baseServidor(): string {
  const ip = direccionesLocales()[0];
  if (!ip) throw new ErrorNegocio("Este servidor no tiene una dirección de red local", 409);
  return `http://${ip}:${config.puerto}`;
}

export async function escanearEquipos(ms = 2200): Promise<EquipoRed[]> {
  const propias = new Set(direccionesLocales());
  return new Promise((resolver) => {
    const s = createSocket({ type: "udp4", reuseAddr: true });
    const halladas = new Map<string, EquipoRed>();
    s.on("message", (msg, quien) => {
      try {
        const d = JSON.parse(msg.toString("utf8")) as Partial<EquipoRed> & { producto?: string };
        if (d.producto !== "FactPOS-equipo" || !d.tipo || !(d.tipo in PUERTOS_EQUIPOS)) return;
        const servidor = String(d.servidor ?? "");
        let host = "";
        try { host = new URL(servidor).hostname; } catch { /* sin servidor */ }
        halladas.set(`${quien.address}|${d.tipo}`, {
          ip: quien.address, tipo: d.tipo as Tipo, id: String(d.id ?? ""), nombre: String(d.nombre ?? quien.address).slice(0, 60),
          version: String(d.version ?? "").slice(0, 20), plataforma: String(d.plataforma ?? "").slice(0, 20), servidor: servidor.slice(0, 200),
          apuntaAqui: propias.has(host) || /^factpos(-[a-z0-9]+)?\.local$/i.test(host) || (/^(localhost|127\.\d+\.\d+\.\d+)$/.test(host) && propias.has(quien.address)),
        });
      } catch { /* respuesta ajena */ }
    });
    s.on("error", () => { try { s.close(); } catch { /* ya cerrado */ } resolver([...halladas.values()]); });
    const preguntar = () => {
      try { s.setBroadcast(true); } catch { /* sin broadcast */ }
      const pregunta = Buffer.from("FACTPOS-EQUIPOS?");
      for (const dir of difusiones()) for (const p of Object.values(PUERTOS_EQUIPOS)) s.send(pregunta, p, dir, () => {});
      setTimeout(() => { try { s.close(); } catch { /* ya cerrado */ } resolver([...halladas.values()].sort((a, b) => a.tipo.localeCompare(b.tipo) || a.nombre.localeCompare(b.nombre))); }, ms);
    };
    s.bind(PUERTO_ESCANEO_EQUIPOS, preguntar);
  });
}

async function mandarOrden(ip: string, tipo: Tipo, orden: unknown): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolver) => {
    const s = createSocket("udp4");
    const fin = (r: { ok: boolean; error?: string }) => { try { s.close(); } catch { /* ya cerrado */ } resolver(r); };
    const t = setTimeout(() => fin({ ok: false, error: "El equipo no contestó (¿tiene la versión nueva instalada?)" }), 8000);
    s.on("message", (msg) => { clearTimeout(t); try { fin(JSON.parse(msg.toString("utf8"))); } catch { fin({ ok: false, error: "Respuesta no válida" }); } });
    s.on("error", (e) => { clearTimeout(t); fin({ ok: false, error: e.message }); });
    s.send(Buffer.from("FACTPOS-APUNTAR " + JSON.stringify(orden)), PUERTOS_EQUIPOS[tipo], ip, (e) => { if (e) { clearTimeout(t); fin({ ok: false, error: e.message }); } });
  });
}

export async function rutasEquiposRed(app: FastifyInstance) {
  const permiso = (req: unknown) => {
    const sesion = (req as { sesion?: SesionAdmin }).sesion;
    if (!sesion || !tienePermiso(sesion.p, "admin.config")) throw new ErrorNegocio("Sin permiso", 403);
  };

  app.get("/central/equipos-red", async (req) => {
    permiso(req);
    return { servidor: (() => { try { return baseServidor(); } catch { return ""; } })(), equipos: await escanearEquipos() };
  });

  app.post("/central/equipos-red/apuntar", async (req) => {
    permiso(req);
    const b = z.object({ ip: z.string().ip({ version: "v4" }), tipo: z.enum(["verificador", "caja", "admin"]) }).parse(req.body);
    const r = await mandarOrden(b.ip, b.tipo, { url: baseServidor() });
    if (!r.ok) throw new ErrorNegocio(r.error ?? "El equipo no aceptó el cambio", 409);
    return { ok: true };
  });
}
