import { createClient, Client } from "@libsql/client";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { getTableCreationSQL } from "./schema-sql.js";

dotenv.config({ path: process.env.DOTENV_PATH || ".env" });

// =============================================================================
// Exported utility functions for testing
// =============================================================================

/** Get the full migration SQL string (re-exported from schema-sql) */
export { getTableCreationSQL };

/** Split SQL string into individual statements */
export function splitSQLStatements(sql: string): string[] {
  return sql.split(';').filter(s => s.trim().length > 0);
}

/** Execute migration statements on a client */
export async function executeMigration(client: Client): Promise<{ success: boolean; executed: number; errors: string[] }> {
  const statements = getTableCreationSQL();
  const errors: string[] = [];
  let executed = 0;

  for (const stmt of statements) {
    try {
      await client.execute(stmt);
      executed++;
    } catch (err: any) {
      errors.push(err.message);
    }
  }

  return { success: errors.length === 0, executed, errors };
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
  
  const client = createClient({ url });
  
  const statements = getTableCreationSQL();
  
  for (const stmt of statements) {
    console.log("Executing:", getStatementPreview(stmt));
    await client.execute(stmt);
  }

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
