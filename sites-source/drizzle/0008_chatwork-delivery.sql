CREATE TABLE chatwork_delivery_runtime (
  id TEXT PRIMARY KEY NOT NULL,
  approved INTEGER NOT NULL DEFAULT 0,
  report_approved INTEGER NOT NULL DEFAULT 0,
  worker_revision TEXT,
  site_revision TEXT,
  last_healthy_heartbeat_at INTEGER,
  last_monitor_run_id TEXT,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
ALTER TABLE chatwork_production_settings ADD COLUMN verified_job_id TEXT;
--> statement-breakpoint
CREATE TABLE chatwork_delivery_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('DestinationVerification','ReportDelivery')),
  request_id TEXT UNIQUE,
  report_id TEXT UNIQUE,
  work_id TEXT,
  actor_id TEXT NOT NULL,
  actor_staff_revision INTEGER NOT NULL,
  settings_version INTEGER NOT NULL,
  account_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  room_name TEXT NOT NULL,
  status TEXT NOT NULL,
  marker TEXT,
  message_id TEXT,
  error_code TEXT,
  lease_id TEXT,
  lease_until INTEGER,
  task_name TEXT,
  dispatch_attempted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX chatwork_delivery_jobs_status ON chatwork_delivery_jobs(status,created_at);
--> statement-breakpoint
CREATE TABLE chatwork_delivery_events (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX chatwork_delivery_events_job_action ON chatwork_delivery_events(job_id,action);
