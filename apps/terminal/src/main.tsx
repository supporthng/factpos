import "./migracion-nombre";
import { Component, StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { PantallaCliente } from "./PantallaCliente";
import "@fontsource-variable/archivo/wdth.css";
import "./estilos.css";
import { aplicarTema, iniciarEscala } from "./escala";


aplicarTema();
iniciarEscala();

// La pantalla de la caja queda guardada para abrir aunque se caiga el servidor.
// (En la red local el instalador de la caja habilita esto con el perfil propio del navegador.)
if ("serviceWorker" in navigator && window.isSecureContext) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
    // Cada vez que abre con servidor, refresca la copia guardada (por si se actualizó FactPOS)
    navigator.serviceWorker.ready.then((r) => r.active?.postMessage("guardar")).catch(() => {});
  });
}

/** La pantalla del cliente nunca debe quedar vacía: si algo falla al dibujarla, muestra la bienvenida y se reintenta sola. */
class RespaldoCliente extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: unknown) { return { error: String((e as Error)?.message ?? e) }; }
  componentDidCatch() { window.setTimeout(() => location.reload(), 5000); }
  render() {
    if (!this.state.error) return this.props.children;
    return <div className="pc pc-centro"><h1>Bienvenido</h1><p className="pc-sub" style={{ fontSize: 12 }}>{this.state.error}</p></div>;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {location.hash.startsWith("#/cliente") ? <RespaldoCliente><PantallaCliente /></RespaldoCliente> : <App />}
  </StrictMode>,
);
