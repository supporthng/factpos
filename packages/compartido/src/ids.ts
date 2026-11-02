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

const ALFABETO_LICENCIA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/**
 * Número de licencia legible: FPOS-XXXX-XXXX-XXXX. Se deriva siempre igual del identificador interno de la licencia
 * (sus últimos 60 bits, que son aleatorios), así no hay que guardar nada más y es el mismo en todas partes.
 */
export function numeroLicencia(id: string | null | undefined): string {
  const hex = (id ?? "").replace(/[^0-9a-f]/gi, "").toLowerCase();
  if (hex.length < 15) return "—";
  let n = BigInt("0x" + hex.slice(-15));
  const c: string[] = [];
  for (let i = 0; i < 12; i++) { c.unshift(ALFABETO_LICENCIA[Number(n % 32n)]); n /= 32n; }
  const s = c.join("");
  return `FPOS-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}
