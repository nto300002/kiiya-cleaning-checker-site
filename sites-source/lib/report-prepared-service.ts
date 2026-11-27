import {prepareReportArtifacts} from './report-preflight.ts';
import {persistReportArtifacts} from './report-prepared-store.ts';
import {withPreparationStage} from './report-preparation-diagnostics.ts';
type Input={jobId:string;permitId:string;actorId:string;staffRevision:number};
const now="CAST(strftime('%s','now') AS INTEGER)*1000";
export async function prepareStoredReport(db:D1Database,bucket:R2Bucket,loadFont:()=>Promise<Uint8Array>,input:Input,log:(...args:string[])=>void=()=>{}):Promise<boolean>{
 const reportQuery=`SELECT rv.body,rv.snapshot_json,j.work_id FROM chatwork_delivery_jobs j JOIN chatwork_test_permits p ON p.job_id=j.id
 JOIN report_versions rv ON rv.id=j.report_id AND rv.work_id=j.work_id JOIN works w ON w.id=j.work_id AND w.owner_id=j.actor_id AND w.latest_report_id=j.report_id
 JOIN app_users u ON u.id=j.actor_id JOIN chatwork_production_settings s ON s.id='production' JOIN chatwork_delivery_runtime r ON r.id='production'
 WHERE j.id=? AND p.id=? AND j.actor_id=? AND j.actor_staff_revision=? AND j.delivery_mode='test'
 AND (j.status='DispatchPending' OR (j.status='TestAwaitingRegistration' AND EXISTS (SELECT 1 FROM report_snapshot_candidates c WHERE c.id=j.report_id AND c.status='Active')))
 AND j.report_manifest_sealed=1
 AND p.status='Active' AND p.expires_at>${now} AND p.actor_id=j.actor_id AND p.staff_revision=j.actor_staff_revision AND p.report_id=j.report_id
 AND p.account_id=j.account_id AND p.room_id=j.room_id AND p.settings_version=j.settings_version AND u.active=1 AND u.role IN ('normal','field') AND u.staff_revision=p.staff_revision
 AND NOT EXISTS (SELECT 1 FROM report_snapshot_candidates c WHERE c.id=j.report_id AND NOT COALESCE(c.status='Active' AND c.work_revision=w.revision AND c.staff_revision=u.staff_revision,0))
 AND s.version=p.settings_version AND s.account_id=p.account_id AND s.room_id=p.room_id AND s.paused=0 AND rv.status='Prepared' AND rv.format=CASE json_extract(rv.snapshot_json,'$.deliveryFormat') WHEN 'pdf' THEN 'pdf' ELSE 'markdown' END
 AND r.approved=1 AND r.report_approved=0 AND r.worker_subject=p.worker_subject AND r.approval_generation=p.approval_generation AND r.worker_revision=p.worker_revision AND r.site_revision=p.site_revision AND r.last_healthy_heartbeat_at>=${now}-180000`;
 const params=[input.jobId,input.permitId,input.actorId,input.staffRevision];
 const report=await withPreparationStage(log,'report_read',()=>db.prepare(reportQuery).bind(...params).first<{body:string;snapshot_json:string;work_id:string}>());
 if(!report)return false;
 const prepared=await withPreparationStage(log,'prepared_read',()=>db.prepare(`SELECT a.id,f.object_key,f.sha256,f.bytes FROM chatwork_report_artifacts a LEFT JOIN chatwork_report_prepared_files f ON f.artifact_id=a.id WHERE a.job_id=? ORDER BY a.ordinal`).bind(input.jobId).all<{id:string;object_key:string|null;sha256:string|null;bytes:number|null}>());
 if(prepared.results.some(row=>row.object_key)){
  if(prepared.results.some(row=>!row.object_key||!row.sha256||!row.bytes))throw new Error('Incomplete prepared files');
  for(const row of prepared.results){
   const object=await bucket.get(row.object_key!);if(!object)throw new Error('Prepared file unavailable');
   if(typeof object.size==='number'&&object.size!==row.bytes)throw new Error('Prepared file integrity mismatch');
   const bytes=new Uint8Array(await object.arrayBuffer());const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
   if(bytes.length!==row.bytes||digest!==row.sha256)throw new Error('Prepared file integrity mismatch');
  }
  return !!await db.prepare(reportQuery).bind(...params).first();
 }
 let snapshot:unknown;try{snapshot=JSON.parse(report.snapshot_json)}catch{return false}
 const ids=(snapshot as {imageIds?:unknown})?.imageIds;
 if(!Array.isArray(ids)||ids.length>20||ids.some(id=>typeof id!=='string'||!id)||new Set(ids).size!==ids.length)return false;
 const images:Array<{id:string;fileName:string;mime:string;bytes:Uint8Array}>=[];const sourceImages:Array<{id:string;object_key:string;file_name:string;mime:string;bytes:number}>=[];let total=0;
 for(const id of ids){
  const image=await withPreparationStage(log,'image_metadata',()=>db.prepare('SELECT id,object_key,file_name,mime,bytes FROM images WHERE id=? AND work_id=?').bind(id,report.work_id).first<{id:string;object_key:string;file_name:string;mime:string;bytes:number}>());
  if(!image)throw new Error('Image unavailable');
  if(!['image/png','image/jpeg'].includes(image.mime))throw new Error('Unsupported image format');
  if(!Number.isSafeInteger(image.bytes)||image.bytes<1||image.bytes>5_000_000)throw new Error('Image exceeds file limit');
  total+=image.bytes;if(total>20_000_000)throw new Error('Report images exceed preparation limit');
  const bytes=await withPreparationStage(log,'image_read',async()=>{const object=await bucket.get(image.object_key);if(!object)throw new Error('Image unavailable');
   if(typeof object.size==='number'&&object.size!==image.bytes)throw new Error('Image size changed');
   const result=new Uint8Array(await object.arrayBuffer());if(result.length!==image.bytes)throw new Error('Image size changed');return result});
  sourceImages.push(image);
  images.push({id:image.id,fileName:image.file_name,mime:image.mime,bytes});
 }
 const format=(snapshot as {deliveryFormat?:unknown}).deliveryFormat;
 if(format!==undefined && format!=='markdown' && format!=='pdf')return false;
 const font=format==='markdown'?undefined:await withPreparationStage(log,'font_fetch',loadFont);
 const artifacts=await withPreparationStage(log,'pdf_generate',()=>prepareReportArtifacts({body:report.body,font,images,format}));
 return persistReportArtifacts(db,bucket,{...input,artifacts,reportBody:report.body,snapshotJson:report.snapshot_json,sourceImages},log);
}
