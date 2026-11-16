import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: fileURLToPath(new URL("./apps/web", import.meta.url)),
  plugins: [react()],
  // WebLLM is reached only through a dynamic import (T-61 part 7). Without this, Vite finds it
  // mid-run, re-optimises and invalidates every lazy module a page is importing at that moment.
  optimizeDeps: { include: ["@mlc-ai/web-llm"] },
  server: {
    proxy: { "/api": process.env.QUILTOR_API_TARGET || "http://127.0.0.1:8010" },
  },
  build: {
    outDir: fileURLToPath(new URL("./dist", import.meta.url)),
    emptyOutDir: true,
  },
});
