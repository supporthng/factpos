import { temaAdmin, marcaEfectiva, type Marca } from "@factpos/compartido";

/** Aplica los colores de la marca a toda la Administración. */
export function aplicarTemaAdmin(marca: (Marca & { usarColores?: boolean }) | null) {
  const raiz = document.documentElement;
  if (!marca) return;
  const m = marcaEfectiva(marca); // sin «usar los colores del logo» se ven los de FactPOS
  for (const [k, v] of Object.entries(temaAdmin(m))) raiz.style.setProperty(k, v);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", temaAdmin(m)["--marca"]);
}
