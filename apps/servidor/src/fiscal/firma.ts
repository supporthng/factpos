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
 * Sin certificado se usa uno de PRUEBA generado al vuelo (solo ambiente SIMULADO).
 */
export interface Certificado { llavePem: string; certPem: string; prueba: boolean; titular: string; vence: Date }

let cache: Certificado | null = null;

export function certificado(): Certificado {
  if (cache) return cache;
  const ruta = process.env.CERT_P12_RUTA;
  if (ruta) {
    const p12 = forge.pkcs12.pkcs12FromAsn1(
      forge.asn1.fromDer(readFileSync(ruta).toString("binary")),
      process.env.CERT_P12_CLAVE ?? "",
    );
    const llave = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0]?.key;
    const cert = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag]?.[0]?.cert;
    if (!llave || !cert) throw new Error("El certificado .p12 no contiene llave privada o certificado");
    cache = {
      llavePem: forge.pki.privateKeyToPem(llave),
      certPem: forge.pki.certificateToPem(cert),
      prueba: false,
      titular: String(cert.subject.getField("CN")?.value ?? ""),
      vence: cert.validity.notAfter,
    };
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
  cache = { llavePem, certPem: forge.pki.certificateToPem(cert), prueba: true, titular: "PRUEBA", vence: cert.validity.notAfter };
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
