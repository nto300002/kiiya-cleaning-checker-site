ALTER TABLE chatwork_delivery_runtime ADD COLUMN worker_subject TEXT;
--> statement-breakpoint
ALTER TABLE chatwork_delivery_runtime ADD COLUMN approval_generation INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TABLE chatwork_delivery_control_audit (
  id TEXT PRIMARY KEY NOT NULL,
  action TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE chatwork_delivery_monitor_runs (
  run_id TEXT PRIMARY KEY NOT NULL,
  nonce TEXT NOT NULL,
  created_at TEXT NOT NULL
);
