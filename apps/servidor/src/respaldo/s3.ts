import { createHash, createHmac } from "node:crypto";

/**
 * Direcciones prefirmadas (AWS Signature V4) para guardar respaldos en cualquier almacenamiento compatible con S3
 * (Cloudflare R2, Backblaze B2, Wasabi, AWS…). Sin dependencias: el portal reparte permisos temporales a cada
 * instalación y las llaves reales nunca salen del portal.
 */
export interface DestinoS3 { endpoint: string; bucket: string; keyId: string; secreto: string; region: string; estilo?: "ruta" | "virtual" }

const hmac = (k: Buffer | string, d: string) => createHmac("sha256", k).update(d).digest();
const sha = (d: string) => createHash("sha256").update(d).digest("hex");
const cod = (t: string) => encodeURIComponent(t).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

export function destinoDeEntorno(env = process.env): DestinoS3 | null {
  const { RESPALDO_S3_ENDPOINT: endpoint, RESPALDO_S3_BUCKET: bucket, RESPALDO_S3_KEY_ID: keyId, RESPALDO_S3_SECRET: secreto } = env;
  if (!endpoint || !bucket || !keyId || !secreto) return null;
  return { endpoint: endpoint.replace(/\/+$/, ""), bucket, keyId, secreto, region: env.RESPALDO_S3_REGION || "auto" };
}

export function presignar(d: DestinoS3, metodo: "GET" | "PUT" | "DELETE", objeto: string, expira = 900, ahora = new Date()): string {
  const u = new URL(d.endpoint);
  const virtual = d.estilo === "virtual";
  const host = virtual ? `${d.bucket}.${u.host}` : u.host;
  const ruta = (virtual ? "/" : `/${cod(d.bucket)}/`) + objeto.split("/").map(cod).join("/");
  const fecha = ahora.toISOString().replace(/[-:]|\.\d{3}/g, ""); // 20130524T000000Z
  const dia = fecha.slice(0, 8);
  const ambito = `${dia}/${d.region}/s3/aws4_request`;
  const q: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256", "X-Amz-Credential": `${d.keyId}/${ambito}`, "X-Amz-Date": fecha,
    "X-Amz-Expires": String(expira), "X-Amz-SignedHeaders": "host",
  };
  const consulta = Object.keys(q).sort().map((k) => `${cod(k)}=${cod(q[k]!)}`).join("&");
  const canonico = [metodo, ruta, consulta, `host:${host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const aFirmar = ["AWS4-HMAC-SHA256", fecha, ambito, sha(canonico)].join("\n");
  const llave = hmac(hmac(hmac(hmac("AWS4" + d.secreto, dia), d.region), "s3"), "aws4_request");
  const firma = createHmac("sha256", llave).update(aFirmar).digest("hex");
  return `${u.protocol}//${host}${ruta}?${consulta}&X-Amz-Signature=${firma}`;
}
