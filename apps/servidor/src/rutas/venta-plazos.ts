import type { PoolClient } from "pg";
import { z } from "zod";
import { Decimal } from "decimal.js";
import { cedulaValida, uuidv7 } from "@factpos/compartido";
import { ErrorNegocio } from "../db.js";
import { armarCuotas, type Frecuencia } from "./credito-plan.js";
import { encolarFilas } from "../sync/outbox.js";
import { devengarComision } from "./comision.js";

/**
 * Venta a plazos (mueblería): el vendedor elige un plan del catálogo, fija la inicial y registra la cédula del cliente y del garante.
 * La caja cobra solo la inicial; el resto queda a crédito con su plan de cuotas.
 *  - El interés sale del plan (solo el administrador lo cambia): el vendedor no escribe porcentajes.
 *  - Si el cliente no cumple (sin cédula, sin garante, pasa el límite o tiene atrasos) decide un supervisor con el permiso
 *    «Vender a crédito»: queda su nombre y el motivo en la venta y en el plan.
 */
type Db = Pick<PoolClient, "query">;
const monto = z.string().regex(/^\d+(\.\d{1,2})?$/, "Monto inválido");
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const FinanciamientoSchema = z.object({
  planId: z.string().uuid(),
  inicial: monto,
  primeraCuota: fecha.optional(),
  garante: z.object({
    nombre: z.string().trim().max(120).default(""),
    documento: z.string().trim().max(20).default(""),
    telefono: z.string().trim().max(30).optional(),
  }).optional(),
  motivoExcepcion: z.string().trim().max(200).optional(),
});
export type Financiamiento = z.infer<typeof FinanciamientoSchema>;

const hoyRD = () => new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10);
const soloDigitos = (s: string) => s.replace(/\D/g, "");

export interface EvaluacionCredito {
  plan: { id: string; nombre: string; cuotas: number; frecuencia: Frecuencia; interesPct: string };
  total: string; inicial: string; financiado: string; interes: string; totalAPagar: string; cuotaMonto: string;
  /** Requisitos que el cliente no cumple: solo un supervisor los puede pasar por alto */
  excepciones: string[];
}

/** Valida el plan y los requisitos del crédito. Los errores de plan (monto, inicial) son definitivos; los del cliente son «excepciones». */
export async function evaluarFinanciamiento(c: Db, p: { empresaId: string; clienteId: string | undefined; total: Decimal.Value; f: Financiamiento }): Promise<EvaluacionCredito> {
  if (!p.clienteId) throw new ErrorNegocio("La venta a plazos requiere un cliente");
  const total = new Decimal(p.total);
  const inicial = new Decimal(p.f.inicial);
  const plan = (await c.query<{ id: string; nombre: string; cuotas: number; frecuencia: Frecuencia; interes_pct: string; inicial_min_pct: string; monto_minimo: string }>(
    `SELECT id, nombre, cuotas, frecuencia, interes_pct::text, inicial_min_pct::text, monto_minimo::text
       FROM cxc_planes_catalogo WHERE id = $1 AND empresa_id = $2 AND activo`, [p.f.planId, p.empresaId])).rows[0];
  if (!plan) throw new ErrorNegocio("Ese plan de financiamiento no existe o está inactivo", 404);
  if (inicial.lte(0)) throw new ErrorNegocio("Indique la inicial que paga el cliente (mayor que cero)");
  if (inicial.gte(total)) throw new ErrorNegocio("La inicial debe ser menor que el total: no queda nada que financiar");
  const minimaInicial = total.mul(plan.inicial_min_pct).div(100).toDecimalPlaces(2, Decimal.ROUND_UP);
  if (inicial.lt(minimaInicial)) throw new ErrorNegocio(`El plan «${plan.nombre}» pide una inicial de al menos ${plan.inicial_min_pct} % (RD$ ${minimaInicial.toFixed(2)})`);
  const financiado = total.minus(inicial);
  if (financiado.lt(plan.monto_minimo)) throw new ErrorNegocio(`El plan «${plan.nombre}» financia desde RD$ ${new Decimal(plan.monto_minimo).toFixed(2)}`);

  const cl = (await c.query<{ nombre: string; tipo_documento: string; documento: string | null; limite: string; saldo: string; vencido: string }>(
    `SELECT c.nombre, c.tipo_documento, c.documento, c.limite_credito::text AS limite,
            COALESCE((SELECT SUM(m.monto) FROM cxc_movimientos m WHERE m.cliente_id = c.id), 0)::text AS saldo,
            COALESCE((SELECT a.vencido_30 + a.vencido_60 + a.vencido_mas FROM rpt_cxc_antiguedad a WHERE a.cliente_id = c.id), 0)::text AS vencido
       FROM clientes c WHERE c.id = $1 AND c.empresa_id = $2`, [p.clienteId, p.empresaId])).rows[0];
  if (!cl) throw new ErrorNegocio("Cliente no encontrado", 404);
  if ((await c.query("SELECT 1 FROM cxc_planes WHERE cliente_id = $1 AND estado = 'ACTIVO'", [p.clienteId])).rowCount) {
    throw new ErrorNegocio(`${cl.nombre} ya tiene un plan de cuotas activo: debe terminarlo o cancelarlo antes de financiar otra compra`);
  }

  const excepciones: string[] = [];
  if (!(cl.tipo_documento === "CEDULA" && cl.documento && cedulaValida(cl.documento))) excepciones.push("Falta la cédula del cliente (o no es válida)");
  const g = p.f.garante;
  if (!g || g.nombre.length < 3) excepciones.push("Falta el nombre del garante");
  if (!g || !cedulaValida(soloDigitos(g.documento))) excepciones.push("Falta la cédula del garante (o no es válida)");
  else if (cl.documento && soloDigitos(cl.documento) === soloDigitos(g.documento)) excepciones.push("El garante no puede ser el mismo cliente");
  if (new Decimal(cl.vencido).gt(0)) excepciones.push(`El cliente tiene RD$ ${new Decimal(cl.vencido).toFixed(2)} vencido`);
  const limite = new Decimal(cl.limite);
  if (limite.gt(0) && new Decimal(cl.saldo).plus(financiado).gt(limite)) {
    excepciones.push(`Pasa el límite de crédito (RD$ ${limite.toFixed(2)}; debe RD$ ${new Decimal(cl.saldo).toFixed(2)})`);
  }

  const cal = armarCuotas({ capital: financiado, interesPct: plan.interes_pct, cuotas: plan.cuotas, frecuencia: plan.frecuencia, desde: hoyRD(), primera: p.f.primeraCuota });
  return {
    plan: { id: plan.id, nombre: plan.nombre, cuotas: plan.cuotas, frecuencia: plan.frecuencia, interesPct: plan.interes_pct },
    total: total.toFixed(2), inicial: inicial.toFixed(2), financiado: financiado.toFixed(2), interes: cal.interes, totalAPagar: cal.total, cuotaMonto: cal.cuotas[0].monto,
    excepciones,
  };
}

interface DatosPlan {
  empresaId: string; sucursalId: string; clienteId: string; ventaId: string; usuarioId: string;
  planId: string; financiado: string; inicial: string; primeraCuota?: string | null;
  garante: { nombre: string; documento: string; telefono?: string | null } | null;
  excepciones: string[]; excepcionMotivo: string | null; excepcionPor: string | null; notas: string;
}

/** Crea el plan de cuotas de la venta ya registrada (el saldo a crédito ya está cargado al cliente). Devuelve el calendario. */
export async function crearPlanDeVenta(c: Db, d: DatosPlan) {
  const plan = (await c.query<{ nombre: string; cuotas: number; frecuencia: Frecuencia; interes_pct: string }>(
    "SELECT nombre, cuotas, frecuencia, interes_pct::text FROM cxc_planes_catalogo WHERE id = $1 AND empresa_id = $2", [d.planId, d.empresaId])).rows[0];
  if (!plan) throw new ErrorNegocio("El plan de financiamiento ya no existe", 404);
  const cfg = (await c.query<{ mora_pct: string; dias_gracia: number }>("SELECT mora_pct::text, dias_gracia FROM credito_config WHERE empresa_id = $1", [d.empresaId])).rows[0];
  let primera = d.primeraCuota ?? undefined;
  if (primera && primera < hoyRD()) primera = undefined; // la venta quedó pendiente varios días: se cuenta desde hoy
  const cal = armarCuotas({ capital: d.financiado, interesPct: plan.interes_pct, cuotas: plan.cuotas, frecuencia: plan.frecuencia, desde: hoyRD(), primera });
  const id = uuidv7();
  await c.query(
    `INSERT INTO cxc_planes (id, empresa_id, cliente_id, venta_id, nombre, capital, interes_pct, interes, total, cuotas, frecuencia, mora_pct, dias_gracia, notas, usuario_id,
                             inicial, garante_nombre, garante_documento, garante_telefono, excepciones, excepcion_motivo, excepcion_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
    [id, d.empresaId, d.clienteId, d.ventaId, plan.nombre, cal.capital, plan.interes_pct, cal.interes, cal.total, plan.cuotas, plan.frecuencia, cfg?.mora_pct ?? "0.00", cfg?.dias_gracia ?? 0,
     d.notas, d.usuarioId, d.inicial, d.garante?.nombre ?? null, d.garante?.documento ?? null, d.garante?.telefono ?? null, d.excepciones, d.excepcionMotivo, d.excepcionPor]);
  for (const q of cal.cuotas) await c.query("INSERT INTO cxc_cuotas (id, plan_id, numero, vence, monto) VALUES ($1,$2,$3,$4,$5)", [uuidv7(), id, q.numero, q.vence, q.monto]);
  if (new Decimal(cal.interes).gt(0)) {
    const mov = uuidv7();
    await c.query(
      `INSERT INTO cxc_movimientos (id, sucursal_id, cliente_id, tipo, monto, usuario_id, notas, autorizado_por)
       VALUES ($1,$2,$3,'AJUSTE',$4,$5,$6,$5)`,
      [mov, d.sucursalId, d.clienteId, cal.interes, d.usuarioId, `Interés del plan «${plan.nombre}» (${plan.interes_pct}% sobre ${cal.capital})`]);
    await encolarFilas(c as PoolClient, "cxc_movimientos", [mov]);
  }
  return { planId: id, nombre: plan.nombre, frecuencia: plan.frecuencia, interesPct: plan.interes_pct, ...cal };
}

// ---------------------------------------------------------------------------------------- Recibos de ingreso
export interface DatosRecibo {
  sucursalId: string; tipo: "INICIAL" | "ABONO"; clienteId: string; ventaId?: string | null; monto: Decimal.Value; formaPago: string; referencia?: string | null;
  saldoAnterior: Decimal.Value; saldoNuevo: Decimal.Value; aplicaciones?: unknown[]; usuarioId: string; turnoId?: string | null;
}

/** Recibo numerado por sucursal (REC-<código>-000001). Bloquea la numeración mientras se asigna. */
export async function emitirRecibo(c: Db, d: DatosRecibo) {
  await c.query("SELECT pg_advisory_xact_lock(hashtext('recibo_ingreso:' || $1))", [d.sucursalId]);
  const id = uuidv7();
  const r = await c.query<{ numero: string }>(
    `INSERT INTO recibos_ingreso (id, sucursal_id, numero, tipo, cliente_id, venta_id, monto, forma_pago, referencia, saldo_anterior, saldo_nuevo, aplicaciones, usuario_id, turno_id)
     VALUES ($1,$2,(SELECT COALESCE(MAX(numero),0)+1 FROM recibos_ingreso WHERE sucursal_id = $2),$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13) RETURNING numero::text`,
    [id, d.sucursalId, d.tipo, d.clienteId, d.ventaId ?? null, new Decimal(d.monto).toFixed(2), d.formaPago, d.referencia ?? null,
     new Decimal(d.saldoAnterior).toFixed(2), new Decimal(d.saldoNuevo).toFixed(2), JSON.stringify(d.aplicaciones ?? []), d.usuarioId, d.turnoId ?? null]);
  // Comisión del vendedor sobre lo que se aplicó a cada factura suya
  for (const a of (d.aplicaciones ?? []) as { ventaId?: string | null; aplicado?: string | number }[]) {
    if (a.ventaId && a.aplicado) await devengarComision(c, { ventaId: a.ventaId, cobrado: a.aplicado, concepto: d.tipo });
  }
  const cod = (await c.query<{ codigo: string }>("SELECT codigo FROM sucursales WHERE id = $1", [d.sucursalId])).rows[0]?.codigo ?? "S";
  return { id, numero: r.rows[0].numero, codigo: `REC-${cod}-${r.rows[0].numero.padStart(6, "0")}` };
}
