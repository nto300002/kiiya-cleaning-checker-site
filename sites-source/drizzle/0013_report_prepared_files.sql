CREATE TABLE `chatwork_report_prepared_files` (
	`artifact_id` text PRIMARY KEY NOT NULL,
	`object_key` text NOT NULL,
	`sha256` text NOT NULL,
	`bytes` integer NOT NULL,
	`mime` text NOT NULL,
	`file_name` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`artifact_id`) REFERENCES `chatwork_report_artifacts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "report_prepared_bytes_valid" CHECK("chatwork_report_prepared_files"."bytes" > 0 AND "chatwork_report_prepared_files"."bytes" <= 5000000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chatwork_report_prepared_files_object_key_unique` ON `chatwork_report_prepared_files` (`object_key`);--> statement-breakpoint
CREATE TRIGGER chatwork_report_prepared_files_no_update BEFORE UPDATE ON chatwork_report_prepared_files
BEGIN SELECT RAISE(ABORT,'prepared file is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER chatwork_report_prepared_files_no_delete BEFORE DELETE ON chatwork_report_prepared_files
BEGIN SELECT RAISE(ABORT,'prepared file is retained'); END;
