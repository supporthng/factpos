import { useEffect, useState } from "react";
import { api } from "../api";
import { Aviso, Encabezado, Tabla } from "../ui";

/**
 * Equipos FactPOS de la red de la tienda (verificadores, cajas y administración de escritorio).
 * El servidor pregunta por la red local, cada equipo contesta quién es y a qué servidor apunta; si apunta a otro,
 * «Apuntar a este servidor» le ordena usar el de la tienda (el equipo lo comprueba antes de aceptar).
 */
interface Equipo { ip: string; tipo: "verificador" | "caja" | "admin"; id: string; nombre: string; version: string; plataforma: string; servidor: string; apuntaAqui: boolean }
interface Respuesta { servidor: string; equipos: Equipo[] }
const NOMBRE = { verificador: "Verificador de precios", caja: "Caja", admin: "Administración (escritorio)" } as const;

export function EquiposRed() {
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [enviando, setEnviando] = useState<string | null>(null);

  const buscar = async () => {
    setBuscando(true); setError("");
    try { setDatos(await api<Respuesta>("/central/equipos-red")); }
    catch (e) { setError((e as Error).message); }
    finally { setBuscando(false); }
  };
  useEffect(() => { buscar(); }, []);

  const apuntar = async (e: Equipo) => {
    setError(""); setOk(""); setEnviando(e.ip + e.tipo);
    try {
      await api("/central/equipos-red/apuntar", { metodo: "POST", cuerpo: { ip: e.ip, tipo: e.tipo } });
      setOk(`${e.nombre} ahora apunta a ${datos?.servidor}. Puede tardar unos segundos en reabrirse.`);
      setTimeout(buscar, 4000);
    } catch (x) { setError((x as Error).message); }
    finally { setEnviando(null); }
  };

  const lista = datos?.equipos ?? [];
  const mal = lista.filter((e) => !e.apuntaAqui).length;
  return (
    <>
      <Encabezado titulo="Equipos en la red" descripcion="Verificadores, cajas y administración de escritorio con FactPOS en esta red, a qué servidor apunta cada uno y un botón para corregirlo.">
        <button className="boton primario" disabled={buscando} onClick={buscar}>{buscando ? "Buscando…" : "Buscar de nuevo"}</button>
      </Encabezado>
      {error && <Aviso tipo="error" texto={error} />}
      {ok && <Aviso tipo="ok" texto={ok} />}
      {datos && !datos.servidor && <Aviso tipo="info" texto="Este servidor no tiene una dirección de red local; no se puede ordenar a los equipos que lo usen." />}
      {datos && <p className="suave">Servidor de esta tienda: <b className="mono">{datos.servidor || "—"}</b>{lista.length > 0 && (mal ? ` · ${mal} equipo(s) apuntan a otro servidor` : " · todos apuntan aquí")}</p>}
      <div className="panel">
        <Tabla
          filas={lista}
          clave={(e) => e.ip + e.tipo}
          vacio={buscando ? "Buscando equipos…" : "No se encontró ningún equipo. Solo aparecen los que tienen la versión más reciente instalada y están en la misma red que este servidor."}
          columnas={[
            { titulo: "Equipo", valor: (e) => <><b>{e.nombre}</b><div className="suave pequeno">{NOMBRE[e.tipo]} · {e.plataforma}</div></> },
            { titulo: "Dirección", valor: (e) => <span className="mono">{e.ip}</span> },
            { titulo: "Versión", valor: (e) => e.version || "—", ocultoMovil: true },
            { titulo: "Apunta a", valor: (e) => <span className="mono">{e.servidor || "(sin configurar)"}</span> },
            { titulo: "Estado", valor: (e) => e.apuntaAqui ? <span style={{ color: "var(--ok, #16a34a)" }}>✓ Este servidor</span> : <span style={{ color: "var(--error, #dc2626)" }}>Otro servidor</span> },
            { titulo: "", valor: (e) => e.apuntaAqui || !datos?.servidor ? null : <button className="boton" disabled={enviando !== null} onClick={() => apuntar(e)}>{enviando === e.ip + e.tipo ? "Enviando…" : "Apuntar a este servidor"}</button> },
          ]}
        />
      </div>
      <p className="suave pequeno">Cada equipo comprueba que en esa dirección responda un servidor FactPOS antes de aceptar el cambio, y solo obedece órdenes que vienen de su misma red local. Una Administración que usa la nube de la empresa no se cambia.</p>
    </>
  );
}
