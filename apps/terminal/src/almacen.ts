/**
 * Almacén local de la caja (IndexedDB): aguanta apagones y reinicios.
 * Guarda lo necesario para vender sin servidor: catálogo, configuración,
 * turno, e-NCF apartados, PIN verificables y las ventas pendientes.
 */
const BD = "factpos-caja";
const TABLA = "datos";
let abierta: Promise<IDBDatabase> | null = null;

function abrir(): Promise<IDBDatabase> {
  if (!abierta) {
    abierta = new Promise((ok, mal) => {
      const r = indexedDB.open(BD, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(TABLA);
      r.onsuccess = () => ok(r.result);
      r.onerror = () => { abierta = null; mal(r.error); };
    });
  }
  return abierta;
}

export async function leer<T>(clave: string): Promise<T | undefined> {
  try {
    const bd = await abrir();
    return await new Promise((ok, mal) => {
      const r = bd.transaction(TABLA, "readonly").objectStore(TABLA).get(clave);
      r.onsuccess = () => ok(r.result as T | undefined);
      r.onerror = () => mal(r.error);
    });
  } catch {
    return undefined;
  }
}

/** Escribe y espera a que quede guardado en disco (la transacción terminó). */
export async function guardar(clave: string, valor: unknown): Promise<void> {
  const bd = await abrir();
  await new Promise<void>((ok, mal) => {
    const t = bd.transaction(TABLA, "readwrite");
    t.objectStore(TABLA).put(valor, clave);
    t.oncomplete = () => ok();
    t.onerror = () => mal(t.error);
    t.onabort = () => mal(t.error ?? new Error("No se pudo guardar en la caja"));
  });
}

export async function borrar(clave: string) {
  try {
    const bd = await abrir();
    await new Promise<void>((ok) => {
      const t = bd.transaction(TABLA, "readwrite");
      t.objectStore(TABLA).delete(clave);
      t.oncomplete = () => ok();
      t.onerror = () => ok();
    });
  } catch { /* nada */ }
}
