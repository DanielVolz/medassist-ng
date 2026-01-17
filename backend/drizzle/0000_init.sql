CREATE TABLE `dose_tracking` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`dose_id` text(255) NOT NULL,
	`taken_at` integer DEFAULT (strftime('%s','now')) NOT NULL,
	`marked_by` text(100),
	`dismissed` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `medications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`name` text(100) NOT NULL,
	`generic_name` text(100),
	`taken_by_json` text DEFAULT '[]' NOT NULL,
	`pack_count` integer DEFAULT 1 NOT NULL,
	`blisters_per_pack` integer DEFAULT 1 NOT NULL,
	`pills_per_blister` integer DEFAULT 1 NOT NULL,
	`loose_tablets` integer DEFAULT 0 NOT NULL,
	`pill_weight_mg` integer,
	`usage_json` text DEFAULT '[]' NOT NULL,
	`every_json` text DEFAULT '[]' NOT NULL,
	`start_json` text DEFAULT '[]' NOT NULL,
	`image_url` text,
	`expiry_date` text,
	`notes` text,
	`intake_reminders_enabled` integer DEFAULT false NOT NULL,
	`updated_at` integer DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `refill_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`medication_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`packs_added` integer DEFAULT 0 NOT NULL,
	`loose_pills_added` integer DEFAULT 0 NOT NULL,
	`refill_date` integer DEFAULT (strftime('%s','now')) NOT NULL,
	FOREIGN KEY (`medication_id`) REFERENCES `medications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `refresh_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`token_id` text(255) NOT NULL,
	`expires_at` integer NOT NULL,
	`rotated_at` integer,
	`revoked` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `refresh_tokens_token_id_unique` ON `refresh_tokens` (`token_id`);--> statement-breakpoint
CREATE TABLE `share_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`token` text(64) NOT NULL,
	`taken_by` text(100) NOT NULL,
	`schedule_days` integer DEFAULT 30 NOT NULL,
	`created_at` integer DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`expires_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `share_tokens_token_unique` ON `share_tokens` (`token`);--> statement-breakpoint
CREATE TABLE `user_settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`email_enabled` integer DEFAULT false NOT NULL,
	`notification_email` text,
	`email_stock_reminders` integer DEFAULT true NOT NULL,
	`email_intake_reminders` integer DEFAULT true NOT NULL,
	`shoutrrr_enabled` integer DEFAULT false NOT NULL,
	`shoutrrr_url` text,
	`shoutrrr_stock_reminders` integer DEFAULT true NOT NULL,
	`shoutrrr_intake_reminders` integer DEFAULT true NOT NULL,
	`reminder_days_before` integer DEFAULT 7 NOT NULL,
	`repeat_daily_reminders` integer DEFAULT false NOT NULL,
	`skip_reminders_for_taken_doses` integer DEFAULT false NOT NULL,
	`repeat_reminders_enabled` integer DEFAULT false NOT NULL,
	`reminder_repeat_interval_minutes` integer DEFAULT 30 NOT NULL,
	`max_nagging_reminders` integer DEFAULT 5 NOT NULL,
	`low_stock_days` integer DEFAULT 30 NOT NULL,
	`normal_stock_days` integer DEFAULT 90 NOT NULL,
	`high_stock_days` integer DEFAULT 180 NOT NULL,
	`expiry_warning_days` integer DEFAULT 90 NOT NULL,
	`language` text(10) DEFAULT 'en' NOT NULL,
	`stock_calculation_mode` text(20) DEFAULT 'automatic' NOT NULL,
	`last_auto_email_sent` text,
	`last_notification_type` text,
	`last_notification_channel` text,
	`updated_at` integer DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_settings_user_id_unique` ON `user_settings` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text(100) NOT NULL,
	`password_hash` text(255),
	`avatar_url` text(255),
	`auth_provider` text(50) DEFAULT 'local' NOT NULL,
	`oidc_subject` text(255),
	`is_active` integer DEFAULT true NOT NULL,
	`last_login_at` integer,
	`created_at` integer DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` integer DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);