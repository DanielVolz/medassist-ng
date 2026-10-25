import { createServer } from "vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function sandboxViteOptions(env = process.env) {
	return {
		envDir: false,
		server: {
			host: env.UI_SANDBOX_HOST ?? "127.0.0.1",
			port: 5176,
			strictPort: true,
			allowedHosts: ["localhost", "127.0.0.1", ...(env.PUBLIC_APP_URL ? [new URL(env.PUBLIC_APP_URL).hostname] : [])],
		},
	};
}

let server;
let stopping = false;

async function close() {
	stopping = true;
	if (server) await server.close();
}

async function start() {
	try {
		server = await createServer(sandboxViteOptions());
		if (stopping) {
			await server.close();
		} else {
			await server.listen();
			if (!stopping && typeof process.send === "function") process.send({ type: "ready" });
		}
	} catch (error) {
		console.error("[ui-sandbox] Frontend failed to start:", error);
		await close();
		process.exitCode = 1;
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	process.once("SIGINT", () => void close());
	process.once("SIGTERM", () => void close());
	await start();
}
