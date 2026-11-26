CREATE TABLE `chatwork_test_permits` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`staff_revision` integer NOT NULL,
	`report_id` text NOT NULL,
	`account_id` text NOT NULL,
	`room_id` text NOT NULL,
	`settings_version` integer NOT NULL,
	`worker_subject` text NOT NULL,
	`worker_revision` text NOT NULL,
	`site_revision` text NOT NULL,
	`approval_generation` integer NOT NULL,
	`image_digest` text NOT NULL,
	`expires_at` integer NOT NULL,
	`status` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `chatwork_delivery_jobs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chatwork_test_permits_status_valid" CHECK("chatwork_test_permits"."status" IN ('Active','Revoked','Expired'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chatwork_test_permits_job_unique` ON `chatwork_test_permits` (`job_id`);
--> statement-breakpoint
CREATE TRIGGER chatwork_test_permit_no_rebind
BEFORE UPDATE OF id,job_id,actor_id,staff_revision,report_id,account_id,room_id,settings_version,worker_subject,worker_revision,site_revision,approval_generation,image_digest,expires_at ON chatwork_test_permits
BEGIN SELECT RAISE(ABORT,'test permit binding is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER chatwork_test_permit_no_reactivate
BEFORE UPDATE OF status ON chatwork_test_permits
WHEN OLD.status<>'Active' AND NEW.status<>OLD.status
BEGIN SELECT RAISE(ABORT,'test permit is closed'); END;
--> statement-breakpoint
CREATE TRIGGER chatwork_test_permit_no_delete
BEFORE DELETE ON chatwork_test_permits
BEGIN SELECT RAISE(ABORT,'test permit is retained for audit'); END;
