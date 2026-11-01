import { useEffect, useState } from "react";
import { uuidv7 } from "@factpos/compartido";
import { api, ErrorApi, alPerderConexion, sesionCaja, type Ajustes } from "./api";
import { borrar, guardar, leer } from "./almacen";
import type { VentaRegistrada } from "./Ticket";
import type { Catalogo, ProductoCatalogo } from "@factpos/compartido";

/**
 * Contingencia: la caja sigue vendiendo si se cae el servidor de la sucursal.
 *
 *  - Vigila el servidor (cada 15 s; cada 5 s mientras está caído).
 *  - Sin servidor: cada venta (consumo E32, al contado) usa un e-NCF apartado,
 *    se imprime como "pendiente de firma" y queda guardada en la caja (IndexedDB).
 *  - Al volver: manda las ventas en orden, informa el corte (incidente para el
 *    servicio técnico) y repone los e-NCF apartados.
 */
export interface VentaPendiente {
  ventaId: string; usuarioOriginal: string; turnoId: string; creadoEn: string; encf: string; rangoId: string;
  items: { presentacionId: string; cantidad: string; precioVariable?: string }[];
  pagos: { formaPago: string; monto: string; recibido?: string; referencia?: string }[];
  clienteId?: string;
  notas?: string;
  total: string;
  ticket: VentaRegistrada;
  error?: string;
}
export interface EstadoConexion {
  enLinea: boolean;
  desde: string | null;     // cuándo se perdió el servidor
  pendientes: number;
  enviando: boolean;
  errores: number;
  aviso: string | null;     // mensaje de "conexión restablecida…"
  reserva: number;          // e-NCF apartados que quedan
  cupoVersion: number;      // sube cuando otra caja le pasa existencia
  latenciaMs: number | null; // qué tan rápido responde el servidor (mediana de las últimas revisiones)
}

let estado: EstadoConexion = { enLinea: true, desde: null, pendientes: 0, enviando: false, errores: 0, aviso: null, reserva: 0, cupoVersion: 0, latenciaMs: null };
const oyentes = new Set<(e: EstadoConexion) => void>();
const cambiar = (p: Partial<EstadoConexion>) => { estado = { ...estado, ...p }; oyentes.forEach((f) => f(estado)); };
export const estadoConexion = () => estado;

export function useConexion() {
  const [e, setE] = useState(estado);
  useEffect(() => { oyentes.add(setE); return () => { oyentes.delete(setE); }; }, []);
  return e;
}

const k = (cajaId: string, que: string) => `${que}:${cajaId}`;
interface Corte { id: string; desde: string; ventas: number; monto: number }

// ------------------------------------------------------------------ Caché para arrancar sin servidor
export const guardarCache = (ajustes: Ajustes, que: "config" | "catalogo" | "turno" | "usuarios", valor: unknown) =>
  guardar(k(ajustes.cajaId, que), valor).catch(() => {});
export const leerCache = <T,>(ajustes: Ajustes, que: "config" | "catalogo" | "turno" | "usuarios") => leer<T>(k(ajustes.cajaId, que));

// ------------------------------------------------------------------ Cupos de existencia (sin servidor)
/**
 * Con servidor, la caja guarda su cupo de cada producto (su parte de la existencia entre las cajas abiertas).
 * Sin servidor solo vende hasta ese cupo: dos cajas nunca venden la misma última unidad.
 * Solo aplica si el administrador lo activó en Configuración › Seguridad.
 */
let cupos: Record<string, number> | null = null;   // null = función apagada
let usado: Record<string, number> = {};            // unidades base vendidas sin servidor desde el último reparto
let ultimoReparto = 0;
let red: { principal: string | null; clave: string | null } = { principal: null, clave: null };
let permitePrincipal = false; // el administrador activó «Caja principal» en Seguridad

/** Cuánto le queda a esta caja de ese producto sin servidor (null = sin control: con servidor o función apagada). */
export function disponibleCupo(productoId: string): number | null {
  if (!cupos || estado.enLinea) return null;
  return Math.max(0, (cupos[productoId] ?? 0) - (usado[productoId] ?? 0));
}
async function cargarCupos(ajustes: Ajustes) {
  const g = await leer<{ cupos: Record<string, number> | null; principal?: string | null; clave?: string | null; permite?: boolean }>(k(ajustes.cajaId, "cupos"));
  permitePrincipal = !!g?.permite;
  cupos = g?.cupos ?? null;
  red = { principal: g?.principal ?? null, clave: g?.clave ?? null };
  usado = (await leer<Record<string, number>>(k(ajustes.cajaId, "cupo-usado"))) ?? {};
}
export async function refrescarCupos(ajustes: Ajustes) {
  if (!sesionCaja()) return;
  ultimoReparto = Date.now();
  try {
    const r = await api<{ habilitado: boolean; cupos: Record<string, number>; principal?: string | null; claveRed?: string | null; permitePrincipal?: boolean }>(ajustes.servidor, `/cajas/${ajustes.cajaId}/contingencia/cupos`);
    cupos = r.habilitado ? r.cupos : null;
    permitePrincipal = !!r.permitePrincipal;
    red = { principal: r.principal ?? null, clave: r.claveRed ?? null };
    await guardar(k(ajustes.cajaId, "cupos"), { cupos, principal: red.principal, clave: red.clave, permite: permitePrincipal });
    if (r.habilitado && permitePrincipal) await anunciarPrincipal(ajustes);
    else if (await esDeEscritorio()) fetch("/principal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ activo: false }) }).catch(() => {}); // función apagada: esta caja deja de ser principal
    // El reparto nuevo ya descuenta lo que esta caja envió; lo pendiente de envío se sigue descontando
    if (!((await leer<VentaPendiente[]>(k(ajustes.cajaId, "pendientes")))?.length)) {
      usado = {};
      await guardar(k(ajustes.cajaId, "cupo-usado"), usado);
    }
  } catch { /* se intenta luego; mientras tanto vale el último reparto */ }
}
// ---- Respaldo en archivo (aplicación de escritorio)
let escritorio: boolean | null = null;
const hayEscritorio = async () => (escritorio ??= await esDeEscritorio());
/** Copia en un archivo del equipo las ventas guardadas y los e-NCF de reserva. Si falla, la base de la caja sigue siendo la principal. */
async function respaldar(ajustes: Ajustes) {
  if (!(await hayEscritorio())) return;
  try {
    const pendientes = (await leer<VentaPendiente[]>(k(ajustes.cajaId, "pendientes"))) ?? [];
    const reserva = (await leer<unknown[]>(k(ajustes.cajaId, "reserva"))) ?? [];
    await fetch("/respaldo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cajaId: ajustes.cajaId, pendientes, reserva }) });
  } catch { /* se respalda en la próxima venta */ }
}
/** Al abrir: si la base de la caja no tiene datos pero el archivo sí, se recuperan. */
async function recuperarRespaldo(ajustes: Ajustes) {
  if (!(await hayEscritorio())) return;
  try {
    if ((await leer(k(ajustes.cajaId, "pendientes"))) !== undefined) return;
    const b = await (await fetch(`/respaldo?caja=${ajustes.cajaId}`, { cache: "no-store" })).json();
    if (Array.isArray(b?.pendientes) && b.pendientes.length) {
      await guardar(k(ajustes.cajaId, "pendientes"), b.pendientes);
      if ((await leer(k(ajustes.cajaId, "reserva"))) === undefined && Array.isArray(b.reserva)) await guardar(k(ajustes.cajaId, "reserva"), b.reserva);
    }
  } catch { /* sin respaldo */ }
}

/** Descarga las ventas guardadas en esta caja como hoja de cálculo (CSV), por si hace falta cargarlas a mano. */
export async function exportarPendientes(ajustes: Ajustes) {
  const pend = (await leer<VentaPendiente[]>(k(ajustes.cajaId, "pendientes"))) ?? [];
  const celda = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const filas = [["Fecha", "e-NCF", "Total", "Pagos", "Productos", "Error"].map(celda).join(",")];
  for (const p of pend) {
    filas.push([
      p.creadoEn, p.encf, p.total,
      p.pagos.map((x) => `${x.formaPago} ${x.monto}`).join(" + "),
      p.ticket.lineas.map((l) => `${l.cantidad} x ${l.descripcion}`).join("; "),
      p.error ?? "",
    ].map(celda).join(","));
  }
  const url = URL.createObjectURL(new Blob(["\ufeff" + filas.join("\r\n")], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `ventas-guardadas-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ---- Caja principal: las cajas se pasan existencia por la red local cuando no hay servidor
const esDeEscritorio = () => fetch("/escritorio.json", { cache: "no-store" }).then((r) => r.ok).catch(() => false);
/** Estado de esta caja como principal (solo existe en la aplicación de escritorio). */
export async function estadoPrincipal(): Promise<{ activo: boolean; url: string | null } | null> {
  if (!permitePrincipal || !(await esDeEscritorio())) return null;
  try { return await (await fetch("/principal", { cache: "no-store" })).json(); } catch { return null; }
}
export async function fijarPrincipal(ajustes: Ajustes, activo: boolean) {
  try {
    await fetch("/principal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ activo, clave: red.clave }) });
  } catch { /* sin aplicación de escritorio */ }
  if (activo) await refrescarCupos(ajustes);
  else await api(ajustes.servidor, `/cajas/${ajustes.cajaId}/principal`, { cuerpo: { url: null } }).catch(() => {});
}
/** Si esta caja es la principal, le da la clave a su buzón y dice su dirección al servidor. */
async function anunciarPrincipal(ajustes: Ajustes) {
  if (!red.clave || !(await esDeEscritorio())) return;
  try {
    const e = await (await fetch("/principal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clave: red.clave }) })).json();
    if (e.activo && e.url) {
      await api(ajustes.servidor, `/cajas/${ajustes.cajaId}/principal`, { cuerpo: { url: e.url } });
      red.principal = e.url;
    }
  } catch { /* se intenta en el próximo reparto */ }
}
const llamar = (ruta: string, cuerpo?: unknown) =>
  fetch(red.principal + ruta, {
    method: cuerpo ? "POST" : "GET", signal: AbortSignal.timeout(2500),
    headers: { "x-clave-red": red.clave ?? "", ...(cuerpo ? { "content-type": "application/json" } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
const pedidos: Record<string, number> = {};
/** Sin servidor, pide a las demás cajas (por la principal) unidades de un producto. */
export async function pedirExistencia(ajustes: Ajustes, productoId: string, cantidad: number) {
  if (!cupos || estado.enLinea || !red.principal || !red.clave) return false;
  if (Date.now() - (pedidos[productoId] ?? 0) < 6000) return true; // ya se pidió hace poco
  pedidos[productoId] = Date.now();
  try {
    const r = await llamar("/pedir", { de: ajustes.cajaId, productoId, cantidad: Math.max(cantidad, 1) });
    return r.ok;
  } catch { return false; }
}
/** Revisa el buzón: da de su cupo cuando otra caja pide, y suma lo que le dan. */
async function atenderRed(ajustes: Ajustes) {
  if (!cupos || estado.enLinea || !red.principal || !red.clave) return;
  let msgs: { tipo: string; de: string; productoId: string; cantidad: number }[] = [];
  try {
    const r = await llamar(`/buzon?caja=${ajustes.cajaId}`);
    if (!r.ok) return;
    msgs = (await r.json()).msgs ?? [];
  } catch { return; }
  for (const m of msgs) {
    if (!cupos) return;
    if (m.tipo === "pedir") {
      const resto = Math.max(0, (cupos[m.productoId] ?? 0) - (usado[m.productoId] ?? 0));
      const da = Math.floor(Math.min(Number(m.cantidad), resto) * 1000) / 1000;
      if (da <= 0) continue;
      // Primero se descuenta y se guarda; si el envío falla se pierde el cupo, nunca se vende de más
      cupos[m.productoId] = (cupos[m.productoId] ?? 0) - da;
      await guardar(k(ajustes.cajaId, "cupos"), { cupos, principal: red.principal, clave: red.clave, permite: permitePrincipal });
      await llamar("/entregar", { para: m.de, de: ajustes.cajaId, productoId: m.productoId, cantidad: da }).catch(() => {});
    } else if (m.tipo === "entrega") {
      cupos[m.productoId] = (cupos[m.productoId] ?? 0) + Number(m.cantidad);
      await guardar(k(ajustes.cajaId, "cupos"), { cupos, principal: red.principal, clave: red.clave, permite: permitePrincipal });
      cambiar({ aviso: "Otra caja le pasó existencia. Ya puede seguir vendiendo.", cupoVersion: estado.cupoVersion + 1 });
      setTimeout(() => cambiar({ aviso: null }), 8000);
    }
  }
}

/** Falla si la venta pasa del cupo de algún producto estricto. Devuelve lo que gastaría cada producto. */
async function revisarCupos(ajustes: Ajustes, items: { presentacionId: string; cantidad: string }[]) {
  const gasto: Record<string, number> = {};
  if (!cupos) return gasto;
  const cat = await leer<Catalogo>(k(ajustes.cajaId, "catalogo"));
  const idx = new Map<string, ProductoCatalogo>((cat?.productos ?? []).map((p) => [p.presentacionId, p]));
  const nombres: Record<string, string> = {};
  const estricto: Record<string, boolean> = {};
  for (const it of items) {
    const p = idx.get(it.presentacionId);
    if (!p || !p.controlaStock || p.tipo === "COMBO") continue;
    gasto[p.productoId] = (gasto[p.productoId] ?? 0) + Number(it.cantidad) * Number(p.factor);
    nombres[p.productoId] = p.nombre;
    estricto[p.productoId] = p.permiteSinExistencia === false;
  }
  for (const [id, n] of Object.entries(gasto)) {
    const queda = Math.max(0, (cupos[id] ?? 0) - (usado[id] ?? 0));
    if (estricto[id] && n > queda + 1e-9) {
      throw new Error(`Sin servidor, a esta caja solo le quedan ${queda} de «${nombres[id]}» (su parte de la existencia). Las demás cajas tienen la suya.`);
    }
  }
  return gasto;
}

// ------------------------------------------------------------------ PIN sin servidor
/** Al entrar con servidor se guarda una huella del PIN: si luego se cae, la misma persona puede volver a entrar. */
export async function recordarPin(ajustes: Ajustes, usuario: { id: string; nombre: string }, pin: string) {
  const sal = uuidv7();
  const mapa = (await leer<Record<string, { nombre: string; sal: string; huella: string }>>(k(ajustes.cajaId, "pines"))) ?? {};
  mapa[usuario.id] = { nombre: usuario.nombre, sal, huella: huellaPin(sal, pin) };
  await guardar(k(ajustes.cajaId, "pines"), mapa).catch(() => {});
}
export async function usuariosSinServidor(ajustes: Ajustes) {
  const mapa = (await leer<Record<string, { nombre: string }>>(k(ajustes.cajaId, "pines"))) ?? {};
  return Object.entries(mapa).map(([id, u]) => ({ id, nombre: u.nombre, tienePin: true }));
}
export async function verificarPinSinServidor(ajustes: Ajustes, usuarioId: string, pin: string) {
  const mapa = (await leer<Record<string, { sal: string; huella: string }>>(k(ajustes.cajaId, "pines"))) ?? {};
  const u = mapa[usuarioId];
  return !!u && u.huella === huellaPin(u.sal, pin);
}
/** Huella lenta (10 mil vueltas de SHA-256) para que no se pueda adivinar el PIN copiando la caja. */
function huellaPin(sal: string, pin: string) {
  let h = sha256(`${sal}:${pin}`);
  for (let i = 0; i < 10000; i++) h = sha256(h + sal);
  return h;
}

// ------------------------------------------------------------------ Vigilancia del servidor
let vigilando: Ajustes | null = null;
let fallosSeguidos = 0;

export async function iniciarVigilancia(ajustes: Ajustes) {
  if (vigilando?.cajaId === ajustes.cajaId) return;
  vigilando = ajustes;
  const pend = (await leer<VentaPendiente[]>(k(ajustes.cajaId, "pendientes"))) ?? [];
  const corte = await leer<Corte>(k(ajustes.cajaId, "corte"));
  const reserva = (await leer<unknown[]>(k(ajustes.cajaId, "reserva")))?.length ?? 0;
  await cargarCupos(ajustes);
  await recuperarRespaldo(ajustes);
  cambiar({ pendientes: pend.length, reserva, errores: pend.filter((p) => p.error).length, ...(corte ? { enLinea: false, desde: corte.desde } : {}) });
  alPerderConexion(() => { void sinServidor(); });
  const vuelta = async () => {
    const ms = await responde(ajustes.servidor);
    if (ms !== null) {
      registrarLatencia(ms);
      fallosSeguidos = 0;
      if (!estado.enLinea || estado.pendientes > 0) await volvioServidor(ajustes);
      else if (estado.reserva < 10) await refrescarReserva(ajustes);
      if (estado.enLinea && Date.now() - ultimoReparto > 60_000) await refrescarCupos(ajustes);
    } else if (++fallosSeguidos >= 2 || !estado.enLinea) {
      await sinServidor();
    }
    setTimeout(vuelta, estado.enLinea ? 15000 : 5000);
  };
  setTimeout(vuelta, 1500);
  setInterval(() => { void atenderRed(ajustes); }, 3000);
}

/** Revisa si el servidor responde y cuánto tarda (en ms); null si no responde. */
async function responde(servidor: string): Promise<number | null> {
  const t = performance.now();
  try {
    const r = await fetch(`${servidor.replace(/\/$/, "")}/descubrir`, { signal: AbortSignal.timeout(3000), cache: "no-store" });
    return r.ok ? Math.max(1, Math.round(performance.now() - t)) : null;
  } catch { return null; }
}

/** Mediana de las últimas revisiones: un solo pico no cambia el indicador. */
const muestras: number[] = [];
function registrarLatencia(ms: number) {
  muestras.push(ms);
  if (muestras.length > 5) muestras.shift();
  const orden = [...muestras].sort((a, b) => a - b);
  cambiar({ latenciaMs: orden[Math.floor(orden.length / 2)]! });
}

async function sinServidor() {
  if (!vigilando) return;
  if (estado.enLinea) {
    const corte = (await leer<Corte>(k(vigilando.cajaId, "corte"))) ?? { id: uuidv7(), desde: new Date().toISOString(), ventas: 0, monto: 0 };
    await guardar(k(vigilando.cajaId, "corte"), corte).catch(() => {});
    cambiar({ enLinea: false, desde: corte.desde, aviso: null });
  }
}

async function volvioServidor(ajustes: Ajustes) {
  cambiar({ enLinea: true });
  const enviados = await enviarPendientes(ajustes);
  const corte = await leer<Corte>(k(ajustes.cajaId, "corte"));
  // Un corte de segundos sin ventas (un cable que se movió) no se reporta
  if (corte && estado.pendientes === 0 && corte.ventas === 0 && Date.now() - new Date(corte.desde).getTime() < 60_000) {
    await borrar(k(ajustes.cajaId, "corte"));
    cambiar({ desde: null });
    await refrescarReserva(ajustes);
    return;
  }
  if (corte && estado.pendientes === 0) {
    try {
      await api(ajustes.servidor, `/cajas/${ajustes.cajaId}/incidentes`, {
        cuerpo: { id: corte.id, desde: corte.desde, hasta: new Date().toISOString(), ventas: corte.ventas, monto: corte.monto.toFixed(2) },
      });
      await borrar(k(ajustes.cajaId, "corte"));
      cambiar({ desde: null });
    } catch { /* sin sesión todavía: se reintenta en la próxima vuelta */ }
  }
  if (corte || enviados) {
    cambiar({ aviso: enviados ? `Conexión con el servidor restablecida · se enviaron ${enviados} venta(s) guardadas en esta caja` : "Conexión con el servidor restablecida" });
    setTimeout(() => cambiar({ aviso: null }), 12000);
  }
  await refrescarReserva(ajustes);
  await refrescarCupos(ajustes);
}

// ------------------------------------------------------------------ e-NCF apartados
export async function refrescarReserva(ajustes: Ajustes) {
  if (!sesionCaja()) return;
  try {
    const r = await api<{ numeros: { encf: string; rangoId: string }[] }>(ajustes.servidor, `/cajas/${ajustes.cajaId}/contingencia/reserva`, { cuerpo: {} });
    // No se vuelven a ofrecer números que la caja ya usó y aún no ha enviado
    const pend = (await leer<VentaPendiente[]>(k(ajustes.cajaId, "pendientes"))) ?? [];
    const usados = new Set(pend.map((p) => p.encf));
    const lista = r.numeros.filter((n) => !usados.has(n.encf));
    await guardar(k(ajustes.cajaId, "reserva"), lista);
    cambiar({ reserva: lista.length });
    void respaldar(ajustes);
  } catch { /* se intenta luego */ }
}

// ------------------------------------------------------------------ Venta sin servidor
export async function venderSinServidor(ajustes: Ajustes, v: Omit<VentaPendiente, "encf" | "rangoId" | "ticket" | "creadoEn"> & { ticket: Omit<VentaRegistrada, "fiscal" | "fecha" | "numero"> }) {
  const gasto = await revisarCupos(ajustes, v.items);
  const reserva = (await leer<{ encf: string; rangoId: string }[]>(k(ajustes.cajaId, "reserva"))) ?? [];
  const num = reserva.shift();
  if (!num) throw new Error("Esta caja no tiene números e-NCF de reserva: no puede facturar sin servidor. Llame al servicio técnico.");
  const creadoEn = new Date().toISOString();
  const pend = (await leer<VentaPendiente[]>(k(ajustes.cajaId, "pendientes"))) ?? [];
  const ticket: VentaRegistrada = {
    ...v.ticket, numero: `P${String(pend.length + 1).padStart(3, "0")}`, fecha: creadoEn, contingencia: true,
    fiscal: { encf: num.encf, codigoSeguridad: "", fechaFirma: "", urlQr: "", modo: "RFCE", venceSecuencia: "" },
  };
  const venta: VentaPendiente = { ...v, encf: num.encf, rangoId: num.rangoId, creadoEn, ticket };
  // Primero se guarda la venta y el número usado; si no se puede guardar, no se vende
  await guardar(k(ajustes.cajaId, "pendientes"), [...pend, venta]);
  await guardar(k(ajustes.cajaId, "reserva"), reserva);
  const corte = (await leer<Corte>(k(ajustes.cajaId, "corte"))) ?? { id: uuidv7(), desde: creadoEn, ventas: 0, monto: 0 };
  await guardar(k(ajustes.cajaId, "corte"), { ...corte, ventas: corte.ventas + 1, monto: corte.monto + Number(v.total) });
  if (cupos) {
    for (const [id, u] of Object.entries(gasto)) usado[id] = (usado[id] ?? 0) + u;
    await guardar(k(ajustes.cajaId, "cupo-usado"), usado).catch(() => {});
  }
  void respaldar(ajustes);
  cambiar({ pendientes: pend.length + 1, reserva: reserva.length, enLinea: false, desde: estado.desde ?? corte.desde });
  return ticket;
}

let enviando = false;
/** Manda las ventas guardadas, una por una y en orden. Devuelve cuántas entraron. */
export async function enviarPendientes(ajustes: Ajustes) {
  if (enviando || !sesionCaja()) return 0;
  enviando = true;
  cambiar({ enviando: true });
  let enviados = 0;
  try {
    let pend = (await leer<VentaPendiente[]>(k(ajustes.cajaId, "pendientes"))) ?? [];
    for (const p of [...pend]) {
      try {
        await api(ajustes.servidor, `/cajas/${ajustes.cajaId}/ventas/contingencia`, {
          cuerpo: { ventaId: p.ventaId, usuarioId: p.usuarioOriginal, usuarioOriginal: p.usuarioOriginal, turnoId: p.turnoId, creadoEn: p.creadoEn,
                    encf: p.encf, items: p.items, pagos: p.pagos, clienteId: p.clienteId, notas: p.notas },
        });
        pend = pend.filter((x) => x.ventaId !== p.ventaId);
        enviados++;
      } catch (e) {
        if (e instanceof ErrorApi && (e.estado === 0 || e.estado === 401)) break; // sin servidor o sin sesión: luego
        pend = pend.map((x) => (x.ventaId === p.ventaId ? { ...x, error: (e as Error).message } : x));
      }
      await guardar(k(ajustes.cajaId, "pendientes"), pend);
    }
    cambiar({ pendientes: pend.length, errores: pend.filter((p) => p.error).length });
    if (enviados) void respaldar(ajustes);
  } finally {
    enviando = false;
    cambiar({ enviando: false });
  }
  return enviados;
}

export const ventasPendientes = (ajustes: Ajustes) => leer<VentaPendiente[]>(k(ajustes.cajaId, "pendientes")).then((x) => x ?? []);

// ------------------------------------------------------------------ SHA-256 (sin crypto.subtle: la caja abre por http en la red local)
function sha256(texto: string): string {
  const K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  const bytes = new TextEncoder().encode(texto);
  const largo = bytes.length * 8;
  const total = ((bytes.length + 9 + 63) >> 6) << 6;
  const m = new Uint8Array(total);
  m.set(bytes); m[bytes.length] = 0x80;
  const dv = new DataView(m.buffer);
  dv.setUint32(total - 4, largo >>> 0); dv.setUint32(total - 8, Math.floor(largo / 2 ** 32));
  let [a0, b0, c0, d0, e0, f0, g0, h0] = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w = new Uint32Array(64);
  const rot = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let i = 0; i < total; i += 64) {
    for (let t = 0; t < 16; t++) w[t] = dv.getUint32(i + t * 4);
    for (let t = 16; t < 64; t++) {
      const s0 = rot(w[t - 15], 7) ^ rot(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rot(w[t - 2], 17) ^ rot(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = [a0, b0, c0, d0, e0, f0, g0, h0];
    for (let t = 0; t < 64; t++) {
      const t1 = (h + (rot(e, 6) ^ rot(e, 11) ^ rot(e, 25)) + ((e & f) ^ (~e & g)) + K[t] + w[t]) >>> 0;
      const t2 = ((rot(a, 2) ^ rot(a, 13) ^ rot(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0; c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0;
    e0 = (e0 + e) >>> 0; f0 = (f0 + f) >>> 0; g0 = (g0 + g) >>> 0; h0 = (h0 + h) >>> 0;
  }
  return [a0, b0, c0, d0, e0, f0, g0, h0].map((x) => x.toString(16).padStart(8, "0")).join("");
}
export const _sha256 = sha256; // para pruebas
