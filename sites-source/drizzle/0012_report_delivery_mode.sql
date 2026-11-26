ALTER TABLE chatwork_delivery_jobs ADD COLUMN delivery_mode TEXT NOT NULL DEFAULT 'production'
  CHECK (delivery_mode IN ('production','test') AND (delivery_mode <> 'test' OR kind = 'ReportDelivery'));
--> statement-breakpoint
CREATE TRIGGER chatwork_delivery_job_mode_immutable
BEFORE UPDATE OF delivery_mode ON chatwork_delivery_jobs
WHEN NEW.delivery_mode <> OLD.delivery_mode
BEGIN SELECT RAISE(ABORT,'delivery mode is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER chatwork_delivery_job_test_kind_immutable
BEFORE UPDATE OF kind ON chatwork_delivery_jobs
WHEN OLD.delivery_mode='test' AND NEW.kind<>'ReportDelivery'
BEGIN SELECT RAISE(ABORT,'test delivery requires report job'); END;
