CREATE TABLE `as_needed_intake_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` text(36) NOT NULL,
	`user_id` integer NOT NULL,
	`medication_id` integer NOT NULL,
	`dose_tracking_id` integer NOT NULL,
	`idempotency_key_hash` text(64) NOT NULL,
	`request_fingerprint` text(64) NOT NULL,
	`occurred_at` integer NOT NULL,
	`recorded_at` integer NOT NULL,
	`quantity_milli` integer NOT NULL,
	`quantity_unit` text(20) NOT NULL,
	`person_name` text(100) DEFAULT '' NOT NULL,
	`source` text(30) DEFAULT 'owner_as_needed' NOT NULL,
	`status` text(20) DEFAULT 'active' NOT NULL,
	`stock_effect_milli` integer DEFAULT 0 NOT NULL,
	`stock_effect_reason` text(40) DEFAULT 'applied' NOT NULL,
	`stock_cutoff_at` integer DEFAULT 0 NOT NULL,
	`replaces_event_id` integer,
	`reversed_at` integer,
	`reversal_idempotency_key_hash` text(64),
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` integer DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`medication_id`) REFERENCES `medications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`dose_tracking_id`) REFERENCES `dose_tracking`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`replaces_event_id`) REFERENCES `as_needed_intake_events`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "as_needed_intake_events_quantity_positive" CHECK("as_needed_intake_events"."quantity_milli" > 0),
	CONSTRAINT "as_needed_intake_events_effect_nonnegative" CHECK("as_needed_intake_events"."stock_effect_milli" >= 0),
	CONSTRAINT "as_needed_intake_events_status_valid" CHECK("as_needed_intake_events"."status" IN ('active', 'reversed')),
	CONSTRAINT "as_needed_intake_events_unit_valid" CHECK("as_needed_intake_events"."quantity_unit" IN ('pills', 'ml', 'puffs', 'injections', 'application')),
	CONSTRAINT "as_needed_intake_events_reason_valid" CHECK("as_needed_intake_events"."stock_effect_reason" IN ('applied', 'non_measurable', 'before_correction', 'superseded_by_correction')),
	CONSTRAINT "as_needed_intake_events_reversal_state_valid" CHECK(("as_needed_intake_events"."status" = 'active' AND "as_needed_intake_events"."reversed_at" IS NULL) OR ("as_needed_intake_events"."status" = 'reversed' AND "as_needed_intake_events"."reversed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `as_needed_intake_events_event_id_unique` ON `as_needed_intake_events` (`event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `as_needed_intake_events_anchor_unique` ON `as_needed_intake_events` (`dose_tracking_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `as_needed_intake_events_owner_key_unique` ON `as_needed_intake_events` (`user_id`,`idempotency_key_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `as_needed_intake_events_owner_reversal_key_unique` ON `as_needed_intake_events` (`user_id`,`reversal_idempotency_key_hash`) WHERE "as_needed_intake_events"."reversal_idempotency_key_hash" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `as_needed_intake_events_replacement_unique` ON `as_needed_intake_events` (`replaces_event_id`) WHERE "as_needed_intake_events"."replaces_event_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `as_needed_intake_events_medication_occurred_idx` ON `as_needed_intake_events` (`user_id`,`medication_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `as_needed_intake_events_owner_status_occurred_idx` ON `as_needed_intake_events` (`user_id`,`status`,`occurred_at`);