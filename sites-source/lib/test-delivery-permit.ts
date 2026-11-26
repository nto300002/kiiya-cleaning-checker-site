type Access = { permitId:string; jobId:string; artifactId:string; leaseId:string; subject:string; generation:number };
type Control = { permitId:string; operatorId:string; reason:string; expectedGeneration:number; ownerId?:string; ownerRevision?:number };
type ExpiryControl = Control & { subject:string };
const dbNow = "CAST(strftime('%s','now') AS INTEGER)*1000";

export async function claimTestJob(db:D1Database,input:{jobId:string;leaseId:string;subject:string;generation:number}):Promise<boolean>{
 const result=await db.prepare(`UPDATE chatwork_delivery_jobs SET status='Posting',lease_id=?,lease_until=${dbNow}+300000,updated_at=datetime('now')
  WHERE id=? AND kind='ReportDelivery' AND delivery_mode='test' AND report_manifest_sealed=1 AND status IN ('DispatchPending','Dispatched')
  AND EXISTS(SELECT 1 FROM chatwork_report_artifacts WHERE job_id=chatwork_delivery_jobs.id AND kind='body')
  AND EXISTS(SELECT 1 FROM chatwork_report_artifacts WHERE job_id=chatwork_delivery_jobs.id AND kind='markdown')
  AND EXISTS(SELECT 1 FROM chatwork_report_artifacts WHERE job_id=chatwork_delivery_jobs.id AND kind='pdf')
  AND NOT EXISTS(SELECT 1 FROM chatwork_report_artifacts a WHERE a.job_id=chatwork_delivery_jobs.id AND NOT EXISTS(SELECT 1 FROM chatwork_report_prepared_files f WHERE f.artifact_id=a.id))
  AND EXISTS(SELECT 1 FROM chatwork_test_permits p JOIN chatwork_production_settings s ON s.id='production'
   JOIN chatwork_delivery_runtime r ON r.id='production' JOIN app_users u ON u.id=p.actor_id JOIN works w ON w.id=chatwork_delivery_jobs.work_id AND w.owner_id=u.id
   WHERE p.job_id=chatwork_delivery_jobs.id AND p.status='Active' AND p.expires_at>${dbNow}
   AND p.report_id=chatwork_delivery_jobs.report_id AND p.actor_id=chatwork_delivery_jobs.actor_id AND p.staff_revision=chatwork_delivery_jobs.actor_staff_revision
   AND u.active=1 AND u.role='field' AND u.staff_revision=p.staff_revision
   AND p.account_id=chatwork_delivery_jobs.account_id AND p.room_id=chatwork_delivery_jobs.room_id AND p.settings_version=chatwork_delivery_jobs.settings_version
   AND s.account_id=p.account_id AND s.room_id=p.room_id AND s.version=p.settings_version AND s.paused=0
   AND r.approved=1 AND r.report_approved=0 AND r.worker_subject=p.worker_subject AND r.worker_subject=? AND r.approval_generation=p.approval_generation AND r.approval_generation=?
   AND r.worker_revision=p.worker_revision AND r.site_revision=p.site_revision AND r.last_healthy_heartbeat_at>=${dbNow}-180000
   AND EXISTS(SELECT 1 FROM chatwork_delivery_control_audit a WHERE a.action='approve' AND json_extract(a.after_json,'$.subject')=p.worker_subject AND json_extract(a.after_json,'$.generation')=p.approval_generation AND json_extract(a.after_json,'$.workerRevision')=p.worker_revision AND json_extract(a.after_json,'$.siteRevision')=p.site_revision AND json_extract(a.after_json,'$.imageDigest')=p.image_digest))`)
 .bind(input.leaseId,input.jobId,input.subject,input.generation).run();
 return !!result.meta.changes;
}

export async function completeTestJob(db:D1Database,input:{jobId:string;leaseId:string;subject:string;generation:number}):Promise<boolean>{
 const result=await db.prepare(`UPDATE chatwork_delivery_jobs SET status='Sent',lease_id=NULL,lease_until=NULL,updated_at=datetime('now')
 WHERE id=? AND kind='ReportDelivery' AND delivery_mode='test' AND status='Posting' AND lease_id=? AND lease_until>${dbNow} AND report_manifest_sealed=1
 AND EXISTS(SELECT 1 FROM chatwork_report_artifacts WHERE job_id=chatwork_delivery_jobs.id)
 AND EXISTS(SELECT 1 FROM chatwork_report_artifacts WHERE job_id=chatwork_delivery_jobs.id AND kind='body')
 AND EXISTS(SELECT 1 FROM chatwork_report_artifacts WHERE job_id=chatwork_delivery_jobs.id AND kind='markdown')
 AND EXISTS(SELECT 1 FROM chatwork_report_artifacts WHERE job_id=chatwork_delivery_jobs.id AND kind='pdf')
 AND NOT EXISTS(SELECT 1 FROM chatwork_report_artifacts a WHERE a.job_id=chatwork_delivery_jobs.id AND (a.status<>'Sent' OR a.message_id IS NULL))
 AND EXISTS(SELECT 1 FROM chatwork_test_permits p JOIN chatwork_delivery_runtime r ON r.id='production'
 WHERE p.job_id=chatwork_delivery_jobs.id AND p.status='Active' AND p.expires_at>${dbNow} AND r.approved=1 AND r.report_approved=0
 AND r.worker_subject=p.worker_subject AND r.worker_subject=? AND r.approval_generation=p.approval_generation AND r.approval_generation=?)`)
 .bind(input.jobId,input.leaseId,input.subject,input.generation).run();
 return !!result.meta.changes;
}

// DB time and the permit's exact job/actor/destination/approved worker bind the
// preparation transition. The HTTP POST itself is not atomic with this update.
export async function claimTestArtifact(db:D1Database,input:Access):Promise<boolean> {
  const result=await db.prepare(`UPDATE chatwork_report_artifacts SET status='Posting',updated_at=datetime('now')
    WHERE id=? AND job_id=? AND status='Pending' AND message_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM chatwork_report_artifacts a WHERE a.job_id=chatwork_report_artifacts.job_id
        AND ((a.ordinal<chatwork_report_artifacts.ordinal AND a.status<>'Sent') OR a.status IN ('Posting','Unknown','Failed') OR (a.status='Pending' AND a.message_id IS NOT NULL) OR (a.status='Sent' AND a.message_id IS NULL)))
      AND EXISTS (SELECT 1 FROM chatwork_test_permits p
        JOIN chatwork_delivery_jobs j ON j.id=p.job_id
        JOIN chatwork_production_settings s ON s.id='production'
        JOIN chatwork_delivery_runtime r ON r.id='production'
        JOIN app_users u ON u.id=j.actor_id JOIN works w ON w.id=j.work_id AND w.owner_id=u.id
        WHERE p.id=? AND p.job_id=chatwork_report_artifacts.job_id AND p.status='Active' AND p.expires_at>${dbNow}
          AND j.kind='ReportDelivery' AND j.delivery_mode='test' AND j.status='Posting' AND j.report_manifest_sealed=1
          AND j.lease_id=? AND j.lease_until>${dbNow}
          AND p.report_id=j.report_id AND p.actor_id=j.actor_id AND p.staff_revision=j.actor_staff_revision
          AND u.active=1 AND u.role='field' AND u.staff_revision=p.staff_revision
          AND p.account_id=j.account_id AND p.room_id=j.room_id AND p.settings_version=j.settings_version
          AND s.version=p.settings_version AND s.account_id=p.account_id AND s.room_id=p.room_id AND s.paused=0
          AND r.approved=1 AND r.report_approved=0 AND r.worker_subject=p.worker_subject AND r.worker_subject=?
          AND r.approval_generation=p.approval_generation AND r.approval_generation=?
          AND r.worker_revision=p.worker_revision AND r.site_revision=p.site_revision
          AND EXISTS (SELECT 1 FROM chatwork_delivery_control_audit a WHERE a.action='approve'
            AND json_extract(a.after_json,'$.subject')=p.worker_subject
            AND json_extract(a.after_json,'$.generation')=p.approval_generation
            AND json_extract(a.after_json,'$.workerRevision')=p.worker_revision
            AND json_extract(a.after_json,'$.siteRevision')=p.site_revision
            AND json_extract(a.after_json,'$.imageDigest')=p.image_digest)
          AND r.last_healthy_heartbeat_at>=${dbNow}-180000)`)
    .bind(input.artifactId,input.jobId,input.permitId,input.leaseId,input.subject,input.generation).run();
  return !!result.meta.changes;
}

// Called only after separate operator authentication. Audit, permit revocation,
// and uncertainty for an already-prepared artifact commit in the same batch.
async function closePermit(db:D1Database,input:Control | ExpiryControl,kind:"Revoke"|"Expire"):Promise<boolean>{
  if(!input.operatorId || !input.reason.trim() || input.reason.length>500 || !Number.isSafeInteger(input.expectedGeneration) || input.expectedGeneration<0 || (kind==="Expire" && (!("subject" in input) || !input.subject))) return false;
  const id=crypto.randomUUID(), status=kind==='Revoke'?'Revoked':'Expired';
  const expiry=kind==='Expire'?` AND expires_at<=${dbNow}`:"";
  const identity=kind==='Expire' ? " AND r.approved=1 AND r.worker_subject=?" : "";
  const owner=input.ownerId ? ` AND actor_id=? AND staff_revision=? AND EXISTS(SELECT 1 FROM chatwork_delivery_jobs j JOIN app_users u ON u.id=j.actor_id WHERE j.id=chatwork_test_permits.job_id AND j.actor_id=? AND j.actor_staff_revision=? AND j.status='TestAwaitingRegistration' AND j.lease_id IS NULL AND j.message_id IS NULL AND u.active=1 AND u.role='field' AND u.staff_revision=?)` : '';
  const auditQuery=db.prepare(`INSERT INTO chatwork_delivery_control_audit(id,action,operator_id,reason,before_json,after_json,created_at)
    SELECT ?,?,?,?,'{}',?,datetime('now') FROM chatwork_test_permits WHERE id=? AND status='Active'${expiry}
      AND EXISTS (SELECT 1 FROM chatwork_delivery_runtime r WHERE r.id='production' AND r.approval_generation=?${identity})${owner}`);
  const auditArgs=[id,'test-permit-'+kind.toLowerCase(),input.operatorId,input.reason,JSON.stringify({permitId:input.permitId,status}),input.permitId,input.expectedGeneration];
  const boundArgs=[...auditArgs,...(kind==='Expire'&&'subject' in input?[input.subject]:[]),...(input.ownerId?[input.ownerId,input.ownerRevision,input.ownerId,input.ownerRevision,input.ownerRevision]:[])];
  const audit=auditQuery.bind(...boundArgs);
  const permit=db.prepare(`UPDATE chatwork_test_permits SET status=?,updated_at=datetime('now')
    WHERE id=? AND status='Active' AND EXISTS (SELECT 1 FROM chatwork_delivery_control_audit WHERE id=?)`)
    .bind(status,input.permitId,id);
  const artifact=db.prepare(`UPDATE chatwork_report_artifacts SET status='Unknown',error_code=?,updated_at=datetime('now')
    WHERE status='Posting' AND job_id=(SELECT job_id FROM chatwork_test_permits WHERE id=? AND status=?)
      AND EXISTS (SELECT 1 FROM chatwork_delivery_control_audit WHERE id=?)`)
    .bind('TEST_PERMIT_'+status.toUpperCase(),input.permitId,status,id);
  const job=db.prepare(`UPDATE chatwork_delivery_jobs SET status='Unknown',error_code=?,updated_at=datetime('now')
    WHERE status='Posting' AND id=(SELECT job_id FROM chatwork_test_permits WHERE id=? AND status=?)
      AND EXISTS (SELECT 1 FROM chatwork_delivery_control_audit WHERE id=?)`)
    .bind('TEST_PERMIT_'+status.toUpperCase(),input.permitId,status,id);
  const queued=db.prepare(`UPDATE chatwork_delivery_jobs SET status='Failed',error_code=?,updated_at=datetime('now')
    WHERE id=(SELECT job_id FROM chatwork_test_permits WHERE id=? AND status=?) AND status IN ('TestAwaitingRegistration','DispatchPending','Dispatched') AND lease_id IS NULL AND lease_until IS NULL AND message_id IS NULL
    AND NOT EXISTS(SELECT 1 FROM chatwork_report_artifacts a WHERE a.job_id=chatwork_delivery_jobs.id AND (a.status<>'Pending' OR a.message_id IS NOT NULL))
    AND EXISTS(SELECT 1 FROM chatwork_delivery_control_audit WHERE id=?)`)
    .bind('TEST_PERMIT_'+status.toUpperCase()+'_UNSENT',input.permitId,status,id);
  const result=await db.batch([audit,permit,artifact,job,queued]);
  return !!result[0].meta.changes && !!result[1].meta.changes;
}
export function revokeTestPermit(db:D1Database,input:Control){return closePermit(db,input,'Revoke')}
export function expireTestPermit(db:D1Database,input:ExpiryControl){return closePermit(db,input,'Expire')}

export async function finishTestArtifact(db:D1Database,input:Access & {status:"Sent"|"Failed"|"Unknown";messageId:string|null;errorCode?:string|null}):Promise<boolean>{
  if(input.status==='Sent'&&!input.messageId)return false;
  if(input.status!=='Sent'&&input.messageId!==null)return false;
  const artifact=db.prepare(`UPDATE chatwork_report_artifacts SET status=?,message_id=?,error_code=?,updated_at=datetime('now')
    WHERE id=? AND job_id=? AND status='Posting'
    AND EXISTS (SELECT 1 FROM chatwork_test_permits p JOIN chatwork_delivery_jobs j ON j.id=p.job_id
      JOIN chatwork_delivery_runtime r ON r.id='production'
      WHERE p.id=? AND p.job_id=chatwork_report_artifacts.job_id AND p.status='Active' AND p.expires_at>${dbNow}
        AND j.delivery_mode='test' AND j.status='Posting' AND j.lease_id=? AND j.lease_until>${dbNow}
        AND r.approved=1 AND r.worker_subject=p.worker_subject AND r.worker_subject=?
        AND r.approval_generation=p.approval_generation AND r.approval_generation=?)`)
    .bind(input.status,input.messageId,input.errorCode??null,input.artifactId,input.jobId,input.permitId,input.leaseId,input.subject,input.generation);
  if(input.status==='Sent')return !!(await artifact.run()).meta.changes;
  const job=db.prepare(`UPDATE chatwork_delivery_jobs SET status='Unknown',error_code=?,updated_at=datetime('now')
   WHERE id=? AND status='Posting' AND lease_id=? AND lease_until>${dbNow}
   AND EXISTS(SELECT 1 FROM chatwork_report_artifacts WHERE id=? AND job_id=chatwork_delivery_jobs.id AND status=? AND message_id IS NULL)
   AND EXISTS(SELECT 1 FROM chatwork_test_permits p JOIN chatwork_delivery_runtime r ON r.id='production' WHERE p.id=? AND p.job_id=chatwork_delivery_jobs.id AND p.status='Active' AND p.expires_at>${dbNow} AND r.approved=1 AND r.worker_subject=p.worker_subject AND r.worker_subject=? AND r.approval_generation=p.approval_generation AND r.approval_generation=?)`)
   .bind(input.errorCode??'POST_RESULT_UNKNOWN',input.jobId,input.leaseId,input.artifactId,input.status,input.permitId,input.subject,input.generation);
  const result=await db.batch([artifact,job]);
  return !!result[0].meta.changes&&!!result[1].meta.changes;
}
