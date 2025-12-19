import { migrate } from "drizzle-orm/libsql/migrator";
import { db } from "./client.js";
import { env } from "../plugins/env.js";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, "..");

async function main() {
  const migrationsFolder = join(__dirname, "migrations");
  await migrate(db, { migrationsFolder });
  console.log("Migrations applied");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
