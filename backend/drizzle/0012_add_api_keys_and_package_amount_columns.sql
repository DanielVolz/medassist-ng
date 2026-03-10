CREATE TABLE `api_keys` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`name` text(100) NOT NULL,
	`key_hash` text(128) NOT NULL,
	`token_prefix` text(24) DEFAULT '' NOT NULL,
	`scope` text(10) DEFAULT 'write' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`last_used_at` integer,
	`expires_at` integer,
	`created_at` integer DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` integer DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_key_hash_unique` ON `api_keys` (`key_hash`);--> statement-breakpoint
ALTER TABLE `medications` ADD `package_amount_value` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `medications` ADD `package_amount_unit` text(10) DEFAULT 'ml' NOT NULL;