import "./migracion-nombre";
import { StrictMode } from "react";
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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {location.hash.startsWith("#/cliente") ? <PantallaCliente /> : <App />}
  </StrictMode>,
);
