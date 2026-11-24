import { tituloPorTipo } from "@factpos/compartido";

/**
 * Título de la ventana: lleva el tipo de negocio («FactPOS Farmacia») en vez de «Administración». El tipo se recuerda en este equipo
 * para que la ventana ya lo diga desde que abre, antes de entrar. Los avisos que anteponen un contador «(2) …» usan la base de aquí.
 */
const CLAVE = "factpos.tipoNegocio";
const leer = () => { try { return localStorage.getItem(CLAVE); } catch { return null; } };
let base = document.title.replace(/^\(\d+\) /, "");

export const tituloBase = () => base;

export function fijarTituloBase(t: string) {
  base = t;
  const contador = document.title.match(/^\(\d+\) /)?.[0] ?? "";
  document.title = contador + t;
}

/** Al conocer el tipo de negocio de la empresa: título de la ventana y recuerdo para la próxima vez. */
export function fijarTituloDeTipo(tipo: string) {
  try { localStorage.setItem(CLAVE, tipo); } catch { /* sin almacenamiento: no se recuerda */ }
  fijarTituloBase(tituloPorTipo(tipo));
}

const recordado = leer();
if (recordado) fijarTituloBase(tituloPorTipo(recordado));
