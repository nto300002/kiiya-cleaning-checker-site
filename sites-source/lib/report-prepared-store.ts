import {withPreparationStage} from './report-preparation-diagnostics.ts';
type Artifact={kind:'body'|'markdown'|'pdf'|'image';sourceId:string|null;fileName:string|null;mime:string;bytes:Uint8Array};
type Source={id:string;object_key:string;file_name:string;mime:string;bytes:number};
type Input={jobId:string;permitId:string;actorId:string;staffRevision:number;artifacts:Artifact[];snapshotJson?:string;sourceImages?:Source[];reportBody?:string};
const now="CAST(strftime('%s','now') AS INTEGER)*1000";
const preparing=`(j.status='DispatchPending' OR (j.status='TestAwaitingRegistration' AND EXISTS (SELECT 1 FROM report_snapshot_candidates c WHERE c.id=j.report_id AND c.status='Active'))) `;
const eligible=`EXISTS(SELECT 1 FROM chatwork_test_permits p JOIN app_users u ON u.id=p.actor_id JOIN works w ON w.id=j.work_id AND w.owner_id=u.id AND w.latest_report_id=j.report_id
 JOIN report_versions rv ON rv.id=j.report_id AND rv.work_id=w.id JOIN chatwork_production_settings s ON s.id='production' JOIN chatwork_delivery_runtime r ON r.id='production'
 WHERE p.id=? AND p.job_id=j.id AND p.status='Active' AND p.expires_at>${now} AND p.actor_id=j.actor_id AND p.staff_revision=j.actor_staff_revision
 AND u.active=1 AND u.role IN ('normal','field') AND u.staff_revision=p.staff_revision AND rv.body=? AND rv.snapshot_json=? AND rv.status='Prepared'
 AND NOT EXISTS (SELECT 1 FROM report_snapshot_candidates c WHERE c.id=j.report_id AND NOT COALESCE(c.status='Active' AND c.work_revision=w.revision AND c.staff_revision=u.staff_revision,0))
 AND NOT EXISTS(SELECT 1 FROM json_each(?) source WHERE NOT EXISTS(SELECT 1 FROM images i WHERE i.id=json_extract(source.value,'$.id') AND i.work_id=j.work_id AND i.object_key=json_extract(source.value,'$.object_key') AND i.file_name=json_extract(source.value,'$.file_name') AND i.mime=json_extract(source.value,'$.mime') AND i.bytes=json_extract(source.value,'$.bytes')))
 AND p.report_id=j.report_id AND p.account_id=j.account_id AND p.room_id=j.room_id AND p.settings_version=j.settings_version
 AND s.account_id=p.account_id AND s.room_id=p.room_id AND s.version=p.settings_version AND s.paused=0
 AND r.approved=1 AND r.report_approved=0 AND r.worker_subject=p.worker_subject AND r.approval_generation=p.approval_generation
 AND r.worker_revision=p.worker_revision AND r.site_revision=p.site_revision AND r.last_healthy_heartbeat_at>=${now}-180000)`;
async function hash(bytes:Uint8Array){const digest=await crypto.subtle.digest('SHA-256',new Uint8Array(bytes).buffer);return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')}
export async function persistReportArtifacts(db:D1Database,bucket:R2Bucket,input:Input,log:(...args:string[])=>void=()=>{}):Promise<boolean>{
 const body=input.artifacts[0];if(!body||!['body','pdf'].includes(body.kind)||!input.jobId||!input.permitId||!input.actorId)return false;
 const text=input.reportBody??(body.kind==='body'?new TextDecoder('utf-8',{fatal:true}).decode(body.bytes):'');if(!text)return false;
 const sources=input.sourceImages??[];
 if(sources.length!==input.artifacts.filter(item=>item.kind==='image').length)return false;
 const args=[input.jobId,input.actorId,input.staffRevision,input.permitId,text,input.snapshotJson??JSON.stringify({imageIds:[]}),JSON.stringify(sources)];
 const query=`SELECT j.id FROM chatwork_delivery_jobs j WHERE j.id=? AND j.actor_id=? AND j.actor_staff_revision=? AND j.delivery_mode='test' AND ${preparing} AND j.report_manifest_sealed=1 AND ${eligible}`;
 if(!await db.prepare(query).bind(...args).first())return false;
 const rows=await db.prepare(`SELECT a.id,a.kind,a.source_id FROM chatwork_report_artifacts a WHERE a.job_id=? ORDER BY a.ordinal`).bind(input.jobId).all<{id:string;kind:string;source_id:string|null}>();
 if(rows.results.length!==input.artifacts.length||rows.results.some((row,i)=>row.kind!==input.artifacts[i].kind||row.source_id!==input.artifacts[i].sourceId))return false;
 const files=[];
 for(let i=0;i<rows.results.length;i++){
  const item=input.artifacts[i];if(!item.bytes.length||item.bytes.length>5_000_000)return false;
  const digest=await hash(item.bytes),key=`chatwork-trial/${input.jobId}/${rows.results[i].id}/${digest}`;
  await withPreparationStage(log,'prepared_r2',async()=>{const existing=await bucket.get(key);
   if(existing){if(typeof existing.size==='number'&&existing.size!==item.bytes.length)throw new Error('Prepared file integrity mismatch');const bytes=new Uint8Array(await existing.arrayBuffer());if(bytes.length!==item.bytes.length||await hash(bytes)!==digest)throw new Error('Prepared file integrity mismatch');}
   else await bucket.put(key,item.bytes)});
  files.push({id:rows.results[i].id,key,digest,item});
 }
 const statements=files.map(file=>db.prepare(`INSERT OR IGNORE INTO chatwork_report_prepared_files(artifact_id,object_key,sha256,bytes,mime,file_name,created_at)
 SELECT a.id,?,?,?,?,?,datetime('now') FROM chatwork_report_artifacts a JOIN chatwork_delivery_jobs j ON j.id=a.job_id WHERE a.id=? AND j.id=? AND j.actor_id=? AND j.actor_staff_revision=? AND j.delivery_mode='test' AND ${preparing} AND j.report_manifest_sealed=1 AND ${eligible}`)
 .bind(file.key,file.digest,file.item.bytes.length,file.item.mime,file.item.fileName,file.id,...args));
 // If any row could not be written, force the batch to roll back.
 for(const file of files)statements.push(db.prepare(`UPDATE chatwork_delivery_jobs SET delivery_mode='invalid' WHERE id=? AND EXISTS(SELECT 1 FROM chatwork_report_prepared_files f JOIN chatwork_report_artifacts a ON a.id=f.artifact_id WHERE a.job_id=chatwork_delivery_jobs.id) AND NOT EXISTS(SELECT 1 FROM chatwork_report_prepared_files WHERE artifact_id=? AND object_key=? AND sha256=? AND bytes=?)`).bind(input.jobId,file.id,file.key,file.digest,file.item.bytes.length));
 await withPreparationStage(log,'prepared_d1',()=>db.batch(statements));
 if(!await db.prepare(query).bind(...args).first())return false;
 const count=await db.prepare(`SELECT count(*) n FROM chatwork_report_prepared_files f JOIN chatwork_report_artifacts a ON a.id=f.artifact_id WHERE a.job_id=?`).bind(input.jobId).first<{n:number}>();
 return count?.n===files.length;
}
