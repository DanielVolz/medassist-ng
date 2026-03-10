import { existsSync, readFileSync } from "fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Read version from package.json at build time
const packageJson = JSON.parse(readFileSync("./package.json", "utf-8"));

// Default to localhost for local dev and CI.
// In Docker, prefer backend-dev to avoid localhost proxy failures.
const defaultBackendTarget = existsSync("/.dockerenv") ? "http://backend-dev:3000" : "http://localhost:3000";
const backendTarget = process.env.BACKEND_URL || defaultBackendTarget;

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version || "unknown"),
    __LOG_LEVEL__: JSON.stringify(process.env.LOG_LEVEL || "warn"),
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
    // On macOS Docker volume mounts, inotify events don't reach the
    // Linux container reliably. Polling ensures HMR sees file edits.
    watch: existsSync("/.dockerenv") ? { usePolling: true, interval: 300 } : undefined,
  },
});
