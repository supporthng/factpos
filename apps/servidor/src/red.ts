import { createSocket } from "node:dgram";
import { networkInterfaces, hostname } from "node:os";
import multicastDns from "multicast-dns";
import { pool } from "./db.js";

/**
 * El servidor de la sucursal se anuncia en la red local para que las cajas
 * lo encuentren solas, sin escribir direcciones:
 *
 *  1. mDNS: responde al nombre  factpos.local  (Windows 10/11, macOS, Android
 *     e iOS lo resuelven solos) y anuncia el servicio _factpos._tcp.
 *  2. UDP 41234: el instalador de la caja manda "FACTPOS?" a toda la red
 *     (broadcast) y el servidor contesta con su dirección.
 *
 * Si hay más de un servidor en la misma red (dos sucursales en un mismo
 * local), cada uno usa su propio NOMBRE_RED: factpos-norte.local, etc.
 */
export const PUERTO_DESCUBRIMIENTO = Number(process.env.DESCUBRIMIENTO_PUERTO ?? 41234);
export const nombreRed = () => (process.env.NOMBRE_RED ?? "factpos").toLowerCase().replace(/[^a-z0-9-]/g, "") || "factpos";

/** Direcciones IPv4 de la red local (sin la de este mismo equipo, 127.0.0.1). */
export function direccionesLocales(): string[] {
  const ips: string[] = [];
  for (const lista of Object.values(networkInterfaces())) {
    for (const i of lista ?? []) {
      if (i.family === "IPv4" && !i.internal && !i.address.startsWith("169.254.")) ips.push(i.address);
    }
  }
  // Primero las de redes privadas típicas de una tienda
  const peso = (ip: string) => (ip.startsWith("192.168.") ? 0 : ip.startsWith("10.") ? 1 : ip.startsWith("172.") ? 2 : 3);
  return ips.sort((a, b) => peso(a) - peso(b));
}

/** Lo que el servidor cuenta de sí mismo a quien lo busca. */
export async function datosDescubrimiento(puerto: number) {
  let empresa: string | null = null, sucursales: string[] = [];
  try {
    const r = await pool.query(
      `SELECT (SELECT nombre_comercial FROM empresas ORDER BY nombre_comercial LIMIT 1) AS empresa,
              COALESCE((SELECT array_agg(nombre ORDER BY codigo) FROM sucursales WHERE activo), '{}') AS sucursales`,
    );
    empresa = r.rows[0].empresa;
    sucursales = r.rows[0].sucursales;
  } catch { /* la base aún no responde: se anuncia igual */ }
  const nombre = nombreRed();
  return {
    producto: "FactPOS",
    nombreRed: `${nombre}.local`,
    equipo: hostname(),
    puerto,
    empresa,
    sucursales,
    direcciones: [`http://${nombre}.local:${puerto}`, ...direccionesLocales().map((ip) => `http://${ip}:${puerto}`)],
  };
}

export function iniciarAnuncioEnRed(puerto: number, log: (m: string) => void) {
  if (process.env.ANUNCIO_RED === "no") return;
  const nombre = nombreRed();
  const host = `${nombre}.local`;
  const servicio = "_factpos._tcp.local";
  const instancia = `FactPOS ${hostname()}.${servicio}`;

  // ---- mDNS ----
  try {
    const mdns = multicastDns();
    mdns.on("query", (q) => {
      const ips = direccionesLocales();
      if (!ips.length) return;
      const a = ips.map((ip) => ({ name: host, type: "A" as const, ttl: 120, data: ip }));
      for (const pregunta of q.questions) {
        const n = pregunta.name.toLowerCase();
        const tipo = pregunta.type as string; // "ANY" (255) también cuenta
        if (n === host && (tipo === "A" || tipo === "ANY")) {
          mdns.respond({ answers: a });
        } else if (n === servicio && (tipo === "PTR" || tipo === "ANY")) {
          mdns.respond({
            answers: [{ name: servicio, type: "PTR", ttl: 120, data: instancia }],
            additionals: [
              { name: instancia, type: "SRV", ttl: 120, data: { port: puerto, target: host, priority: 0, weight: 0 } },
              { name: instancia, type: "TXT", ttl: 120, data: [`ruta=/terminal/`, `version=1`] },
              ...a,
            ],
          });
        }
      }
    });
    mdns.on("error", (e) => log(`Red: mDNS no disponible (${e.message})`));
  } catch (e) {
    log(`Red: mDNS no disponible (${(e as Error).message})`);
  }

  // ---- Respuesta a la búsqueda por broadcast ----
  const udp = createSocket({ type: "udp4", reuseAddr: true });
  udp.on("message", async (msg, quien) => {
    if (msg.toString().trim() !== "FACTPOS?") return;
    const datos = JSON.stringify(await datosDescubrimiento(puerto));
    udp.send(datos, quien.port, quien.address);
  });
  udp.on("error", (e) => log(`Red: búsqueda por UDP no disponible (${e.message})`));
  udp.bind(PUERTO_DESCUBRIMIENTO, () => { try { udp.setBroadcast(true); } catch { /* sin broadcast */ } });

  const ips = direccionesLocales();
  log(`Cajas: abran http://${host}:${puerto}/terminal/${ips.length ? `  (o http://${ips[0]}:${puerto}/terminal/)` : ""}`);
}
