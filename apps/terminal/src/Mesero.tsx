import { useEffect, useState } from "react";
import type { Catalogo } from "@factpos/compartido";
import { api, type Ajustes } from "./api";
import type { ConfigCaja, Usuario } from "./App";
import { Cuentas } from "./Cuentas";

/**
 * Pantalla del mesero: entra con su PIN y va directo al salón. Toma pedidos de sus mesas (y de las libres), envía a la cocina
 * y pide la pre-cuenta. No abre turno ni cobra: el cobro es del cajero. Al cerrar el salón se sale (la pantalla puede ser compartida).
 */
export function PantallaMesero({ ajustes, config, usuario, onSalir }: { ajustes: Ajustes; config: ConfigCaja; usuario: Usuario; onSalir: () => void }) {
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Catalogo>(ajustes.servidor, `/cajas/${ajustes.cajaId}/catalogo`).then(setCatalogo).catch((e) => setError((e as Error).message));
  }, [ajustes.servidor, ajustes.cajaId]);
  if (error) return <div style={{ padding: 24 }}><div className="tarjeta-centro"><p className="error">{error}</p><button className="boton ancho" onClick={onSalir}>Salir</button></div></div>;
  if (!catalogo) return <div style={{ padding: 24 }}><div className="tarjeta-centro"><p className="suave">Cargando el menú…</p></div></div>;
  return (
    <Cuentas ajustes={ajustes} config={config} catalogo={catalogo} nivel={catalogo.nivelPredeterminado}
      usuarioNombre={usuario.nombre} soloMesero onCobrar={() => undefined} onCerrar={onSalir} />
  );
}
