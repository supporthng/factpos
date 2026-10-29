// Funciona igual en Node (servidor) y en el navegador/Electron (caja).
const randomBytes = (n: number) => {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
};

/**
 * Genera un UUID v7 (ordenado por tiempo).
 *
 * Cada sucursal y cada caja crea sus propios IDs sin consultar a nadie,
 * así los registros nunca chocan al sincronizar con la nube. Al estar
 * ordenados por tiempo, los índices de PostgreSQL se mantienen eficientes.
 */
export function uuidv7(ahora: number = Date.now()): string {
  const bytes = randomBytes(16);
  const ts = BigInt(ahora);

  // 48 bits de marca de tiempo en milisegundos
  bytes[0] = Number((ts >> 40n) & 0xffn);
  bytes[1] = Number((ts >> 32n) & 0xffn);
  bytes[2] = Number((ts >> 24n) & 0xffn);
  bytes[3] = Number((ts >> 16n) & 0xffn);
  bytes[4] = Number((ts >> 8n) & 0xffn);
  bytes[5] = Number(ts & 0xffn);

  bytes[6] = (bytes[6] & 0x0f) | 0x70; // versión 7
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variante RFC 4122

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
