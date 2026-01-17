import { createClient, Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

dotenv.config({ path: process.env.DOTENV_PATH || ".env" });

// Get migrations folder path (relative to this file's location)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = resolve(__dirname, "../../drizzle");

// =============================================================================
// Exported utility functions for testing
// =============================================================================

/** Split SQL string into individual statements (for backwards compatibility with tests) */
export function splitSQLStatements(sql: string): string[] {
  return sql.split(';').filter(s => s.trim().length > 0);
}

/** Execute drizzle migrations on a database */
export async function executeMigration(client: Client): Promise<{ success: boolean; executed: number; errors: string[] }> {
  const errors: string[] = [];
  const db = drizzle(client);

  try {
    await migrate(db, { migrationsFolder });
    
    // Count tables as a proxy for "executed" statements
    const tables = await client.execute(
      "SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'"
    );
    const executed = Number(tables.rows[0].count) || 0;
    
    return { success: true, executed, errors };
  } catch (err: any) {
    errors.push(err.message);
    return { success: false, executed: 0, errors };
  }
}

/** Get a preview of statement (first N characters) */
export function getStatementPreview(stmt: string, maxLength: number = 50): string {
  const trimmed = stmt.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return trimmed.substring(0, maxLength) + "...";
}

// =============================================================================
// CLI execution (only runs when called directly)
// =============================================================================

const url = "file:./data/medassist-ng.db";

async function main() {
  console.log("Starting database setup...");
  console.log("Database URL:", url);
  console.log("Migrations folder:", migrationsFolder);
  
  const client = createClient({ url });
  const db = drizzle(client);
  
  console.log("Running drizzle migrations...");
  await migrate(db, { migrationsFolder });

  console.log("Database setup complete!");
  process.exit(0);
}

// Only run main() if this file is executed directly (not imported)
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main().catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
}
