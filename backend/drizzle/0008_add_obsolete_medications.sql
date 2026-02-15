ALTER TABLE `medications` ADD `is_obsolete` integer DEFAULT false NOT NULL;
ALTER TABLE `medications` ADD `obsolete_at` integer;