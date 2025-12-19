import { defineConfig } from "drizzle-kit";

const dbUrl = process.env.DATABASE_URL || "file:./data/medassist.db";

export default defineConfig({
  dialect: "libsql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: dbUrl,
  },
});
