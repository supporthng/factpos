/**
 * Copia en archivo de las ventas en pausa (solo en la aplicación de escritorio).
 * La pantalla las guarda en localStorage, pero si el proceso se cierra a la fuerza (actualización, reinicio) o el perfil se
 * daña, puede perderse lo último. Este archivo se escribe en cada cambio y se usa para recuperarlas al abrir.
 */
let escritorio: boolean | null = null;
const hayEscritorio = async () => (escritorio ??= await fetch("/escritorio.json", { cache: "no-store" }).then((r) => r.ok).catch(() => false));

export async function guardarRespaldoPausadas(cajaId: string, pausadas: unknown[]) {
  if (!(await hayEscritorio())) return;
  try {
    await fetch("/respaldo-pausadas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cajaId, pausadas }) });
  } catch { /* se vuelve a intentar en el próximo cambio */ }
}

export async function leerRespaldoPausadas<T>(cajaId: string): Promise<T[]> {
  if (!(await hayEscritorio())) return [];
  try {
    const b = await (await fetch(`/respaldo-pausadas?caja=${encodeURIComponent(cajaId)}`, { cache: "no-store" })).json();
    return Array.isArray(b?.pausadas) ? (b.pausadas as T[]) : [];
  } catch { return []; }
}
