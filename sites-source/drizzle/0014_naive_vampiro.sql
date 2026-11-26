CREATE TABLE `report_snapshot_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`work_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`work_revision` integer NOT NULL,
	`staff_revision` integer NOT NULL,
	`fingerprint` text NOT NULL,
	`body` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "report_snapshot_candidate_status" CHECK("report_snapshot_candidates"."status" IN ('Active','Closed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `report_snapshot_one_active` ON `report_snapshot_candidates` (`work_id`,`actor_id`) WHERE "report_snapshot_candidates"."status" = 'Active';--> statement-breakpoint
CREATE TABLE `report_snapshot_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`work_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`work_revision` integer NOT NULL,
	`fingerprint` text,
	`status` text NOT NULL,
	`candidate_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `report_snapshot_candidates`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "report_snapshot_request_status" CHECK(("report_snapshot_requests"."status" = 'Linked' AND "report_snapshot_requests"."candidate_id" IS NOT NULL AND "report_snapshot_requests"."fingerprint" IS NOT NULL) OR ("report_snapshot_requests"."status" = 'Fenced' AND "report_snapshot_requests"."candidate_id" IS NULL AND "report_snapshot_requests"."fingerprint" IS NULL))
);
--> statement-breakpoint
CREATE TRIGGER report_snapshot_candidate_immutable BEFORE UPDATE OF id,work_id,actor_id,work_revision,staff_revision,fingerprint,body,snapshot_json,created_at ON report_snapshot_candidates
BEGIN SELECT RAISE(ABORT,'snapshot content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER report_snapshot_request_immutable BEFORE UPDATE ON report_snapshot_requests
BEGIN SELECT RAISE(ABORT,'snapshot request is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER report_snapshot_request_no_delete BEFORE DELETE ON report_snapshot_requests
BEGIN SELECT RAISE(ABORT,'snapshot request fence is retained'); END;
--> statement-breakpoint
CREATE TRIGGER report_snapshot_candidate_no_reactivate BEFORE UPDATE OF status ON report_snapshot_candidates
WHEN OLD.status <> 'Active' AND NEW.status <> OLD.status
BEGIN SELECT RAISE(ABORT,'snapshot cannot be reactivated'); END;
