import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@unfurl/component-manifest": fileURLToPath(new URL("../../packages/component-manifest/src/index.ts", import.meta.url)),
      "@unfurl/fabric-scene-model": fileURLToPath(new URL("../../packages/fabric-scene-model/src/index.ts", import.meta.url)),
      "@unfurl/fabric-studio-webapp": fileURLToPath(new URL("../fabric-studio-webapp/src/index.ts", import.meta.url)),
      "@unfurl/fabric-validation-client": fileURLToPath(new URL("../../packages/fabric-validation-client/src/index.ts", import.meta.url)),
      "@unfurl/graph-layout": fileURLToPath(new URL("../../packages/graph-layout/src/index.ts", import.meta.url)),
      "@unfurl/theme-engine": fileURLToPath(new URL("../../packages/theme-engine/src/index.ts", import.meta.url)),
      "@unfurl/three-renderer": fileURLToPath(new URL("../../packages/three-renderer/src/index.ts", import.meta.url)),
      "@unfurl/ui-contracts": fileURLToPath(new URL("../../packages/ui-contracts/src/index.ts", import.meta.url)),
      "@unfurl/visual-manifest": fileURLToPath(new URL("../../packages/visual-manifest/src/index.ts", import.meta.url))
    }
  },
  build: {
    chunkSizeWarningLimit: 700
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/studio": "http://127.0.0.1:7878"
    }
  },
  preview: {
    host: "127.0.0.1",
    port: 4173
  }
});
