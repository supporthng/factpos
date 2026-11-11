import { describe, expect, it } from "vitest";
import { Script } from "node:vm";
import { PAGINA_WEB } from "./pagina-web.js";
import { PAGINA_DEMO } from "./pagina-demo.js";

/** Las páginas públicas son texto: se comprueba que su JavaScript compile, que los ids que usa existan y que no falten secciones. */
const scripts = (html: string) => [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
const idsDeclarados = (html: string) => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!));
const idsUsados = (js: string) => [...js.matchAll(/\$\("([^"]+)"\)|getElementById\("([^"]+)"\)/g)].map((m) => (m[1] ?? m[2])!);

describe.each([["landing", PAGINA_WEB], ["demo", PAGINA_DEMO]])("página %s", (_n, html) => {
  it("es un documento completo", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("</html>");
  });
  it("su JavaScript compila", () => {
    const s = scripts(html);
    expect(s.length).toBeGreaterThan(0);
    for (const js of s) expect(() => new Script(js)).not.toThrow();
  });
  it("todo id que busca el script existe en el HTML", () => {
    const declarados = idsDeclarados(html);
    // los ids que el propio script crea al vuelo se excluyen: solo se piden los que no se asignan en el código
    const faltan = new Set<string>();
    for (const js of scripts(html)) for (const id of idsUsados(js)) if (!declarados.has(id) && !js.includes(`.id = "${id}"`) && !js.includes(`id="${id}"`) && !js.includes(`id: "${id}"`)) faltan.add(id);
    expect([...faltan]).toEqual([]);
  });
});

describe("landing", () => {
  it("tiene las secciones y enlaces principales", () => {
    for (const x of ['id="funciones"', 'id="pantallas"', 'id="descargar"', 'id="planes"', 'id="contacto"', 'href="/demo"', 'href="/entrar#inicio"', "/licencias/descargar-instalador", "/licencias/planes-web", "/licencias/prospecto"]) expect(html()).toContain(x);
  });
  it("anuncia la demo de 15 días", () => {
    expect(html()).toContain("15 días");
  });
  it("el formulario pide nombre, negocio y teléfono", () => {
    for (const id of ["s-nombre", "s-negocio", "s-tel"]) expect(html()).toContain(`id="${id}"`);
  });
  function html() { return PAGINA_WEB; }
});

describe("demo", () => {
  it("incluye las pantallas principales del sistema", () => {
    for (const p of ["resumen", "caja", "facturas", "clientes", "productos", "existencias", "ofertas", "verificador", "fiscal", "sucursales", "reportes"]) expect(PAGINA_DEMO).toContain(p);
  });
});
