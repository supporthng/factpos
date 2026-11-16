"""Genera src/fiscal/estructura-ecf.ts a partir de los XSD oficiales de la DGII (apps/servidor/xsd).
Cada elemento queda como [nombre, minOccurs, maxOccurs, hijos|null], en el orden exacto del esquema.
Uso: python3 scripts/generar-estructura-ecf.py   (solo hace falta al cambiar los XSD)"""
import json, os
from lxml import etree

NS = {"xs": "http://www.w3.org/2001/XMLSchema"}
AQUI = os.path.dirname(os.path.abspath(__file__))
XSD = os.path.join(AQUI, "..", "xsd")
ARCHIVOS = {
    "E31": "e-CF_31_v.1.0.xsd", "E32": "e-CF_32_v.1.0.xsd", "E33": "e-CF_33_v.1.0.xsd", "E34": "e-CF_34_v.1.0.xsd",
    "E41": "e-CF_41_v.1.0.xsd", "E43": "e-CF_43_v.1.0.xsd", "E44": "e-CF_44_v.1.0.xsd", "E45": "e-CF_45_v.1.0.xsd",
    "E46": "e-CF_46_v.1.0.xsd", "E47": "e-CF_47_v.1.0.xsd", "RFCE": "RFCE_32_v.1.0.xsd",
}

def nodo(el):
    mx = el.get("maxOccurs", "1")
    mx = 9999 if mx == "unbounded" else int(mx)
    ct = el.find("xs:complexType", NS)
    hijos = None
    if ct is not None:
        sec = ct.find("xs:sequence", NS)
        if sec is None:
            sec = ct.find("xs:all", NS)
        if sec is not None:
            hijos = [nodo(c) for c in sec if c.tag.endswith("}element")]
    return [el.get("name"), int(el.get("minOccurs", "1")), mx, hijos]

salida = {}
for tipo, nombre in ARCHIVOS.items():
    raiz = etree.parse(os.path.join(XSD, nombre)).getroot().find("xs:element", NS)
    salida[tipo] = nodo(raiz)

destino = os.path.join(AQUI, "..", "src", "fiscal", "estructura-ecf.ts")
with open(destino, "w", encoding="utf-8") as f:
    f.write("// GENERADO por scripts/generar-estructura-ecf.py desde los XSD de la DGII (apps/servidor/xsd): no editar a mano.\n")
    f.write("// Cada nodo: [nombre, minOccurs, maxOccurs, hijos | null], en el orden exacto del esquema.\n")
    f.write("export type NodoEcf = [string, number, number, NodoEcf[] | null];\n")
    f.write("export const ESTRUCTURA_ECF: Record<string, NodoEcf> = JSON.parse(" + json.dumps(json.dumps(salida, separators=(",", ":"), ensure_ascii=False), ensure_ascii=False) + ");\n")
print(os.path.getsize(destino), "bytes")
