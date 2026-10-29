import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./", // funciona servida desde /terminal/ o /admin/ del servidor
  server: { port: 5174 },
  build: { target: "es2022" },
});
