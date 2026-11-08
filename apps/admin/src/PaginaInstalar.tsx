import { CONFIG } from "./api";
import { AgregarAInicio } from "./AgregarAInicio";

/**
 * Página de instalación de las apps FactPOS Admin: https://<portal>/<empresa>/#instalar
 * Descarga la app y la abre YA configurada con esta empresa (enlace factpos-admin://conectar/<empresa>).
 */
export function PaginaInstalar() {
  const slug = CONFIG.slug ?? "";
  const descarga = (so: string) => `${location.origin}/licencias/descargar-verificador/${so}`;
  const abrir = `factpos-admin://conectar/${slug}`;
  const movil = /Android|iPhone|iPad/i.test(navigator.userAgent);
  const caja: React.CSSProperties = { background: "#fff", borderRadius: 14, padding: 20, margin: "14px 0", boxShadow: "0 6px 24px rgba(0,0,0,.12)" };
  const paso = (n: number, t: string) => <p style={{ margin: "8px 0" }}><b>{n}.</b> {t}</p>;
  const bloque = (titulo: string, so: string, boton: string) => (
    <div style={caja}>
      <h3 style={{ marginTop: 0 }}>{titulo}</h3>
      {paso(1, "Descarga e instala la app.")}
      <a className="boton primario" href={descarga(so)}>{boton}</a>
      {paso(2, "Ábrela con este botón: queda conectada a tu empresa.")}
      <a className="boton" href={abrir}>Abrir y conectar</a>
      {paso(3, "Si tu administrador exige autorización, la app pedirá acceso y se abrirá sola cuando lo autorice.")}
    </div>
  );
  return (
    <div style={{ minHeight: "100vh", background: "#0E1B26", padding: 16, fontFamily: "system-ui, sans-serif", color: "#10202e" }}>
      <div style={{ maxWidth: 520, margin: "6vh auto" }}>
        <h1 style={{ color: "#fff" }}>FactPOS Admin{CONFIG.cliente ? ` · ${CONFIG.cliente}` : ""}</h1>
        <p style={{ color: "#cfd8e0" }}>Administra tu negocio desde cualquier lugar.</p>
        {(movil || !/Windows/i.test(navigator.userAgent)) && bloque("Android", "admin-android", "Descargar la app para Android")}
        {!movil && bloque("Windows", "admin-windows", "Descargar el instalador para Windows")}
        <AgregarAInicio siempre />
        <p><a style={{ color: "#fff" }} href={`${location.origin}/${slug}/`}>Entrar desde el navegador</a></p>
      </div>
    </div>
  );
}
