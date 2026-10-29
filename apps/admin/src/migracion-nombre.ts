/**
 * Debe importarse PRIMERO en main.tsx: otros módulos leen lo guardado al cargarse.
 */
// Cambio de nombre OnePOS → FactPOS: se conserva lo guardado en este equipo
// (servidor, caja, ventas en pausa, preferencias).
try {
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith("onepos.")) {
      const nueva = "factpos." + k.slice(7);
      if (localStorage.getItem(nueva) === null) localStorage.setItem(nueva, localStorage.getItem(k)!);
    }
  }
} catch { /* sin almacenamiento */ }

export {};
