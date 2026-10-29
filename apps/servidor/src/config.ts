const enVercel = !!process.env.VERCEL;

export const config = {
  databaseUrl: process.env.DATABASE_URL ?? "postgres://factpos:factpos@localhost:5432/factpos",
  puerto: Number(process.env.PUERTO ?? process.env.PORT ?? 3000),
  host: process.env.HOST ?? "0.0.0.0",
  /** "sucursal" = servidor local de una tienda; "central" = administración en la nube de un cliente;
   *  "portal" = portal del proveedor (clientes y licencias; no guarda datos de los clientes) */
  modo: (process.env.MODO === "central" || process.env.MODO === "portal" ? process.env.MODO : "sucursal") as "central" | "sucursal" | "portal",
  /** Conexiones a la base por instancia: pocas en Vercel (muchas instancias), más en una sucursal */
  maxConexiones: Number(process.env.DB_MAX_CONEXIONES ?? (enVercel ? 3 : 20)),
};
