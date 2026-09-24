import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolveBuildInfo } from "./build-info.mjs";

export default defineConfig({
  define: {
    __BUILD_INFO__: JSON.stringify(resolveBuildInfo()),
  },
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: ["terminal.local", "localhost", "127.0.0.1"],
    proxy: {
      "/api": {
        target: "http://127.0.0.1:5002",
        changeOrigin: true,
      },
    },
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  plugins: [react()],
});
