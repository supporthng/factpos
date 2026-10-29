import { useState } from "react";
import { api, rd, num, sesionActual } from "../api";
import { Aviso, Encabezado, SelectorSucursal, Tabla, useCatalogo, useDatos } from "../ui";

interface ItemConteo { productoId: string; sku: string; nombre: string; sistema: string; contada: string | null; diferencia: string | null; valorDiferencia: string | null }

/**
 * Conteo físico: al abrirlo se toma la foto de la existencia. Se cuenta "a ciegas"
 * (sin ver lo que dice el sistema) y al aplicar se ajusta solo la diferencia.
 */
export function Conteos() {
  const { sucursales, categorias } = useCatalogo();
  const lista = useDatos<any[]>("/central/conteos");
  const [abierto, setAbierto] = useState<string | null>(null);
  const [sucursalId, setSucursalId] = useState(sucursales[0]?.id ?? "");
  const [tipo, setTipo] = useState("CICLICO");
  const [categoriaId, setCategoriaId] = useState("");
  const [msg, setMsg] = useState("");

  const crear = async () => {
    setMsg("");
    try {
      const r = await api("/central/conteos", {
        cuerpo: {
          sucursalId, usuarioId: sesionActual().usuarioId, tipo, categoriaId: categoriaId || undefined,
          alcance: tipo === "TOTAL" ? "Inventario completo" : categorias.find((c) => c.id === categoriaId)?.nombre ?? "Todos los productos",
        },
      });
      setAbierto(r.id);
      lista.recargar();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  if (abierto) return <EditarConteo id={abierto} onVolver={() => { setAbierto(null); lista.recargar(); }} />;

  return (
    <>
      <Encabezado titulo="Conteos físicos" descripcion="Inventario completo o cíclico por categoría, con ajuste automático de las diferencias." />
      <div className="panel">
        <div className="tres-col">
          <label className="campo"><span>Sucursal</span><SelectorSucursal valor={sucursalId} onCambio={setSucursalId} todas={false} /></label>
          <label className="campo"><span>Tipo</span>
            <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="CICLICO">Cíclico (una parte)</option><option value="TOTAL">Inventario completo</option>
            </select>
          </label>
          {tipo === "CICLICO" && (
            <label className="campo"><span>Categoría</span>
              <select value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}>
                <option value="">Todas</option>
                {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </label>
          )}
        </div>
        <button className="boton primario" onClick={crear}>Iniciar conteo</button>
        <Aviso texto={msg} />
      </div>
      <h2>Conteos</h2>
      <Tabla
        filas={lista.datos ?? []}
        clave={(f) => f.id}
        vacio="Todavía no hay conteos"
        columnas={[
          { titulo: "Fecha", valor: (f) => new Date(f.creadoEn).toLocaleString("es-DO") },
          { titulo: "Sucursal", valor: (f) => f.sucursal },
          { titulo: "Alcance", valor: (f) => f.alcance },
          { titulo: "Estado", valor: (f) => <span className={"pastilla " + f.estado.toLowerCase()}>{f.estado}</span> },
          { titulo: "Contados", valor: (f) => `${num(f.contados)} / ${num(f.productos)}`, der: true },
          { titulo: "", valor: (f) => <button className="enlace" onClick={() => setAbierto(f.id)}>{f.estado === "ABIERTO" ? "Continuar" : "Ver"}</button> },
        ]}
      />
    </>
  );
}

function EditarConteo({ id, onVolver }: { id: string; onVolver: () => void }) {
  const { datos, recargar } = useDatos<{ conteo: any; pendientes: number; items: ItemConteo[] }>(`/central/conteos/${id}`);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [verSistema, setVerSistema] = useState(false);
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState<{ t: string; tipo: "ok" | "error" } | null>(null);
  if (!datos) return <p className="suave">Cargando…</p>;
  const abierto = datos.conteo.estado === "ABIERTO";

  const guardar = async () => {
    const items = Object.entries(valores).filter(([, v]) => v !== "").map(([productoId, cantidadContada]) => ({ productoId, cantidadContada }));
    if (!items.length) return;
    try {
      await api(`/central/conteos/${id}/items`, { metodo: "PUT", cuerpo: { usuarioId: sesionActual().usuarioId, items } });
      setValores({});
      setMsg({ t: `${items.length} producto(s) guardados`, tipo: "ok" });
      recargar();
    } catch (e) {
      setMsg({ t: (e as Error).message, tipo: "error" });
    }
  };
  const aplicar = async () => {
    if (!confirm(`Se ajustará el inventario con las diferencias. ${datos.pendientes} producto(s) sin contar quedarán como están. ¿Aplicar?`)) return;
    try {
      const r = await api(`/central/conteos/${id}/aplicar`, { cuerpo: { usuarioId: sesionActual().usuarioId } });
      setMsg({ t: r.ajuste ? `Aplicado: ${r.productosConDiferencia} producto(s) ajustados (${rd(r.ajuste.valor)})` : "Aplicado sin diferencias", tipo: "ok" });
      recargar();
    } catch (e) {
      setMsg({ t: (e as Error).message, tipo: "error" });
    }
  };

  const filas = datos.items.filter((i) => `${i.nombre} ${i.sku}`.toLowerCase().includes(q.toLowerCase()));
  const valorDif = datos.items.reduce((a, i) => a + Number(i.valorDiferencia ?? 0), 0);

  return (
    <>
      <Encabezado titulo={`Conteo: ${datos.conteo.alcance}`} descripcion={`${datos.conteo.estado} · ${datos.items.length - datos.pendientes} de ${datos.items.length} contados · diferencia ${rd(valorDif)}`}>
        <button className="boton fantasma" onClick={onVolver}>← Volver</button>
        {abierto && <button className="boton primario" onClick={aplicar}>Aplicar conteo</button>}
      </Encabezado>
      <div className="filtros">
        <input placeholder="Buscar producto" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="check"><input type="checkbox" checked={verSistema} onChange={(e) => setVerSistema(e.target.checked)} /> Mostrar existencia del sistema</label>
        <span className="flex" />
        {abierto && <button className="boton" disabled={!Object.keys(valores).length} onClick={guardar}>Guardar lo contado</button>}
      </div>
      {msg && <Aviso texto={msg.t} tipo={msg.tipo} />}
      <Tabla
        filas={filas}
        clave={(f) => f.productoId}
        columnas={[
          { titulo: "Producto", valor: (f) => <><b>{f.nombre}</b> <span className="suave">{f.sku}</span></> },
          ...(verSistema || !abierto ? [{ titulo: "Sistema", valor: (f: ItemConteo) => num(f.sistema, 0), der: true }] : []),
          {
            titulo: "Contado", der: true,
            valor: (f) => abierto
              ? <input className="numero" inputMode="decimal" placeholder={f.contada ?? ""} value={valores[f.productoId] ?? ""}
                  onChange={(e) => setValores({ ...valores, [f.productoId]: e.target.value.replace(/[^\d.]/g, "") })} />
              : f.contada === null ? "—" : num(f.contada, 0),
          },
          ...(verSistema || !abierto ? [
            { titulo: "Diferencia", der: true, valor: (f: ItemConteo) => f.diferencia === null ? "—" : <span className={Number(f.diferencia) < 0 ? "texto-alerta" : Number(f.diferencia) > 0 ? "texto-ok" : ""}>{num(f.diferencia, 0)}</span> },
            { titulo: "Valor", der: true, valor: (f: ItemConteo) => f.valorDiferencia === null ? "—" : rd(f.valorDiferencia) },
          ] : []),
        ]}
      />
    </>
  );
}
