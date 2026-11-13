import { useState } from "react";
import { api } from "./api";

/** «¿Olvidó su contraseña?»: pide el correo, recibe un código de 6 dígitos y elige la contraseña nueva. */
export function RecuperarClave({ servidor, usuarioInicial, onVolver }: { servidor: string; usuarioInicial: string; onVolver: (mensaje?: string) => void }) {
  const [usuario, setUsuario] = useState(usuarioInicial.includes("@") ? usuarioInicial : "");
  const [paso, setPaso] = useState<1 | 2>(1);
  const [codigo, setCodigo] = useState("");
  const [clave, setClave] = useState("");
  const [clave2, setClave2] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [trabajando, setTrabajando] = useState(false);

  const pedir = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(""); setMsg(""); setTrabajando(true);
    try {
      const r = await api<{ mensaje: string }>("/central/recuperar/solicitar", { servidor, cuerpo: { usuario } });
      setMsg(r.mensaje); setPaso(2);
    } catch (err) { setError((err as Error).message); } finally { setTrabajando(false); }
  };
  const cambiar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (clave !== clave2) { setError("Las dos contraseñas no coinciden"); return; }
    setError(""); setTrabajando(true);
    try {
      await api("/central/recuperar/confirmar", { servidor, cuerpo: { usuario, codigo, clave } });
      onVolver("Listo. Su contraseña cambió: entre con la nueva.");
    } catch (err) { setError((err as Error).message); } finally { setTrabajando(false); }
  };

  return (
    <form className="tarjeta-entrar" onSubmit={paso === 1 ? pedir : cambiar}>
      <div className="entrar-titulo">
        <small>Recuperar acceso</small>
        <h1>{paso === 1 ? "¿Olvidó su contraseña?" : "Elija una contraseña nueva"}</h1>
      </div>
      {paso === 1 ? (
        <>
          <p className="suave">Escriba su correo (el que usa para entrar) y le enviamos un código de 6 dígitos.</p>
          <label className="campo"><span>Correo</span><input autoFocus type="email" value={usuario} onChange={(e) => setUsuario(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} /></label>
          <button className="boton primario ancho" disabled={!usuario.includes("@") || trabajando}>{trabajando ? "Enviando…" : "Enviar código"}</button>
        </>
      ) : (
        <>
          {msg && <p className="suave">{msg}</p>}
          <label className="campo"><span>Código de 6 dígitos</span><input autoFocus value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" /></label>
          <label className="campo"><span>Contraseña nueva</span><input type="password" value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="new-password" /></label>
          <label className="campo"><span>Repita la contraseña</span><input type="password" value={clave2} onChange={(e) => setClave2(e.target.value)} autoComplete="new-password" /></label>
          <button className="boton primario ancho" disabled={codigo.length !== 6 || clave.length < 8 || trabajando}>{trabajando ? "Guardando…" : "Cambiar contraseña"}</button>
          <button type="button" className="enlace pequeno" onClick={() => { setPaso(1); setMsg(""); setError(""); }}>No me llegó: pedir otro código</button>
        </>
      )}
      {error && <p className="error">{error}</p>}
      <button type="button" className="enlace pequeno" onClick={() => onVolver()}>← Volver a iniciar sesión</button>
      <p className="suave" style={{ fontSize: 12.5 }}>Si no recibe el correo, pida a quien administra FactPOS que le restablezca la contraseña desde Usuarios.</p>
    </form>
  );
}
