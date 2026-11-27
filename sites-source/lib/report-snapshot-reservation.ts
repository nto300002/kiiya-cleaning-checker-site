import {reportRetryGuard} from './report-retry-guard.ts';
type Input={requestId:string;candidateId:string;workId:string;actorId:string;workRevision:number;staffRevision:number;epoch:number;fingerprint:string;body:string;snapshotJson:string};
type Fence={requestId:string;workId:string;actorId:string;workRevision:number};

// Callers compute the fingerprint on the server after validating the complete
// content and authorizing its owner. Both writes run in one D1 transaction.
export async function reserveSnapshot(db:D1Database,input:Input):Promise<{candidateId:string}|null>{
 if(!input.requestId||!input.candidateId||!input.workId||!input.actorId||!Number.isSafeInteger(input.workRevision)||!Number.isSafeInteger(input.staffRevision)||!Number.isSafeInteger(input.epoch)||input.epoch<0||!/^[a-f0-9]{64}$/.test(input.fingerprint)||!input.body.trim())return null;
 const candidate=db.prepare(`INSERT OR IGNORE INTO report_snapshot_candidates(id,work_id,actor_id,work_revision,staff_revision,fingerprint,body,snapshot_json,status,created_at)
 SELECT ?,w.id,u.id,w.revision,u.staff_revision,?,?,?,'Active',datetime('now') FROM works w JOIN app_users u ON u.id=w.owner_id
 WHERE w.id=? AND w.owner_id=? AND w.revision=? AND u.active=1 AND u.role IN ('normal','field') AND u.staff_revision=?
 AND NOT EXISTS(SELECT 1 FROM report_snapshot_requests WHERE id=?)
 AND COALESCE((SELECT epoch FROM report_snapshot_scopes WHERE work_id=w.id AND actor_id=u.id),0)=?`)
 .bind(input.candidateId,input.fingerprint,input.body,input.snapshotJson,input.workId,input.actorId,input.workRevision,input.staffRevision,input.requestId,input.epoch);
 const request=db.prepare(`INSERT OR IGNORE INTO report_snapshot_requests(id,work_id,actor_id,work_revision,fingerprint,status,candidate_id,created_at)
 SELECT ?,c.work_id,c.actor_id,c.work_revision,c.fingerprint,'Linked',c.id,datetime('now') FROM report_snapshot_candidates c
 JOIN works w ON w.id=c.work_id AND w.owner_id=c.actor_id AND w.revision=c.work_revision
 JOIN app_users u ON u.id=c.actor_id AND u.active=1 AND u.role IN ('normal','field') AND u.staff_revision=c.staff_revision
 WHERE c.work_id=? AND c.actor_id=? AND c.work_revision=? AND c.staff_revision=? AND c.fingerprint=? AND c.status='Active'
 AND COALESCE((SELECT epoch FROM report_snapshot_scopes WHERE work_id=c.work_id AND actor_id=c.actor_id),0)=?`)
 .bind(input.requestId,input.workId,input.actorId,input.workRevision,input.staffRevision,input.fingerprint,input.epoch);
 await db.batch([candidate,request]);
 const result=await db.prepare(`SELECT c.id AS candidateId FROM report_snapshot_requests r JOIN report_snapshot_candidates c ON c.id=r.candidate_id
 JOIN works w ON w.id=c.work_id AND w.owner_id=c.actor_id AND w.revision=c.work_revision
 JOIN app_users u ON u.id=c.actor_id AND u.active=1 AND u.role IN ('normal','field') AND u.staff_revision=c.staff_revision
 WHERE r.id=? AND r.work_id=? AND r.actor_id=? AND r.work_revision=? AND r.fingerprint=? AND r.status='Linked' AND c.status='Active' AND c.staff_revision=?`)
 .bind(input.requestId,input.workId,input.actorId,input.workRevision,input.fingerprint,input.staffRevision).first<{candidateId:string}>();
 return result?{candidateId:result.candidateId}:null;
}
export async function fenceSnapshotScope(db:D1Database,input:{workId:string;actorId:string;workRevision:number;expectedEpoch:number}):Promise<boolean>{
 if(!Number.isSafeInteger(input.expectedEpoch)||input.expectedEpoch<0)return false;
 const authorized=`EXISTS(SELECT 1 FROM works w JOIN app_users u ON u.id=w.owner_id WHERE w.id=? AND w.owner_id=? AND w.revision=? AND u.active=1 AND u.role IN ('normal','field'))
 AND NOT EXISTS(SELECT 1 FROM report_snapshot_candidates c WHERE c.work_id=? AND c.actor_id=? AND c.status='Active')`;
 const args=[input.workId,input.actorId,input.workRevision,input.workId,input.actorId];
 const update=db.prepare(`UPDATE report_snapshot_scopes SET epoch=epoch+1 WHERE work_id=? AND actor_id=? AND epoch=? AND ${authorized}`)
  .bind(input.workId,input.actorId,input.expectedEpoch,...args);
 const insert=db.prepare(`INSERT OR IGNORE INTO report_snapshot_scopes(work_id,actor_id,epoch) SELECT ?,?,1 WHERE ?=0 AND ${authorized}`)
  .bind(input.workId,input.actorId,input.expectedEpoch,...args);
 const results=await db.batch([update,insert]);
 return !!results[0].meta.changes||!!results[1].meta.changes;
}
export async function fenceSnapshotRequest(db:D1Database,input:Fence):Promise<boolean>{
 const insert=db.prepare(`INSERT OR IGNORE INTO report_snapshot_requests(id,work_id,actor_id,work_revision,fingerprint,status,candidate_id,created_at)
 SELECT ?,w.id,u.id,w.revision,NULL,'Fenced',NULL,datetime('now') FROM works w JOIN app_users u ON u.id=w.owner_id
 WHERE w.id=? AND w.owner_id=? AND w.revision=? AND u.active=1 AND u.role IN ('normal','field')`)
 .bind(input.requestId,input.workId,input.actorId,input.workRevision);
 await insert.run();
 return !!await db.prepare(`SELECT 1 FROM report_snapshot_requests r JOIN works w ON w.id=r.work_id AND w.owner_id=r.actor_id
 JOIN app_users u ON u.id=r.actor_id AND u.active=1 AND u.role IN ('normal','field')
 WHERE r.id=? AND r.work_id=? AND r.actor_id=? AND r.work_revision=? AND r.status='Fenced'`)
 .bind(input.requestId,input.workId,input.actorId,input.workRevision).first();
}
export async function findSnapshot(db:D1Database,input:{workId:string;actorId:string}):Promise<{id:string;stale:boolean}|null>{
 const row=await db.prepare(`SELECT c.id,(c.staff_revision<>u.staff_revision OR c.work_revision<>w.revision) AS stale
 FROM report_snapshot_candidates c JOIN works w ON w.id=c.work_id AND w.owner_id=c.actor_id
 JOIN app_users u ON u.id=c.actor_id AND u.active=1 AND u.role IN ('normal','field')
 WHERE c.work_id=? AND c.actor_id=? AND c.status='Active'`).bind(input.workId,input.actorId).first<{id:string;stale:number}>();
 return row?{id:row.id,stale:!!row.stale}:null;
}
// Closing and advancing the fence are one SQLite statement via the trigger.
// A candidate tied to a job can close only after delivery recovery proves all
// attempts for the work are safely resolved.
export async function closeSnapshot(db:D1Database,input:{workId:string;actorId:string;candidateId:string}):Promise<boolean>{
 const result=await db.prepare(`UPDATE report_snapshot_candidates SET status='Closed'
 WHERE id=? AND work_id=? AND actor_id=? AND status='Active'
 AND EXISTS (SELECT 1 FROM works w JOIN app_users u ON u.id=w.owner_id
   WHERE w.id=report_snapshot_candidates.work_id AND w.owner_id=report_snapshot_candidates.actor_id AND u.active=1 AND u.role IN ('normal','field'))
 AND EXISTS (SELECT 1 FROM works WHERE works.id=report_snapshot_candidates.work_id AND ${reportRetryGuard})`)
 .bind(input.candidateId,input.workId,input.actorId).run();
 return !!result.meta.changes;
}
