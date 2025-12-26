import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// =============================================================================
// Users - Simple auth, no roles (every user is equal)
// =============================================================================
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username", { length: 100 }).notNull().unique(),
  passwordHash: text("password_hash", { length: 255 }),
  authProvider: text("auth_provider", { length: 50 }).notNull().default("local"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  lastLoginAt: integer("last_login_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`CURRENT_TIMESTAMP`),
});

// =============================================================================
// Medications - Per user
// =============================================================================
export const medications = sqliteTable("medications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name", { length: 100 }).notNull(),
  genericName: text("generic_name", { length: 100 }),
  takenBy: text("taken_by", { length: 100 }),
  count: integer("count").notNull().default(0),
  strips: integer("strips").notNull().default(0),
  packCount: integer("pack_count").notNull().default(1),
  stripsPerPack: integer("strips_per_pack").notNull().default(1),
  tabsPerStrip: integer("tabs_per_strip").notNull().default(1),
  looseTablets: integer("loose_tablets").notNull().default(0),
  pillWeightMg: integer("pill_weight_mg"),
  usageJson: text("usage_json").notNull().default("[]"),
  everyJson: text("every_json").notNull().default("[]"),
  startJson: text("start_json").notNull().default("[]"),
  stripSize: integer("strip_size").notNull().default(1),
  imageUrl: text("image_url"),
  expiryDate: text("expiry_date"),
  notes: text("notes"),
  intakeRemindersEnabled: integer("intake_reminders_enabled", { mode: "boolean" }).notNull().default(false),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`CURRENT_TIMESTAMP`),
});

// =============================================================================
// User Settings - Per user (email, push, thresholds, language)
// =============================================================================
export const userSettings = sqliteTable("user_settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  // Email notifications
  emailEnabled: integer("email_enabled", { mode: "boolean" }).notNull().default(false),
  notificationEmail: text("notification_email"),
  emailStockReminders: integer("email_stock_reminders", { mode: "boolean" }).notNull().default(true),
  emailIntakeReminders: integer("email_intake_reminders", { mode: "boolean" }).notNull().default(true),
  // Push notifications (shoutrrr/ntfy)
  shoutrrrEnabled: integer("shoutrrr_enabled", { mode: "boolean" }).notNull().default(false),
  shoutrrrUrl: text("shoutrrr_url"),
  shoutrrrStockReminders: integer("shoutrrr_stock_reminders", { mode: "boolean" }).notNull().default(true),
  shoutrrrIntakeReminders: integer("shoutrrr_intake_reminders", { mode: "boolean" }).notNull().default(true),
  // Reminder settings
  reminderDaysBefore: integer("reminder_days_before").notNull().default(7),
  repeatDailyReminders: integer("repeat_daily_reminders", { mode: "boolean" }).notNull().default(false),
  // Stock thresholds (days)
  lowStockDays: integer("low_stock_days").notNull().default(30),
  normalStockDays: integer("normal_stock_days").notNull().default(90),
  highStockDays: integer("high_stock_days").notNull().default(180),
  // UI preferences
  language: text("language", { length: 10 }).notNull().default("en"),
  // Last notification tracking
  lastAutoEmailSent: text("last_auto_email_sent"),
  lastNotificationType: text("last_notification_type"),
  lastNotificationChannel: text("last_notification_channel"),
  // Timestamps
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`CURRENT_TIMESTAMP`),
});

// =============================================================================
// Refresh Tokens - For JWT rotation
// =============================================================================
export const refreshTokens = sqliteTable("refresh_tokens", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenId: text("token_id", { length: 255 }).notNull().unique(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  rotatedAt: integer("rotated_at", { mode: "timestamp" }),
  revoked: integer("revoked", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`CURRENT_TIMESTAMP`),
});
