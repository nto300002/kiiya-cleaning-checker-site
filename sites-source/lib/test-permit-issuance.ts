import {reportRetryGuard} from './report-retry-guard.ts';
type Issue = {requestId:string;jobId:string;permitId:string;reportId:string;operatorId:string;reason:string;expectedGeneration:number;expiresAt:number;testAccountId:string;testRoomId:string;trialWorkerSubject:string; ownerId?:string; ownerRevision?:number};
const now = "CAST(strftime('%s','now') AS INTEGER)*1000";

// The caller authenticates the operator and supplies destination IDs from
// server configuration. Never use a destination supplied by the requester.
export async function issueTestPermit(db:D1Database,input:Issue):Promise<{jobId:string;permitId:string}|null>{
 if(!input.requestId || !input.jobId || !input.permitId || !input.reportId || !input.operatorId || !input.reason.trim() || input.reason.length>500 || !input.testAccountId || !input.testRoomId || !input.trialWorkerSubject || !Number.isSafeInteger(input.expectedGeneration) || !Number.isSafeInteger(input.expiresAt)) return null;
 const existing=await db.prepare(`SELECT j.id AS jobId,p.id AS permitId FROM chatwork_delivery_jobs j JOIN chatwork_test_permits p ON p.job_id=j.id
   JOIN chatwork_delivery_control_audit a ON a.action='test-permit-issue' AND json_extract(a.after_json,'$.permitId')=p.id
   WHERE j.request_id=? AND j.delivery_mode='test' AND j.report_id=? AND p.account_id=? AND p.room_id=? AND p.worker_subject=? AND p.approval_generation=? AND p.expires_at=? AND a.operator_id=? AND a.reason=?`)
   .bind(input.requestId,input.reportId,input.testAccountId,input.testRoomId,input.trialWorkerSubject,input.expectedGeneration,input.expiresAt,input.operatorId,input.reason.trim()).first<{jobId:string;permitId:string}>();
 if(existing)return {jobId:existing.jobId,permitId:existing.permitId};
 const auditId=crypto.randomUUID();
 // Candidate materialization is part of the same transaction as issuance.
 // The candidate's ID becomes the immutable report ID, so no second report can
 // be substituted between the operator's approval and the staff confirmation.
 const report=db.prepare(`INSERT OR IGNORE INTO report_versions(id,work_id,sequence,format,status,body,snapshot_json,created_at)
  SELECT c.id,c.work_id,COALESCE((SELECT MAX(sequence) FROM report_versions WHERE work_id=c.work_id),0)+1,CASE json_extract(c.snapshot_json,'$.deliveryFormat') WHEN 'pdf' THEN 'pdf' ELSE 'markdown' END,'Prepared',c.body,c.snapshot_json,datetime('now')
  FROM report_snapshot_candidates c JOIN works w ON w.id=c.work_id AND w.owner_id=c.actor_id AND w.revision=c.work_revision
  JOIN app_users u ON u.id=c.actor_id AND u.active=1 AND u.role IN ('normal','field') AND u.staff_revision=c.staff_revision
  WHERE c.id=? AND c.status='Active' AND (? IS NULL OR c.actor_id=?) AND (? IS NULL OR c.staff_revision=?)`).bind(input.reportId,input.ownerId??null,input.ownerId??null,input.ownerRevision??null,input.ownerRevision??null);
 const latest=db.prepare(`UPDATE works SET latest_report_id=? WHERE id=(SELECT work_id FROM report_snapshot_candidates WHERE id=? AND status='Active')
  AND EXISTS (SELECT 1 FROM report_snapshot_candidates c JOIN report_versions r ON r.id=c.id AND r.work_id=c.work_id
    JOIN app_users u ON u.id=c.actor_id AND u.active=1 AND u.role IN ('normal','field') AND u.staff_revision=c.staff_revision
    WHERE c.id=? AND c.status='Active' AND c.work_id=works.id AND c.actor_id=works.owner_id AND c.work_revision=works.revision
    AND r.body=c.body AND r.snapshot_json=c.snapshot_json AND r.status='Prepared' AND r.format=CASE json_extract(r.snapshot_json,'$.deliveryFormat') WHEN 'pdf' THEN 'pdf' ELSE 'markdown' END) AND ${reportRetryGuard}`)
  .bind(input.reportId,input.reportId,input.reportId);
 const job=db.prepare(`INSERT OR IGNORE INTO chatwork_delivery_jobs(id,kind,request_id,report_id,work_id,actor_id,actor_staff_revision,settings_version,account_id,room_id,room_name,status,delivery_mode,created_at,updated_at)
  SELECT ?,'ReportDelivery',?,r.id,w.id,u.id,u.staff_revision,s.version,s.account_id,s.room_id,s.room_name,'TestAwaitingRegistration','test',datetime('now'),datetime('now')
  FROM report_versions r JOIN works w ON w.id=r.work_id AND w.latest_report_id=r.id JOIN app_users u ON u.id=w.owner_id
  JOIN chatwork_production_settings s ON s.id='production' JOIN chatwork_delivery_runtime rt ON rt.id='production'
  WHERE r.id=? AND r.status='Prepared' AND r.format=CASE json_extract(r.snapshot_json,'$.deliveryFormat') WHEN 'pdf' THEN 'pdf' ELSE 'markdown' END AND u.active=1 AND u.role IN ('normal','field')
    AND (? IS NULL OR u.id=?) AND (? IS NULL OR u.staff_revision=?)
    AND NOT EXISTS (SELECT 1 FROM report_snapshot_candidates c WHERE c.id=r.id AND NOT COALESCE(
      c.status='Active' AND c.work_id=w.id AND c.actor_id=u.id AND c.work_revision=w.revision AND c.staff_revision=u.staff_revision
      AND c.body=r.body AND c.snapshot_json=r.snapshot_json,0))
    AND s.account_id=? AND s.room_id=? AND s.account_confirmed=1 AND s.destination_verified=1 AND s.paused=0 AND s.status='DestinationVerified' AND s.token_cipher IS NOT NULL
    AND rt.approved=1 AND rt.report_approved=0 AND rt.approval_generation=? AND rt.worker_subject=? AND rt.worker_revision IS NOT NULL AND rt.site_revision IS NOT NULL
    AND rt.last_healthy_heartbeat_at>=${now}-180000 AND ?>${now} AND ?<=${now}+3600000
    AND EXISTS (SELECT 1 FROM chatwork_delivery_control_audit a WHERE a.action='approve' AND json_extract(a.after_json,'$.subject')=rt.worker_subject
      AND json_extract(a.after_json,'$.generation')=rt.approval_generation AND json_extract(a.after_json,'$.workerRevision')=rt.worker_revision
      AND json_extract(a.after_json,'$.siteRevision')=rt.site_revision AND json_extract(a.after_json,'$.imageDigest') IS NOT NULL)`)
  .bind(input.jobId,input.requestId,input.reportId,input.ownerId??null,input.ownerId??null,input.ownerRevision??null,input.ownerRevision??null,input.testAccountId,input.testRoomId,input.expectedGeneration,input.trialWorkerSubject,input.expiresAt,input.expiresAt);
 const permit=db.prepare(`INSERT INTO chatwork_test_permits(id,job_id,actor_id,staff_revision,report_id,account_id,room_id,settings_version,worker_subject,worker_revision,site_revision,approval_generation,image_digest,expires_at,status,updated_at)
  SELECT ?,j.id,j.actor_id,j.actor_staff_revision,j.report_id,j.account_id,j.room_id,j.settings_version,rt.worker_subject,rt.worker_revision,rt.site_revision,rt.approval_generation,
  (SELECT json_extract(a.after_json,'$.imageDigest') FROM chatwork_delivery_control_audit a WHERE a.action='approve' AND json_extract(a.after_json,'$.subject')=rt.worker_subject AND json_extract(a.after_json,'$.generation')=rt.approval_generation AND json_extract(a.after_json,'$.workerRevision')=rt.worker_revision AND json_extract(a.after_json,'$.siteRevision')=rt.site_revision LIMIT 1),?,'Active',datetime('now')
  FROM chatwork_delivery_jobs j JOIN chatwork_delivery_runtime rt ON rt.id='production' WHERE j.id=? AND j.request_id=? AND j.status='TestAwaitingRegistration' AND j.delivery_mode='test'`)
  .bind(input.permitId,input.expiresAt,input.jobId,input.requestId);
 const audit=db.prepare(`INSERT INTO chatwork_delivery_control_audit(id,action,operator_id,reason,before_json,after_json,created_at)
  SELECT ?,'test-permit-issue',?,?,'{}',?,datetime('now') WHERE EXISTS (SELECT 1 FROM chatwork_test_permits WHERE id=? AND job_id=?)`)
  .bind(auditId,input.operatorId,input.reason.trim(),JSON.stringify({permitId:input.permitId,jobId:input.jobId}),input.permitId,input.jobId);
 // Constraint failure aborts the entire batch if any dependent row is missing.
 const assertComplete=db.prepare(`UPDATE chatwork_delivery_jobs SET delivery_mode='invalid' WHERE id=? AND request_id=? AND (NOT EXISTS (SELECT 1 FROM chatwork_test_permits WHERE id=? AND job_id=?) OR NOT EXISTS (SELECT 1 FROM chatwork_delivery_control_audit WHERE id=?))`)
  .bind(input.jobId,input.requestId,input.permitId,input.jobId,auditId);
 const assertCandidate=db.prepare(`UPDATE report_snapshot_candidates SET status='invalid' WHERE id=? AND status='Active'
  AND EXISTS (SELECT 1 FROM report_versions WHERE id=report_snapshot_candidates.id)
  AND NOT EXISTS (SELECT 1 FROM chatwork_test_permits p JOIN chatwork_delivery_jobs j ON j.id=p.job_id WHERE p.id=? AND j.id=? AND j.report_id=report_snapshot_candidates.id)`)
  .bind(input.reportId,input.permitId,input.jobId);
 try {
  const result=await db.batch([report,latest,job,permit,audit,assertComplete,assertCandidate]);
  return result[2].meta.changes && result[3].meta.changes && result[4].meta.changes ? {jobId:input.jobId,permitId:input.permitId} : null;
 } catch(error) {
  if(error instanceof Error && error.message.includes('report_snapshot_candidate_status'))return null;
  throw error;
 }
}
