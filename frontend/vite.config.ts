import { existsSync, readFileSync } from "fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function parseCsvEnv(value: string | undefined, fallback: string[]) {
  const entries = value
    ?.split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return entries && entries.length > 0 ? entries : fallback;
}

function parseOptionalPort(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseUrlHostname(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  try {
    return new URL(value).hostname;
  } catch {
    return undefined;
  }
}

function uniqueHosts(hosts: Array<string | undefined>) {
  return [...new Set(hosts.filter((host): host is string => Boolean(host)))];
}

// Read version from package.json at build time
const packageJson = JSON.parse(readFileSync("./package.json", "utf-8"));

// Default to localhost for local dev and CI.
// In Docker, prefer backend-dev to avoid localhost proxy failures.
const defaultBackendTarget = existsSync("/.dockerenv") ? "http://backend-dev:3000" : "http://localhost:3000";
const backendTarget = process.env.BACKEND_URL || defaultBackendTarget;
const configuredAllowedHosts = parseCsvEnv(process.env.VITE_ALLOWED_HOSTS, []);
const baseAllowedHosts = configuredAllowedHosts.length > 0 ? configuredAllowedHosts : ["localhost", "127.0.0.1"];
const allowedHosts = uniqueHosts([...baseAllowedHosts, parseUrlHostname(process.env.PUBLIC_APP_URL)]);
const hmrHost = process.env.VITE_HMR_HOST?.trim();
const hmrProtocol = process.env.VITE_HMR_PROTOCOL === "ws" ? "ws" : process.env.VITE_HMR_PROTOCOL === "wss" ? "wss" : undefined;
const hmrClientPort = parseOptionalPort(process.env.VITE_HMR_CLIENT_PORT);
const hmrPort = parseOptionalPort(process.env.VITE_HMR_PORT);
const hmr = hmrHost
  ? {
      host: hmrHost,
      protocol: hmrProtocol ?? "wss",
      clientPort: hmrClientPort ?? (hmrProtocol === "ws" ? 80 : 443),
      port: hmrPort ?? 5173,
    }
  : undefined;

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version || "unknown"),
    __LOG_LEVEL__: JSON.stringify(process.env.LOG_LEVEL || "warn"),
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return undefined;
          }

          if (id.includes("react-router-dom")) {
            return "router-vendor";
          }

          if (id.includes("react-i18next") || id.includes("i18next-browser-languagedetector") || id.includes("i18next")) {
            return "i18n-vendor";
          }

          if (id.includes("lucide-react")) {
            return "icons-vendor";
          }

          if (id.includes("react") || id.includes("scheduler")) {
            return "react-vendor";
          }

          return "vendor";
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    allowedHosts,
    hmr,
    proxy: {
      "/api": {
        target: backendTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
    // Ignore generated artifacts that otherwise trigger massive reload storms during local dev.
    // On macOS Docker volume mounts, inotify events don't reach the Linux container reliably,
    // so polling remains enabled only in Docker.
    watch: {
      ignored: ["**/coverage/**", "**/playwright-report/**", "**/test-results/**"],
      ...(existsSync("/.dockerenv") ? { usePolling: true, interval: 300 } : {}),
    },
  },
});
