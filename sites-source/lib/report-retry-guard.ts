// This predicate is evaluated inside the report-version update transaction.
// NULL or contradictory delivery state always blocks automatic recovery.
export const reportRetryGuard = `NOT EXISTS (
  SELECT 1 FROM chatwork_delivery_jobs old
  WHERE old.work_id=works.id AND old.kind='ReportDelivery'
    AND NOT COALESCE((
      (old.report_manifest_sealed=1
       AND EXISTS (SELECT 1 FROM chatwork_report_artifacts a WHERE a.job_id=old.id)
       AND (
         (old.status='Sent' AND NOT EXISTS (SELECT 1 FROM chatwork_report_artifacts a
           WHERE a.job_id=old.id AND (a.status<>'Sent' OR a.message_id IS NULL)))
         OR
         (old.status='Failed' AND old.error_code IN ('ACTOR_CHANGED','SETTINGS_CHANGED') AND old.message_id IS NULL
           AND old.lease_id IS NULL AND old.lease_until IS NULL
           AND NOT EXISTS (SELECT 1 FROM chatwork_report_artifacts a
             WHERE a.job_id=old.id AND (a.status<>'Pending' OR a.message_id IS NOT NULL)))
         OR
         (old.status='Failed' AND old.delivery_mode='test' AND old.error_code IN ('TEST_PERMIT_REVOKED_UNSENT','TEST_PERMIT_EXPIRED_UNSENT') AND old.message_id IS NULL AND old.lease_id IS NULL AND old.lease_until IS NULL
           AND NOT EXISTS (SELECT 1 FROM chatwork_report_artifacts a WHERE a.job_id=old.id AND (a.status<>'Pending' OR a.message_id IS NOT NULL)))
         OR
         (old.status='Failed' AND old.delivery_mode='test' AND old.error_code='MANUALLY_CONFIRMED_NOT_SENT' AND old.message_id IS NULL AND old.lease_id IS NULL AND old.lease_until IS NULL
           AND EXISTS (SELECT 1 FROM chatwork_delivery_events e WHERE e.job_id=old.id AND e.action='ReportIsolationConfirmed' AND json_extract(e.detail_json,'$.workerStopped')=1 AND json_extract(e.detail_json,'$.tokenInvalidated')=1 AND json_extract(e.detail_json,'$.requestsEnded')=1)
           AND NOT EXISTS (SELECT 1 FROM chatwork_report_artifacts a WHERE a.job_id=old.id AND (a.message_id IS NOT NULL OR NOT COALESCE(a.status='Pending' OR (a.status='Failed' AND a.error_code='MANUALLY_CONFIRMED_NOT_SENT'),0))))
       ))
      OR
      (old.report_manifest_sealed=0 AND old.status='Failed' AND old.delivery_mode='test' AND old.error_code IN ('TEST_PERMIT_REVOKED_UNSENT','TEST_PERMIT_EXPIRED_UNSENT') AND old.message_id IS NULL AND old.lease_id IS NULL AND old.lease_until IS NULL AND old.task_name IS NULL AND old.dispatch_attempted_at IS NULL AND NOT EXISTS (SELECT 1 FROM chatwork_report_artifacts a WHERE a.job_id=old.id))
      OR
      (old.report_manifest_sealed=0 AND old.status='Failed'
       AND old.error_code IN ('ACTOR_CHANGED_UNSEALED','SETTINGS_CHANGED_UNSEALED')
       AND old.message_id IS NULL AND old.lease_id IS NULL AND old.lease_until IS NULL
       AND old.task_name IS NULL AND old.dispatch_attempted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM chatwork_report_artifacts a WHERE a.job_id=old.id))
    ),0)
)`;
