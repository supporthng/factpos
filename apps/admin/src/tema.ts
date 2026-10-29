import { temaAdmin, type Marca } from "@factpos/compartido";

/** Aplica los colores de la marca a toda la Administración. */
export function aplicarTemaAdmin(m: Marca | null) {
  const raiz = document.documentElement;
  if (!m) return;
  for (const [k, v] of Object.entries(temaAdmin(m))) raiz.style.setProperty(k, v);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", temaAdmin(m)["--marca"]);
}
