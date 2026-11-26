import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {issueTestPermit} from '../lib/test-permit-issuance.ts';
import {registerTestDelivery} from '../lib/test-delivery-registration.ts';
import {reportRetryGuard} from '../lib/report-retry-guard.ts';
import {claimTestJob} from '../lib/test-delivery-permit.ts';
import {closeSnapshot} from '../lib/report-snapshot-reservation.ts';

function fixture(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(`CREATE TABLE app_users(id TEXT PRIMARY KEY,active INTEGER,role TEXT,staff_revision INTEGER);
 CREATE TABLE works(id TEXT PRIMARY KEY,owner_id TEXT,latest_report_id TEXT);
 CREATE TABLE report_versions(id TEXT PRIMARY KEY,work_id TEXT,status TEXT,format TEXT,snapshot_json TEXT,body TEXT);
 CREATE TABLE images(id TEXT PRIMARY KEY,work_id TEXT,object_key TEXT,file_name TEXT,mime TEXT,bytes INTEGER);
 CREATE TABLE chatwork_production_settings(id TEXT PRIMARY KEY,version INTEGER,account_id TEXT,room_id TEXT,room_name TEXT,account_confirmed INTEGER,destination_verified INTEGER,paused INTEGER,status TEXT,token_cipher TEXT);
 INSERT INTO app_users VALUES('field',1,'field',1);
 INSERT INTO works VALUES('work','field','report');
 INSERT INTO report_versions VALUES('report','work','Prepared','markdown','{"imageIds":[]}','報告');
 INSERT INTO chatwork_production_settings VALUES('production',2,'account','room','test room',1,1,0,'DestinationVerified','encrypted');`);
 sql.exec("ALTER TABLE works ADD COLUMN revision INTEGER NOT NULL DEFAULT 1; ALTER TABLE works ADD COLUMN status TEXT NOT NULL DEFAULT 'Draft'; ALTER TABLE works ADD COLUMN first_pressed_at TEXT; ALTER TABLE works ADD COLUMN updated_at TEXT; ALTER TABLE report_versions ADD COLUMN sequence INTEGER NOT NULL DEFAULT 1; ALTER TABLE report_versions ADD COLUMN created_at TEXT;");
 for(const name of ['0008_chatwork-delivery.sql','0009_delivery_identity.sql','0010_report_delivery_artifacts.sql','0011_test_delivery_permits.sql','0012_report_delivery_mode.sql','0013_report_prepared_files.sql']) sql.exec(readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));
 for(const name of ['0014_naive_vampiro.sql','0015_quiet_darkhawk.sql','0016_shiny_scream.sql']) sql.exec(readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));
 sql.exec(`INSERT INTO chatwork_delivery_runtime(id,approved,report_approved,worker_subject,worker_revision,site_revision,approval_generation,last_healthy_heartbeat_at,updated_at) VALUES('production',1,0,'subject','worker','site',3,CAST(strftime('%s','now') AS INTEGER)*1000,'now');
 INSERT INTO chatwork_delivery_control_audit VALUES('approval','approve','operator','approved','{}','{"subject":"subject","workerRevision":"worker","siteRevision":"site","generation":3,"imageDigest":"sha256:test"}','now');`);
 let fail=false;
 const db={prepare(query:string){let args:unknown[]=[];return {bind(...v:unknown[]){args=v;return this},run(){if(fail&&query.includes('INSERT INTO chatwork_test_permits'))throw Error('injected');const x=sql.prepare(query).run(...args as []);return Promise.resolve({meta:{changes:Number(x.changes)}})},first<T>(){return Promise.resolve((sql.prepare(query).get(...args as [])??null) as T|null)},all<T>(){return Promise.resolve({results:sql.prepare(query).all(...args as []) as T[]})}}},async batch(items:Array<{run():Promise<unknown>}>){sql.exec('BEGIN');try{const r=[];for(const x of items)r.push(await x.run());sql.exec('COMMIT');return r}catch(e){sql.exec('ROLLBACK');throw e}}} as unknown as D1Database;
 return {sql,db,fail(){fail=true}};
}
const input={requestId:'request',jobId:'job',permitId:'permit',reportId:'report',operatorId:'operator',reason:'test',expectedGeneration:3,expiresAt:Date.now()+60000,testAccountId:'account',testRoomId:'room',trialWorkerSubject:'subject'};
async function prepareCandidate(db:D1Database){
 const {createReportManifest}=await import('../lib/report-manifest.ts');const {prepareStoredReport}=await import('../lib/report-prepared-service.ts');
 const objects=new Map<string,Uint8Array>();const bucket={async put(k:string,v:Uint8Array){objects.set(k,new Uint8Array(v));return {}},async get(k:string){const v=objects.get(k);return v?{arrayBuffer:async()=>new Uint8Array(v).buffer}:null}} as unknown as R2Bucket;
 const info={jobId:'job',permitId:'permit',actorId:'field',staffRevision:1,now:Date.now()};
 assert.equal(await createReportManifest(db,info),true);
 const font=readFileSync(new URL('../public/assets/fonts/NotoSansJP.ttf',import.meta.url));
 assert.equal(await prepareStoredReport(db,bucket,async()=>font,info),true);
}
test('issuance reserves one non-dispatchable test job atomically and is idempotent',async()=>{
 const {sql,db}=fixture();
 assert.deepEqual(await issueTestPermit(db,input),{jobId:'job',permitId:'permit'});
 assert.deepEqual(await issueTestPermit(db,{...input,jobId:'other',permitId:'other'}),{jobId:'job',permitId:'permit'});
 assert.deepEqual({...sql.prepare('SELECT status,delivery_mode FROM chatwork_delivery_jobs').get()},{status:'TestAwaitingRegistration',delivery_mode:'test'});
 assert.equal((sql.prepare("SELECT count(*) n FROM chatwork_delivery_control_audit WHERE action='test-permit-issue'").get() as {n:number}).n,1);
 assert.equal(await issueTestPermit(db,{...input,requestId:'different',jobId:'other',permitId:'other'}),null);
});
test('a fixed candidate becomes a reserved report and permit together, with no dispatch before confirmation',async()=>{
 const {sql,db}=fixture();
 sql.exec("INSERT INTO report_snapshot_candidates VALUES('candidate','work','field',1,1,'fingerprint','fixed body','{\"imageIds\":[]}','Active','now')");
 assert.deepEqual(await issueTestPermit(db,{...input,reportId:'candidate'}),{jobId:'job',permitId:'permit'});
 assert.deepEqual({...sql.prepare("SELECT body,status FROM report_versions WHERE id='candidate'").get()},{body:'fixed body',status:'Prepared'});
 assert.equal((sql.prepare("SELECT latest_report_id FROM works WHERE id='work'").get() as {latest_report_id:string}).latest_report_id,'candidate');
 assert.equal((sql.prepare("SELECT status FROM chatwork_delivery_jobs WHERE id='job'").get() as {status:string}).status,'TestAwaitingRegistration');
 assert.equal((sql.prepare("SELECT count(*) n FROM report_snapshot_confirmations").get() as {n:number}).n,0);
 await prepareCandidate(db);
 assert.equal(await registerTestDelivery(db,{jobId:'job',permitId:'permit',actorId:'field',staffRevision:1,now:Date.now()}),false);
 assert.equal(await registerTestDelivery(db,{jobId:'job',permitId:'permit',candidateId:'candidate',actorId:'field',staffRevision:1,now:Date.now()}),true);
 assert.equal((sql.prepare("SELECT count(*) n FROM report_snapshot_confirmations WHERE candidate_id='candidate' AND job_id='job'").get() as {n:number}).n,1);
 assert.equal((sql.prepare("SELECT status FROM works WHERE id='work'").get() as {status:string}).status,'Prepared');
});
test('candidate issuance rolls back the report and latest pointer on invalid state or a write failure',async()=>{
 for(const change of ["UPDATE app_users SET staff_revision=2", "UPDATE works SET revision=2", "UPDATE chatwork_production_settings SET paused=1"]){
  const {sql,db}=fixture();
  sql.exec("INSERT INTO report_snapshot_candidates VALUES('candidate','work','field',1,1,'fingerprint','fixed body','{\"imageIds\":[]}','Active','now')");
  sql.exec(change);
  assert.equal(await issueTestPermit(db,{...input,reportId:'candidate'}),null);
  assert.equal((sql.prepare("SELECT count(*) n FROM report_versions WHERE id='candidate'").get() as {n:number}).n,0);
  assert.equal((sql.prepare("SELECT latest_report_id FROM works WHERE id='work'").get() as {latest_report_id:string}).latest_report_id,'report');
 }
 const {sql,db,fail}=fixture();
 sql.exec("INSERT INTO report_snapshot_candidates VALUES('candidate','work','field',1,1,'fingerprint','fixed body','{\"imageIds\":[]}','Active','now')");
 fail();await assert.rejects(issueTestPermit(db,{...input,reportId:'candidate'}));
 assert.equal((sql.prepare("SELECT count(*) n FROM report_versions WHERE id='candidate'").get() as {n:number}).n,0);
 assert.equal((sql.prepare("SELECT latest_report_id FROM works WHERE id='work'").get() as {latest_report_id:string}).latest_report_id,'report');
});
test('an issued candidate cannot be confirmed after the underlying work or candidate changes',async()=>{
 for(const change of ["UPDATE works SET revision=2", "UPDATE report_snapshot_candidates SET status='Closed' WHERE id='candidate'"]){
  const {sql,db}=fixture();
  sql.exec("INSERT INTO report_snapshot_candidates VALUES('candidate','work','field',1,1,'fingerprint','fixed body','{\"imageIds\":[]}','Active','now')");
  await issueTestPermit(db,{...input,reportId:'candidate'});
  await prepareCandidate(db);
  sql.exec(change);
  assert.equal(await registerTestDelivery(db,{jobId:'job',permitId:'permit',candidateId:'candidate',actorId:'field',staffRevision:1,now:Date.now()}),false);
  assert.equal((sql.prepare("SELECT status FROM chatwork_delivery_jobs WHERE id='job'").get() as {status:string}).status,'TestAwaitingRegistration');
 }
});
test('a failed confirmation audit rolls back the dispatch transition',async()=>{
 const {sql,db}=fixture();
 sql.exec("INSERT INTO report_snapshot_candidates VALUES('candidate','work','field',1,1,'fingerprint','fixed body','{\"imageIds\":[]}','Active','now')");
 await issueTestPermit(db,{...input,reportId:'candidate'});
 await prepareCandidate(db);
 sql.exec("CREATE TRIGGER reject_confirmation BEFORE INSERT ON report_snapshot_confirmations BEGIN SELECT RAISE(ABORT,'injected'); END");
 await assert.rejects(registerTestDelivery(db,{jobId:'job',permitId:'permit',candidateId:'candidate',actorId:'field',staffRevision:1,now:Date.now()}));
 assert.equal((sql.prepare("SELECT status FROM chatwork_delivery_jobs WHERE id='job'").get() as {status:string}).status,'TestAwaitingRegistration');
});
test('a definitely unposted revoked candidate can be closed, while an unknown one cannot',async()=>{
 const {revokeTestPermit}=await import('../lib/test-delivery-permit.ts');
 const {sql,db}=fixture();sql.exec("INSERT INTO report_snapshot_candidates VALUES('candidate','work','field',1,1,'fingerprint','fixed body','{\"imageIds\":[]}','Active','now')");
 await issueTestPermit(db,{...input,reportId:'candidate'});
 assert.equal(await closeSnapshot(db,{candidateId:'candidate',workId:'work',actorId:'field'}),false);
 assert.equal(await revokeTestPermit(db,{permitId:'permit',operatorId:'operator',expectedGeneration:3,reason:'cancelled'}),true);
 assert.equal(await closeSnapshot(db,{candidateId:'candidate',workId:'work',actorId:'field'}),true);
});
test('staff revision change blocks confirmation and close until the old permit is safely revoked',async()=>{
 const {revokeTestPermit}=await import('../lib/test-delivery-permit.ts');
 const {sql,db}=fixture();sql.exec("INSERT INTO report_snapshot_candidates VALUES('candidate','work','field',1,1,'fingerprint','fixed body','{\"imageIds\":[]}','Active','now')");
 await issueTestPermit(db,{...input,reportId:'candidate'});await prepareCandidate(db);
 sql.exec("UPDATE app_users SET staff_revision=2 WHERE id='field'");
 assert.equal(await registerTestDelivery(db,{jobId:'job',permitId:'permit',candidateId:'candidate',actorId:'field',staffRevision:2,now:Date.now()}),false);
 assert.equal(await closeSnapshot(db,{candidateId:'candidate',workId:'work',actorId:'field'}),false);
 assert.equal(await revokeTestPermit(db,{permitId:'permit',operatorId:'operator',expectedGeneration:3,reason:'staff changed'}),true);
 assert.equal(await closeSnapshot(db,{candidateId:'candidate',workId:'work',actorId:'field'}),true);
 assert.equal((sql.prepare("SELECT status FROM chatwork_delivery_jobs WHERE id='job'").get() as {status:string}).status,'Failed');
});
test('candidate artifacts are prepared before confirmation and cannot be posted until confirmed',async()=>{
 const {createReportManifest}=await import('../lib/report-manifest.ts');
 const {prepareStoredReport}=await import('../lib/report-prepared-service.ts');
 const {sql,db}=fixture();sql.exec("INSERT INTO report_snapshot_candidates VALUES('candidate','work','field',1,1,'fingerprint','fixed body','{\"imageIds\":[]}','Active','now')");
 await issueTestPermit(db,{...input,reportId:'candidate'});
 const info={jobId:'job',permitId:'permit',candidateId:'candidate',actorId:'field',staffRevision:1,now:Date.now()};
 assert.equal(await registerTestDelivery(db,info),false);
 assert.equal(await createReportManifest(db,info),true);
 const objects=new Map<string,Uint8Array>();
 const bucket={async put(key:string,value:Uint8Array){objects.set(key,new Uint8Array(value));return {}},async get(key:string){const value=objects.get(key);return value?{arrayBuffer:async()=>new Uint8Array(value).buffer}:null}} as unknown as R2Bucket;
 const font=readFileSync(new URL('../public/assets/fonts/NotoSansJP.ttf',import.meta.url));
 assert.equal(await prepareStoredReport(db,bucket,async()=>font,info),true);
 assert.equal((sql.prepare('SELECT count(*) n FROM chatwork_report_prepared_files').get() as {n:number}).n,3);
 assert.equal(await claimTestJob(db,{jobId:'job',leaseId:'lease',subject:'subject',generation:3}),false);
 assert.equal(await registerTestDelivery(db,info),true);
});
test('a permitted reservation remains unclaimable before the owner confirms even if artifacts exist',async()=>{
 const {sql,db}=fixture();
 await issueTestPermit(db,input);
 for(const [id,ordinal,kind] of [['body',0,'body'],['markdown',1,'markdown'],['pdf',2,'pdf']] as const){
  sql.prepare("INSERT INTO chatwork_report_artifacts(id,job_id,ordinal,kind,status,updated_at) VALUES(?, 'job',?,?,'Pending','now')").run(id,ordinal,kind);
  sql.prepare("INSERT INTO chatwork_report_prepared_files(artifact_id,object_key,sha256,bytes,mime,created_at) VALUES(?,?,?,1,'text/plain','now')").run(id,'key-'+id,'digest');
 }
 sql.exec("UPDATE chatwork_delivery_jobs SET report_manifest_sealed=1 WHERE id='job'");
 assert.equal(await claimTestJob(db,{jobId:'job',leaseId:'lease',subject:'subject',generation:3}),false);
 assert.equal((sql.prepare("SELECT status FROM chatwork_delivery_jobs WHERE id='job'").get() as {status:string}).status,'TestAwaitingRegistration');
});
test('issuance fails closed on changed authorization and rolls back partial writes',async()=>{
 for(const change of ["UPDATE chatwork_delivery_runtime SET worker_subject='other'","UPDATE app_users SET staff_revision=2,role='normal'","UPDATE chatwork_delivery_runtime SET report_approved=1","UPDATE chatwork_production_settings SET paused=1","DELETE FROM chatwork_delivery_control_audit"]){const {sql,db}=fixture();sql.exec(change);assert.equal(await issueTestPermit(db,input),null);assert.equal((sql.prepare('SELECT count(*) n FROM chatwork_delivery_jobs').get() as {n:number}).n,0)}
 {const {db}=fixture();assert.equal(await issueTestPermit(db,{...input,trialWorkerSubject:'other'}),null)}
 const {sql,db,fail}=fixture();fail();await assert.rejects(issueTestPermit(db,input));assert.equal((sql.prepare('SELECT count(*) n FROM chatwork_delivery_jobs').get() as {n:number}).n,0);
});

test('only the owner can register the reserved report and atomically seal its manifest',async()=>{
 const {sql,db}=fixture();await issueTestPermit(db,input);
 assert.equal(await registerTestDelivery(db,{jobId:'job',permitId:'permit',actorId:'other',staffRevision:1,now:Date.now()}),false);
 assert.equal((sql.prepare("SELECT status FROM chatwork_delivery_jobs").get() as {status:string}).status,'TestAwaitingRegistration');
 assert.equal(await registerTestDelivery(db,{jobId:'job',permitId:'permit',actorId:'field',staffRevision:1,now:Date.now()}),true);
 assert.deepEqual({...sql.prepare("SELECT status,report_manifest_sealed FROM chatwork_delivery_jobs").get()},{status:'DispatchPending',report_manifest_sealed:1});
 assert.equal((sql.prepare('SELECT count(*) n FROM chatwork_report_artifacts').get() as {n:number}).n,3);
 assert.equal((sql.prepare("SELECT count(*) n FROM chatwork_report_artifacts WHERE kind='pdf'").get() as {n:number}).n,1);
 assert.equal(await registerTestDelivery(db,{jobId:'job',permitId:'permit',actorId:'field',staffRevision:1,now:Date.now()}),true);
});
test('revocation or actor changes prevent registration',async()=>{
 for(const change of ["UPDATE chatwork_test_permits SET status='Revoked'", "UPDATE app_users SET staff_revision=2", "UPDATE chatwork_production_settings SET room_id='other'"]){const {sql,db}=fixture();await issueTestPermit(db,input);sql.exec(change);assert.equal(await registerTestDelivery(db,{jobId:'job',permitId:'permit',actorId:'field',staffRevision:1,now:Date.now()}),false);assert.equal((sql.prepare('SELECT count(*) n FROM chatwork_report_artifacts').get() as {n:number}).n,0)}
});

test('report unknown can be reconciled only after recorded worker isolation',async()=>{
 const {confirmReportIsolation,reconcileReportArtifact}=await import('../lib/report-delivery-reconcile.ts');
 const {sql,db}=fixture();await issueTestPermit(db,input);await registerTestDelivery(db,{jobId:'job',permitId:'permit',actorId:'field',staffRevision:1,now:Date.now()});
 sql.exec("UPDATE chatwork_delivery_jobs SET status='Unknown',error_code='LEASE_EXPIRED' WHERE id='job'; UPDATE chatwork_report_artifacts SET status='Unknown' WHERE ordinal=0");
 const artifact=(sql.prepare('SELECT id FROM chatwork_report_artifacts WHERE ordinal=0').get() as {id:string}).id;
 const reconcile={jobId:'job',artifactId:artifact,actorId:'field',staffRevision:1,outcome:'NotSent' as const,messageId:null,now:Date.now()};
 assert.equal(await reconcileReportArtifact(db,reconcile),false);
 assert.equal(await confirmReportIsolation(db,{jobId:'job',operatorId:'operator',expectedGeneration:3,reason:'isolated',evidence:'proof'}),false);
 sql.exec("UPDATE chatwork_delivery_runtime SET approved=0,approval_generation=4");
 assert.equal(await confirmReportIsolation(db,{jobId:'job',operatorId:'operator',expectedGeneration:4,reason:'isolated',evidence:'proof'}),true);
 assert.equal(await reconcileReportArtifact(db,reconcile),true);
 assert.deepEqual({...sql.prepare('SELECT status,error_code FROM chatwork_report_artifacts WHERE id=?').get(artifact)},{status:'Failed',error_code:'MANUALLY_CONFIRMED_NOT_SENT'});
 assert.equal((sql.prepare('SELECT status FROM chatwork_delivery_jobs').get() as {status:string}).status,'Failed');
 assert.ok(sql.prepare(`SELECT 1 FROM works WHERE id='work' AND ${reportRetryGuard}`).get());
 sql.exec("UPDATE chatwork_report_artifacts SET error_code=NULL WHERE status='Failed'");
 assert.equal(sql.prepare(`SELECT 1 FROM works WHERE id='work' AND ${reportRetryGuard}`).get(),undefined);
});

test('expired or revoked report attempts mark their posting artifact unknown under the current generation only',async()=>{
 const {markUnknownReportArtifacts}=await import('../lib/report-delivery-reconcile.ts');
 const {sql,db}=fixture();await issueTestPermit(db,input);await registerTestDelivery(db,{jobId:'job',permitId:'permit',actorId:'field',staffRevision:1,now:Date.now()});
 sql.exec("UPDATE chatwork_delivery_jobs SET status='Unknown',error_code='WORKER_REVOKED' WHERE id='job'; UPDATE chatwork_report_artifacts SET status='Posting' WHERE ordinal=0; UPDATE chatwork_delivery_runtime SET approved=0,approval_generation=4");
 await markUnknownReportArtifacts(db,{generation:3,approved:false});
 assert.equal((sql.prepare('SELECT status FROM chatwork_report_artifacts WHERE ordinal=0').get() as {status:string}).status,'Posting');
 await markUnknownReportArtifacts(db,{generation:4,approved:false});
 assert.deepEqual({...sql.prepare('SELECT status,error_code FROM chatwork_report_artifacts WHERE ordinal=0').get()},{status:'Unknown',error_code:'WORKER_REVOKED'});
});

test('prepared files are saved once with immutable metadata and fail closed when revoked',async()=>{
 const {persistReportArtifacts}=await import('../lib/report-prepared-store.ts');
 const {prepareReportArtifacts}=await import('../lib/report-preflight.ts');
 const {sql,db}=fixture();await issueTestPermit(db,input);await registerTestDelivery(db,{jobId:'job',permitId:'permit',actorId:'field',staffRevision:1,now:Date.now()});
 const objects=new Map<string,Uint8Array>();
 const bucket={async put(key:string,value:Uint8Array){objects.set(key,new Uint8Array(value));return {}},async get(key:string){const value=objects.get(key);return value?{arrayBuffer:async()=>new Uint8Array(value).buffer}:null}} as unknown as R2Bucket;
 const font=readFileSync(new URL('../public/assets/fonts/NotoSansJP.ttf',import.meta.url));
 const artifacts=await prepareReportArtifacts({body:'報告',font,images:[]});
 const ctx={jobId:'job',permitId:'permit',actorId:'field',staffRevision:1,artifacts};
 assert.equal(await persistReportArtifacts(db,bucket,ctx),true);
 assert.equal((sql.prepare('SELECT count(*) n FROM chatwork_report_prepared_files').get() as {n:number}).n,3);
 assert.equal(await persistReportArtifacts(db,bucket,ctx),true);
 sql.exec("UPDATE chatwork_test_permits SET status='Revoked'");
 assert.equal(await persistReportArtifacts(db,bucket,ctx),false);
});

test('prepares trusted saved report into private storage before delivery',async()=>{
 const {prepareStoredReport}=await import('../lib/report-prepared-service.ts');
 const {sql,db}=fixture();await issueTestPermit(db,input);await registerTestDelivery(db,{jobId:'job',permitId:'permit',actorId:'field',staffRevision:1,now:Date.now()});
 const objects=new Map<string,Uint8Array>();const bucket={async put(key:string,value:Uint8Array){objects.set(key,new Uint8Array(value));return {}},async get(key:string){const value=objects.get(key);return value?{arrayBuffer:async()=>new Uint8Array(value).buffer}:null}} as unknown as R2Bucket;
 const font=readFileSync(new URL('../public/assets/fonts/NotoSansJP.ttf',import.meta.url));
 const ctx={jobId:'job',permitId:'permit',actorId:'field',staffRevision:1};
 assert.equal(await prepareStoredReport(db,bucket,async()=>font,ctx),true);
 assert.equal((sql.prepare('SELECT count(*) n FROM chatwork_report_prepared_files').get() as {n:number}).n,3);
 assert.equal(await prepareStoredReport(db,bucket,async()=>{throw Error('font must not be loaded again')},ctx),true);
 sql.exec("UPDATE chatwork_test_permits SET status='Revoked'");
 assert.equal(await prepareStoredReport(db,bucket,async()=>font,ctx),false);
});

test('image metadata changing during storage prevents sealing prepared files',async()=>{
 const {prepareStoredReport}=await import('../lib/report-prepared-service.ts');
 const {sql,db}=fixture();const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=','base64');
 sql.prepare("UPDATE report_versions SET snapshot_json=?").run(JSON.stringify({imageIds:['image']}));
 sql.prepare("INSERT INTO images VALUES('image','work','old-key','photo.png','image/png',?)").run(png.length);
 await issueTestPermit(db,input);await registerTestDelivery(db,{jobId:'job',permitId:'permit',actorId:'field',staffRevision:1,now:Date.now()});
 const objects=new Map<string,Uint8Array>([['old-key',png]]);let changed=false;
 const bucket={async put(key:string,value:Uint8Array){objects.set(key,new Uint8Array(value));if(!changed){changed=true;sql.exec("UPDATE images SET object_key='new-key' WHERE id='image'")}return {}},async get(key:string){const v=objects.get(key);return v?{arrayBuffer:async()=>new Uint8Array(v).buffer}:null}} as unknown as R2Bucket;
 const font=readFileSync(new URL('../public/assets/fonts/NotoSansJP.ttf',import.meta.url));
 assert.equal(await prepareStoredReport(db,bucket,async()=>font,{jobId:'job',permitId:'permit',actorId:'field',staffRevision:1}),false);
 assert.equal((sql.prepare('SELECT count(*) n FROM chatwork_report_prepared_files').get() as {n:number}).n,0);
});

test('current owner can reconcile an isolated old attempt after their staff revision changes',async()=>{
 const {confirmReportIsolation,reconcileReportArtifact}=await import('../lib/report-delivery-reconcile.ts');const {sql,db}=fixture();
 await issueTestPermit(db,input);await registerTestDelivery(db,{jobId:'job',permitId:'permit',actorId:'field',staffRevision:1,now:Date.now()});
 sql.exec("UPDATE chatwork_delivery_jobs SET status='Unknown' WHERE id='job'; UPDATE chatwork_report_artifacts SET status='Unknown' WHERE ordinal=0; UPDATE app_users SET staff_revision=2; UPDATE chatwork_delivery_runtime SET approved=0,approval_generation=4");
 assert.equal(await confirmReportIsolation(db,{jobId:'job',operatorId:'operator',expectedGeneration:4,reason:'isolated',evidence:'proof'}),true);
 const artifact=(sql.prepare('SELECT id FROM chatwork_report_artifacts WHERE ordinal=0').get() as {id:string}).id;
 assert.equal(await reconcileReportArtifact(db,{jobId:'job',artifactId:artifact,actorId:'field',staffRevision:2,outcome:'NotSent',messageId:null,now:Date.now()}),true);
});

test('an isolated report is completed after its last uncertain artifact is confirmed sent',async()=>{
 const {confirmReportIsolation,reconcileReportArtifact}=await import('../lib/report-delivery-reconcile.ts');const {sql,db}=fixture();
 await issueTestPermit(db,input);await registerTestDelivery(db,{jobId:'job',permitId:'permit',actorId:'field',staffRevision:1,now:Date.now()});
 sql.exec("UPDATE chatwork_delivery_jobs SET status='Unknown' WHERE id='job'; UPDATE chatwork_report_artifacts SET status='Sent',message_id='known' WHERE ordinal>0; UPDATE chatwork_report_artifacts SET status='Unknown' WHERE ordinal=0; UPDATE chatwork_delivery_runtime SET approved=0,approval_generation=4");
 assert.equal(await confirmReportIsolation(db,{jobId:'job',operatorId:'operator',expectedGeneration:4,reason:'isolated',evidence:'proof'}),true);
 const artifact=(sql.prepare('SELECT id FROM chatwork_report_artifacts WHERE ordinal=0').get() as {id:string}).id;
 assert.equal(await reconcileReportArtifact(db,{jobId:'job',artifactId:artifact,actorId:'field',staffRevision:1,outcome:'Sent',messageId:'verified',now:Date.now()}),true);
 assert.equal((sql.prepare('SELECT status FROM chatwork_delivery_jobs').get() as {status:string}).status,'Sent');
});

test('an isolated lease with no claimed artifacts can be manually closed as unsent',async()=>{
 const {confirmReportIsolation,reconcileUnpostedReport}=await import('../lib/report-delivery-reconcile.ts');const {sql,db}=fixture();
 await issueTestPermit(db,input);await registerTestDelivery(db,{jobId:'job',permitId:'permit',actorId:'field',staffRevision:1,now:Date.now()});
 sql.exec("UPDATE chatwork_delivery_jobs SET status='Unknown' WHERE id='job'; UPDATE chatwork_delivery_runtime SET approved=0,approval_generation=4");
 const ctx={jobId:'job',actorId:'field',staffRevision:1,now:Date.now()};
 assert.equal(await reconcileUnpostedReport(db,ctx),false);
 assert.equal(await confirmReportIsolation(db,{jobId:'job',operatorId:'operator',expectedGeneration:4,reason:'isolated',evidence:'proof'}),true);
 assert.equal(await reconcileUnpostedReport(db,ctx),true);
 assert.equal((sql.prepare('SELECT status FROM chatwork_delivery_jobs').get() as {status:string}).status,'Failed');
 assert.ok(sql.prepare(`SELECT 1 FROM works WHERE id='work' AND ${reportRetryGuard}`).get());
});

test('partial delivery can be completed manually after isolation without resending an existing artifact',async()=>{
 const {confirmReportIsolation,reconcileReportArtifact}=await import('../lib/report-delivery-reconcile.ts');const {sql,db}=fixture();
 await issueTestPermit(db,input);await registerTestDelivery(db,{jobId:'job',permitId:'permit',actorId:'field',staffRevision:1,now:Date.now()});
 sql.exec("UPDATE chatwork_delivery_jobs SET status='Unknown' WHERE id='job'; UPDATE chatwork_report_artifacts SET status='Sent',message_id='existing' WHERE ordinal=0; UPDATE chatwork_report_artifacts SET status='Unknown' WHERE ordinal=1; UPDATE chatwork_delivery_runtime SET approved=0,approval_generation=4");
 assert.equal(await confirmReportIsolation(db,{jobId:'job',operatorId:'operator',expectedGeneration:4,reason:'isolated',evidence:'proof'}),true);
 const markdown=(sql.prepare('SELECT id FROM chatwork_report_artifacts WHERE ordinal=1').get() as {id:string}).id,pdf=(sql.prepare('SELECT id FROM chatwork_report_artifacts WHERE ordinal=2').get() as {id:string}).id;
 const base={jobId:'job',actorId:'field',staffRevision:1,now:Date.now()};
 assert.equal(await reconcileReportArtifact(db,{...base,artifactId:markdown,outcome:'NotSent',messageId:null}),true);
 assert.equal(await reconcileReportArtifact(db,{...base,artifactId:markdown,outcome:'Sent',messageId:'manual-markdown'}),true);
 assert.equal(await reconcileReportArtifact(db,{...base,artifactId:pdf,outcome:'Sent',messageId:'manual-pdf'}),true);
 assert.deepEqual({...sql.prepare('SELECT status,message_id FROM chatwork_report_artifacts WHERE ordinal=0').get()},{status:'Sent',message_id:'existing'});
 assert.equal((sql.prepare('SELECT status FROM chatwork_delivery_jobs').get() as {status:string}).status,'Sent');
});
