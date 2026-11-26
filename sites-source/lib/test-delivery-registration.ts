import {createReportManifest} from './report-manifest.ts';
type Registration={jobId:string;permitId:string;candidateId?:string;actorId:string;staffRevision:number;now:number};
const now="CAST(strftime('%s','now') AS INTEGER)*1000";
const eligible=`EXISTS (SELECT 1 FROM chatwork_test_permits p JOIN chatwork_production_settings s ON s.id='production'
 JOIN chatwork_delivery_runtime r ON r.id='production' JOIN app_users u ON u.id=p.actor_id
 JOIN works w ON w.id=chatwork_delivery_jobs.work_id AND w.owner_id=u.id AND w.latest_report_id=p.report_id
 WHERE p.id=? AND p.job_id=chatwork_delivery_jobs.id AND p.status='Active' AND p.expires_at>${now}
 AND p.actor_id=chatwork_delivery_jobs.actor_id AND p.staff_revision=chatwork_delivery_jobs.actor_staff_revision
 AND u.active=1 AND u.role='field' AND u.staff_revision=p.staff_revision
 AND NOT EXISTS (SELECT 1 FROM report_snapshot_candidates c WHERE c.id=p.report_id AND NOT COALESCE(
   c.status='Active' AND c.work_id=w.id AND c.actor_id=u.id AND c.work_revision=w.revision AND c.staff_revision=u.staff_revision,0))
 AND p.report_id=chatwork_delivery_jobs.report_id AND p.account_id=chatwork_delivery_jobs.account_id AND p.room_id=chatwork_delivery_jobs.room_id AND p.settings_version=chatwork_delivery_jobs.settings_version
 AND s.account_id=p.account_id AND s.room_id=p.room_id AND s.version=p.settings_version AND s.paused=0
 AND r.approved=1 AND r.report_approved=0 AND r.worker_subject=p.worker_subject AND r.approval_generation=p.approval_generation
 AND r.worker_revision=p.worker_revision AND r.site_revision=p.site_revision AND r.last_healthy_heartbeat_at>=${now}-180000
 AND (NOT EXISTS(SELECT 1 FROM report_snapshot_candidates c WHERE c.id=p.report_id) OR p.report_id=?))`;
export async function registerTestDelivery(db:D1Database,input:Registration):Promise<boolean>{
 if(!input.jobId || !input.permitId || !input.actorId || !Number.isSafeInteger(input.staffRevision))return false;
 const args=[input.jobId,input.actorId,input.staffRevision,input.permitId,input.candidateId??null];
 const register=db.prepare(`UPDATE chatwork_delivery_jobs SET status='DispatchPending',updated_at=datetime('now') WHERE id=? AND actor_id=? AND actor_staff_revision=? AND delivery_mode='test' AND status='TestAwaitingRegistration'
 AND (NOT EXISTS (SELECT 1 FROM report_snapshot_candidates c WHERE c.id=chatwork_delivery_jobs.report_id)
   OR (report_manifest_sealed=1 AND EXISTS (SELECT 1 FROM chatwork_report_artifacts a WHERE a.job_id=chatwork_delivery_jobs.id)
     AND NOT EXISTS (SELECT 1 FROM chatwork_report_artifacts a LEFT JOIN chatwork_report_prepared_files f ON f.artifact_id=a.id WHERE a.job_id=chatwork_delivery_jobs.id AND (f.artifact_id IS NULL OR a.status<>'Pending' OR a.message_id IS NOT NULL))))
 AND ${eligible}`).bind(...args);
 const confirmation=db.prepare(`INSERT OR IGNORE INTO report_snapshot_confirmations(candidate_id,job_id,actor_id,created_at)
 SELECT c.id,chatwork_delivery_jobs.id,c.actor_id,datetime('now') FROM chatwork_delivery_jobs
 JOIN report_snapshot_candidates c ON c.id=chatwork_delivery_jobs.report_id AND c.actor_id=chatwork_delivery_jobs.actor_id
 WHERE chatwork_delivery_jobs.id=? AND chatwork_delivery_jobs.actor_id=? AND chatwork_delivery_jobs.actor_staff_revision=?
 AND chatwork_delivery_jobs.delivery_mode='test' AND chatwork_delivery_jobs.status='DispatchPending' AND ${eligible}`).bind(...args);
 const assertConfirmation=db.prepare(`UPDATE chatwork_delivery_jobs SET delivery_mode='invalid' WHERE id=? AND actor_id=? AND actor_staff_revision=?
 AND status='DispatchPending' AND EXISTS (SELECT 1 FROM report_snapshot_candidates c WHERE c.id=chatwork_delivery_jobs.report_id)
 AND NOT EXISTS (SELECT 1 FROM report_snapshot_confirmations x WHERE x.candidate_id=chatwork_delivery_jobs.report_id AND x.job_id=chatwork_delivery_jobs.id AND x.actor_id=chatwork_delivery_jobs.actor_id)
 AND ${eligible}`).bind(...args);
 const work=db.prepare(`UPDATE works SET status='Prepared',first_pressed_at=COALESCE(first_pressed_at,datetime('now')),updated_at=datetime('now')
 WHERE id=(SELECT work_id FROM chatwork_delivery_jobs WHERE id=? AND actor_id=? AND actor_staff_revision=? AND status='DispatchPending')
 AND EXISTS (SELECT 1 FROM report_snapshot_confirmations x JOIN chatwork_delivery_jobs j ON j.id=x.job_id WHERE j.id=? AND x.actor_id=? AND x.candidate_id=j.report_id AND j.work_id=works.id)`)
 .bind(input.jobId,input.actorId,input.staffRevision,input.jobId,input.actorId);
 await db.batch([register,confirmation,assertConfirmation,work]);
 const canProceed=await db.prepare(`SELECT 1 FROM chatwork_delivery_jobs WHERE id=? AND actor_id=? AND actor_staff_revision=? AND delivery_mode='test' AND status IN ('DispatchPending','Dispatched','Posting','Sent') AND ${eligible}`).bind(...args).first();
 if(!canProceed)return false;
 // An unsealed reservation is never claimable. Retrying completes the same manifest.
 const sealed=await createReportManifest(db,{jobId:input.jobId,actorId:input.actorId,staffRevision:input.staffRevision,now:input.now});
 if(!sealed)return false;
 return !!await db.prepare(`SELECT 1 FROM chatwork_delivery_jobs WHERE id=? AND actor_id=? AND actor_staff_revision=? AND delivery_mode='test' AND report_manifest_sealed=1 AND ${eligible}`).bind(...args).first();
}
