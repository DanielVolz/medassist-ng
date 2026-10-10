import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

async function main(): Promise<void> {
	const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
	const expectedDataDir = resolve(repositoryRoot, ".ui-dev/data");
	if (
		process.env.UI_SANDBOX_LAUNCHER !== "1" ||
		resolve(process.env.DATA_DIR ?? "") !== expectedDataDir ||
		process.env.DOTENV_PATH !== "/dev/null" ||
		process.env.NODE_ENV !== "development" ||
		process.env.AUTH_ENABLED !== "false" ||
		process.env.ALLOW_UNAUTHENTICATED !== "false"
	) {
		throw new Error("The UI sandbox backend must be started by its launcher with isolated development settings.");
	}

	const [{ createApp }, { migrationsReady }, { env }, { buildRuntimeAppOptions, ensureImagesDirectory }] =
		await Promise.all([
			import("./app/createApp.js"),
			import("./db/client.js"),
			import("./plugins/env.js"),
			import("./utils/server-config.js"),
		]);
	if (env.AUTH_ENABLED || env.NODE_ENV !== "development") {
		throw new Error("The UI sandbox requires development mode with AUTH_ENABLED=false.");
	}
	await migrationsReady;
	const imagesDir = ensureImagesDirectory();
	const app = await createApp(buildRuntimeAppOptions(env, imagesDir));
	await app.listen({ port: env.PORT, host: "127.0.0.1" });
	app.log.info(`Local UI sandbox backend listening on 127.0.0.1:${env.PORT}; runtime schedulers are disabled.`);
	if (typeof process.send === "function") process.send({ type: "ready" });

	let closing = false;
	const close = async () => {
		if (closing) return;
		closing = true;
		await app.close();
		process.exit(0);
	};
	process.on("SIGINT", () => void close());
	process.on("SIGTERM", () => void close());
}

main().catch((error: unknown) => {
	console.error("[ui-sandbox] Backend failed to start:", error);
	process.exit(1);
});
