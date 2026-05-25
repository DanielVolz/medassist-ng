ALTER TABLE `share_tokens` ADD `allow_mark_taken` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `share_tokens` ADD `last_used_at` integer;--> statement-breakpoint
ALTER TABLE `share_tokens` ADD `revoked_at` integer;
