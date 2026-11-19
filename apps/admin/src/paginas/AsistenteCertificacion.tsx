import { useState } from "react";
import { Aviso, Encabezado } from "../ui";
import { SetPruebasDgii } from "./SetPruebasDgii";
import { FirmarXmlDgii } from "./FirmarXmlDgii";
import { EnsayoTipos } from "./CertificacionDgii";

/**
 * Certificación DGII de UNA empresa, en etapas ordenadas. Cada etapa dice qué hacer, en qué orden y qué cuidar, y trae a mano
 * la herramienta que necesita. Lo aprendido certificando a Fumigadora Zapa (ambiente CerteCF, numeración de simulación,
 * un solo envío por lote, XML completo de las facturas de consumo, recepción por la dirección fija…) está escrito aquí.
 * Las marcas «Hecha» se guardan solo en este navegador: la DGII es quien da fe del avance real.
 */
const CLAVE = "factpos.certificacion.etapas";
const leerMarcas = (): Record<string, boolean> => { try { return JSON.parse(localStorage.getItem(CLAVE) ?? "{}"); } catch { return {}; } };

/** Dirección pública de esta empresa (la que la DGII llama): solo se conoce si se está entrando por su dirección fija. */
const base = () => (location.hostname.endsWith(".factpos.app") ? `https://${location.host}` : "https://<su-dirección>.factpos.app");

const Pasos = ({ items }: { items: string[] }) => (
  <ol className="pequeno" style={{ margin: "8px 0", paddingLeft: 20, maxWidth: "85ch" }}>{items.map((t, i) => <li key={i} style={{ margin: "4px 0" }}>{t}</li>)}</ol>
);
const Cuidado = ({ items }: { items: string[] }) => (
  <>
    <b className="pequeno">Cuide esto</b>
    <ul className="pequeno" style={{ margin: "4px 0 8px", paddingLeft: 20, maxWidth: "85ch" }}>{items.map((t, i) => <li key={i} style={{ margin: "3px 0" }}>{t}</li>)}</ul>
  </>
);

function Urls() {
  const b = base();
  const filas: [string, string][] = [
    ["Autenticación", `${b}/fe/autenticacion/api/[semilla|ValidacionCertificado]`],
    ["Recepción de e-CF", `${b}/fe/recepcion/api/ecf`],
    ["Aprobación comercial", `${b}/fe/aprobacioncomercial/api/ecf`],
  ];
  return (
    <div style={{ margin: "8px 0" }}>
      {filas.map(([n, u]) => (
        <div key={n} className="pequeno" style={{ margin: "4px 0" }}><b>{n}:</b> <code>{u}</code></div>
      ))}
      <div className="fila-acciones">
        <a className="boton" href={`${b}/fe/autenticacion/api/semilla`} target="_blank" rel="noopener noreferrer">Probar que responde (debe mostrar una semilla)</a>
      </div>
    </div>
  );
}

interface Etapa { id: string; titulo: string; resumen: string; cuerpo: () => React.ReactNode }

const ETAPAS: Etapa[] = [
  {
    id: "preparar", titulo: "1. Preparar", resumen: "Oficina Virtual, certificado y postulación",
    cuerpo: () => (
      <>
        <p className="pequeno" style={{ maxWidth: "85ch" }}>Antes de las pruebas la empresa necesita su acceso a la Oficina Virtual, el certificado digital cargado en FactPOS y la postulación aprobada en el Portal de Certificación.</p>
        <Pasos items={[
          "Certificado digital (.p12) a nombre de la empresa o de su representante: cárguelo en Fiscal › Certificado digital.",
          "Oficina Virtual (OFV): el representante debe tener usuario y la relación con el RNC de la empresa.",
          "En el Portal de Certificación: «Generar archivo» de la postulación, fírmelo con el firmador de la DGII (abajo) y súbalo.",
          "Con la postulación aprobada, descargue el Excel del set de pruebas.",
          "En Fiscal › Facturación electrónica: transmisor «DGII» y ambiente «Certificación (CerteCF)».",
        ]} />
        <Cuidado items={[
          "El Paso 2 de la DGII solo cuenta lo que se envía a CerteCF; en TesteCF los comprobantes salen aceptados pero no suman.",
          "En la postulación la versión del software va como número decimal (por ejemplo 6.0).",
          "El certificado debe ser el mismo que se usó en la postulación.",
        ]} />
        <FirmarXmlDgii />
        <EnsayoTipos />
      </>
    ),
  },
  {
    id: "pruebas", titulo: "2. Pruebas de datos y simulación", resumen: "Pasos 2, 3, 4 y 5 de la DGII",
    cuerpo: () => (
      <>
        <p className="pequeno" style={{ maxWidth: "85ch" }}>Todo se hace con la herramienta de abajo. Se suben los Excel que genera la DGII; FactPOS arma, firma y envía cada comprobante.</p>
        <Pasos items={[
          "Paso 2 (Pruebas de datos e-CF): suba el Excel del set y envíelo TAL CUAL, con los números originales, sin convertir en simulación. En CerteCF la DGII solo acepta los e-NCF de su propio set.",
          "Paso 3 (Aprobación comercial): suba el Excel de aprobaciones, que es otro archivo, y envíelo. FactPOS usa la fecha y hora que trae el Excel.",
          "Paso 4 (Simulación e-CF): con el Excel del set cargado, ponga el número de inicio (101, 201, 301…; FactPOS propone el siguiente libre), pulse «Convertir en simulación» y luego «Enviar todo a la DGII» UNA sola vez.",
          "Facturas de consumo menores a 250 mil: cuando los resúmenes estén aceptados, suba en el portal los e-CF completos con el botón «XML» de cada fila (no el botón «Resumen»).",
          "Paso 5 (Representación impresa): descargue los PDF y suba uno por tipo, del Paso 4. Máximo 10 MB en total.",
        ]} />
        <Cuidado items={[
          "Un rechazo reinicia las pruebas de esa etapa y el número rechazado no se puede reusar: reinicie la simulación con un inicio más alto.",
          "No pulse «Enviar» fila por fila ni abra FactPOS en otra pestaña mientras corre el lote: repetir un envío provoca el rechazo 75/1209.",
          "El envío masivo se detiene en el primer rechazo y no repite lo ya aceptado.",
          "Siempre use el Excel más reciente que descargó del portal; el set cambia entre descargas.",
        ]} />
        <SetPruebasDgii />
      </>
    ),
  },
  {
    id: "recepcion", titulo: "3. Recepción y URLs", resumen: "Pasos 7 al 12 de la DGII",
    cuerpo: () => (
      <>
        <p className="pequeno" style={{ maxWidth: "85ch" }}>La DGII llama a estas direcciones para enviarle comprobantes y aprobaciones. Se confirman en el portal en los pasos 7 (pruebas) y 12 (producción), y son las mismas.</p>
        <Urls />
        <Pasos items={[
          "Entre a FactPOS por la dirección fija de la empresa y verifique que la dirección de arriba muestre la semilla.",
          "Pasos 8 y 9: inicie la prueba de recepción en el portal; la DGII envía comprobantes y FactPOS responde el acuse. No pulse Aceptar ni Rechazar en la bandeja.",
          "Pasos 10 y 11: inicie la prueba de aprobación comercial; la DGII envía las aprobaciones. Si el portal reporta error de conexión, vuelva a pulsar el botón de enviar una sola vez.",
          "Paso 12: confirme las mismas URL para producción.",
        ]} />
        <Cuidado items={[
          "El servidor de la empresa debe estar encendido y con internet mientras dura cada prueba. Si el túnel se cae, el portal muestra el error 530/1033 y reinicia la prueba.",
          "Esa dirección queda publicada para los demás contribuyentes: no la cambie después.",
        ]} />
      </>
    ),
  },
  {
    id: "cierre", titulo: "4. Declaración jurada y cierre", resumen: "Pasos 13 al 15 de la DGII",
    cuerpo: () => (
      <>
        <Pasos items={[
          "Paso 13: «Generar archivo» en el portal, fírmelo con el firmador de la DGII y el certificado del representante, y súbalo.",
          "Paso 14: la DGII verifica el estatus del contribuyente (RNC al día, relación del representante y OFV activa).",
          "Paso 15: finalizado. La Oficina Virtual habilita la facturación electrónica.",
        ]} />
        <Cuidado items={["La declaración jurada la firma el representante: confirme que conoce y acepta el texto antes de subirla."]} />
        <FirmarXmlDgii />
      </>
    ),
  },
  {
    id: "produccion", titulo: "5. Pasar a producción", resumen: "Facturar con e-CF reales",
    cuerpo: () => (
      <>
        <Pasos items={[
          "En la Oficina Virtual, solicite los rangos de e-NCF reales de cada tipo que usará (E31, E32, E34…).",
          "Regístrelos en Fiscal › Comprobantes (NCF) con su fecha de vencimiento.",
          "Solo entonces cambie el ambiente a «Producción (ECF)».",
          "Haga una primera factura real y verifíquela en la DGII.",
        ]} />
        <Cuidado items={[
          "En producción cada e-CF es legal y consume un número real: no use rangos de prueba.",
          "Deje el servidor siempre encendido: la DGII y los proveedores le enviarán comprobantes a la dirección publicada.",
        ]} />
      </>
    ),
  },
];

export function AsistenteCertificacion() {
  const [actual, setActual] = useState(ETAPAS[0]!.id);
  const [marcas, setMarcas] = useState<Record<string, boolean>>(leerMarcas);
  const etapa = ETAPAS.find((e) => e.id === actual) ?? ETAPAS[0]!;
  const alternar = (id: string) => setMarcas((m) => {
    const n = { ...m, [id]: !m[id] };
    try { localStorage.setItem(CLAVE, JSON.stringify(n)); } catch { /* sin almacenamiento */ }
    return n;
  });
  const hechas = ETAPAS.filter((e) => marcas[e.id]).length;
  return (
    <>
      <Encabezado titulo="Certificación DGII" descripcion="Pasos para certificar a esta empresa como emisor electrónico, en orden y con las herramientas a mano." />
      <Aviso tipo="info" texto={`${hechas} de ${ETAPAS.length} etapas marcadas. Las marcas son solo suyas (este navegador); el avance oficial lo muestra el Portal de Certificación de la DGII.`} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "flex-start" }}>
        <nav className="panel" aria-label="Etapas de la certificación" style={{ padding: 8, flex: "1 1 220px", maxWidth: 280 }}>
          {ETAPAS.map((e) => (
            <button key={e.id} className={"boton" + (e.id === etapa.id ? " primario" : "")} onClick={() => setActual(e.id)}
              style={{ display: "block", width: "100%", textAlign: "left", margin: "4px 0" }} aria-current={e.id === etapa.id ? "step" : undefined}>
              {marcas[e.id] ? "✓ " : ""}{e.titulo}
              <span className="suave pequeno" style={{ display: "block", fontWeight: 400 }}>{e.resumen}</span>
            </button>
          ))}
        </nav>
        <div style={{ flex: "3 1 340px", minWidth: 0 }}>
          <div className="panel">
            <div className="fila-acciones" style={{ marginTop: 0 }}>
              <h3 style={{ margin: 0 }}>{etapa.titulo}</h3><span className="flex" />
              <label className="check"><input type="checkbox" checked={!!marcas[etapa.id]} onChange={() => alternar(etapa.id)} /> Etapa hecha</label>
            </div>
            {etapa.cuerpo()}
          </div>
        </div>
      </div>
    </>
  );
}
