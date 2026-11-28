import { integer, sqliteTable, text, uniqueIndex, index, check } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const users = sqliteTable("app_users", {
  id: text("id").primaryKey(), email: text("email").notNull(),
  displayName: text("display_name").notNull(), role: text("role").notNull().default("normal"),
  active: integer("active").notNull().default(1), manageChatwork: integer("manage_chatwork").notNull().default(0),
  staffRevision: integer("staff_revision").notNull().default(1), createdAt: text("created_at").notNull(),
});
export const staffNameChanges = sqliteTable("staff_name_changes", {
  id: text("id").primaryKey(), staffId: text("staff_id").notNull(), actorId: text("actor_id").notNull(),
  beforeName: text("before_name").notNull(), afterName: text("after_name").notNull(), changedAt: text("changed_at").notNull(),
});
export const staffRoleChanges = sqliteTable("staff_role_changes", {
  id: text("id").primaryKey(), staffId: text("staff_id").notNull(), actorId: text("actor_id").notNull(),
  beforeRole: text("before_role").notNull(), afterRole: text("after_role").notNull(), changedAt: text("changed_at").notNull(),
});
export const staffRegistrationRequests = sqliteTable("staff_registration_requests", {
  id: text("id").primaryKey(), email: text("email").notNull(), displayName: text("display_name").notNull(),
  firstSeenAt: text("first_seen_at").notNull(), lastSeenAt: text("last_seen_at").notNull(),
  approvalId: text("approval_id"), approvedBy: text("approved_by"), approvedAt: text("approved_at"),
});
export const works = sqliteTable("works", {
  id: text("id").primaryKey(), day: text("day").notNull(), ownerId: text("owner_id").notNull(),
  revision: integer("revision").notNull().default(1), status: text("status").notNull().default("Draft"),
  dataJson: text("data_json").notNull(), firstPressedAt: text("first_pressed_at"),
  latestReportId: text("latest_report_id"), createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, (table) => ({ ownerDay: uniqueIndex("works_owner_day_unique").on(table.ownerId, table.day) }));
export const workChanges = sqliteTable("work_changes", {
  id: text("id").primaryKey(), workId: text("work_id").notNull(), actorId: text("actor_id").notNull(),
  revision: integer("revision").notNull(), beforeJson: text("before_json"),
  afterJson: text("after_json").notNull(), changedAt: text("changed_at").notNull(),
}, (table) => ({ workRevision: uniqueIndex("work_changes_work_revision_unique").on(table.workId, table.revision) }));
export const images = sqliteTable("images", {
  id: text("id").primaryKey(), workId: text("work_id").notNull(), objectKey: text("object_key").notNull(),
  fileName: text("file_name").notNull(), mime: text("mime").notNull(), bytes: integer("bytes").notNull(), uploadedAt: text("uploaded_at").notNull(),
});
export const reports = sqliteTable("report_versions", {
  id: text("id").primaryKey(), workId: text("work_id").notNull(), sequence: integer("sequence").notNull(),
  format: text("format").notNull(), status: text("status").notNull(), body: text("body").notNull(),
  snapshotJson: text("snapshot_json").notNull(), createdAt: text("created_at").notNull(),
}, (table) => ({ workSequence: uniqueIndex("reports_work_sequence_unique").on(table.workId, table.sequence) }));
export const reportSnapshotCandidates = sqliteTable("report_snapshot_candidates", {
  id: text("id").primaryKey(), workId: text("work_id").notNull(), actorId: text("actor_id").notNull(),
  workRevision: integer("work_revision").notNull(), staffRevision: integer("staff_revision").notNull(),
  fingerprint: text("fingerprint").notNull(), body: text("body").notNull(), snapshotJson: text("snapshot_json").notNull(),
  status: text("status").notNull(), createdAt: text("created_at").notNull(),
}, table => [uniqueIndex("report_snapshot_one_active").on(table.workId,table.actorId).where(sql`${table.status} = 'Active'`),
  check("report_snapshot_candidate_status",sql`${table.status} IN ('Active','Closed')`)]);
export const reportSnapshotRequests = sqliteTable("report_snapshot_requests", {
  id: text("id").primaryKey(), workId: text("work_id").notNull(), actorId: text("actor_id").notNull(),
  workRevision: integer("work_revision").notNull(), fingerprint: text("fingerprint"), status: text("status").notNull(),
  candidateId: text("candidate_id").references(()=>reportSnapshotCandidates.id), createdAt: text("created_at").notNull(),
},table=>[check("report_snapshot_request_status",sql`(${table.status} = 'Linked' AND ${table.candidateId} IS NOT NULL AND ${table.fingerprint} IS NOT NULL) OR (${table.status} = 'Fenced' AND ${table.candidateId} IS NULL AND ${table.fingerprint} IS NULL)`)]);
export const reportSnapshotScopes = sqliteTable("report_snapshot_scopes", {
  workId:text("work_id").notNull(), actorId:text("actor_id").notNull(), epoch:integer("epoch").notNull(),
},table=>[uniqueIndex("report_snapshot_scope_unique").on(table.workId,table.actorId),check("report_snapshot_scope_epoch",sql`${table.epoch} > 0`)]);
export const reportSnapshotConfirmations = sqliteTable("report_snapshot_confirmations", {
  candidateId:text("candidate_id").primaryKey().references(()=>reportSnapshotCandidates.id),
  jobId:text("job_id").notNull().unique(), actorId:text("actor_id").notNull(), createdAt:text("created_at").notNull(),
});
export const masterRevisions = sqliteTable("master_revisions", {
  id: text("id").primaryKey(), version: integer("version").notNull(), dataJson: text("data_json").notNull(),
  effectiveDay: text("effective_day").notNull(), createdAt: text("created_at").notNull(),
});
export const masterChanges = sqliteTable("master_changes", {
  id: text("id").primaryKey(), applicantId: text("applicant_id").notNull(), approverName: text("approver_name").notNull(),
  reason: text("reason").notNull(), status: text("status").notNull(), candidateJson: text("candidate_json").notNull(),
  editorIdsJson: text("editor_ids_json").notNull(), reviewerId: text("reviewer_id"), reviewedAt: text("reviewed_at"), createdAt: text("created_at").notNull(),
});
export const chatworkOauthAttempts = sqliteTable("chatwork_oauth_attempts", {
  stateHash: text("state_hash").primaryKey(), actorId: text("actor_id").notNull(),
  verifierCipher: text("verifier_cipher").notNull(), expiresAt: integer("expires_at").notNull(),
  consumedAt: text("consumed_at"), createdAt: text("created_at").notNull(),
});
export const chatworkSmokeConnection = sqliteTable("chatwork_smoke_connection", {
  id: text("id").primaryKey(), revision: integer("revision").notNull().default(1),
  accountId: text("account_id"), displayName: text("display_name"), accountConfirmed: integer("account_confirmed").notNull().default(0),
  roomId: text("room_id"), roomName: text("room_name"), roomConfirmed: integer("room_confirmed").notNull().default(0),
  tokenCipher: text("token_cipher"), tokenExpiresAt: integer("token_expires_at"), refreshLeaseUntil: integer("refresh_lease_until"),
  status: text("status").notNull().default("Disconnected"), lastVerifiedAt: text("last_verified_at"), updatedAt: text("updated_at").notNull(),
});
export const chatworkSmokePosts = sqliteTable("chatwork_smoke_posts", {
  requestId: text("request_id").primaryKey(), actorId: text("actor_id").notNull(), marker: text("marker").notNull(),
  status: text("status").notNull(), messageId: text("message_id"), errorCode: text("error_code"),
  createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
});
export const chatworkProductionSettings = sqliteTable("chatwork_production_settings", {
  id: text("id").primaryKey(), version: integer("version").notNull().default(0), controlRevision: integer("control_revision").notNull().default(0),
  accountId: text("account_id"), displayName: text("display_name"), accountConfirmed: integer("account_confirmed").notNull().default(0),
  roomId: text("room_id"), roomName: text("room_name"), destinationVerified: integer("destination_verified").notNull().default(0),
  tokenCipher: text("token_cipher"), tokenExpiresAt: integer("token_expires_at"), tokenRevision: integer("token_revision").notNull().default(0), refreshLeaseUntil: integer("refresh_lease_until"),
  status: text("status").notNull().default("Unconfigured"), paused: integer("paused").notNull().default(0), verifiedJobId: text("verified_job_id"),
  accountConfirmedBy: text("account_confirmed_by"), accountConfirmedAt: text("account_confirmed_at"), roomConfirmedBy: text("room_confirmed_by"), roomConfirmedAt: text("room_confirmed_at"), updatedAt: text("updated_at").notNull(),
});
export const chatworkProductionOauthAttempts = sqliteTable("chatwork_production_oauth_attempts", {
  stateHash: text("state_hash").primaryKey(), actorId: text("actor_id").notNull(), verifierCipher: text("verifier_cipher").notNull(), expiresAt: integer("expires_at").notNull(), consumedAt: text("consumed_at"), createdAt: text("created_at").notNull(),
});
export const chatworkRoomCandidates = sqliteTable("chatwork_room_candidates", {
  id: text("id").primaryKey(), actorId: text("actor_id").notNull(), accountId: text("account_id").notNull(), expectedVersion: integer("expected_version").notNull(), roomId: text("room_id").notNull(), roomName: text("room_name").notNull(), expiresAt: integer("expires_at").notNull(), consumedAt: text("consumed_at"), createdAt: text("created_at").notNull(),
});
export const chatworkProductionAudit = sqliteTable("chatwork_production_audit", {
  id: text("id").primaryKey(), actorId: text("actor_id").notNull(), action: text("action").notNull(), detailJson: text("detail_json").notNull(), createdAt: text("created_at").notNull(),
});
export const chatworkDeliveryRuntime = sqliteTable("chatwork_delivery_runtime", {
  id: text("id").primaryKey(), approved: integer("approved").notNull().default(0), reportApproved: integer("report_approved").notNull().default(0),
  workerRevision: text("worker_revision"), siteRevision: text("site_revision"),
  workerSubject: text("worker_subject"), approvalGeneration: integer("approval_generation").notNull().default(0),
  lastHealthyHeartbeatAt: integer("last_healthy_heartbeat_at"), lastMonitorRunId: text("last_monitor_run_id"), updatedAt: text("updated_at").notNull(),
});
export const chatworkDeliveryJobs = sqliteTable("chatwork_delivery_jobs", {
  id: text("id").primaryKey(), kind: text("kind").notNull(), requestId: text("request_id").unique(),
  reportId: text("report_id").unique(), workId: text("work_id"), actorId: text("actor_id").notNull(),
  actorStaffRevision: integer("actor_staff_revision").notNull(), settingsVersion: integer("settings_version").notNull(),
  accountId: text("account_id").notNull(), roomId: text("room_id").notNull(), roomName: text("room_name").notNull(),
  status: text("status").notNull(), marker: text("marker"), messageId: text("message_id"), errorCode: text("error_code"),
  deliveryMode: text("delivery_mode").notNull().default("production"),
  leaseId: text("lease_id"), leaseUntil: integer("lease_until"), taskName: text("task_name"),
  reportManifestSealed: integer("report_manifest_sealed").notNull().default(0),
  dispatchAttemptedAt: text("dispatch_attempted_at"), createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, table => [check("report_manifest_sealed_valid", sql`${table.reportManifestSealed} IN (0,1)`), check("delivery_mode_valid", sql`${table.deliveryMode} IN ('production','test') AND (${table.deliveryMode}<>'test' OR ${table.kind}='ReportDelivery')`)]);
export const chatworkReportArtifacts = sqliteTable("chatwork_report_artifacts", {
  id: text("id").primaryKey().notNull(),
  jobId: text("job_id").notNull().references(() => chatworkDeliveryJobs.id),
  ordinal: integer("ordinal").notNull(),
  kind: text("kind").notNull(),
  sourceId: text("source_id"),
  status: text("status").notNull(),
  messageId: text("message_id"),
  errorCode: text("error_code"),
  updatedAt: text("updated_at").notNull(),
}, table => [
  uniqueIndex("chatwork_report_artifacts_job_ordinal").on(table.jobId, table.ordinal),
  index("chatwork_report_artifacts_job_status").on(table.jobId, table.status, table.ordinal),
  check("report_artifact_ordinal_valid", sql`${table.ordinal} >= 0`),
  check("report_artifact_kind_valid", sql`${table.kind} IN ('body','markdown','pdf','image')`),
  check("report_artifact_status_valid", sql`${table.status} IN ('Pending','Posting','Sent','Failed','Unknown')`),
  check("report_artifact_source_valid", sql`(${table.kind} IN ('body','markdown','pdf') AND ${table.sourceId} IS NULL) OR (${table.kind}='image' AND ${table.sourceId} IS NOT NULL)`),
  check("report_artifact_message_valid", sql`${table.status}<>'Sent' OR ${table.messageId} IS NOT NULL`),
]);

export const chatworkReportPreparedFiles = sqliteTable("chatwork_report_prepared_files", {
  artifactId: text("artifact_id").primaryKey().notNull().references(() => chatworkReportArtifacts.id),
  objectKey: text("object_key").notNull().unique(), sha256: text("sha256").notNull(),
  bytes: integer("bytes").notNull(), mime: text("mime").notNull(), fileName: text("file_name"), createdAt: text("created_at").notNull(),
}, table => [check("report_prepared_bytes_valid", sql`${table.bytes} > 0 AND ${table.bytes} <= 5000000`)]);

export const chatworkDeliveryEvents = sqliteTable("chatwork_delivery_events", {
  id: text("id").primaryKey(), jobId: text("job_id").notNull(), actorId: text("actor_id").notNull(),
  action: text("action").notNull(), detailJson: text("detail_json").notNull(), createdAt: text("created_at").notNull(),
});

export const chatworkDeliveryControlAudit = sqliteTable("chatwork_delivery_control_audit", {
  id: text("id").primaryKey(), action: text("action").notNull(), operatorId: text("operator_id").notNull(), reason: text("reason").notNull(), beforeJson: text("before_json").notNull(), afterJson: text("after_json").notNull(), createdAt: text("created_at").notNull(),
});
export const chatworkDeliveryMonitorRuns = sqliteTable("chatwork_delivery_monitor_runs", {
  runId: text("run_id").primaryKey(), nonce: text("nonce").notNull(), createdAt: text("created_at").notNull(),
});

// A separate, one-job test permit. Runtime issuance and operator authentication
// are implemented separately and must never enable normal report delivery.
export const chatworkTestPermits = sqliteTable("chatwork_test_permits", {
  id: text("id").primaryKey().notNull(),
  jobId: text("job_id").notNull().references(() => chatworkDeliveryJobs.id),
  actorId: text("actor_id").notNull(),
  staffRevision: integer("staff_revision").notNull(),
  reportId: text("report_id").notNull(),
  accountId: text("account_id").notNull(),
  roomId: text("room_id").notNull(),
  settingsVersion: integer("settings_version").notNull(),
  workerSubject: text("worker_subject").notNull(),
  workerRevision: text("worker_revision").notNull(),
  siteRevision: text("site_revision").notNull(),
  approvalGeneration: integer("approval_generation").notNull(),
  imageDigest: text("image_digest").notNull(),
  expiresAt: integer("expires_at").notNull(),
  status: text("status").notNull(),
  updatedAt: text("updated_at").notNull(),
}, table => [
  uniqueIndex("chatwork_test_permits_job_unique").on(table.jobId),
  check("chatwork_test_permits_status_valid", sql`${table.status} IN ('Active','Revoked','Expired')`),
]);

export const appSessions = sqliteTable("app_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id").notNull(),
  email: text("email").notNull().default(""),
  displayName: text("display_name").notNull().default(""),
  lastActivityMs: integer("last_activity_ms").notNull(),
  createdAtMs: integer("created_at_ms").notNull(),
}, table => [index("app_sessions_user_id_idx").on(table.userId)]);

export const oauthStates = sqliteTable("oauth_states", {
  stateHash: text("state_hash").primaryKey(),
  browserTokenHash: text("browser_token_hash").notNull(),
  nonce: text("nonce").notNull(),
  codeVerifier: text("code_verifier").notNull(),
  returnTo: text("return_to").notNull(),
  expiresAtMs: integer("expires_at_ms").notNull(),
  createdAtMs: integer("created_at_ms").notNull(),
}, table => [index("oauth_states_expires_at_idx").on(table.expiresAtMs)]);

export const staffIdentities = sqliteTable("staff_identities", {
  googleSub: text("google_sub").primaryKey(),
  userId: text("user_id").notNull(),
  email: text("email").notNull().default(""),
  createdAt: text("created_at").notNull(),
}, table => [index("staff_identities_user_id_idx").on(table.userId)]);
