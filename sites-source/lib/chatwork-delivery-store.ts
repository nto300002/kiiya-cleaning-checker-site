import { createReportManifest } from "./report-manifest.ts";
export type DeliveryJob = {
  id: string; kind: "DestinationVerification" | "ReportDelivery"; request_id: string | null;
  report_id: string | null; work_id: string | null; actor_id: string; actor_staff_revision: number;
  settings_version: number; account_id: string; room_id: string; room_name: string;
  status: string; marker: string | null; message_id: string | null; error_code: string | null;
  lease_id: string | null; lease_until: number | null; task_name: string | null;
  created_at: string; updated_at: string;
};
type VerificationInput = { actorId: string; staffRevision: number; expectedVersion: number; requestId: string; jobId: string; marker: string; now: number };
type ReportInput = { actorId: string; staffRevision: number; expectedVersion: number; reportId: string; workId: string; jobId: string; now: number };

function timestamp(now: number) { return new Date(now).toISOString(); }

export async function createVerification(db: D1Database, input: VerificationInput): Promise<DeliveryJob | null> {
  const existing = await db.prepare("SELECT * FROM chatwork_delivery_jobs WHERE request_id=?").bind(input.requestId).first<DeliveryJob>();
  if (existing) return existing.actor_id === input.actorId && existing.kind === "DestinationVerification" ? existing : null;
  const saved = await db.prepare(`INSERT OR IGNORE INTO chatwork_delivery_jobs
    (id,kind,request_id,actor_id,actor_staff_revision,settings_version,account_id,room_id,room_name,status,marker,created_at,updated_at)
    SELECT ?,'DestinationVerification',?,u.id,u.staff_revision,s.version,s.account_id,s.room_id,s.room_name,'DispatchPending',?,?,?
    FROM chatwork_production_settings s JOIN app_users u ON u.id=? JOIN chatwork_delivery_runtime r ON r.id='production'
    WHERE s.id='production' AND s.version=? AND s.account_confirmed=1 AND s.account_id IS NOT NULL
      AND s.room_id IS NOT NULL AND s.paused=0 AND s.status IN ('DestinationVerificationRequired','DestinationVerified')
      AND u.active=1 AND u.role='field' AND u.staff_revision=?
      AND r.approved=1 AND r.worker_subject IS NOT NULL AND r.approval_generation>0 AND r.worker_revision IS NOT NULL AND r.site_revision IS NOT NULL
      AND r.last_healthy_heartbeat_at>=?
      AND NOT EXISTS (SELECT 1 FROM chatwork_delivery_jobs j WHERE j.kind='DestinationVerification'
        AND j.status IN ('DispatchPending','Dispatched','Posting','Unknown'))`)
    .bind(input.jobId, input.requestId, input.marker, timestamp(input.now), timestamp(input.now), input.actorId, input.expectedVersion, input.staffRevision, input.now - 180_000).run();
  if (!saved.meta.changes) {
    const raced = await db.prepare("SELECT * FROM chatwork_delivery_jobs WHERE request_id=?").bind(input.requestId).first<DeliveryJob>();
    return raced?.actor_id === input.actorId && raced?.kind === "DestinationVerification" ? raced : null;
  }
  return db.prepare("SELECT * FROM chatwork_delivery_jobs WHERE id=?").bind(input.jobId).first<DeliveryJob>();
}

// Record reconciliation and change state in the same D1 batch. Only an Unknown
// verification and an active field staff member can create the unique event.
export async function reconcileVerification(db: D1Database, input: { id: string; actorId: string; staffRevision: number; marker: string; outcome: "Sent" | "NotSent"; messageId: string | null; now: number }): Promise<boolean> {
  const eventId = crypto.randomUUID(), at = timestamp(input.now);
  const detail = JSON.stringify({ outcome: input.outcome, messageId: input.messageId });
  const results = await db.batch([
    db.prepare(`INSERT OR IGNORE INTO chatwork_delivery_events (id,job_id,actor_id,action,detail_json,created_at)
      SELECT ?,j.id,u.id,'UnknownReconciled',?,? FROM chatwork_delivery_jobs j JOIN app_users u ON u.id=?
      WHERE j.id=? AND j.kind='DestinationVerification' AND j.status='Unknown' AND j.marker=?
      AND (j.error_code IS NULL OR j.error_code<>'WORKER_REVOKED' OR (j.lease_until IS NOT NULL AND j.lease_until<=?))
      AND (? <> 'NotSent' AND (j.error_code IS NULL OR j.error_code<>'WORKER_REVOKED') OR EXISTS (SELECT 1 FROM chatwork_delivery_events e WHERE e.job_id=j.id AND e.action='WorkerIsolationConfirmedV2' AND json_extract(e.detail_json,'$.workerStopped')=1 AND json_extract(e.detail_json,'$.tokenInvalidated')=1 AND json_extract(e.detail_json,'$.requestsEnded')=1))
      AND u.active=1 AND u.role='field' AND u.staff_revision=?`)
      .bind(eventId, detail, at, input.actorId, input.id, input.marker, input.now, input.outcome, input.staffRevision),
    db.prepare(`UPDATE chatwork_delivery_jobs SET status=?,message_id=?,error_code=?,lease_until=NULL,updated_at=?
      WHERE id=? AND kind='DestinationVerification' AND status='Unknown'
      AND EXISTS (SELECT 1 FROM chatwork_delivery_events WHERE id=? AND job_id=chatwork_delivery_jobs.id)`)
      .bind(input.outcome === "Sent" ? "Sent" : "Failed", input.messageId, input.outcome === "NotSent" ? "MANUALLY_CONFIRMED_NOT_SENT" : null, at, input.id, eventId),
  ]);
  return !!results[0].meta.changes && !!results[1].meta.changes;
}

export async function confirmVerification(db: D1Database, input: { id: string; actorId: string; staffRevision: number; expectedVersion: number; now: number }): Promise<boolean> {
  const at = timestamp(input.now), eventId = crypto.randomUUID();
  const result = await db.batch([
    db.prepare(`UPDATE chatwork_production_settings SET destination_verified=1,status='DestinationVerified',verified_job_id=?,version=version+1,updated_at=?
      WHERE id='production' AND version=? AND paused=0 AND account_confirmed=1 AND EXISTS (
        SELECT 1 FROM chatwork_delivery_jobs j JOIN app_users u ON u.id=? WHERE j.id=? AND j.kind='DestinationVerification'
        AND j.status='Sent' AND j.message_id IS NOT NULL AND j.actor_id=u.id AND j.actor_staff_revision=u.staff_revision
        AND u.active=1 AND u.role='field' AND u.staff_revision=? AND j.settings_version=chatwork_production_settings.version
        AND j.account_id=chatwork_production_settings.account_id AND j.room_id=chatwork_production_settings.room_id
      )`).bind(input.id, at, input.expectedVersion, input.actorId, input.id, input.staffRevision),
    db.prepare(`INSERT OR IGNORE INTO chatwork_delivery_events (id,job_id,actor_id,action,detail_json,created_at)
      SELECT ?,?,?,'DestinationConfirmed','{}',? FROM chatwork_production_settings
      WHERE id='production' AND verified_job_id=? AND version=?`)
      .bind(eventId, input.id, input.actorId, at, input.id, input.expectedVersion + 1),
  ]);
  return !!result[0].meta.changes;
}

export async function createReportDelivery(db: D1Database, input: ReportInput): Promise<DeliveryJob | null> {
  const existingForActor = () => db.prepare(`SELECT j.* FROM chatwork_delivery_jobs j
    JOIN works w ON w.id=j.work_id JOIN app_users u ON u.id=w.owner_id
    WHERE j.report_id=? AND j.work_id=? AND j.actor_id=? AND u.id=? AND j.delivery_mode='production'
      AND u.active=1 AND u.role='field' AND u.staff_revision=?
      AND j.actor_staff_revision=u.staff_revision`)
    .bind(input.reportId, input.workId, input.actorId, input.actorId, input.staffRevision).first<DeliveryJob>();
  const prepare = async (job: DeliveryJob | null | undefined) => {
    if (!job) return null;
    const sealed = await createReportManifest(db,{jobId:job.id,actorId:input.actorId,staffRevision:input.staffRevision,now:input.now});
    return sealed ? job : null;
  };
  const existing = await existingForActor();
  if (existing) return prepare(existing);
  const saved = await db.prepare(`INSERT OR IGNORE INTO chatwork_delivery_jobs
    (id,kind,report_id,work_id,actor_id,actor_staff_revision,settings_version,account_id,room_id,room_name,status,created_at,updated_at)
    SELECT ?,'ReportDelivery',r.id,w.id,u.id,u.staff_revision,s.version,s.account_id,s.room_id,s.room_name,'DispatchPending',?,?
    FROM report_versions r JOIN works w ON w.id=r.work_id JOIN app_users u ON u.id=w.owner_id
    JOIN chatwork_production_settings s ON s.id='production' JOIN chatwork_delivery_runtime rt ON rt.id='production'
    WHERE r.id=? AND w.id=? AND w.latest_report_id=r.id AND r.status='Prepared'
      AND u.id=? AND u.active=1 AND u.role='field' AND u.staff_revision=?
      AND s.version=? AND s.destination_verified=1 AND s.status='DestinationVerified' AND s.paused=0
      AND s.account_id IS NOT NULL AND s.room_id IS NOT NULL
      AND rt.approved=1 AND rt.report_approved=1 AND rt.worker_revision IS NOT NULL AND rt.site_revision IS NOT NULL
      AND rt.last_healthy_heartbeat_at>=?`)
    .bind(input.jobId, timestamp(input.now), timestamp(input.now), input.reportId, input.workId, input.actorId, input.staffRevision, input.expectedVersion, input.now - 180_000).run();
  if (!saved.meta.changes) {
    return prepare(await existingForActor());
  }
  return prepare(await db.prepare("SELECT * FROM chatwork_delivery_jobs WHERE id=?").bind(input.jobId).first<DeliveryJob>());
}

// An unsealed job is safe to retire only before any dispatch or artifact exists.
// Sealed jobs require a complete, untouched manifest. All ambiguous states stay
// blocked for reconciliation, including contradictory artifact message IDs.
export async function invalidateObsoleteReportJobs(db: D1Database, now: number, identity: { subject: string; generation: number }): Promise<void> {
  await db.prepare(`UPDATE chatwork_delivery_jobs SET status='Failed',
      error_code=CASE WHEN EXISTS (SELECT 1 FROM app_users u JOIN works w ON w.id=chatwork_delivery_jobs.work_id WHERE u.id=chatwork_delivery_jobs.actor_id AND w.owner_id=u.id AND u.active=1 AND u.role='field' AND u.staff_revision=chatwork_delivery_jobs.actor_staff_revision)
        THEN CASE WHEN report_manifest_sealed=0 THEN 'SETTINGS_CHANGED_UNSEALED' ELSE 'SETTINGS_CHANGED' END
        ELSE CASE WHEN report_manifest_sealed=0 THEN 'ACTOR_CHANGED_UNSEALED' ELSE 'ACTOR_CHANGED' END END,updated_at=?
    WHERE kind='ReportDelivery' AND status IN ('DispatchPending','Dispatched')
      AND lease_id IS NULL AND lease_until IS NULL AND message_id IS NULL
      AND (
        (report_manifest_sealed=0 AND status='DispatchPending'
          AND task_name IS NULL AND dispatch_attempted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM chatwork_report_artifacts a WHERE a.job_id=chatwork_delivery_jobs.id))
        OR
        (report_manifest_sealed=1
          AND EXISTS (SELECT 1 FROM chatwork_report_artifacts a WHERE a.job_id=chatwork_delivery_jobs.id)
          AND NOT EXISTS (SELECT 1 FROM chatwork_report_artifacts a
            WHERE a.job_id=chatwork_delivery_jobs.id AND (a.status<>'Pending' OR a.message_id IS NOT NULL)))
      )
      AND (NOT EXISTS (SELECT 1 FROM app_users u JOIN works w ON w.id=chatwork_delivery_jobs.work_id
        WHERE u.id=chatwork_delivery_jobs.actor_id AND w.owner_id=u.id
          AND u.active=1 AND u.role='field' AND u.staff_revision=chatwork_delivery_jobs.actor_staff_revision)
        OR NOT EXISTS (SELECT 1 FROM chatwork_production_settings s WHERE s.id='production' AND s.version=chatwork_delivery_jobs.settings_version AND s.account_id=chatwork_delivery_jobs.account_id AND s.room_id=chatwork_delivery_jobs.room_id))
      AND EXISTS (SELECT 1 FROM chatwork_delivery_runtime r WHERE r.id='production'
        AND r.approved=1 AND r.worker_subject=? AND r.approval_generation=?)`)
    .bind(timestamp(now),identity.subject,identity.generation).run();
}

// Only invalidate jobs that have not been claimed; Posting may already have reached Chatwork.
export async function invalidateObsoleteVerifications(db: D1Database, now: number, id?: string, identity?: { subject: string; generation: number }): Promise<void> {
  const filter = id ? " AND chatwork_delivery_jobs.id=?" : "";
  const guard = identity ? " AND EXISTS (SELECT 1 FROM chatwork_delivery_runtime WHERE id='production' AND approved=1 AND worker_subject=? AND approval_generation=?)" : "";
  const query = db.prepare(`UPDATE chatwork_delivery_jobs SET status='Failed',error_code='SETTINGS_OR_ACTOR_CHANGED',updated_at=?
    WHERE kind='DestinationVerification' AND status IN ('DispatchPending','Dispatched')${filter}
    AND NOT EXISTS (SELECT 1 FROM chatwork_production_settings s JOIN app_users u ON u.id=chatwork_delivery_jobs.actor_id
      WHERE s.id='production' AND s.version=chatwork_delivery_jobs.settings_version
      AND s.account_id=chatwork_delivery_jobs.account_id AND s.room_id=chatwork_delivery_jobs.room_id
      AND u.active=1 AND u.role='field' AND u.staff_revision=chatwork_delivery_jobs.actor_staff_revision)${guard}`);
  const args = id ? [timestamp(now), id] : [timestamp(now)];
  await (identity ? query.bind(...args, identity.subject, identity.generation) : query.bind(...args)).run();
}

export async function claimDelivery(db: D1Database, input: { id: string; leaseId: string; now: number; subject?: string; generation?: number }): Promise<DeliveryJob | null> {
  const identityGuard = input.subject ? " AND r.worker_subject=? AND r.approval_generation=?" : "";
  const statement = db.prepare(`UPDATE chatwork_delivery_jobs SET status='Posting',lease_id=?,lease_until=?,updated_at=?
    WHERE id=? AND delivery_mode='production' AND status IN ('DispatchPending','Dispatched') AND EXISTS (
      SELECT 1 FROM chatwork_production_settings s JOIN app_users u ON u.id=chatwork_delivery_jobs.actor_id
      JOIN chatwork_delivery_runtime r ON r.id='production' WHERE s.id='production'
      AND s.version=chatwork_delivery_jobs.settings_version AND s.account_id=chatwork_delivery_jobs.account_id
      AND s.room_id=chatwork_delivery_jobs.room_id AND s.paused=0 AND u.active=1 AND u.role='field'
      AND u.staff_revision=chatwork_delivery_jobs.actor_staff_revision AND r.approved=1
      AND r.last_healthy_heartbeat_at>=? AND (chatwork_delivery_jobs.kind='DestinationVerification' OR (s.destination_verified=1 AND r.report_approved=1 AND chatwork_delivery_jobs.report_manifest_sealed=1))${identityGuard}
    )`);
  const args = [input.leaseId, input.now + 300_000, timestamp(input.now), input.id, input.now - 180_000];
  const result = await (input.subject ? statement.bind(...args, input.subject, input.generation) : statement.bind(...args)).run();
  if (!result.meta.changes) return null;
  return db.prepare("SELECT * FROM chatwork_delivery_jobs WHERE id=?").bind(input.id).first<DeliveryJob>();
}

export async function finishArtifact(db: D1Database, input: { id: string; leaseId: string; status: "Sent" | "Failed" | "Unknown"; messageId: string | null; now: number; errorCode?: string | null; identity?: { subject: string; generation: number } }): Promise<boolean> {
  if (input.status === "Sent" && !input.messageId) return false;
  const guard = input.identity ? " AND EXISTS (SELECT 1 FROM chatwork_delivery_runtime WHERE id='production' AND approved=1 AND worker_subject=? AND approval_generation=?)" : "";
  const statement = db.prepare(`UPDATE chatwork_delivery_jobs SET status=?,message_id=?,error_code=?,lease_id=NULL,lease_until=NULL,updated_at=? WHERE id=? AND status='Posting' AND lease_id=? AND lease_until>?${guard}`);
  const args = [input.status, input.messageId, input.errorCode ?? null, timestamp(input.now), input.id, input.leaseId, input.now];
  const result = await (input.identity ? statement.bind(...args, input.identity.subject, input.identity.generation) : statement.bind(...args)).run();
  return !!result.meta.changes;
}
