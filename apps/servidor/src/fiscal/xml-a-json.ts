/**
 * Convierte el XML de un e-CF (el que genera `construirEcf`) al JSON que recibe MSeller.
 * MSeller usa «los mismos nombres de campo y la misma estructura que el XML oficial de la DGII», con raíz `ECF`.
 * La firma se quita: MSeller firma con el certificado cargado en su cuenta.
 */

/** Elementos que siempre van como lista, aunque haya uno solo */
const LISTAS = new Set(["Item", "Pagina", "FormaDePago", "ImpuestoAdicional", "TelefonoEmisor", "TipoCodigo", "CodigosItem", "SubDescuento", "SubRecargo", "Subtotal", "ImpuestosAdicionales"]);
/** Campos que viajan como número; el resto (RNC, e-NCF, códigos, fechas) se queda como texto */
const NUMERICO = /^(Monto|Total|Precio|Cantidad|Descuento|Recargo|ITBIS\d|Tasa|Valor|Numero(Linea|Pagina)|Subtotal|Gravado|Pagina(No)?$)/;
const NO_NUMERICO = /^(TotalPaginas?)$/;

type Nodo = { n: string; hijos: Nodo[]; texto: string };

function parsear(xml: string): Nodo {
  const limpio = xml.replace(/<\?xml[^?]*\?>/g, "").replace(/<!--[\s\S]*?-->/g, "").replace(/<Signature[\s\S]*?<\/Signature>/g, "");
  const raiz: Nodo = { n: "#", hijos: [], texto: "" };
  const pila: Nodo[] = [raiz];
  const re = /<(\/?)([A-Za-z_][\w.-]*)([^>]*?)(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(limpio))) {
    const actual = pila[pila.length - 1]!;
    if (m[5] !== undefined) { actual.texto += m[5]; continue; }
    if (m[1]) { pila.pop(); continue; }
    const nodo: Nodo = { n: m[2]!, hijos: [], texto: "" };
    actual.hijos.push(nodo);
    if (!m[4]) pila.push(nodo);
  }
  return raiz.hijos[0] ?? raiz;
}

const desescapar = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, c) => String.fromCharCode(Number(c))).replace(/&amp;/g, "&");

function valor(n: Nodo): unknown {
  if (!n.hijos.length) {
    const t = desescapar(n.texto.trim());
    return NUMERICO.test(n.n) && !NO_NUMERICO.test(n.n) && /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : t;
  }
  const o: Record<string, unknown> = {};
  for (const h of n.hijos) {
    const v = valor(h);
    if (h.n in o) { const a = o[h.n]; o[h.n] = Array.isArray(a) ? [...a, v] : [a, v]; }
    else o[h.n] = LISTAS.has(h.n) ? [v] : v;
  }
  return o;
}

export function ecfXmlAJson(xml: string): Record<string, unknown> {
  const raiz = parsear(xml);
  return { [raiz.n]: valor(raiz) };
}
