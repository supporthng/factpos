import { useState } from "react";
import { api } from "../api";
import { Aviso } from "../ui";

/** Firma con el certificado de la empresa el XML que genera el portal de la DGII (no hace falta la «App Firma Digital»). */
export function FirmarXmlDgii() {
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [trabajando, setTrabajando] = useState(false);

  const firmar = async (archivo: File | undefined) => {
    if (!archivo) return;
    setMsg(null); setTrabajando(true);
    try {
      const r = await api<{ xmlFirmado: string }>("/central/fiscal/firmar-xml", { metodo: "POST", cuerpo: { xml: await archivo.text() } });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([r.xmlFirmado], { type: "application/xml" }));
      a.download = archivo.name.replace(/\.xml$/i, "") + "-firmado.xml";
      a.click(); URL.revokeObjectURL(a.href);
      setMsg({ tipo: "ok", texto: "Listo: se descargó el XML firmado. Súbalo a la DGII en el mismo lugar de donde bajó el original." });
    } catch (e) { setMsg({ tipo: "error", texto: (e as Error).message }); }
    setTrabajando(false);
  };

  return (
    <div className="panel" style={{ marginTop: 14 }}>
      <h3 style={{ marginTop: 0 }}>Firmar un XML de la DGII</h3>
      <p className="suave pequeno">La postulación, las delegaciones de roles y la declaración jurada se descargan de la DGII sin firma. Elija aquí ese archivo y FactPOS lo firma con el certificado digital cargado de la empresa; después súbalo de nuevo a la DGII. Así no necesita la «App Firma Digital».</p>
      <input type="file" accept=".xml,text/xml,application/xml" disabled={trabajando} onChange={(e) => { firmar(e.target.files?.[0]); e.target.value = ""; }} />
      {msg && <Aviso tipo={msg.tipo} texto={msg.texto} />}
    </div>
  );
}
