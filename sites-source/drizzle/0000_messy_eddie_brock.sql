CREATE TABLE `images` (
	`id` text PRIMARY KEY NOT NULL,
	`work_id` text NOT NULL,
	`object_key` text NOT NULL,
	`file_name` text NOT NULL,
	`mime` text NOT NULL,
	`bytes` integer NOT NULL,
	`uploaded_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `master_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`applicant_id` text NOT NULL,
	`approver_name` text NOT NULL,
	`reason` text NOT NULL,
	`status` text NOT NULL,
	`candidate_json` text NOT NULL,
	`editor_ids_json` text NOT NULL,
	`reviewer_id` text,
	`reviewed_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `master_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`version` integer NOT NULL,
	`data_json` text NOT NULL,
	`effective_day` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `report_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`work_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`format` text NOT NULL,
	`status` text NOT NULL,
	`body` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reports_work_sequence_unique` ON `report_versions` (`work_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `app_users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text DEFAULT 'staff' NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `work_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`work_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`revision` integer NOT NULL,
	`before_json` text,
	`after_json` text NOT NULL,
	`changed_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `works` (
	`id` text PRIMARY KEY NOT NULL,
	`day` text NOT NULL,
	`owner_id` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'Draft' NOT NULL,
	`data_json` text NOT NULL,
	`first_pressed_at` text,
	`latest_report_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `works_owner_day_unique` ON `works` (`owner_id`,`day`);