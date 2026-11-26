type Isolation={jobId:string;operatorId:string;expectedGeneration:number;reason:string;evidence:string};
type Reconciliation={jobId:string;artifactId:string;actorId:string;staffRevision:number;outcome:'Sent'|'NotSent';messageId:string|null;now:number};
export async function reconcileUnpostedReport(db:D1Database,input:{jobId:string;actorId:string;staffRevision:number;now:number}):Promise<boolean>{
 if(!input.jobId||!input.actorId||!Number.isSafeInteger(input.staffRevision))return false;
 const event=crypto.randomUUID(),at=new Date(input.now).toISOString();
 const result=await db.batch([
  db.prepare(`INSERT OR IGNORE INTO chatwork_delivery_events(id,job_id,actor_id,action,detail_json,created_at)
   SELECT ?,j.id,u.id,'ReportJobConfirmedNotSent','{}',? FROM chatwork_delivery_jobs j JOIN app_users u ON u.id=j.actor_id JOIN works w ON w.id=j.work_id AND w.owner_id=u.id
   WHERE j.id=? AND j.kind='ReportDelivery' AND j.delivery_mode='test' AND j.status='Unknown' AND j.actor_id=? AND u.active=1 AND u.role='field' AND u.staff_revision=? AND j.message_id IS NULL
   AND EXISTS(SELECT 1 FROM chatwork_report_artifacts a WHERE a.job_id=j.id)
   AND NOT EXISTS(SELECT 1 FROM chatwork_report_artifacts a WHERE a.job_id=j.id AND (a.status<>'Pending' OR a.message_id IS NOT NULL))
   AND EXISTS(SELECT 1 FROM chatwork_delivery_events e WHERE e.job_id=j.id AND e.action='ReportIsolationConfirmed' AND json_extract(e.detail_json,'$.workerStopped')=1 AND json_extract(e.detail_json,'$.tokenInvalidated')=1 AND json_extract(e.detail_json,'$.requestsEnded')=1)`)
   .bind(event,at,input.jobId,input.actorId,input.staffRevision),
  db.prepare(`UPDATE chatwork_delivery_jobs SET status='Failed',error_code='MANUALLY_CONFIRMED_NOT_SENT',lease_id=NULL,lease_until=NULL,updated_at=? WHERE id=? AND status='Unknown' AND EXISTS(SELECT 1 FROM chatwork_delivery_events WHERE id=?)`).bind(at,input.jobId,event)
 ]);
 return !!result[0].meta.changes&&!!result[1].meta.changes;
}
export async function markUnknownReportArtifacts(db:D1Database,input:{generation:number;approved:boolean;subject?:string}):Promise<void>{
 if(!Number.isSafeInteger(input.generation)||(input.approved&&!input.subject))return;
 await db.prepare(`UPDATE chatwork_report_artifacts SET status='Unknown',error_code=(SELECT error_code FROM chatwork_delivery_jobs WHERE id=chatwork_report_artifacts.job_id),updated_at=datetime('now')
 WHERE status='Posting' AND EXISTS(SELECT 1 FROM chatwork_delivery_jobs j WHERE j.id=chatwork_report_artifacts.job_id AND j.kind='ReportDelivery' AND j.status='Unknown' AND j.error_code IN ('WORKER_REVOKED','LEASE_EXPIRED'))
 AND EXISTS(SELECT 1 FROM chatwork_delivery_runtime r WHERE r.id='production' AND r.approved=? AND r.approval_generation=? AND (?=0 OR r.worker_subject=?))`)
 .bind(input.approved?1:0,input.generation,input.approved?1:0,input.subject??'').run();
}
export async function confirmReportIsolation(db:D1Database,input:Isolation):Promise<boolean>{
 if(!input.jobId||!input.operatorId||!input.reason.trim()||input.reason.length>500||!/^[A-Za-z0-9_-]{1,100}$/.test(input.evidence)||!Number.isSafeInteger(input.expectedGeneration))return false;
 const event=crypto.randomUUID(),audit=crypto.randomUUID(), detail=JSON.stringify({workerStopped:true,tokenInvalidated:true,requestsEnded:true,evidence:input.evidence,generation:input.expectedGeneration});
 const result=await db.batch([
  db.prepare(`INSERT OR IGNORE INTO chatwork_delivery_events(id,job_id,actor_id,action,detail_json,created_at)
   SELECT ?,j.id,?,'ReportIsolationConfirmed',?,datetime('now') FROM chatwork_delivery_jobs j WHERE j.id=? AND j.kind='ReportDelivery' AND j.delivery_mode='test' AND j.status='Unknown'
   AND EXISTS(SELECT 1 FROM chatwork_delivery_runtime WHERE id='production' AND approved=0 AND approval_generation=?)`).bind(event,input.operatorId,detail,input.jobId,input.expectedGeneration),
  db.prepare(`INSERT INTO chatwork_delivery_control_audit(id,action,operator_id,reason,before_json,after_json,created_at)
   SELECT ?,'report-isolation',?,?,'{}',?,datetime('now') WHERE EXISTS(SELECT 1 FROM chatwork_delivery_events WHERE id=?)`).bind(audit,input.operatorId,input.reason.trim(),detail,event),
  db.prepare(`UPDATE chatwork_delivery_jobs SET delivery_mode='invalid' WHERE id=? AND EXISTS(SELECT 1 FROM chatwork_delivery_events WHERE id=?) AND NOT EXISTS(SELECT 1 FROM chatwork_delivery_control_audit WHERE id=?)`).bind(input.jobId,event,audit)
 ]);
 return !!result[0].meta.changes&&!!result[1].meta.changes;
}
export async function reconcileReportArtifact(db:D1Database,input:Reconciliation):Promise<boolean>{
 if(!input.jobId||!input.artifactId||!input.actorId||!Number.isSafeInteger(input.staffRevision)||!['Sent','NotSent'].includes(input.outcome)||input.outcome==='Sent'&&(!input.messageId||input.messageId.length>100)||input.outcome==='NotSent'&&input.messageId!==null)return false;
 const event=crypto.randomUUID(), action=`ReportArtifactReconciled:${input.artifactId}:${input.outcome}`, detail=JSON.stringify({artifactId:input.artifactId,outcome:input.outcome,messageId:input.messageId});
 const result=await db.batch([
  db.prepare(`INSERT OR IGNORE INTO chatwork_delivery_events(id,job_id,actor_id,action,detail_json,created_at)
   SELECT ?,j.id,?,?,?,? FROM chatwork_delivery_jobs j JOIN app_users u ON u.id=j.actor_id JOIN works w ON w.id=j.work_id AND w.owner_id=u.id
   JOIN chatwork_report_artifacts a ON a.job_id=j.id WHERE j.id=? AND j.kind='ReportDelivery' AND j.delivery_mode='test' AND j.status='Unknown' AND j.actor_id=?
   AND u.active=1 AND u.role='field' AND u.staff_revision=? AND a.id=? AND a.message_id IS NULL
   AND (a.status='Unknown' OR (a.status='Failed' AND (a.error_code IS NULL OR a.error_code<>'MANUALLY_CONFIRMED_NOT_SENT' OR ?='Sent')) OR (a.status='Pending' AND ?='Sent'))
   AND EXISTS(SELECT 1 FROM chatwork_delivery_events e WHERE e.job_id=j.id AND e.action='ReportIsolationConfirmed' AND json_extract(e.detail_json,'$.workerStopped')=1 AND json_extract(e.detail_json,'$.tokenInvalidated')=1 AND json_extract(e.detail_json,'$.requestsEnded')=1)`)
    .bind(event,input.actorId,action,detail,new Date(input.now).toISOString(),input.jobId,input.actorId,input.staffRevision,input.artifactId,input.outcome,input.outcome),
  db.prepare(`UPDATE chatwork_report_artifacts SET status=?,message_id=?,error_code=?,updated_at=? WHERE id=? AND job_id=? AND status IN ('Unknown','Failed','Pending') AND message_id IS NULL AND EXISTS(SELECT 1 FROM chatwork_delivery_events WHERE id=?)`)
    .bind(input.outcome==='Sent'?'Sent':'Failed',input.messageId,input.outcome==='NotSent'?'MANUALLY_CONFIRMED_NOT_SENT':null,new Date(input.now).toISOString(),input.artifactId,input.jobId,event),
  db.prepare(`UPDATE chatwork_delivery_jobs SET delivery_mode='invalid' WHERE id=? AND EXISTS(SELECT 1 FROM chatwork_delivery_events WHERE id=?) AND NOT EXISTS(SELECT 1 FROM chatwork_report_artifacts WHERE id=? AND job_id=? AND status=? )`)
    .bind(input.jobId,event,input.artifactId,input.jobId,input.outcome==='Sent'?'Sent':'Failed'),
  db.prepare(`UPDATE chatwork_delivery_jobs SET status='Failed',error_code='MANUALLY_CONFIRMED_NOT_SENT',lease_id=NULL,lease_until=NULL,updated_at=?
   WHERE id=? AND status='Unknown' AND message_id IS NULL AND EXISTS(SELECT 1 FROM chatwork_delivery_events WHERE id=?)
   AND EXISTS(SELECT 1 FROM chatwork_report_artifacts WHERE job_id=chatwork_delivery_jobs.id)
   AND NOT EXISTS(SELECT 1 FROM chatwork_report_artifacts a WHERE a.job_id=chatwork_delivery_jobs.id AND (a.message_id IS NOT NULL OR NOT COALESCE(a.status='Pending' OR (a.status='Failed' AND a.error_code='MANUALLY_CONFIRMED_NOT_SENT'),0)))`)
   .bind(new Date(input.now).toISOString(),input.jobId,event),
  db.prepare(`UPDATE chatwork_delivery_jobs SET status='Sent',error_code=NULL,lease_id=NULL,lease_until=NULL,updated_at=? WHERE id=? AND status='Unknown' AND report_manifest_sealed=1
   AND EXISTS(SELECT 1 FROM chatwork_delivery_events WHERE id=?) AND EXISTS(SELECT 1 FROM chatwork_report_artifacts WHERE job_id=chatwork_delivery_jobs.id AND kind='body')
   AND EXISTS(SELECT 1 FROM chatwork_report_artifacts WHERE job_id=chatwork_delivery_jobs.id AND kind='markdown') AND EXISTS(SELECT 1 FROM chatwork_report_artifacts WHERE job_id=chatwork_delivery_jobs.id AND kind='pdf')
   AND NOT EXISTS(SELECT 1 FROM chatwork_report_artifacts WHERE job_id=chatwork_delivery_jobs.id AND (status<>'Sent' OR message_id IS NULL))`)
   .bind(new Date(input.now).toISOString(),input.jobId,event)
 ]);
 return !!result[0].meta.changes&&!!result[1].meta.changes;
}
