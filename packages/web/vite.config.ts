import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    // The remaining C++ grammar is lazy-loaded and 52.72 kB gzip; Vite's
    // default warning measures its raw, non-initial size instead.
    chunkSizeWarningLimit: 750,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react") || id.includes("node_modules/react-dom")) {
            return "react-runtime";
          }
          if (id.includes("@tanstack/react-virtual")) {
            return "virtualizer";
          }
          if (id.includes("@shikijs/core") || id.includes("@shikijs/engine")) {
            return "shiki-runtime";
          }
          return undefined;
        }
      }
    }
  },
  server: {
    host: "127.0.0.1"
  }
});
