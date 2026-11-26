CREATE TABLE `chatwork_oauth_attempts` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`verifier_cipher` text NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `chatwork_smoke_connection` (
	`id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`account_id` text,
	`display_name` text,
	`account_confirmed` integer DEFAULT 0 NOT NULL,
	`room_id` text,
	`room_name` text,
	`room_confirmed` integer DEFAULT 0 NOT NULL,
	`token_cipher` text,
	`token_expires_at` integer,
	`refresh_lease_until` integer,
	`status` text DEFAULT 'Disconnected' NOT NULL,
	`last_verified_at` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `chatwork_smoke_posts` (
	`request_id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`marker` text NOT NULL,
	`status` text NOT NULL,
	`message_id` text,
	`error_code` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
