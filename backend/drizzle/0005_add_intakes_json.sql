-- Add dose_unit column and intakes JSON array for per-intake takenBy support
ALTER TABLE `medications` ADD `dose_unit` text(20) DEFAULT 'mg';--> statement-breakpoint
ALTER TABLE `medications` ADD `intakes_json` text DEFAULT '[]' NOT NULL;