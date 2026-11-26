CREATE TABLE `chatwork_report_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`kind` text NOT NULL,
	`source_id` text,
	`status` text NOT NULL,
	`message_id` text,
	`error_code` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `chatwork_delivery_jobs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "report_artifact_ordinal_valid" CHECK("chatwork_report_artifacts"."ordinal" >= 0),
	CONSTRAINT "report_artifact_kind_valid" CHECK("chatwork_report_artifacts"."kind" IN ('body','markdown','pdf','image')),
	CONSTRAINT "report_artifact_status_valid" CHECK("chatwork_report_artifacts"."status" IN ('Pending','Posting','Sent','Failed','Unknown')),
	CONSTRAINT "report_artifact_source_valid" CHECK(("chatwork_report_artifacts"."kind" IN ('body','markdown','pdf') AND "chatwork_report_artifacts"."source_id" IS NULL) OR ("chatwork_report_artifacts"."kind"='image' AND "chatwork_report_artifacts"."source_id" IS NOT NULL)),
	CONSTRAINT "report_artifact_message_valid" CHECK("chatwork_report_artifacts"."status"<>'Sent' OR "chatwork_report_artifacts"."message_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chatwork_report_artifacts_job_ordinal` ON `chatwork_report_artifacts` (`job_id`,`ordinal`);--> statement-breakpoint
CREATE INDEX `chatwork_report_artifacts_job_status` ON `chatwork_report_artifacts` (`job_id`,`status`,`ordinal`);--> statement-breakpoint
ALTER TABLE `chatwork_delivery_jobs` ADD `report_manifest_sealed` integer DEFAULT 0 NOT NULL CHECK (report_manifest_sealed IN (0,1));
--> statement-breakpoint
CREATE TRIGGER chatwork_report_artifacts_no_insert_after_seal
BEFORE INSERT ON chatwork_report_artifacts
WHEN EXISTS (SELECT 1 FROM chatwork_delivery_jobs j WHERE j.id=NEW.job_id AND j.report_manifest_sealed=1)
BEGIN SELECT RAISE(ABORT,'report manifest sealed'); END;
--> statement-breakpoint
CREATE TRIGGER chatwork_report_artifacts_no_delete_after_seal
BEFORE DELETE ON chatwork_report_artifacts
WHEN EXISTS (SELECT 1 FROM chatwork_delivery_jobs j WHERE j.id=OLD.job_id AND j.report_manifest_sealed=1)
BEGIN SELECT RAISE(ABORT,'report manifest sealed'); END;
--> statement-breakpoint
CREATE TRIGGER chatwork_report_artifacts_no_rewrite_after_seal
BEFORE UPDATE OF id,job_id,ordinal,kind,source_id ON chatwork_report_artifacts
WHEN EXISTS (SELECT 1 FROM chatwork_delivery_jobs j WHERE j.id IN (OLD.job_id,NEW.job_id) AND j.report_manifest_sealed=1)
BEGIN SELECT RAISE(ABORT,'report manifest sealed'); END;
--> statement-breakpoint
CREATE TRIGGER chatwork_report_manifest_no_unseal
BEFORE UPDATE OF report_manifest_sealed ON chatwork_delivery_jobs
WHEN OLD.report_manifest_sealed=1 AND NEW.report_manifest_sealed<>1
BEGIN SELECT RAISE(ABORT,'report manifest sealed'); END;
