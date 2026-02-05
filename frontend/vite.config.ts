import { readFileSync } from "fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Read version from package.json at build time
const packageJson = JSON.parse(readFileSync("./package.json", "utf-8"));

// Use localhost backend for E2E tests and local dev, docker container for docker dev
const backendTarget = process.env.BACKEND_URL || "http://backend-dev:3000";

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version || "unknown"),
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: backendTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
