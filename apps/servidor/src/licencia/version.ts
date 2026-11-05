/** Etiqueta de la versión de cara al cliente (solo para mostrar; la versión real no cambia): 29.1.0 → 2.9.1, 26.0.0 → 2.6, 26.9.0 → 2.6.9. */
export function versionCliente(v: string | null | undefined): string {
  const m = /^(\d+)(?:\.(\d))?(?:\.|$)/.exec(v ?? "");
  if (!m || m[1]!.length < 2) return v ?? "";
  const e = Number(m[1]);
  return `${Math.floor(e / 10)}.${e % 10}${m[2] && m[2] !== "0" ? "." + m[2] : ""}`;
}
