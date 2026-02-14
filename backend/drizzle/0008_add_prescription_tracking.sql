ALTER TABLE `medications` ADD `prescription_enabled` integer NOT NULL DEFAULT 0;
ALTER TABLE `medications` ADD `prescription_authorized_refills` integer;
ALTER TABLE `medications` ADD `prescription_remaining_refills` integer;
ALTER TABLE `medications` ADD `prescription_low_refill_threshold` integer NOT NULL DEFAULT 1;
ALTER TABLE `medications` ADD `prescription_expiry_date` text;

ALTER TABLE `user_settings` ADD `email_prescription_reminders` integer NOT NULL DEFAULT 1;
ALTER TABLE `user_settings` ADD `shoutrrr_prescription_reminders` integer NOT NULL DEFAULT 1;
