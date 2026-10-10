import { createServer } from "vite";

let server;
let stopping = false;

async function close() {
	stopping = true;
	if (server) await server.close();
}

process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());

try {
	server = await createServer({
		envDir: false,
		server: {
			host: "127.0.0.1",
			port: 5176,
			strictPort: true,
		},
	});
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
