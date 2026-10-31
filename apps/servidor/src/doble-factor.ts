import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Verificación en dos pasos: códigos de 6 dígitos que cambian cada 30 s (TOTP, RFC 6238),
 * compatibles con Google Authenticator, Microsoft Authenticator, Authy y similares.
 */
const ALFABETO = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export const nuevoSecreto = () => base32(randomBytes(20));

function base32(b: Buffer) {
  let bits = 0, valor = 0, r = "";
  for (const byte of b) {
    valor = (valor << 8) | byte; bits += 8;
    while (bits >= 5) { r += ALFABETO[(valor >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) r += ALFABETO[(valor << (5 - bits)) & 31];
  return r;
}
function desdeBase32(s: string) {
  let bits = 0, valor = 0;
  const out: number[] = [];
  for (const c of s.replace(/=+$/, "").toUpperCase()) {
    const i = ALFABETO.indexOf(c);
    if (i < 0) continue;
    valor = (valor << 5) | i; bits += 5;
    if (bits >= 8) { out.push((valor >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

function codigo(secreto: string, paso: number) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(paso));
  const h = createHmac("sha1", desdeBase32(secreto)).update(msg).digest();
  const o = h[h.length - 1]! & 15;
  const n = ((h[o]! & 127) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(n % 1_000_000).padStart(6, "0");
}
const igual = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Devuelve el paso (ventana de 30 s) que coincide, o null. Acepta ±1 paso por diferencia de reloj. */
export function verificarCodigo(secreto: string, entrada: string, ahora = Date.now()): number | null {
  const limpio = entrada.replace(/\s/g, "");
  if (!/^\d{6}$/.test(limpio)) return null;
  const actual = Math.floor(ahora / 30_000);
  for (const p of [actual, actual - 1, actual + 1]) if (igual(codigo(secreto, p), limpio)) return p;
  return null;
}

export const uriOtp = (secreto: string, usuario: string, emisor: string) =>
  `otpauth://totp/${encodeURIComponent(`${emisor}:${usuario}`)}?secret=${secreto}&issuer=${encodeURIComponent(emisor)}&digits=6&period=30`;

/** 8 códigos de recuperación de un solo uso (se muestran una vez; se guarda solo su huella). */
export function nuevosCodigosRecuperacion() {
  const codigos = Array.from({ length: 8 }, () => { const x = randomBytes(5).toString("hex").toUpperCase(); return `${x.slice(0, 5)}-${x.slice(5)}`; });
  return { codigos, huellas: codigos.map(huellaRecuperacion) };
}
export const huellaRecuperacion = (c: string) => createHash("sha256").update(c.replace(/[^A-Z0-9]/gi, "").toUpperCase()).digest("hex");
export const esCodigoRecuperacion = (c: string) => /^[A-Za-z0-9]{5}-?[A-Za-z0-9]{5}$/.test(c.trim());
