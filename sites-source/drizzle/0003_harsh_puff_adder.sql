CREATE TABLE `chatwork_production_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`detail_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `chatwork_production_oauth_attempts` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`verifier_cipher` text NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `chatwork_production_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`control_revision` integer DEFAULT 0 NOT NULL,
	`account_id` text,
	`display_name` text,
	`account_confirmed` integer DEFAULT 0 NOT NULL,
	`room_id` text,
	`room_name` text,
	`destination_verified` integer DEFAULT 0 NOT NULL,
	`token_cipher` text,
	`token_expires_at` integer,
	`token_revision` integer DEFAULT 0 NOT NULL,
	`refresh_lease_until` integer,
	`status` text DEFAULT 'Unconfigured' NOT NULL,
	`paused` integer DEFAULT 0 NOT NULL,
	`account_confirmed_by` text,
	`account_confirmed_at` text,
	`room_confirmed_by` text,
	`room_confirmed_at` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `chatwork_room_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`account_id` text NOT NULL,
	`expected_version` integer NOT NULL,
	`room_id` text NOT NULL,
	`room_name` text NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `app_users` ADD `manage_chatwork` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `app_users` ADD `staff_revision` integer DEFAULT 1 NOT NULL;