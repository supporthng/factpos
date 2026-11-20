import { documento } from "./sitio-web.js";

/**
 * Página «Facturación electrónica»: cómo FactPOS emite, firma y envía los e-CF a la DGII, cómo guía la certificación y qué revisa
 * antes de dejar facturar. Lo que dice aquí existe en la administración (Fiscal › Facturación electrónica y Certificación DGII).
 */
const li = (t: string, d: string) => `<li><div><b>${t}</b> <span>${d}</span></div></li>`;

const TIPOS: [string, string, string][] = [
  ["E31", "Factura de crédito fiscal", "Caja"],
  ["E32", "Factura de consumo", "Caja"],
  ["E34", "Nota de crédito", "Caja (anulaciones y devoluciones)"],
  ["E33", "Nota de débito", "Se genera según el esquema oficial; se habilita al conectar su módulo"],
  ["E41", "Comprobante de compras", "Se habilita al conectar su módulo"],
  ["E43", "Gastos menores", "Se habilita al conectar su módulo"],
  ["E44", "Regímenes especiales", "Se habilita al conectar su módulo"],
  ["E45", "Gubernamental", "Se habilita al conectar su módulo"],
  ["E46", "Exportaciones", "Se habilita al conectar su módulo"],
  ["E47", "Pagos al exterior", "Se habilita al conectar su módulo"],
];

const cuerpo = `
<div class="ph"><div class="cont">
  <span class="etq"><i></i>e-CF · DGII</span>
  <h1>Facturación electrónica sin complicarse</h1>
  <p>FactPOS genera, firma y envía sus comprobantes fiscales electrónicos a la DGII desde su propio servidor, lo guía paso a paso en la certificación y revisa que todo esté en orden antes de dejarle facturar.</p>
  <div class="acc"><a class="btn p" href="/#descargar">Probar 15 días</a><a class="btn s" href="/funciones">Ver todas las funciones</a><a class="btn s" href="/#contacto">Hablar con nosotros</a></div>
</div></div>
<div class="indice"><div class="cont"><a href="#como">Cómo funciona</a><a href="#tipos">Tipos de e-CF</a><a href="#certificacion">Certificación</a><a href="#validador">¿Puedo facturar?</a><a href="#secuencias">Secuencias</a><a href="#recepcion">Recepción</a><a href="#certificado">Certificado</a><a href="#requisitos">Requisitos</a><a href="#preguntas">Preguntas</a></div></div>

<section class="area" id="como"><div class="cont">
  <div class="tit"><small>Cómo funciona</small><h2>De la venta a la DGII, sin que el cajero haga nada extra</h2><p>El cajero cobra como siempre. El resto ocurre solo.</p></div>
  <div class="flujo">
    <div class="paso"><h3>Se cobra la venta</h3><p>La caja toma el siguiente e-NCF del bloque de su sucursal: nunca se repite, aunque no haya internet.</p></div>
    <div class="paso"><h3>Se firma el e-CF</h3><p>El servidor de la tienda arma el XML y lo firma con el certificado digital de su empresa.</p></div>
    <div class="paso"><h3>Se envía a la DGII</h3><p>Va a una cola con reintentos. Sin internet se sigue facturando y se envía al volver la conexión.</p></div>
    <div class="paso"><h3>El ticket lleva el QR</h3><p>Sale con el código de seguridad y el QR para que el cliente verifique el comprobante en la DGII.</p></div>
  </div>
  <div class="rejilla" style="margin-top:18px">
    <div class="tarj"><div class="ic">🧾</div><h3>Consumo menor de RD$250,000</h3><p>Se envía el resumen (RFCE) y se conserva el e-CF completo firmado. Los demás, el e-CF completo.</p></div>
    <div class="tarj"><div class="ic">↩️</div><h3>Anulaciones con nota de crédito</h3><p>Anular o corregir una factura emite la nota de crédito (E34), devuelve el inventario y registra la devolución, con motivo y PIN del supervisor.</p></div>
    <div class="tarj"><div class="ic">🖨️</div><h3>Reimpresión como copia</h3><p>Reimprima cualquier factura en ticket, media carta o carta, marcada como copia y con vista previa antes de imprimir.</p></div>
    <div class="tarj"><div class="ic">🔀</div><h3>Su forma de transmitir</h3><p>Directo a la DGII con su certificado propio, o por medio de un proveedor autorizado. También hay un modo de práctica para capacitar al personal sin enviar nada.</p></div>
  </div>
</div></section>

<section class="area" id="tipos"><div class="cont">
  <div class="tit"><small>Tipos de e-CF</small><h2>Los 10 tipos de comprobante de la DGII</h2><p>FactPOS genera los diez tipos con los esquemas oficiales. En la caja se emiten hoy los tres de mayor uso.</p></div>
  <table class="tipos"><thead><tr><th>Tipo</th><th>Comprobante</th><th>Dónde se emite</th></tr></thead><tbody>
    ${TIPOS.map((t) => `<tr><td>${t[0]}</td><td>${t[1]}</td><td>${t[2]}</td></tr>`).join("")}
  </tbody></table>
</div></section>

<section class="area" id="certificacion"><div class="cont">
  <div class="tit"><small>Certificación</small><h2>Una guía para certificarse, paso por paso <span class="nuevo">NUEVO</span></h2><p>La DGII exige un proceso de pruebas antes de autorizar a emitir. FactPOS lo ordena en etapas y trae a mano la herramienta de cada una.</p></div>
  <div class="dos">
    <ol class="chk" style="list-style:none">
      ${li("1. Preparar", "Oficina Virtual, certificado cargado, postulación y firmador de XML de la DGII incluido.")}
      ${li("2. Pruebas y simulación", "Suba los Excel que entrega la DGII: FactPOS arma, firma y envía cada comprobante del set, las aprobaciones comerciales y la simulación.")}
      ${li("3. Recepción y URLs", "Le muestra las direcciones que la DGII debe llamar y comprueba que respondan.")}
      ${li("4. Declaración jurada y cierre", "Firma del archivo de la declaración con el certificado del representante.")}
      ${li("5. Pasar a producción", "Rangos reales, cambio de ambiente y primera factura verificada.")}
    </ol>
    <div>
      <div class="tarj"><h3>Lo que ya viene resuelto</h3><ul class="mini-l">
        <li>Envío del set de pruebas con los números originales y la simulación con su propia numeración</li>
        <li>Resúmenes de consumo menor de RD$250,000 y su e-CF completo para subir al portal</li>
        <li>Aprobaciones comerciales con la fecha y hora que pide la DGII</li>
        <li>Representaciones impresas para subir al portal</li>
        <li>El envío masivo se detiene en el primer rechazo y no repite lo ya aceptado</li>
        <li>Avisos de qué cuidar en cada etapa, aprendidos en certificaciones reales</li>
      </ul></div>
      <p class="nota">La autorización como emisor electrónico la otorga la DGII. FactPOS no la reemplaza: la prepara y la acompaña.</p>
    </div>
  </div>
</div></section>

<section class="area" id="validador"><div class="cont">
  <div class="tit"><small>Antes de facturar</small><h2>«¿Puedo facturar?»: el validador <span class="nuevo">NUEVO</span></h2><p>Un solo botón revisa todo lo necesario para emitir e-CF de verdad y le dice qué corregir, con la acción exacta.</p></div>
  <div class="dos">
    <ul class="chk">
      ${li("Ambiente", "Que esté en Producción: en pruebas las facturas no valen.")}
      ${li("RNC de la empresa", "Que esté cargado y sea válido.")}
      ${li("Certificado digital", "Vigencia y aviso cuando le quedan 30 días o menos.")}
      ${li("Conexión con la DGII", "Que la DGII acepte su certificado y dé acceso.")}
      ${li("Registro en la DGII", "Que figure como facturador electrónico en su directorio.")}
    </ul>
    <ul class="chk">
      ${li("Dirección de recepción", "Que la dirección registrada en la DGII responda y llegue a su servidor.")}
      ${li("Direcciones públicas", "Que su dirección fija responda desde internet.")}
      ${li("Secuencias e-NCF", "Que haya números vigentes de crédito fiscal, consumo y notas de crédito en cada sucursal, y avisa cuando se agotan o vencen.")}
      ${li("Certificado en las sucursales", "Que esté activado donde se factura.")}
      ${li("Envíos recientes", "Que no haya comprobantes rechazados o pendientes.")}
    </ul>
  </div>
</div></section>

<section class="area" id="secuencias"><div class="cont">
  <div class="tit"><small>Secuencias</small><h2>Los números de e-NCF, bajo control <span class="nuevo">NUEVO</span></h2><p>La DGII autoriza rangos a la empresa; FactPOS los reparte entre sus sucursales para que cada tienda numere sin internet y nunca se repitan.</p></div>
  <div class="rejilla">
    <div class="tarj"><div class="ic">🗂️</div><h3>Rangos autorizados y bloques</h3><p>Registre el rango de la DGII con su fecha de vencimiento y asigne bloques a cada sucursal.</p></div>
    <div class="tarj"><div class="ic">✏️</div><h3>Editables después de crearlos</h3><p>Ajuste o elimine rangos y bloques mientras no tengan números usados ni reservados; los usados quedan protegidos.</p></div>
    <div class="tarj"><div class="ic">🧪</div><h3>Retirar bloques de prueba</h3><p>Al pasar a producción, retire el bloque de certificación para que la numeración real arranque limpia.</p></div>
    <div class="tarj"><div class="ic">⚠️</div><h3>Mensajes claros</h3><p>Si un bloque se cruza con otro, el sistema le dice cuál y por qué, en lugar de un error genérico.</p></div>
  </div>
</div></section>

<section class="area" id="recepcion"><div class="cont">
  <div class="tit"><small>Recepción</small><h2>Reciba los e-CF de sus proveedores</h2><p>Sus proveedores también facturan electrónicamente: FactPOS los recibe y responde por usted.</p></div>
  <div class="dos">
    <ul class="chk">
      ${li("Bandeja de recibidos", "Todos los comprobantes que le envían, en un solo lugar.")}
      ${li("Aprobación comercial", "Acepte o rechace cada comprobante y la respuesta viaja firmada a la DGII.")}
      ${li("Acuse de recibo automático", "FactPOS responde a quien le envía sin que usted intervenga.")}
    </ul>
    <div class="tarj"><div class="ic">🌐</div><h3>Una dirección fija en internet <span class="nuevo">NUEVO</span></h3><p>Cada empresa recibe su propia dirección (por ejemplo, su-empresa.factpos.app) para que la DGII y sus proveedores le lleguen, sin abrir puertos ni tocar el router. Solo hace falta que el servidor esté encendido y con internet.</p></div>
  </div>
</div></section>

<section class="area" id="certificado"><div class="cont">
  <div class="tit"><small>Certificado digital</small><h2>Su certificado, guardado y controlado</h2><p>El archivo .p12 de su empresa firma cada comprobante.</p></div>
  <div class="rejilla">
    <div class="tarj"><div class="ic">🔒</div><h3>Guardado cifrado</h3><p>Se revisa la contraseña y la vigencia antes de guardarlo; nadie puede descargarlo desde la administración.</p></div>
    <div class="tarj"><div class="ic">🏬</div><h3>Activo por sucursal</h3><p>Se activa en las sucursales que ya deben facturar ante la DGII; cada servidor lo pide al arrancar y lo conserva aunque se quede sin internet.</p></div>
    <div class="tarj"><div class="ic">⏰</div><h3>Aviso de vencimiento</h3><p>Se le avisa cuando faltan 30 días o menos, para renovarlo a tiempo.</p></div>
    <div class="tarj"><div class="ic">🔁</div><h3>Reemplazar o quitar</h3><p>Reemplácelo por uno nuevo o quítelo cuando lo necesite, con confirmación extra si está en producción.</p></div>
  </div>
</div></section>

<section class="area" id="requisitos"><div class="cont">
  <div class="tit"><small>Requisitos</small><h2>Qué necesita su empresa para facturar electrónicamente</h2><p>FactPOS se encarga de lo técnico; estos pasos son de la empresa ante la DGII.</p></div>
  <div class="dos">
    <ol class="chk" style="list-style:none">
      ${li("RNC activo y Oficina Virtual (OFV)", "con usuario del representante de la empresa.")}
      ${li("Certificado digital (.p12)", "de una entidad certificadora autorizada.")}
      ${li("Postulación y certificación", "ante la DGII; FactPOS lo guía en la herramienta de Certificación.")}
      ${li("Rangos de e-NCF", "solicitados en la Oficina Virtual para cada tipo que va a usar.")}
    </ol>
    <div class="aviso">Cada empresa debe estar habilitada como emisor electrónico por la DGII. Si necesita ayuda con el proceso, escríbanos: lo acompañamos desde la postulación hasta la primera factura en producción.</div>
  </div>
</div></section>

<section class="area" id="preguntas"><div class="cont">
  <div class="tit"><small>Preguntas frecuentes</small><h2>Facturación electrónica: lo que casi todos preguntan</h2></div>
  <div class="faq">
    <details><summary>¿Tengo que certificarme para emitir e-CF?</summary><p>Sí: la DGII exige un proceso de pruebas antes de autorizar a la empresa a emitir en producción. FactPOS trae una guía con las herramientas de cada etapa para hacerlo ordenado.</p></details>
    <details><summary>¿Qué pasa si se cae el internet?</summary><p>Se sigue facturando: cada comprobante queda firmado en su servidor y se envía a la DGII cuando vuelve la conexión.</p></details>
    <details><summary>¿Puedo practicar antes de facturar de verdad?</summary><p>Sí. Hay un modo de práctica que no envía nada a la DGII, y los ambientes de pruebas y certificación de la propia DGII. Al pasar a producción se retiran los números de prueba.</p></details>
    <details><summary>¿Dónde veo si el comprobante fue aceptado?</summary><p>En la lista de envíos de la administración y en la verificación de la DGII, a la que se llega escaneando el QR del ticket.</p></details>
    <details><summary>¿Necesito un proveedor de facturación electrónica aparte?</summary><p>No es obligatorio: FactPOS puede enviar directamente a la DGII con su certificado. Si prefiere, también puede usar un proveedor autorizado.</p></details>
    <details><summary>¿Qué pasa cuando se me agotan los números?</summary><p>El validador y los avisos le muestran cuántos quedan y cuándo vencen. Solicite el siguiente rango en la Oficina Virtual, regístrelo y asígnelo a la sucursal.</p></details>
  </div>
</div></section>

<section><div class="cont"><div class="cta">
  <h2>Empiece a facturar electrónicamente</h2>
  <p>Pruebe FactPOS 15 días sin pagar y sin tarjeta, o escríbanos y lo acompañamos en la certificación.</p>
  <div class="acc"><a class="btn p" href="/#descargar">Descargar y probar 15 días</a><a class="btn s" href="/#contacto">Hablar con nosotros</a><a class="btn s" href="/#planes">Ver planes</a></div>
</div></div></section>`;

export const PAGINA_ECF = documento({
  ruta: "/facturacion-electronica",
  activa: "ecf",
  titulo: "Facturación electrónica e-CF · FactPOS",
  descripcion: "FactPOS emite, firma y envía e-CF a la DGII, guía la certificación paso a paso y revisa que su empresa pueda facturar. Funciona también sin internet.",
  cuerpo,
});
