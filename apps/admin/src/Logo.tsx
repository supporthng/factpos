/**
 * Símbolo de FactPOS: la F de Factura dentro del anillo.
 * El anillo de cuatro colores representa al sistema camaleón; cuando el
 * cliente tiene su marca, el anillo toma su color principal.
 */
const SEGMENTOS = ["#2DD4BF", "#60A5FA", "#A3E635", "#FBBF24"];
const arco = (i: number) => {
  const r = 158, a0 = ((-90 + i * 90 + 9) * Math.PI) / 180, a1 = ((-90 + (i + 1) * 90 - 9) * Math.PI) / 180;
  return `M${256 + r * Math.cos(a0)} ${256 + r * Math.sin(a0)}A${r} ${r} 0 0 1 ${256 + r * Math.cos(a1)} ${256 + r * Math.sin(a1)}`;
};

export function SimboloFactPOS({ tamano = 32, color, fondo = false }: { tamano?: number; color?: string; fondo?: boolean }) {
  return (
    <svg width={tamano} height={tamano} viewBox="0 0 512 512" role="img" aria-label="FactPOS">
      {fondo && <rect width="512" height="512" rx="116" fill="#0E1B26" />}
      {color
        ? <circle cx="256" cy="256" r="158" fill="none" stroke={color} strokeWidth="56" />
        : SEGMENTOS.map((c, i) => <path key={c} d={arco(i)} fill="none" stroke={c} strokeWidth="56" strokeLinecap="round" />)}
      <path d="M302 168 L214 168 L214 352 M214 260 L284 260" fill="none" stroke="#FFFFFF" strokeWidth="52" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
