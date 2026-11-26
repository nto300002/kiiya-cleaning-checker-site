CREATE TABLE `report_snapshot_scopes` (
	`work_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`epoch` integer NOT NULL,
	CONSTRAINT "report_snapshot_scope_epoch" CHECK("report_snapshot_scopes"."epoch" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `report_snapshot_scope_unique` ON `report_snapshot_scopes` (`work_id`,`actor_id`);--> statement-breakpoint
CREATE TRIGGER report_snapshot_scope_no_decrease BEFORE UPDATE OF epoch ON report_snapshot_scopes
WHEN NEW.epoch <> OLD.epoch + 1
BEGIN SELECT RAISE(ABORT,'snapshot scope epoch must advance once'); END;
--> statement-breakpoint
CREATE TRIGGER report_snapshot_scope_no_delete BEFORE DELETE ON report_snapshot_scopes
BEGIN SELECT RAISE(ABORT,'snapshot scope is retained'); END;
--> statement-breakpoint
CREATE TRIGGER report_snapshot_close_fences_scope AFTER UPDATE OF status ON report_snapshot_candidates
WHEN OLD.status='Active' AND NEW.status='Closed'
BEGIN
  INSERT INTO report_snapshot_scopes(work_id,actor_id,epoch) VALUES(OLD.work_id,OLD.actor_id,1)
  ON CONFLICT(work_id,actor_id) DO UPDATE SET epoch=epoch+1;
END;
