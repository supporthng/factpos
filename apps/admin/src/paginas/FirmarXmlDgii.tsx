const DESCARGA = "https://dgii.gov.do/cicloContribuyente/facturacion/comprobantesFiscalesElectronicosE-CF/App%20Firma%20Digital/App%20Firma%20Digital.zip";
const INSTRUCTIVO = "https://dgii.gov.do/cicloContribuyente/facturacion/comprobantesFiscalesElectronicosE-CF/Documentacin%20sobre%20eCF/Instructivos%20sobre%20Facturaci%C3%B3n%20Electr%C3%B3nica/Instructivo%20App%20Firma%20Digital.pdf";

/**
 * La postulación, las delegaciones de roles y la declaración jurada se firman con el «Aplicativo para firma digital» de la DGII
 * (la herramienta oficial; así la DGII siempre acepta la firma). FactPOS firma por su cuenta los comprobantes y las aprobaciones.
 */
export function FirmarXmlDgii() {
  return (
    <div className="panel" style={{ marginTop: 14 }}>
      <h3 style={{ marginTop: 0 }}>Firmar la postulación y otros XML de la DGII</h3>
      <p className="suave pequeno">
        La postulación, las delegaciones de roles y la declaración jurada se descargan de la DGII sin firma. Fírmelos con el <b>Aplicativo para firma digital</b> de
        la DGII: elija el XML y el certificado (.p12), escriba su clave y pulse «Descargar XML firmado»; después súbalo de nuevo al portal de la DGII.
      </p>
      <div className="fila-acciones">
        <a className="boton primario" href={DESCARGA} target="_blank" rel="noopener noreferrer">Descargar el firmador de la DGII</a>
        <a className="enlace" href={INSTRUCTIVO} target="_blank" rel="noopener noreferrer">Instructivo (PDF)</a>
      </div>
      <p className="suave pequeno" style={{ marginBottom: 0 }}>Los comprobantes del set de pruebas y las aprobaciones comerciales no pasan por aquí: FactPOS los firma al enviarlos.</p>
    </div>
  );
}
