import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// =============================================================================
// Users - Simple auth, no roles (every user is equal)
// =============================================================================
export const users = sqliteTable("users", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	username: text("username", { length: 100 }).notNull().unique(),
	passwordHash: text("password_hash", { length: 255 }),
	avatarUrl: text("avatar_url", { length: 255 }),
	authProvider: text("auth_provider", { length: 50 }).notNull().default("local"),
	oidcSubject: text("oidc_subject", { length: 255 }), // OIDC provider's unique user ID (sub claim)
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
	userId: integer("user_id")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	name: text("name", { length: 100 }).notNull(),
	genericName: text("generic_name", { length: 100 }),
	takenByJson: text("taken_by_json").notNull().default("[]"), // JSON array of person names
	packageType: text("package_type", { length: 20 }).notNull().default("blister"), // 'blister' or 'bottle'
	packCount: integer("pack_count").notNull().default(1),
	blistersPerPack: integer("blisters_per_pack").notNull().default(1),
	pillsPerBlister: integer("pills_per_blister").notNull().default(1),
	totalPills: integer("total_pills"), // For bottle type: total capacity of the container
	looseTablets: integer("loose_tablets").notNull().default(0), // For blister: extra loose pills; for bottle: current stock
	stockAdjustment: integer("stock_adjustment").notNull().default(0), // Hidden offset from stock corrections
	lastStockCorrectionAt: integer("last_stock_correction_at", { mode: "timestamp" }), // When stock was last corrected - consumed doses before this don't count
	pillWeightMg: integer("pill_weight_mg"),
	doseUnit: text("dose_unit", { length: 20 }).default("mg"), // Unit for the dose (mg, g, mcg, ml, IU, etc.)
	usageJson: text("usage_json").notNull().default("[]"), // DEPRECATED: Use intakesJson instead
	everyJson: text("every_json").notNull().default("[]"), // DEPRECATED: Use intakesJson instead
	startJson: text("start_json").notNull().default("[]"), // DEPRECATED: Use intakesJson instead
	// New unified intakes structure: [{usage, every, start, takenBy, intakeRemindersEnabled}]
	intakesJson: text("intakes_json").notNull().default("[]"),
	imageUrl: text("image_url"),
	expiryDate: text("expiry_date"),
	notes: text("notes"),
	intakeRemindersEnabled: integer("intake_reminders_enabled", { mode: "boolean" }).notNull().default(false),
	medicationStartDate: text("medication_start_date").notNull().default(""),
	isObsolete: integer("is_obsolete", { mode: "boolean" }).notNull().default(false),
	obsoleteAt: integer("obsolete_at", { mode: "timestamp" }),
	prescriptionEnabled: integer("prescription_enabled", { mode: "boolean" }).notNull().default(false),
	prescriptionAuthorizedRefills: integer("prescription_authorized_refills"),
	prescriptionRemainingRefills: integer("prescription_remaining_refills"),
	prescriptionLowRefillThreshold: integer("prescription_low_refill_threshold").notNull().default(1),
	prescriptionExpiryDate: text("prescription_expiry_date"),
	dismissedUntil: text("dismissed_until"), // ISO date string (e.g. "2026-01-23") - all past doses until this date are dismissed
	updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`CURRENT_TIMESTAMP`),
});

// =============================================================================
// User Settings - Per user (email, push, thresholds, language)
// =============================================================================
export const userSettings = sqliteTable("user_settings", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	userId: integer("user_id")
		.notNull()
		.unique()
		.references(() => users.id, { onDelete: "cascade" }),
	// Email notifications
	emailEnabled: integer("email_enabled", { mode: "boolean" }).notNull().default(false),
	notificationEmail: text("notification_email"),
	emailStockReminders: integer("email_stock_reminders", { mode: "boolean" }).notNull().default(true),
	emailIntakeReminders: integer("email_intake_reminders", { mode: "boolean" }).notNull().default(true),
	emailPrescriptionReminders: integer("email_prescription_reminders", { mode: "boolean" }).notNull().default(true),
	// Push notifications (shoutrrr/ntfy)
	shoutrrrEnabled: integer("shoutrrr_enabled", { mode: "boolean" }).notNull().default(false),
	shoutrrrUrl: text("shoutrrr_url"),
	shoutrrrStockReminders: integer("shoutrrr_stock_reminders", { mode: "boolean" }).notNull().default(true),
	shoutrrrIntakeReminders: integer("shoutrrr_intake_reminders", { mode: "boolean" }).notNull().default(true),
	shoutrrrPrescriptionReminders: integer("shoutrrr_prescription_reminders", { mode: "boolean" })
		.notNull()
		.default(true),
	// Reminder settings
	reminderDaysBefore: integer("reminder_days_before").notNull().default(7),
	repeatDailyReminders: integer("repeat_daily_reminders", { mode: "boolean" }).notNull().default(false),
	skipRemindersForTakenDoses: integer("skip_reminders_for_taken_doses", { mode: "boolean" }).notNull().default(false),
	repeatRemindersEnabled: integer("repeat_reminders_enabled", { mode: "boolean" }).notNull().default(false),
	reminderRepeatIntervalMinutes: integer("reminder_repeat_interval_minutes").notNull().default(30),
	maxNaggingReminders: integer("max_nagging_reminders").notNull().default(5),
	// Stock thresholds (days)
	lowStockDays: integer("low_stock_days").notNull().default(30),
	normalStockDays: integer("normal_stock_days").notNull().default(90),
	highStockDays: integer("high_stock_days").notNull().default(180),
	expiryWarningDays: integer("expiry_warning_days").notNull().default(90),
	// UI preferences
	language: text("language", { length: 10 }).notNull().default("en"),
	// Stock calculation mode: "automatic" (schedule-based) or "manual" (only marked doses)
	stockCalculationMode: text("stock_calculation_mode", { length: 20 }).notNull().default("automatic"),
	// Whether shared schedule links show stock status (Critical/Low/Normal) to intake users
	shareStockStatus: integer("share_stock_status", { mode: "boolean" }).notNull().default(true),
	// Last notification tracking (intake reminders)
	lastAutoEmailSent: text("last_auto_email_sent"),
	lastNotificationType: text("last_notification_type"),
	lastNotificationChannel: text("last_notification_channel"),
	lastReminderMedName: text("last_reminder_med_name"),
	lastReminderTakenBy: text("last_reminder_taken_by"),
	// Last stock reminder tracking (separate from intake)
	lastStockReminderSent: text("last_stock_reminder_sent"),
	lastStockReminderChannel: text("last_stock_reminder_channel"),
	lastStockReminderMedNames: text("last_stock_reminder_med_names"),
	// Last prescription reminder tracking (separate from stock/intake)
	lastPrescriptionReminderSent: text("last_prescription_reminder_sent"),
	lastPrescriptionReminderChannel: text("last_prescription_reminder_channel"),
	lastPrescriptionReminderMedNames: text("last_prescription_reminder_med_names"),
	// Timestamps
	updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`CURRENT_TIMESTAMP`),
});

// =============================================================================
// Refresh Tokens - For JWT rotation
// =============================================================================
export const refreshTokens = sqliteTable("refresh_tokens", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	userId: integer("user_id")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	tokenId: text("token_id", { length: 255 }).notNull().unique(),
	expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
	rotatedAt: integer("rotated_at", { mode: "timestamp" }),
	revoked: integer("revoked", { mode: "boolean" }).notNull().default(false),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`CURRENT_TIMESTAMP`),
});

// =============================================================================
// Share Tokens - For public schedule sharing by takenBy person
// =============================================================================
export const shareTokens = sqliteTable("share_tokens", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	userId: integer("user_id")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	token: text("token", { length: 64 }).notNull().unique(),
	takenBy: text("taken_by", { length: 100 }).notNull(),
	scheduleDays: integer("schedule_days").notNull().default(30),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`CURRENT_TIMESTAMP`),
	expiresAt: integer("expires_at", { mode: "timestamp" }), // NULL = never expires
});

// =============================================================================
// Dose Tracking - Tracks when doses are marked as taken
// =============================================================================
export const doseTracking = sqliteTable("dose_tracking", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	userId: integer("user_id")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	doseId: text("dose_id", { length: 255 }).notNull(), // e.g. "med-5-1-86400000-1735200000000"
	takenAt: integer("taken_at", { mode: "timestamp" }).notNull().default(sql`(strftime('%s','now'))`),
	markedBy: text("marked_by", { length: 100 }), // null = user, "Daniel" = via share link
	dismissed: integer("dismissed", { mode: "boolean" }).notNull().default(false), // true = missed dose acknowledged without taking
});

// =============================================================================
// Refill History - Tracks when medication stock was refilled
// =============================================================================
export const refillHistory = sqliteTable("refill_history", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	medicationId: integer("medication_id")
		.notNull()
		.references(() => medications.id, { onDelete: "cascade" }),
	userId: integer("user_id")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	packsAdded: integer("packs_added").notNull().default(0),
	loosePillsAdded: integer("loose_pills_added").notNull().default(0),
	usedPrescription: integer("used_prescription", { mode: "boolean" }).notNull().default(false),
	refillDate: integer("refill_date", { mode: "timestamp" }).notNull().default(sql`(strftime('%s','now'))`),
});
