import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import dotenv from "dotenv";

dotenv.config({ path: process.env.DOTENV_PATH || ".env" });

const url = process.env.DATABASE_URL || "file:./data/medassist.db";
const client = createClient({ url });

export const db = drizzle(client);
