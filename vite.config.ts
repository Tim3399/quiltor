import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: fileURLToPath(new URL("./apps/web", import.meta.url)),
  plugins: [react()],
  server: {
    proxy: { "/api": process.env.QUILTOR_API_TARGET || "http://127.0.0.1:8000" },
  },
  build: {
    outDir: fileURLToPath(new URL("./dist", import.meta.url)),
    emptyOutDir: true,
  },
});
