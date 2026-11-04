import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  define: { __INTERFAZ__: JSON.stringify(new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC") },
  base: "./", // funciona servida desde /terminal/ o /admin/ del servidor
  server: { port: 5173 },
  build: { target: "es2022" },
});
