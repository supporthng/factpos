/** Íconos de línea de la Administración (24 × 24, trazo de 1.8). Heredan el color del texto. */
const TRAZOS = {
  resumen: <><rect x="3" y="3" width="7.5" height="7.5" rx="2" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="2" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="2" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2" /></>,
  productos: <><path d="M21 7.5 12 3 3 7.5l9 4.5 9-4.5Z" /><path d="M3 7.5v9L12 21l9-4.5v-9" /><path d="M12 12v9" /></>,
  compras: <><circle cx="9" cy="20" r="1.4" /><circle cx="18" cy="20" r="1.4" /><path d="M2.5 3.5h2.8l2.4 11a2 2 0 0 0 2 1.6h7.9a2 2 0 0 0 1.9-1.5L21 7.5H6.2" /></>,
  inventario: <><path d="M12 3 21 8l-9 5-9-5 9-5Z" /><path d="m3 12.5 9 5 9-5" /><path d="m3 17 9 5 9-5" /></>,
  ajustes: <><path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" /><circle cx="15" cy="6" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="17" cy="18" r="2" /></>,
  conteos: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4V2.8h6V4" /><path d="m9 13 2 2 4-4.5" /></>,
  traspasos: <><path d="M4 7.5h15M15.5 4l3.5 3.5-3.5 3.5" /><path d="M20 16.5H5M8.5 13 5 16.5 8.5 20" /></>,
  kardex: <><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1.1" /><circle cx="4.5" cy="12" r="1.1" /><circle cx="4.5" cy="18" r="1.1" /></>,
  precios: <><path d="M3 3h8.2l9.3 9.3a1.7 1.7 0 0 1 0 2.4l-5.8 5.8a1.7 1.7 0 0 1-2.4 0L3 11.2V3Z" /><circle cx="7.5" cy="7.5" r="1.5" /></>,
  ofertas: <><path d="M18.5 5.5 5.5 18.5" /><circle cx="7" cy="7" r="2.5" /><circle cx="17" cy="17" r="2.5" /></>,
  delivery: <><path d="M2.5 5.5h11v11h-11zM13.5 9.5h4l3.5 3.5v3.5h-7.5" /><circle cx="7" cy="18" r="2" /><circle cx="17.5" cy="18" r="2" /></>,
  cxc: <><path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2H5" /><circle cx="16.5" cy="14" r="1.3" /></>,
  caja: <><rect x="2.5" y="6" width="19" height="12" rx="2" /><circle cx="12" cy="12" r="2.6" /><path d="M6 12h.01M18 12h.01" /></>,
  fiscal: <><path d="M5 2.5h14v19l-3-2-2 2-2-2-2 2-2-2-3 2v-19Z" /><path d="M9 8h6M9 12h6M9 16h3" /></>,
  padron: <><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="11" r="2.2" /><path d="M5.8 16.2c.8-1.4 1.9-2 3.2-2s2.4.6 3.2 2M14.5 10h4M14.5 14h3" /></>,
  reportes: <><path d="M3.5 20.5h17" /><path d="M7 17v-6M12 17V5.5M17 17v-9" /></>,
  sucursales: <><path d="M3.5 9 5 4h14l1.5 5" /><path d="M3.5 9a2.8 2.8 0 0 0 5.7 0 2.8 2.8 0 0 0 5.6 0 2.8 2.8 0 0 0 5.7 0" /><path d="M5 11.5V20h14v-8.5" /><path d="M10 20v-4.5h4V20" /></>,
  incidentes: <><path d="M10.3 3.9 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9.5v4M12 17h.01" /></>,
  usuarios: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.4 3.4-5.5 6.5-5.5s5.7 2.1 6.5 5.5" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.9.8 3.1 2.5 3.5 5.2" /></>,
  correo: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3.5 7 8.5 6 8.5-6" /></>,
  marca: <><path d="M12 3a9 9 0 1 0 0 18c1 0 1.6-.7 1.6-1.5 0-.5-.2-.8-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.8-1.6 1.7-1.6H16a5 5 0 0 0 5-5C21 6.3 17 3 12 3Z" /><circle cx="7.5" cy="11" r="1" /><circle cx="10" cy="7" r="1" /><circle cx="15" cy="7.5" r="1" /></>,
  licencia: <><circle cx="8" cy="15" r="4.5" /><path d="m11.2 11.8 9.3-9.3M17 6l3 3M14.5 8.5l2 2" /></>,
  actualizaciones: <><path d="M20 11a8 8 0 0 0-14.4-4.6L4 8.5" /><path d="M4 3.5v5h5" /><path d="M4 13a8 8 0 0 0 14.4 4.6l1.6-2.1" /><path d="M20 20.5v-5h-5" /></>,
  clientes: <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18" /></>,
  venta: <><path d="m3 17 6-6 4 4 8-8" /><path d="M15 7h6v6" /></>,
  ticket: <><path d="M4 4h16v16H4z" /><path d="M8 9h8M8 13h8M8 17h4" /></>,
  salir: <><path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3" /><path d="m16 17 5-5-5-5M21 12H9" /></>,
  atras: <><path d="M15 5 8 12l7 7" /></>,
  menu: <><path d="M4 6h16M4 12h16M4 18h16" /></>,
  inicio: <><path d="M3.5 10.5 12 3.5l8.5 7" /><path d="M5.5 9v10.5a1 1 0 0 0 1 1H10v-6h4v6h3.5a1 1 0 0 0 1-1V9" /></>,
  "menu-lateral": <><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M9 4v16M5.5 8h1M5.5 11h1M5.5 14h1" /></>,
  llave: <><rect x="4" y="10.5" width="16" height="10.5" rx="2" /><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" /></>,
  web: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z" /></>,
} as const;

export type NombreIcono = keyof typeof TRAZOS;

export function Icono({ n, tamano = 20, className = "" }: { n: NombreIcono; tamano?: number; className?: string }) {
  return (
    <svg className={"icono " + className} width={tamano} height={tamano} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {TRAZOS[n]}
    </svg>
  );
}
