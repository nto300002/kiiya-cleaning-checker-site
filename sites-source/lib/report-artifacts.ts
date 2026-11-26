type ArtifactAccess = {
  jobId: string; artifactId: string; leaseId: string;
  subject: string; generation: number; now: number;
};

// A claim is a one-way boundary: once Posting, only a recorded outcome or
// explicit reconciliation can move it forward. In particular, Unknown is not retried.
export async function claimReportArtifact(db: D1Database, input: ArtifactAccess): Promise<boolean> {
  const result = await db.prepare(`UPDATE chatwork_report_artifacts SET status='Posting',updated_at=?
    WHERE id=? AND job_id=? AND status='Pending'
      AND NOT EXISTS (SELECT 1 FROM chatwork_report_artifacts earlier
        WHERE earlier.job_id=chatwork_report_artifacts.job_id
          AND earlier.ordinal<chatwork_report_artifacts.ordinal AND earlier.status<>'Sent')
      AND NOT EXISTS (SELECT 1 FROM chatwork_report_artifacts other
        WHERE other.job_id=chatwork_report_artifacts.job_id AND other.status IN ('Posting','Unknown','Failed'))
      AND EXISTS (SELECT 1 FROM chatwork_delivery_jobs j
        JOIN chatwork_production_settings s ON s.id='production'
        JOIN chatwork_delivery_runtime r ON r.id='production'
        JOIN app_users u ON u.id=j.actor_id JOIN works w ON w.id=j.work_id AND w.owner_id=u.id
        WHERE j.id=chatwork_report_artifacts.job_id AND j.kind='ReportDelivery' AND j.delivery_mode='production'
          AND j.report_manifest_sealed=1 AND j.status='Posting' AND j.lease_id=? AND j.lease_until>?
          AND s.version=j.settings_version AND s.account_id=j.account_id AND s.room_id=j.room_id AND s.paused=0
          AND u.active=1 AND u.role='field' AND u.staff_revision=j.actor_staff_revision
          AND r.approved=1 AND r.report_approved=1 AND r.worker_subject=? AND r.approval_generation=?)`)
    .bind(new Date(input.now).toISOString(),input.artifactId,input.jobId,input.leaseId,input.now,input.subject,input.generation).run();
  return !!result.meta.changes;
}

export async function finishReportArtifact(db: D1Database, input: ArtifactAccess & {
  status: "Sent" | "Failed" | "Unknown"; messageId: string | null; errorCode?: string | null;
}): Promise<boolean> {
  if (input.status === "Sent" && !input.messageId) return false;
  const result = await db.prepare(`UPDATE chatwork_report_artifacts SET status=?,message_id=?,error_code=?,updated_at=?
    WHERE id=? AND job_id=? AND status='Posting'
      AND EXISTS (SELECT 1 FROM chatwork_delivery_jobs j JOIN chatwork_delivery_runtime r ON r.id='production'
        WHERE j.id=chatwork_report_artifacts.job_id AND j.kind='ReportDelivery' AND j.delivery_mode='production'
          AND j.status='Posting' AND j.lease_id=? AND j.lease_until>?
          AND r.approved=1 AND r.worker_subject=? AND r.approval_generation=?)`)
    .bind(input.status,input.messageId,input.errorCode ?? null,new Date(input.now).toISOString(),input.artifactId,input.jobId,input.leaseId,input.now,input.subject,input.generation).run();
  return !!result.meta.changes;
}
