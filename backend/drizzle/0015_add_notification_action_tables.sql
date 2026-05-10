CREATE TABLE `notification_action_groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`group_key` text(255) NOT NULL,
	`sequence_id` text(255) NOT NULL,
	`dose_ids_json` text NOT NULL,
	`title` text(255) NOT NULL,
	`message` text NOT NULL,
	`language` text(10) DEFAULT 'en' NOT NULL,
	`scheduled_for` integer,
	`expires_at` integer NOT NULL,
	`resolved_action` text(20),
	`resolved_at` integer,
	`created_at` integer DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` integer DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_action_groups_group_key_unique` ON `notification_action_groups` (`group_key`);--> statement-breakpoint
CREATE TABLE `notification_action_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`group_id` integer NOT NULL,
	`token_hash` text(128) NOT NULL,
	`kind` text(20) NOT NULL,
	`used_at` integer,
	`created_at` integer DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `notification_action_groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_action_tokens_token_hash_unique` ON `notification_action_tokens` (`token_hash`);