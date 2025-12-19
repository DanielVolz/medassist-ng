import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email", { length: 255 }).notNull().unique(),
  passwordHash: text("password_hash", { length: 255 }).notNull(),
  role: text("role", { length: 50 }).notNull().default("user"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const medications = sqliteTable("medications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name", { length: 100 }).notNull().unique(),
  count: integer("count").notNull().default(0),
  usageJson: text("usage_json").notNull().default("[]"),
  everyJson: text("every_json").notNull().default("[]"),
  startJson: text("start_json").notNull().default("[]"),
  stripSize: integer("strip_size").notNull().default(1),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const refreshTokens = sqliteTable("refresh_tokens", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenId: text("token_id", { length: 255 }).notNull().unique(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  rotatedAt: integer("rotated_at", { mode: "timestamp" }),
  revoked: integer("revoked", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  smtpHost: text("smtp_host"),
  smtpPort: integer("smtp_port"),
  smtpUser: text("smtp_user"),
  smtpPassEncrypted: text("smtp_pass_encrypted"),
  smtpFrom: text("smtp_from"),
  smtpSecure: integer("smtp_secure", { mode: "boolean" }).notNull().default(false),
  emailsPerDay: integer("emails_per_day").notNull().default(3),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`CURRENT_TIMESTAMP`),
});
