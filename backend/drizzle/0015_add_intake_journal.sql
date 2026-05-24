CREATE TABLE `intake_journal` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`dose_tracking_id` integer NOT NULL,
	`medication_id` integer NOT NULL,
	`scheduled_for` integer NOT NULL,
	`note` text NOT NULL,
	`created_at` integer DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` integer DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`dose_tracking_id`) REFERENCES `dose_tracking`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`medication_id`) REFERENCES `medications`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `intake_journal_dose_tracking_id_unique` ON `intake_journal` (`dose_tracking_id`);
