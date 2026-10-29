import { readFileSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import forge from "node-forge";
import { SignedXml } from "xml-crypto";

/**
 * Firma digital XML (XMLDSig envuelta, RSA-SHA256) con el certificado de la
 * empresa, emitido por una entidad autorizada por INDOTEL.
 *
 * El certificado (.p12) vive SOLO en el servidor local de cada sucursal, porque
 * la firma ocurre al momento de vender (el código de seguridad impreso en el
 * ticket sale de la firma), aunque no haya internet.
 *
 *   CERT_P12_RUTA=/ruta/certificado.p12
 *   CERT_P12_CLAVE=********
 *
 * O, más cómodo, se sube en Administración › Facturación electrónica ›
 * Certificado: baja cifrado a cada sucursal (ver fiscal/certificado-guardado.ts).
 * El archivo del .env, si está, tiene prioridad.
 *
 * Sin certificado se usa uno de PRUEBA generado al vuelo (solo ambiente SIMULADO).
 */
export interface Certificado {
  llavePem: string; certPem: string; prueba: boolean; titular: string; vence: Date;
  /** De dónde salió: archivo del .env, el que se subió en la Administración, o el de prueba */
  origen?: "archivo" | "administracion" | "prueba";
  emisor?: string; numeroSerie?: string; validoDesde?: Date; huella?: string;
}

let cache: Certificado | null = null;

/**
 * Lee un .p12/.pfx con su contraseña. Revisa que traiga la llave privada,
 * que corresponda al certificado y lo describe (titular, emisor, vigencia).
 * Lanza errores en palabras simples (contraseña mala, archivo dañado...).
 */
export function leerP12(der: Buffer, clave: string): Certificado {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(der.toString("binary")), clave);
  } catch (e) {
    const m = (e as Error).message ?? "";
    if (/password|MAC/i.test(m)) throw new Error("La contraseña del certificado no es correcta");
    throw new Error("El archivo no es un certificado .p12 / .pfx válido");
  }
  const bolsas = (tipo: string) => p12.getBags({ bagType: tipo })[tipo] ?? [];
  const llave = (bolsas(forge.pki.oids.pkcs8ShroudedKeyBag)[0]?.key ?? bolsas(forge.pki.oids.keyBag)[0]?.key) as forge.pki.rsa.PrivateKey | undefined;
  if (!llave) throw new Error("El certificado no trae la llave privada (pida a la entidad certificadora el archivo .p12 completo)");
  // Puede venir la cadena completa: se toma el certificado que corresponde a la llave
  const certs = bolsas(forge.pki.oids.certBag).map((b) => b.cert).filter((c): c is forge.pki.Certificate => !!c);
  const cert = certs.find((c) => {
    const pub = c.publicKey as forge.pki.rsa.PublicKey;
    return pub?.n && pub.n.equals(llave.n) && pub.e.equals(llave.e);
  });
  if (!cert) throw new Error("La llave privada no corresponde a ningún certificado del archivo");
  const campo = (a: forge.pki.Certificate["subject"], n: string) => String(a.getField(n)?.value ?? "");
  const derCert = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  return {
    llavePem: forge.pki.privateKeyToPem(llave),
    certPem: forge.pki.certificateToPem(cert),
    prueba: false,
    titular: campo(cert.subject, "CN") || campo(cert.subject, "O") || "(sin nombre)",
    emisor: campo(cert.issuer, "CN") || campo(cert.issuer, "O"),
    numeroSerie: cert.serialNumber,
    validoDesde: cert.validity.notBefore,
    vence: cert.validity.notAfter,
    huella: forge.md.sha256.create().update(derCert).digest().toHex(),
  };
}

/** Pone en uso un certificado (el que se subió en la Administración). */
export function usarCertificado(c: Certificado) {
  if (process.env.CERT_P12_RUTA) return false; // el archivo del .env manda
  cache = { ...c, origen: "administracion" };
  return true;
}

/** Deja de usar el certificado de la Administración (la sucursal quedó desactivada). */
export function quitarCertificado() {
  if (cache?.origen === "administracion") cache = null;
}

export function certificado(): Certificado {
  if (cache) return cache;
  const ruta = process.env.CERT_P12_RUTA;
  if (ruta) {
    cache = { ...leerP12(readFileSync(ruta), process.env.CERT_P12_CLAVE ?? ""), origen: "archivo" };
    return cache;
  }
  // Certificado de prueba (autofirmado)
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const llavePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const llave = forge.pki.privateKeyFromPem(llavePem) as forge.pki.rsa.PrivateKey;
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.setRsaPublicKey(llave.n, llave.e);
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date(Date.now() - 86400e3);
  cert.validity.notAfter = new Date(Date.now() + 365 * 86400e3);
  const sujeto = [{ name: "commonName", value: "FactPOS CERTIFICADO DE PRUEBA" }, { name: "countryName", value: "DO" }];
  cert.setSubject(sujeto);
  cert.setIssuer(sujeto);
  cert.sign(llave, forge.md.sha256.create());
  cache = { llavePem, certPem: forge.pki.certificateToPem(cert), prueba: true, titular: "PRUEBA", vence: cert.validity.notAfter, origen: "prueba" };
  return cache;
}

/** Firma el documento completo y devuelve el XML firmado y el SignatureValue. */
export function firmarXml(xml: string): { xmlFirmado: string; signatureValue: string } {
  const c = certificado();
  const sig = new SignedXml({
    privateKey: c.llavePem,
    publicCert: c.certPem,
    signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
    canonicalizationAlgorithm: "http://www.w3.org/TR/2001/REC-xml-c14n-20010315",
  });
  sig.addReference({
    xpath: "/*",
    uri: "",
    isEmptyUri: true,
    digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256",
    transforms: ["http://www.w3.org/2000/09/xmldsig#enveloped-signature"],
  });
  sig.computeSignature(xml, { location: { reference: "/*", action: "append" } });
  const xmlFirmado = sig.getSignedXml();
  const valor = /<SignatureValue>([^<]+)<\/SignatureValue>/.exec(xmlFirmado)?.[1]?.replace(/\s/g, "");
  if (!valor) throw new Error("No se pudo obtener el SignatureValue de la firma");
  return { xmlFirmado, signatureValue: valor };
}

/** Código de seguridad: los primeros 6 caracteres del SignatureValue de la firma. */
export const codigoSeguridad = (signatureValue: string) => signatureValue.slice(0, 6);
