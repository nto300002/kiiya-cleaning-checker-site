type WorkerAccess={jobId:string;leaseId:string;subject:string;generation:number};
type FileRow={id:string;kind:string;source_id?:string|null;status:string;object_key:string|null;sha256:string|null;bytes:number|null;mime:string|null;file_name:string|null};
const now="CAST(strftime('%s','now') AS INTEGER)*1000";
export async function workerReportFiles(db:D1Database,input:WorkerAccess):Promise<FileRow[]|null>{
 const authorized=await db.prepare(`SELECT rv.format,rv.snapshot_json FROM chatwork_delivery_jobs j JOIN report_versions rv ON rv.id=j.report_id AND rv.work_id=j.work_id JOIN chatwork_test_permits p ON p.job_id=j.id JOIN chatwork_delivery_runtime r ON r.id='production'
 JOIN chatwork_production_settings s ON s.id='production' JOIN app_users u ON u.id=j.actor_id JOIN works w ON w.id=j.work_id AND w.owner_id=u.id
 WHERE j.id=? AND j.kind='ReportDelivery' AND j.delivery_mode='test' AND j.status='Posting' AND j.lease_id=? AND j.lease_until>${now} AND j.report_manifest_sealed=1
 AND p.status='Active' AND p.expires_at>${now} AND p.report_id=j.report_id AND p.actor_id=j.actor_id AND p.staff_revision=j.actor_staff_revision
 AND u.active=1 AND u.role IN ('normal','field') AND u.staff_revision=p.staff_revision AND s.version=p.settings_version AND s.account_id=p.account_id AND s.room_id=p.room_id AND s.paused=0
 AND j.settings_version=p.settings_version AND j.account_id=p.account_id AND j.room_id=p.room_id
 AND r.approved=1 AND r.report_approved=0 AND r.worker_subject=p.worker_subject AND r.worker_subject=? AND r.approval_generation=p.approval_generation AND r.approval_generation=?
 AND r.worker_revision=p.worker_revision AND r.site_revision=p.site_revision`).bind(input.jobId,input.leaseId,input.subject,input.generation).first<{format:string;snapshot_json:string}>();
 if(!authorized)return null;
 const rows=await db.prepare(`SELECT a.id,a.kind,a.source_id,a.status,f.object_key,f.sha256,f.bytes,f.mime,f.file_name FROM chatwork_report_artifacts a LEFT JOIN chatwork_report_prepared_files f ON f.artifact_id=a.id WHERE a.job_id=? ORDER BY a.ordinal`).bind(input.jobId).all<FileRow>();
 let snapshot: {deliveryFormat?:unknown;imageIds?:unknown};try{snapshot=JSON.parse(authorized.snapshot_json)}catch{return null}
 const expected=snapshot.deliveryFormat==='markdown'?['body']:snapshot.deliveryFormat==='pdf'?['pdf']:snapshot.deliveryFormat===undefined?['body','markdown','pdf']:[];
 if(!expected.length||!Array.isArray(snapshot.imageIds)||rows.results.length!==expected.length+snapshot.imageIds.length||expected.some((kind,index)=>rows.results[index]?.kind!==kind)||snapshot.imageIds.some((id,index)=>rows.results[expected.length+index]?.kind!=='image'||(rows.results[expected.length+index] as FileRow & {source_id?:string}).source_id!==id)||rows.results.some(row=>!row.object_key||!row.sha256||!row.bytes||row.bytes>5_000_000||!row.mime||!(row.kind==='body'&&row.mime==='text/plain'||row.kind==='markdown'&&row.mime==='text/markdown'||row.kind==='pdf'&&row.mime==='application/pdf'||row.kind==='image'&&['image/png','image/jpeg'].includes(row.mime))))return null;
 return rows.results;
}
export async function readWorkerFile(bucket:R2Bucket,row:FileRow):Promise<Uint8Array>{
 if(!row.object_key||!row.sha256||!row.bytes||row.bytes>5_000_000)throw new Error('Prepared file missing');
 const obj=await bucket.get(row.object_key);if(!obj)throw new Error('Prepared file missing');
 if(typeof obj.size==='number'&&obj.size!==row.bytes)throw new Error('Prepared file integrity mismatch');
 const bytes=new Uint8Array(await obj.arrayBuffer());
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 if(bytes.length!==row.bytes||digest!==row.sha256)throw new Error('Prepared file integrity mismatch');
 return bytes;
}
