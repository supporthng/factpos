import QRCode from "qrcode";
import { api, rd } from "./api";

/**
 * Impresión en CARTA (8½ × 11 pulg.) de cotizaciones y facturas.
 * Se abre una página lista para imprimir o guardar como PDF (el navegador elige «Carta» y sin márgenes extra).
 */
export interface EmpresaImpresion { nombre?: string; razonSocial?: string; rnc?: string; logo?: string | null; direccion?: string | null; telefono?: string | null }

export interface DocumentoCarta {
  /** «Cotización», «Factura de Crédito Fiscal Electrónica»… */
  titulo: string;
  numero: string;
  /** Cuadro de la derecha: [«Fecha», «30/10/2026»], [«Válida hasta», …] */
  datos: [string, string][];
  /** Quien recibe el documento */
  cliente: { nombre: string; documento?: string | null; telefono?: string | null; correo?: string | null } | null;
  etiquetaCliente?: string;
  lineas: { descripcion: string; cantidad: string; precio: string; descuento?: string; total: string }[];
  /** Subtotal, descuento, ITBIS… (el total va aparte, resaltado) */
  totales: [string, string][];
  total: [string, string];
  notas?: string | null;
  /** Párrafos al pie (condiciones, forma de pago) */
  pie?: string[];
  /** Representación impresa de un e-CF */
  fiscal?: { encf: string; codigoSeguridad?: string | null; fechaFirma?: string | null; venceSecuencia?: string | null; urlQr?: string | null } | null;
  anulada?: boolean;
}

const esc = (t: unknown) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const multilinea = (t: unknown) => esc(t).replace(/\n/g, "<br>");

export const empresaParaImprimir = (sucursalId?: string | null) =>
  api<EmpresaImpresion>(`/central/empresa/impresion${sucursalId ? `?sucursalId=${sucursalId}` : ""}`).catch(() => ({} as EmpresaImpresion));

export async function imprimirCarta(doc: DocumentoCarta, sucursalId?: string | null) {
  // La ventana se abre ya (dentro del clic) para que el navegador no la bloquee; se llena cuando llegan los datos
  const w = window.open("", "_blank");
  if (!w) { alert("El navegador bloqueó la ventana de impresión: permita las ventanas emergentes."); return; }
  w.document.write("<!doctype html><meta charset=\"utf-8\"><title>Preparando…</title><p style=\"font:14px system-ui;margin:24px\">Preparando el documento…</p>");
  const emp = await empresaParaImprimir(sucursalId);
  let qr = "";
  if (doc.fiscal?.urlQr) { try { qr = await QRCode.toDataURL(doc.fiscal.urlQr, { margin: 0, width: 220 }); } catch { /* sin QR */ } }
  const color = getComputedStyle(document.documentElement).getPropertyValue("--primario").trim() || "#0f766e";
  const f = doc.fiscal;
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(doc.titulo)} ${esc(doc.numero)}</title>
<style>
@page { size: letter; margin: 12mm 13mm; }
* { box-sizing: border-box; }
body { font: 12px/1.35 "Segoe UI", Arial, sans-serif; color: #1f2933; margin: 0; }
.sup { display: flex; justify-content: space-between; gap: 18px; align-items: flex-start; }
.emisor { display: flex; gap: 12px; align-items: center; }
.emisor img { max-height: 64px; max-width: 150px; object-fit: contain; }
.emisor h1 { font-size: 18px; margin: 0 0 2px; }
.emisor div { color: #444; }
.caja-doc { border: 1.5px solid ${esc(color)}; border-radius: 6px; min-width: 215px; overflow: hidden; }
.caja-doc .t { background: ${esc(color)}; color: #fff; padding: 6px 10px; font-weight: 700; font-size: 13px; }
.caja-doc .n { padding: 6px 10px 2px; font-size: 16px; font-weight: 700; }
.caja-doc dl { margin: 0; padding: 2px 10px 8px; display: grid; grid-template-columns: auto 1fr; gap: 1px 10px; }
.caja-doc dt { color: #666; } .caja-doc dd { margin: 0; text-align: right; }
.cli { border: 1px solid #cfd6dd; border-radius: 6px; padding: 8px 12px; margin: 14px 0 10px; display: grid; grid-template-columns: 1fr 1fr; gap: 2px 20px; }
.cli .e { grid-column: 1 / -1; font-size: 10px; letter-spacing: .06em; text-transform: uppercase; color: #667; }
table { width: 100%; border-collapse: collapse; }
thead { display: table-header-group; }
th { background: #eef1f4; font-size: 10.5px; text-transform: uppercase; letter-spacing: .04em; color: #4b5563; padding: 7px 8px; text-align: left; }
td { padding: 6px 8px; border-bottom: 1px solid #e5e9ed; vertical-align: top; }
tr { page-break-inside: avoid; }
.d { text-align: right; white-space: nowrap; }
.tot { display: flex; justify-content: flex-end; margin-top: 12px; page-break-inside: avoid; }
.tot table { width: 280px; } .tot td { border: 0; padding: 3px 8px; }
.tot .g td { border-top: 2px solid ${esc(color)}; font-size: 15px; font-weight: 700; padding-top: 7px; }
.notas { margin-top: 14px; page-break-inside: avoid; } .notas b { display: block; }
.pie { margin-top: 12px; color: #555; font-size: 11px; white-space: pre-line; }
.fiscal { display: flex; gap: 14px; align-items: center; margin-top: 16px; padding-top: 10px; border-top: 1px dashed #9aa5b1; page-break-inside: avoid; }
.fiscal img { width: 96px; height: 96px; }
.fiscal div { font-size: 11px; line-height: 1.5; }
.anulada { color: #b91c1c; border: 3px solid #b91c1c; font-weight: 800; font-size: 26px; text-align: center; padding: 6px; margin: 10px 0; transform: rotate(-3deg); }
.firma { display: flex; gap: 40px; margin-top: 46px; page-break-inside: avoid; } .firma div { flex: 1; border-top: 1px solid #889; padding-top: 4px; text-align: center; color: #555; font-size: 11px; }
</style></head><body>
<div class="sup">
  <div class="emisor">${emp.logo ? `<img src="${esc(emp.logo)}" alt="">` : ""}
    <div><h1>${esc(emp.nombre ?? "")}</h1>
      ${emp.razonSocial && emp.razonSocial !== emp.nombre ? `<div>${esc(emp.razonSocial)}</div>` : ""}
      ${emp.rnc ? `<div>RNC ${esc(emp.rnc)}</div>` : ""}
      ${emp.direccion ? `<div>${esc(emp.direccion)}</div>` : ""}
      ${emp.telefono ? `<div>Tel. ${esc(emp.telefono)}</div>` : ""}</div></div>
  <div class="caja-doc"><div class="t">${esc(doc.titulo)}</div><div class="n">${esc(doc.numero)}</div>
    <dl>${doc.datos.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl></div>
</div>
${doc.anulada ? `<div class="anulada">ANULADA</div>` : ""}
${doc.cliente ? `<div class="cli"><div class="e">${esc(doc.etiquetaCliente ?? "Cliente")}</div>
  <div><b>${esc(doc.cliente.nombre)}</b></div><div>${doc.cliente.documento ? `RNC / Cédula: ${esc(doc.cliente.documento)}` : ""}</div>
  <div>${doc.cliente.telefono ? `Tel. ${esc(doc.cliente.telefono)}` : ""}</div><div>${doc.cliente.correo ? esc(doc.cliente.correo) : ""}</div></div>` : ""}
<table><thead><tr><th style="width:34px">#</th><th>Descripción</th><th class="d">Cant.</th><th class="d">Precio</th>${doc.lineas.some((l) => l.descuento) ? `<th class="d">Desc.</th>` : ""}<th class="d">Total</th></tr></thead><tbody>
${doc.lineas.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.descripcion)}</td><td class="d">${esc(l.cantidad)}</td><td class="d">${esc(l.precio)}</td>${doc.lineas.some((x) => x.descuento) ? `<td class="d">${esc(l.descuento ?? "")}</td>` : ""}<td class="d">${esc(l.total)}</td></tr>`).join("")}
</tbody></table>
<div class="tot"><table>${doc.totales.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="d">${esc(v)}</td></tr>`).join("")}<tr class="g"><td>${esc(doc.total[0])}</td><td class="d">${esc(doc.total[1])}</td></tr></table></div>
${doc.notas ? `<div class="notas"><b>Notas</b>${multilinea(doc.notas)}</div>` : ""}
${(doc.pie ?? []).filter(Boolean).map((p) => `<div class="pie">${esc(p)}</div>`).join("")}
${f ? `<div class="fiscal">${qr ? `<img src="${qr}" alt="QR">` : ""}<div><b>e-NCF: ${esc(f.encf)}</b><br>
  ${f.fechaFirma ? `Fecha de firma digital: ${esc(new Date(f.fechaFirma).toLocaleString("es-DO"))}<br>` : ""}
  ${f.codigoSeguridad ? `Código de seguridad: ${esc(f.codigoSeguridad)}<br>` : ""}
  ${f.venceSecuencia ? `Fecha de vencimiento de la secuencia: ${esc(new Date(f.venceSecuencia).toLocaleDateString("es-DO"))}` : ""}</div></div>` : ""}
${!f && !doc.pie?.length ? "" : ""}
<script>onload=()=>setTimeout(()=>print(),300)</script></body></html>`;
  w.document.open();
  w.document.write(html);
  w.document.close();
}

export { rd };
