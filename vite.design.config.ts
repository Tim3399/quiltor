import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { buildPolicy } from "./tools/dev/csp.mjs";
import { resolveDesignPort } from "./tools/dev/design-port.mjs";

export default defineConfig({
  root: fileURLToPath(new URL("./apps/design-gallery", import.meta.url)),
  plugins: [react()],
  // WebLLM is reached only through a dynamic import (T-61 part 7). Without this, Vite finds it
  // mid-run, re-optimises and invalidates every lazy module a page is importing at that moment.
  optimizeDeps: { include: ["@mlc-ai/web-llm"] },
  server: {
    host: "127.0.0.1",
    port: resolveDesignPort(),
    strictPort: true,
    // The product policy, plus 'unsafe-inline' in script-src for the react plugin's inline
    // preamble. It guards connect-src, img-src and font-src here; script-src is the product
    // suite's to prove (T-61).
    headers: { "Content-Security-Policy": buildPolicy({ design: true }) },
  },
});
