import { createApp } from "./app/createApp.js";
import { startServer } from "./app/startServer.js";
import { migrationsReady } from "./db/client.js";
import { env } from "./plugins/env.js";
import { log } from "./utils/logger.js";
import { buildRuntimeAppOptions, ensureImagesDirectory } from "./utils/server-config.js";

export { createApp } from "./app/createApp.js";
export {
	buildAppConfig,
	buildBaseCookieOptions,
	buildRefreshCookieOptions,
	buildRuntimeAppOptions,
	ensureImagesDirectory,
	getJwtConfig,
	parseCorsOrigins,
} from "./utils/server-config.js";

async function main(): Promise<void> {
	await migrationsReady;
	log.info("[DB] Migrations complete, starting server...");

	const imagesDir = ensureImagesDirectory();
	const app = await createApp(buildRuntimeAppOptions(env, imagesDir));
	await startServer(app, { port: env.PORT, host: "0.0.0.0" });
}

try {
	await main();
} catch (err) {
	const errorMessage = err instanceof Error ? (err.stack ?? err.message) : String(err);
	log.error(`[Server] Failed to start backend: ${errorMessage}`);
	process.exit(1);
}
