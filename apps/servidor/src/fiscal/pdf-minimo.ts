import { ANCHO_HELVETICA, ANCHO_HELVETICA_NEGRITA } from "./helvetica-anchos.js";

/**
 * Escritor de PDF mínimo, sin dependencias: páginas con texto (Helvetica), líneas, rectángulos y cuadros (para el QR).
 * Alcanza para la representación impresa de un e-CF. Coordenadas como en PDF: origen abajo a la izquierda, en puntos.
 */
export type Color = [number, number, number];

// Unicode → WinAnsi (cp1252) para lo que no coincide con Latin-1
const ESPECIALES: Record<number, number> = { 0x20ac: 128, 0x201a: 130, 0x192: 131, 0x201e: 132, 0x2026: 133, 0x2020: 134, 0x2021: 135, 0x2c6: 136, 0x2030: 137, 0x160: 138, 0x2039: 139, 0x152: 140, 0x17d: 142, 0x2018: 145, 0x2019: 146, 0x201c: 147, 0x201d: 148, 0x2022: 149, 0x2013: 150, 0x2014: 151, 0x2dc: 152, 0x2122: 153, 0x161: 154, 0x203a: 155, 0x153: 156, 0x17e: 158, 0x178: 159 };

export function aWinAnsi(t: string): number[] {
  const out: number[] = [];
  for (const ch of t.normalize("NFC")) {
    const c = ch.codePointAt(0)!;
    if (c >= 32 && c <= 126) out.push(c);
    else if (c >= 160 && c <= 255) out.push(c);
    else if (ESPECIALES[c]) out.push(ESPECIALES[c]!);
    else out.push(c === 9 || c === 10 ? 32 : 63);
  }
  return out;
}

export function anchoTexto(t: string, tam: number, negrita = false): number {
  const tabla = negrita ? ANCHO_HELVETICA_NEGRITA : ANCHO_HELVETICA;
  let w = 0;
  for (const c of aWinAnsi(t)) w += tabla[c - 32] ?? 556;
  return (w * tam) / 1000;
}

const n = (v: number) => (Math.round(v * 100) / 100).toString();
const col = (c: Color) => `${n(c[0])} ${n(c[1])} ${n(c[2])}`;
const escapar = (bytes: number[]) => bytes.map((b) => (b === 40 || b === 41 || b === 92 ? "\\" + String.fromCharCode(b) : b < 32 || b > 126 ? "\\" + b.toString(8).padStart(3, "0") : String.fromCharCode(b))).join("");

export class PdfMinimo {
  private paginas: { ancho: number; alto: number; contenido: string[] }[] = [];
  titulo = "";
  autor = "";

  nuevaPagina(ancho: number, alto: number) { this.paginas.push({ ancho, alto, contenido: [] }); }
  private p() { return this.paginas[this.paginas.length - 1]!.contenido; }

  texto(t: string, x: number, y: number, tam = 9, negrita = false, color: Color = [0, 0, 0]) {
    this.p().push(`BT /${negrita ? "F2" : "F1"} ${n(tam)} Tf ${col(color)} rg ${n(x)} ${n(y)} Td (${escapar(aWinAnsi(t))}) Tj ET`);
  }
  linea(x1: number, y1: number, x2: number, y2: number, grosor = 1, color: Color = [0, 0, 0]) {
    this.p().push(`${col(color)} RG ${n(grosor)} w ${n(x1)} ${n(y1)} m ${n(x2)} ${n(y2)} l S`);
  }
  rect(x: number, y: number, w: number, h: number, o: { relleno?: Color; borde?: Color; grosor?: number } = {}) {
    const partes: string[] = [];
    if (o.relleno) partes.push(`${col(o.relleno)} rg`);
    if (o.borde) partes.push(`${col(o.borde)} RG ${n(o.grosor ?? 0.5)} w`);
    const op = o.relleno && o.borde ? "B" : o.relleno ? "f" : "S";
    this.p().push(`${partes.join(" ")} ${n(x)} ${n(y)} ${n(w)} ${n(h)} re ${op}`);
  }
  /** Dibuja una matriz de módulos (QR) como cuadros negros dentro de un cuadrado de `lado` puntos con su esquina inferior izquierda en (x, y). */
  matriz(m: { size: number; get: (fila: number, col: number) => number | boolean }, x: number, y: number, lado: number) {
    const paso = lado / m.size;
    const cuadros: string[] = ["0 0 0 rg"];
    for (let f = 0; f < m.size; f++) {
      let c = 0;
      while (c < m.size) {
        if (!m.get(f, c)) { c++; continue; }
        let fin = c; while (fin < m.size && m.get(f, fin)) fin++;
        cuadros.push(`${n(x + c * paso)} ${n(y + lado - (f + 1) * paso)} ${n((fin - c) * paso + 0.05)} ${n(paso + 0.05)} re`);
        c = fin;
      }
    }
    this.p().push(`${cuadros.join(" ")} f`);
  }

  guardar(): Uint8Array {
    const objs: string[] = [];
    const agregar = (s: string) => { objs.push(s); return objs.length; };
    const catalogo = agregar(""), arbol = agregar(""); // se llenan al final
    const f1 = agregar("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    const f2 = agregar("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    const hijos: number[] = [];
    for (const pg of this.paginas) {
      const cont = pg.contenido.join("\n");
      const idC = agregar(`<< /Length ${Buffer.byteLength(cont, "latin1")} >>\nstream\n${cont}\nendstream`);
      hijos.push(agregar(`<< /Type /Page /Parent ${arbol} 0 R /MediaBox [0 0 ${n(pg.ancho)} ${n(pg.alto)}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${idC} 0 R >>`));
    }
    const info = agregar(`<< /Title (${escapar(aWinAnsi(this.titulo))}) /Author (${escapar(aWinAnsi(this.autor))}) /Producer (FactPOS) >>`);
    objs[catalogo - 1] = `<< /Type /Catalog /Pages ${arbol} 0 R >>`;
    objs[arbol - 1] = `<< /Type /Pages /Kids [${hijos.map((h) => `${h} 0 R`).join(" ")}] /Count ${hijos.length} >>`;
    let salida = "%PDF-1.4\n";
    const pos: number[] = [];
    objs.forEach((o, i) => { pos.push(Buffer.byteLength(salida, "latin1")); salida += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = Buffer.byteLength(salida, "latin1");
    salida += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${pos.map((p) => `${String(p).padStart(10, "0")} 00000 n \n`).join("")}`;
    salida += `trailer\n<< /Size ${objs.length + 1} /Root ${catalogo} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return new Uint8Array(Buffer.from(salida, "latin1"));
  }
}
