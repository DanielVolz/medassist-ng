ALTER TABLE `medications` ADD `medication_form` text(20) DEFAULT 'tablet' NOT NULL;--> statement-breakpoint
ALTER TABLE `medications` ADD `pill_form` text(20);--> statement-breakpoint
ALTER TABLE `medications` ADD `lifecycle_category` text(30) DEFAULT 'refill_when_empty' NOT NULL;--> statement-breakpoint
ALTER TABLE `medications` ADD `medication_end_date` text;--> statement-breakpoint
ALTER TABLE `medications` ADD `auto_mark_obsolete_after_end_date` integer DEFAULT true NOT NULL;