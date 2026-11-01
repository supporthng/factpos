/**
 * Plantillas de los correos. HTML sencillo con tablas y estilos en línea
 * (así se ve bien en Gmail, Outlook y el celular) y su versión en texto.
 */
export interface Marca { empresa: string; color: string; logo: string | null }

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
export const rd = (v: unknown) => `RD$${Number(v ?? 0).toLocaleString("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (v: unknown) => Number(v ?? 0).toLocaleString("es-DO");
const zona = { timeZone: "America/Santo_Domingo" } as const;
export const fechaHora = (v: string | Date | null) =>
  v ? new Date(v).toLocaleString("es-DO", { ...zona, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—";
export const fechaLarga = (aaaammdd: string) =>
  new Date(`${aaaammdd}T12:00:00-04:00`).toLocaleDateString("es-DO", { ...zona, weekday: "long", day: "numeric", month: "long", year: "numeric" });

/** El color de la marca puede ser muy claro: para textos y bordes se oscurece si hace falta. */
function colorLegible(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#0f766e";
  let [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  if (lum > 0.55) { const f = 0.55 / lum; [r, g, b] = [r, g, b].map((x) => Math.round(x * f)); }
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

const COLOR = { texto: "#1f2933", suave: "#5b6b7c", borde: "#e3e8ee", fondo: "#f4f6f8", rojo: "#b42318", verde: "#067647", ambar: "#b54708" };

function base(m: Marca, titulo: string, subtitulo: string, cuerpo: string, pie: string, paraCliente = false) {
  const acento = colorLegible(m.color);
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(titulo)}</title></head>
<body style="margin:0;padding:0;background:${COLOR.fondo};font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${COLOR.texto}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLOR.fondo};padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border:1px solid ${COLOR.borde};border-radius:10px;overflow:hidden">
<tr><td style="height:6px;background:${esc(m.color)}"></td></tr>
<tr><td style="padding:22px 24px 6px">
  <div style="font-size:13px;color:${COLOR.suave}">${esc(m.empresa)}</div>
  <h1 style="margin:4px 0 2px;font-size:22px;line-height:1.25;color:${COLOR.texto}">${esc(titulo)}</h1>
  <div style="font-size:14px;color:${COLOR.suave}">${subtitulo}</div>
</td></tr>
<tr><td style="padding:12px 24px 22px">${cuerpo}</td></tr>
<tr><td style="padding:14px 24px;border-top:1px solid ${COLOR.borde};font-size:12px;color:${COLOR.suave};line-height:1.5">${pie}${paraCliente ? "" : `<br>Enviado por FactPOS · <span style="color:${acento}">Administración › Correo y envíos</span> para cambiar quién lo recibe.`}</td></tr>
</table></td></tr></table></body></html>`;
}

const tabla = (cabeza: string[], filas: (string | number)[][], derechaDesde = 1, pie?: (string | number)[]) => `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;margin:6px 0 18px">
${cabeza.every((c) => !c) ? "" : `<tr>${cabeza.map((c, i) => `<th align="${i >= derechaDesde ? "right" : "left"}" style="padding:7px 6px;border-bottom:2px solid ${COLOR.borde};font-size:12px;color:${COLOR.suave};font-weight:600">${esc(c)}</th>`).join("")}</tr>`}
${filas.map((f) => `<tr>${f.map((v, i) => `<td align="${i >= derechaDesde ? "right" : "left"}" style="padding:7px 6px;border-bottom:1px solid ${COLOR.borde};white-space:${i >= derechaDesde ? "nowrap" : "normal"}">${v}</td>`).join("")}</tr>`).join("")}
${pie ? `<tr>${pie.map((v, i) => `<td align="${i >= derechaDesde ? "right" : "left"}" style="padding:8px 6px;font-weight:700;white-space:nowrap">${v}</td>`).join("")}</tr>` : ""}
</table>`;

const seccion = (t: string) => `<h2 style="margin:8px 0 2px;font-size:15px;color:${COLOR.texto}">${esc(t)}</h2>`;

function difHtml(d: number) {
  if (Math.abs(d) < 0.005) return `<span style="color:${COLOR.verde};font-weight:700">Cuadró</span>`;
  return d < 0 ? `<span style="color:${COLOR.rojo};font-weight:700">Faltan ${rd(-d)}</span>` : `<span style="color:${COLOR.ambar};font-weight:700">Sobran ${rd(d)}</span>`;
}

// ------------------------------------------------------------------ CIERRE DE CAJA
/** Recibe lo mismo que imprime la caja en el reporte Z (reporteTurno). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function correoCierre(m: Marca, r: any) {
  const t = r.turno;
  const dif = Number(t.diferencia ?? 0);
  const declarado = t.declarado ?? {};
  const esperado = r.esperado ?? {};
  const FORMAS: [string, string][] = [["EFECTIVO", "Efectivo"], ["TARJETA", "Tarjeta"], ["TRANSFERENCIA", "Transferencia"]];
  const filasCuadre = FORMAS
    .filter(([f]) => Number(esperado[f] ?? 0) || Number(declarado[f] ?? 0))
    .map(([f, n]) => {
      const d = Number(declarado[f] ?? 0) - Number(esperado[f] ?? 0);
      return [n, rd(esperado[f]), rd(declarado[f]), difHtml(d)];
    });
  const resultado = Math.abs(dif) < 0.005
    ? { texto: "La caja cuadró", color: COLOR.verde }
    : dif < 0 ? { texto: `Faltante de ${rd(-dif)}`, color: COLOR.rojo } : { texto: `Sobrante de ${rd(dif)}`, color: COLOR.ambar };
  const mv = r.resumenMovimientos ?? {};
  const movimientos = [
    ["Retiros de efectivo", mv.retiros], ["Gastos pagados de la gaveta", mv.gastos], ["Sencillo (entró cambio)", mv.sencillo],
    ["Abonos de clientes", mv.abonos], ["Liquidación de delivery", mv.delivery],
  ].filter(([, v]) => Number(v ?? 0) > 0).map(([n, v]) => [n as string, rd(v)]);

  const cuerpo = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 18px;border:1px solid ${COLOR.borde};border-left:5px solid ${resultado.color};border-radius:8px">
<tr><td style="padding:14px 16px">
  <div style="font-size:22px;font-weight:700;color:${resultado.color}">${esc(resultado.texto)}</div>
  <div style="font-size:14px;color:${COLOR.suave};margin-top:4px">Vendido en el turno: <b style="color:${COLOR.texto}">${rd(r.ventas?.total)}</b> en ${num(r.ventas?.facturas)} factura(s)</div>
</td></tr></table>
${seccion("Cuadre")}
${tabla(["Forma de pago", "Esperado", "Contado", "Diferencia"], filasCuadre)}
${seccion("Ventas")}
${tabla(["", ""], [
    ["Facturas", num(r.ventas?.facturas)],
    ["De crédito fiscal (E31)", num(r.ventas?.creditoFiscal)],
    ["ITBIS", rd(r.ventas?.itbis)],
    ["Descuentos", rd(r.ventas?.descuentos)],
    ["Anulaciones (notas de crédito)", `${num(r.anulaciones?.cantidad)} · ${rd(r.anulaciones?.monto)}`],
    ...(r.ventas?.primeraFactura ? [["Facturas del turno", `${esc(r.ventas.primeraFactura)} a ${esc(r.ventas.ultimaFactura)}`]] : []),
  ])}
${movimientos.length ? seccion("Entradas y salidas de la gaveta") + tabla(["", ""], movimientos) : ""}
${seccion("Efectivo")}
${tabla(["", ""], [
    ["Fondo inicial", rd(r.efectivo?.fondo)], ["Ventas en efectivo", rd(r.efectivo?.ventas)],
    ["Entradas", rd(r.efectivo?.entradas)], ["Salidas", rd(r.efectivo?.salidas)],
  ], 1, ["Debía haber", rd(esperado.EFECTIVO)])}
${t.notas ? `<p style="font-size:14px;margin:0 0 6px"><b>Nota del cajero:</b> ${esc(t.notas)}</p>` : ""}`;

  const asunto = `Cierre de ${t.caja} · ${t.sucursal} · ${Math.abs(dif) < 0.005 ? "cuadró" : dif < 0 ? `faltan ${rd(-dif)}` : `sobran ${rd(dif)}`}`;
  const sub = `${esc(t.sucursal)} · ${esc(t.caja)} · ${esc(t.cajero)}<br>Turno del ${esc(fechaHora(t.abiertoEn))} al ${esc(fechaHora(t.cerradoEn))}`;
  const texto = [
    `Cierre de ${t.caja} — ${t.sucursal}`, `Cajero: ${t.cajero}`, `Turno: ${fechaHora(t.abiertoEn)} a ${fechaHora(t.cerradoEn)}`,
    `Resultado: ${resultado.texto}`, `Vendido: ${rd(r.ventas?.total)} en ${num(r.ventas?.facturas)} facturas`,
    ...FORMAS.map(([f, n]) => `${n}: esperado ${rd(esperado[f])}, contado ${rd(declarado[f])}`),
    t.notas ? `Nota: ${t.notas}` : "",
  ].filter(Boolean).join("\n");
  return { asunto, html: base(m, `Cierre de caja: ${t.caja}`, sub, cuerpo, `Cerrado por ${esc(t.cerradoPor ?? t.cajero)}.`), texto };
}

// ------------------------------------------------------------------ RESUMEN DIARIO
export interface DatosResumen {
  fecha: string;
  sucursales: { sucursal: string; transacciones: number; venta_total: string; itbis: string; ticket_promedio: string; efectivo: string; tarjeta: string; transferencia: string; credito: string }[];
  semanaPasada: string;            // venta total del mismo día de la semana anterior
  cierres: { sucursal: string; caja: string; cajero: string; diferencia: string }[];
  anulaciones: { cantidad: number; monto: string };
  ecf: { rechazados: number; pendientes: number };
  incidentes: { titulo: string; desde: string; hasta: string | null }[];
  bajoMinimo: number;
}

export function correoResumen(m: Marca, d: DatosResumen) {
  const total = d.sucursales.reduce((a, s) => a + Number(s.venta_total), 0);
  const trans = d.sucursales.reduce((a, s) => a + Number(s.transacciones), 0);
  const suma = (k: "efectivo" | "tarjeta" | "transferencia" | "credito") => d.sucursales.reduce((a, s) => a + Number(s[k]), 0);
  const antes = Number(d.semanaPasada);
  const cambio = antes > 0 ? ((total - antes) / antes) * 100 : null;
  const conDif = d.cierres.filter((c) => Math.abs(Number(c.diferencia)) >= 0.005);
  const faltante = conDif.filter((c) => Number(c.diferencia) < 0).reduce((a, c) => a + Number(c.diferencia), 0);

  const atencion = [
    conDif.length && `${conDif.length} cierre(s) de caja con diferencia${faltante ? ` (faltante total ${rd(-faltante)})` : ""}`,
    d.ecf.rechazados && `${d.ecf.rechazados} comprobante(s) electrónico(s) rechazado(s) por la DGII`,
    d.ecf.pendientes && `${d.ecf.pendientes} comprobante(s) todavía sin enviar a la DGII`,
    d.incidentes.length && `${d.incidentes.length} incidente(s) de servidores o cajas`,
    d.bajoMinimo && `${d.bajoMinimo} producto(s) por debajo del mínimo`,
  ].filter(Boolean) as string[];

  const cuerpo = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 16px"><tr>
<td style="padding:0 0 4px"><div style="font-size:30px;font-weight:700;letter-spacing:-.5px">${rd(total)}</div>
<div style="font-size:14px;color:${COLOR.suave}">${num(trans)} ventas · ticket promedio ${rd(trans ? total / trans : 0)}${cambio !== null ? ` · <span style="color:${cambio >= 0 ? COLOR.verde : COLOR.rojo}">${cambio >= 0 ? "▲" : "▼"} ${Math.abs(cambio).toFixed(1)}%</span> contra el mismo día de la semana pasada` : ""}</div></td>
</tr></table>
${atencion.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;background:#fff8ec;border:1px solid #f5d9a8;border-radius:8px"><tr><td style="padding:12px 14px;font-size:14px;line-height:1.6"><b>Para revisar</b><br>${atencion.map((a) => `• ${esc(a)}`).join("<br>")}</td></tr></table>`
    : `<p style="font-size:14px;color:${COLOR.verde};margin:0 0 16px"><b>Todo en orden:</b> cierres cuadrados, comprobantes al día y sin incidentes.</p>`}
${!d.sucursales.length ? `<p style="font-size:14px;color:${COLOR.suave};margin:0 0 12px">No hubo ventas este día en las sucursales incluidas.</p>` : `${seccion("Por sucursal")}
${tabla(["Sucursal", "Ventas", "Total", "Ticket prom."],
    d.sucursales.map((s) => [esc(s.sucursal), num(s.transacciones), rd(s.venta_total), rd(s.ticket_promedio)]),
    1, d.sucursales.length > 1 ? ["Total", num(trans), rd(total), rd(trans ? total / trans : 0)] : undefined)}
${seccion("Formas de pago")}
${tabla(["", ""], [["Efectivo", rd(suma("efectivo"))], ["Tarjeta", rd(suma("tarjeta"))], ["Transferencia", rd(suma("transferencia"))], ["Crédito (fiado)", rd(suma("credito"))]]
    .filter(([, v], i) => i < 2 || v !== rd(0)))}`}
${d.cierres.length ? seccion("Cierres de caja") + tabla(["Sucursal · Caja", "Cajero", "Resultado"], d.cierres.map((c) => [`${esc(c.sucursal)} · ${esc(c.caja)}`, esc(c.cajero), difHtml(Number(c.diferencia))]), 2) : ""}
${Number(d.anulaciones.cantidad) ? `<p style="font-size:14px;margin:0 0 8px">Anulaciones: ${num(d.anulaciones.cantidad)} por ${rd(d.anulaciones.monto)}.</p>` : ""}
${d.incidentes.length ? seccion("Incidentes") + `<p style="font-size:14px;line-height:1.6;margin:0 0 8px">${d.incidentes.map((i) => `• ${esc(i.titulo)} (${esc(fechaHora(i.desde))}${i.hasta ? ` – ${esc(fechaHora(i.hasta))}` : ", sigue abierto"})`).join("<br>")}</p>` : ""}`;

  const dia = fechaLarga(d.fecha);
  const asunto = `Resumen del ${dia}: ${rd(total)} en ventas${conDif.length ? ` · ${conDif.length} cierre(s) con diferencia` : ""}`;
  const texto = [
    `Resumen del ${dia}`, `Ventas: ${rd(total)} (${num(trans)} ventas)`,
    ...d.sucursales.map((s) => `  ${s.sucursal}: ${rd(s.venta_total)} (${num(s.transacciones)})`),
    ...(atencion.length ? ["Para revisar:", ...atencion.map((a) => `  - ${a}`)] : ["Todo en orden."]),
  ].join("\n");
  return { asunto, html: base(m, "Resumen del día", esc(dia.charAt(0).toUpperCase() + dia.slice(1)), cuerpo, "Incluye todas las sucursales elegidas en la configuración del envío."), texto };
}

// ------------------------------------------------------------------ PRUEBA
export function correoPrueba(m: Marca, usuario: string) {
  const cuerpo = `<p style="font-size:15px;line-height:1.6;margin:0">Si está leyendo esto, la conexión de correo de FactPOS funciona. Los cierres de caja y los resúmenes diarios saldrán desde esta misma cuenta.</p>`;
  return {
    asunto: "Correo de prueba de FactPOS",
    html: base(m, "La conexión de correo funciona", `Prueba enviada por ${esc(usuario)}`, cuerpo, ""),
    texto: `La conexión de correo de FactPOS funciona. Prueba enviada por ${usuario}.`,
  };
}

/** Aviso de incidente al servicio técnico (mismo texto de Telegram, en HTML sencillo). */
export function correoIncidente(m: Marca, texto: string) {
  const [primera, ...resto] = texto.split("\n");
  return {
    asunto: primera.replace(/^[^\p{L}\p{N}]+/u, "").slice(0, 150),
    html: base(m, primera.replace(/^[^\p{L}\p{N}]+/u, ""), "Aviso para el servicio técnico", `<p style="font-size:15px;line-height:1.7;margin:0">${resto.map(esc).join("<br>")}</p>`, ""),
    texto,
  };
}


// ------------------------------------------------------------------ COTIZACIÓN (para el cliente)
interface CotizacionCorreo {
  numero: number; clienteNombre: string; fecha: string; vence: string; notas: string | null; condiciones: string | null;
  subtotal: number; descuento: number; itbis: number; total: number;
  lineas: { descripcion: string; cantidad: number; precio: number; incluyeItbis: boolean; tasaItbis: number; total: number }[];
}
const fechaCorta = (aaaammdd: string) => new Date(`${aaaammdd}T12:00:00-04:00`).toLocaleDateString("es-DO", { ...zona, day: "numeric", month: "long", year: "numeric" });

export function correoCotizacion(m: Marca, c: CotizacionCorreo, mensaje?: string) {
  const numero = `COT-${String(c.numero).padStart(4, "0")}`;
  const filas = c.lineas.map((l) => [esc(l.descripcion), num(l.cantidad), rd(l.incluyeItbis ? l.precio / (1 + l.tasaItbis) : l.precio), rd(l.total)]);
  const cuerpo = `
${mensaje ? `<p style="font-size:15px;line-height:1.6;margin:0 0 14px">${esc(mensaje).replace(/\n/g, "<br>")}</p>` : `<p style="font-size:15px;line-height:1.6;margin:0 0 14px">Estimado(a) ${esc(c.clienteNombre)}, le enviamos nuestra cotización.</p>`}
${tabla(["Descripción", "Cant.", "Precio (sin ITBIS)", "Total"], filas, 1)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;margin:0 0 14px">
  <tr><td align="right" style="padding:3px 6px;color:${COLOR.suave}">Subtotal</td><td align="right" style="padding:3px 6px;width:130px">${rd(c.subtotal)}</td></tr>
  ${c.descuento > 0 ? `<tr><td align="right" style="padding:3px 6px;color:${COLOR.suave}">Descuento incluido</td><td align="right" style="padding:3px 6px">${rd(c.descuento)}</td></tr>` : ""}
  <tr><td align="right" style="padding:3px 6px;color:${COLOR.suave}">ITBIS</td><td align="right" style="padding:3px 6px">${rd(c.itbis)}</td></tr>
  <tr><td align="right" style="padding:6px;font-weight:700;font-size:16px">Total</td><td align="right" style="padding:6px;font-weight:700;font-size:16px">${rd(c.total)}</td></tr>
</table>
<p style="font-size:14px;margin:0 0 6px"><b>Válida hasta:</b> ${esc(fechaCorta(c.vence))}</p>
${c.notas ? `<p style="font-size:14px;line-height:1.5;margin:0 0 6px"><b>Notas:</b> ${esc(c.notas)}</p>` : ""}
${c.condiciones ? `<p style="font-size:13px;line-height:1.5;margin:0;color:${COLOR.suave}">${esc(c.condiciones).replace(/\n/g, "<br>")}</p>` : ""}`;
  const texto = [
    `${m.empresa} · Cotización ${numero}`, `Para: ${c.clienteNombre}`, `Fecha: ${fechaCorta(c.fecha)} · Válida hasta: ${fechaCorta(c.vence)}`, "",
    ...c.lineas.map((l) => `- ${l.descripcion}: ${num(l.cantidad)} x ${rd(l.precio)} = ${rd(l.total)}`), "",
    `Subtotal ${rd(c.subtotal)} · ITBIS ${rd(c.itbis)} · TOTAL ${rd(c.total)}`, c.notas ?? "", c.condiciones ?? "",
  ].filter((x) => x !== undefined).join("\n");
  return {
    asunto: `Cotización ${numero} de ${m.empresa}`,
    html: base(m, `Cotización ${numero}`, `Fecha ${esc(fechaCorta(c.fecha))}`, cuerpo, `Si tiene alguna pregunta, responda a este correo.`, true),
    texto,
  };
}
