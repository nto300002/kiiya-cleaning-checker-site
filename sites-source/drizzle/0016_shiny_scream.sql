CREATE TABLE `report_snapshot_confirmations` (
	`candidate_id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `report_snapshot_candidates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `report_snapshot_confirmations_job_id_unique` ON `report_snapshot_confirmations` (`job_id`);
--> statement-breakpoint
CREATE TRIGGER report_snapshot_confirmation_no_update BEFORE UPDATE ON report_snapshot_confirmations
BEGIN SELECT RAISE(ABORT,'snapshot confirmation is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER report_snapshot_confirmation_no_delete BEFORE DELETE ON report_snapshot_confirmations
BEGIN SELECT RAISE(ABORT,'snapshot confirmation is retained'); END;
