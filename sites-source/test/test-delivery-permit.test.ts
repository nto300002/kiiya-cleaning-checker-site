import { test } from "node:test";
import { strict as assert } from "node:assert";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { claimTestArtifact, revokeTestPermit, expireTestPermit, finishTestArtifact } from "../lib/test-delivery-permit.ts";
import { reportRetryGuard } from "../lib/report-retry-guard.ts";

function fixture(expiresSeconds=30) {
 const sql=new DatabaseSync(":memory:");
 sql.exec(`CREATE TABLE chatwork_delivery_runtime (id TEXT PRIMARY KEY,approved INTEGER,worker_subject TEXT,approval_generation INTEGER,worker_revision TEXT,site_revision TEXT,last_healthy_heartbeat_at INTEGER,report_approved INTEGER);
 CREATE TABLE chatwork_production_settings (id TEXT PRIMARY KEY,version INTEGER,account_id TEXT,room_id TEXT,paused INTEGER);
 CREATE TABLE app_users(id TEXT PRIMARY KEY,active INTEGER,role TEXT,staff_revision INTEGER);
 CREATE TABLE works(id TEXT PRIMARY KEY,owner_id TEXT);
 CREATE TABLE chatwork_delivery_jobs(id TEXT PRIMARY KEY,kind TEXT,status TEXT,work_id TEXT,report_id TEXT,actor_id TEXT,actor_staff_revision INTEGER,settings_version INTEGER,account_id TEXT,room_id TEXT,lease_id TEXT,lease_until INTEGER,report_manifest_sealed INTEGER,error_code TEXT,updated_at TEXT,message_id TEXT,task_name TEXT,dispatch_attempted_at TEXT);
 CREATE TABLE chatwork_report_artifacts(id TEXT PRIMARY KEY,job_id TEXT,ordinal INTEGER,status TEXT,message_id TEXT,error_code TEXT,updated_at TEXT);
 CREATE TABLE chatwork_test_permits(id TEXT PRIMARY KEY,job_id TEXT UNIQUE,actor_id TEXT,staff_revision INTEGER,report_id TEXT,account_id TEXT,room_id TEXT,settings_version INTEGER,worker_subject TEXT,worker_revision TEXT,site_revision TEXT,approval_generation INTEGER,image_digest TEXT,expires_at INTEGER,status TEXT,updated_at TEXT);
 CREATE TABLE chatwork_delivery_control_audit(id TEXT PRIMARY KEY,action TEXT,operator_id TEXT,reason TEXT,before_json TEXT,after_json TEXT,created_at TEXT);
 CREATE TABLE chatwork_report_prepared_files(artifact_id TEXT PRIMARY KEY);
 INSERT INTO chatwork_delivery_runtime VALUES('production',1,'subject',3,'worker-v1','site-v1',CAST(strftime('%s','now') AS INTEGER)*1000,0);
 INSERT INTO chatwork_production_settings VALUES('production',2,'account','room',0);
 INSERT INTO app_users VALUES('field',1,'field',1); INSERT INTO works VALUES('work','field');
 INSERT INTO chatwork_delivery_jobs VALUES('job','ReportDelivery','Posting','work','report','field',1,2,'account','room','lease',CAST(strftime('%s','now') AS INTEGER)*1000+60000,1,NULL,'now',NULL,NULL,NULL);
 INSERT INTO chatwork_report_artifacts VALUES('a','job',0,'Pending',NULL,NULL,'now');
 INSERT INTO chatwork_test_permits VALUES('permit','job','field',1,'report','account','room',2,'subject','worker-v1','site-v1',3,'digest',CAST(strftime('%s','now') AS INTEGER)*1000+1000*${expiresSeconds},'Active','now');
 INSERT INTO chatwork_delivery_control_audit VALUES ('approval','approve','operator','ok','{}','{"subject":"subject","workerRevision":"worker-v1","siteRevision":"site-v1","generation":3,"imageDigest":"digest"}','now');`);
 sql.exec("ALTER TABLE chatwork_delivery_jobs ADD COLUMN delivery_mode TEXT NOT NULL DEFAULT 'test'; ALTER TABLE chatwork_report_artifacts ADD COLUMN kind TEXT NOT NULL DEFAULT 'body'; CREATE TABLE chatwork_delivery_events(job_id TEXT,action TEXT,detail_json TEXT)");
 const migration=readFileSync(new URL("../drizzle/0011_test_delivery_permits.sql",import.meta.url),"utf8");
 sql.exec(migration.slice(migration.indexOf("CREATE TRIGGER")));
 let fail=false;
 const db={
  prepare(query:string){let args:unknown[]=[];return {bind(...v:unknown[]){args=v;return this},run(){if(fail && query.includes("UPDATE chatwork_report_artifacts"))throw new Error("injected");const r=sql.prepare(query).run(...args as []);return Promise.resolve({meta:{changes:Number(r.changes)}})},first<T>(){return Promise.resolve((sql.prepare(query).get(...args as []) ?? null) as T|null)}}},
  async batch(items:Array<{run():Promise<unknown>}>){sql.exec("BEGIN");try{const result=[];for(const item of items)result.push(await item.run());sql.exec("COMMIT");return result}catch(e){sql.exec("ROLLBACK");throw e}}
 } as unknown as D1Database;
 return {sql,db,setFailure(v:boolean){fail=v}};
}
const access={permitId:'permit',jobId:'job',artifactId:'a',leaseId:'lease',subject:'subject',generation:3};
test("a test permit cannot authorize a production job",async()=>{
 const {sql,db}=fixture();
 sql.exec("UPDATE chatwork_delivery_jobs SET delivery_mode='production'");
 assert.equal(await claimTestArtifact(db,access),false);
});
test("revocation or expiry before preparation prevents the claim",async()=>{
 for(const mode of ['revoked','expired']){
  const {sql,db}=fixture(mode==='expired'?-1:30);
  if(mode==='revoked') assert.equal(await revokeTestPermit(db,{permitId:'permit',operatorId:'operator',reason:'test',expectedGeneration:3}),true);
  else {assert.equal(await expireTestPermit(db,{permitId:'permit',operatorId:'system',reason:'test',expectedGeneration:3,subject:'subject'}),true)}
  assert.equal(await claimTestArtifact(db,access),false);
  assert.equal((sql.prepare("SELECT status FROM chatwork_report_artifacts").get() as {status:string}).status,'Pending');
 }
});
test("existing job lease without proof of token isolation stays unknown after permit closure",async()=>{
 for(const mode of ['revoked','expired']){
  const {sql,db}=fixture(mode==='expired'?-1:30);
  const result=mode==='revoked' ? await revokeTestPermit(db,{permitId:'permit',operatorId:'operator',reason:'test',expectedGeneration:3}) : await expireTestPermit(db,{permitId:'permit',operatorId:'system',reason:'test',expectedGeneration:3,subject:'subject'});
  assert.equal(result,true);
  assert.deepEqual({...sql.prepare('SELECT status,error_code FROM chatwork_delivery_jobs').get()},{status:'Unknown',error_code:`TEST_PERMIT_${mode==='revoked'?'REVOKED':'EXPIRED'}`});
  assert.equal(await claimTestArtifact(db,access),false);
 }
});
test("permit closure after a sent artifact never marks the job wholly unposted",async()=>{
 const {sql,db}=fixture();
 sql.exec("UPDATE chatwork_report_artifacts SET status='Sent',message_id='sent-id'");
 assert.equal(await revokeTestPermit(db,{permitId:'permit',operatorId:'operator',reason:'test',expectedGeneration:3}),true);
 assert.equal((sql.prepare('SELECT status FROM chatwork_delivery_jobs').get() as {status:string}).status,'Unknown');
 assert.equal((sql.prepare('SELECT message_id FROM chatwork_report_artifacts').get() as {message_id:string}).message_id,'sent-id');
});
test("revocation after preparation marks result unknown and does not allow an old response or repeat claim",async()=>{
 const {sql,db}=fixture();
 assert.equal(await claimTestArtifact(db,access),true);
 assert.equal(await revokeTestPermit(db,{permitId:'permit',operatorId:'operator',reason:'test',expectedGeneration:3}),true);
 assert.equal((sql.prepare("SELECT status FROM chatwork_report_artifacts").get() as {status:string}).status,'Unknown');
 assert.equal(await finishTestArtifact(db,{...access,status:'Sent',messageId:'msg'}),false);
 assert.equal(await claimTestArtifact(db,access),false);
});
test("expiry after preparation is uncertain even if the external post was not observed",async()=>{
 const {sql,db}=fixture(1);
 assert.equal(await claimTestArtifact(db,access),true);
 await new Promise(resolve=>setTimeout(resolve,1100));
 assert.equal(await expireTestPermit(db,{permitId:'permit',operatorId:'system',reason:'test',expectedGeneration:3,subject:'subject'}),true);
 assert.equal((sql.prepare("SELECT status FROM chatwork_report_artifacts").get() as {status:string}).status,'Unknown');
 assert.equal(await claimTestArtifact(db,access),false);
});
test("rollback keeps permit active when marking uncertain fails",async()=>{
 const {sql,db,setFailure}=fixture();
 assert.equal(await claimTestArtifact(db,access),true);
 setFailure(true);
 await assert.rejects(revokeTestPermit(db,{permitId:'permit',operatorId:'operator',reason:'test',expectedGeneration:3}));
 assert.equal((sql.prepare("SELECT status FROM chatwork_test_permits").get() as {status:string}).status,'Active');
});
test("binding and heartbeat mismatch prevent a trial post",async()=>{
 for(const change of ["UPDATE chatwork_delivery_jobs SET room_id='other'","UPDATE app_users SET staff_revision=2","UPDATE chatwork_delivery_runtime SET approval_generation=4","UPDATE chatwork_delivery_runtime SET last_healthy_heartbeat_at=0","UPDATE chatwork_delivery_runtime SET report_approved=1","UPDATE chatwork_delivery_control_audit SET after_json=json_set(after_json,'$.imageDigest','wrong') WHERE id='approval'"]){
  const {sql,db}=fixture();sql.exec(change);assert.equal(await claimTestArtifact(db,access),false,change);
 }
});

test("expired permission cannot save an apparent success before expiry reconciliation",async()=>{
 const {sql,db}=fixture(1);
 assert.equal(await claimTestArtifact(db,access),true);
 await new Promise(resolve=>setTimeout(resolve,1100));
 assert.equal(await finishTestArtifact(db,{...access,status:'Sent',messageId:'msg'}),false);
 assert.equal((sql.prepare("SELECT status FROM chatwork_report_artifacts").get() as {status:string}).status,'Posting');
 assert.equal(await expireTestPermit(db,{permitId:'permit',operatorId:'system',reason:'expired',expectedGeneration:3,subject:'subject'}),true);
 assert.equal((sql.prepare("SELECT status FROM chatwork_report_artifacts").get() as {status:string}).status,'Unknown');
 assert.equal((sql.prepare("SELECT status FROM chatwork_delivery_jobs").get() as {status:string}).status,'Unknown');
});

test("successful outcome is recorded only once while the bound permit and lease remain valid",async()=>{
 const {sql,db}=fixture();
 assert.equal(await claimTestArtifact(db,access),true);
 assert.equal(await finishTestArtifact(db,{...access,status:'Sent',messageId:'msg'}),true);
 assert.equal(await finishTestArtifact(db,{...access,status:'Sent',messageId:'other'}),false);
 assert.deepEqual({...sql.prepare("SELECT status,message_id FROM chatwork_report_artifacts").get()},{status:'Sent',message_id:'msg'});
 assert.equal(await revokeTestPermit(db,{permitId:'permit',operatorId:'operator',reason:'done',expectedGeneration:3}),true);
 assert.equal((sql.prepare("SELECT status FROM chatwork_report_artifacts").get() as {status:string}).status,'Sent');
});

test("permit bindings are immutable and revoked authorization cannot be reopened",async()=>{
 const {sql,db}=fixture();
 assert.throws(()=>sql.exec("UPDATE chatwork_test_permits SET room_id='other' WHERE id='permit'"));
 assert.throws(()=>sql.exec("UPDATE chatwork_test_permits SET expires_at=expires_at+60000 WHERE id='permit'"));
 assert.equal(await revokeTestPermit(db,{permitId:'permit',operatorId:'operator',reason:'done',expectedGeneration:3}),true);
 assert.throws(()=>sql.exec("UPDATE chatwork_test_permits SET status='Active' WHERE id='permit'"));
 assert.throws(()=>sql.exec("DELETE FROM chatwork_test_permits WHERE id='permit'"));
});


test("old monitor identity cannot expire a permit after a worker revocation",async()=>{
 const {sql,db}=fixture(-1);
 sql.exec("UPDATE chatwork_delivery_runtime SET approved=0,approval_generation=4,worker_subject=NULL");
 assert.equal(await expireTestPermit(db,{permitId:'permit',operatorId:'system',reason:'expired',expectedGeneration:3,subject:'subject'}),false);
 assert.equal((sql.prepare("SELECT status FROM chatwork_test_permits").get() as {status:string}).status,'Active');
});
test("operator revocation rejects an outdated control generation",async()=>{
 const {sql,db}=fixture();
 sql.exec("UPDATE chatwork_delivery_runtime SET approval_generation=4");
 assert.equal(await revokeTestPermit(db,{permitId:'permit',operatorId:'operator',reason:'test',expectedGeneration:3}),false);
 assert.equal((sql.prepare("SELECT status FROM chatwork_test_permits").get() as {status:string}).status,'Active');
});


test("a prepared but revoked attempt blocks a new report before external isolation",async()=>{
 const {sql,db}=fixture();
 assert.equal(await claimTestArtifact(db,access),true);
 assert.equal(await revokeTestPermit(db,{permitId:'permit',operatorId:'operator',reason:'isolate',expectedGeneration:3}),true);
 assert.equal(sql.prepare(`SELECT 1 FROM works WHERE id='work' AND ${reportRetryGuard}`).get(),undefined);
 assert.equal(await claimTestArtifact(db,access),false);
});

test("a pending artifact with a retained message ID blocks the whole trial",async()=>{
 const {sql,db}=fixture();
 sql.exec("INSERT INTO chatwork_report_artifacts(id,job_id,ordinal,status,message_id,error_code,updated_at) VALUES('b','job',1,'Pending','old-message',NULL,'now')");
 assert.equal(await claimTestArtifact(db,access),false);
});

test('a definite artifact rejection retains its error code for review',async()=>{
 const {sql,db}=fixture();
 assert.equal(await claimTestArtifact(db,access),true);
 assert.equal(await finishTestArtifact(db,{...access,status:'Failed',messageId:null,errorCode:'CHATWORK_403'}),true);
 assert.equal((sql.prepare('SELECT error_code FROM chatwork_report_artifacts').get() as {error_code:string}).error_code,'CHATWORK_403');
 assert.equal((sql.prepare('SELECT status FROM chatwork_delivery_jobs').get() as {status:string}).status,'Unknown');
});

test('test job lease requires active permit and approved identity and is acquired once',async()=>{
 const {claimTestJob}=await import('../lib/test-delivery-permit.ts');
 const {sql,db}=fixture();sql.exec("UPDATE chatwork_delivery_jobs SET status='DispatchPending',lease_id=NULL,lease_until=NULL");
 assert.equal(await claimTestJob(db,{jobId:'job',leaseId:'lease2',subject:'old',generation:3}),false);
 assert.equal(await claimTestJob(db,{jobId:'job',leaseId:'lease2',subject:'subject',generation:3}),false);
 sql.exec("INSERT INTO chatwork_report_artifacts(id,job_id,ordinal,status,updated_at,kind) VALUES('m','job',1,'Pending','now','markdown'),('p','job',2,'Pending','now','pdf')");
 assert.equal(await claimTestJob(db,{jobId:'job',leaseId:'lease2',subject:'subject',generation:3}),false);
 sql.exec("INSERT INTO chatwork_report_prepared_files VALUES('a'),('m'),('p')");
 assert.equal(await claimTestJob(db,{jobId:'job',leaseId:'lease2',subject:'subject',generation:3}),true);
 assert.equal(await claimTestJob(db,{jobId:'job',leaseId:'lease3',subject:'subject',generation:3}),false);
 assert.equal((sql.prepare('SELECT lease_id FROM chatwork_delivery_jobs').get() as {lease_id:string}).lease_id,'lease2');
});

test('trial job completes only after all artifacts have recorded successful IDs under the active lease',async()=>{
 const {completeTestJob}=await import('../lib/test-delivery-permit.ts');
 const {sql,db}=fixture();
 const ctx={jobId:'job',leaseId:'lease',subject:'subject',generation:3};
 assert.equal(await completeTestJob(db,ctx),false);
 sql.exec("UPDATE chatwork_report_artifacts SET status='Sent',message_id='id' WHERE id='a'");
 assert.equal(await completeTestJob(db,ctx),false);
 sql.exec("INSERT INTO chatwork_report_artifacts(id,job_id,ordinal,status,message_id,updated_at,kind) VALUES('m','job',1,'Sent','file1','now','markdown'),('p','job',2,'Sent','file2','now','pdf')");
 assert.equal(await completeTestJob(db,{...ctx,subject:'old'}),false);
 assert.equal(await completeTestJob(db,ctx),true);
 assert.equal((sql.prepare('SELECT status FROM chatwork_delivery_jobs').get() as {status:string}).status,'Sent');
});

test('revoked queued trial becomes a definite unposted failure without blocking a new report',async()=>{
 const {sql,db}=fixture();
 sql.exec("UPDATE chatwork_delivery_jobs SET status='Dispatched',lease_id=NULL,lease_until=NULL,task_name='task'");
 assert.equal(await revokeTestPermit(db,{permitId:'permit',operatorId:'operator',reason:'cancel',expectedGeneration:3}),true);
 assert.deepEqual({...sql.prepare('SELECT status,error_code FROM chatwork_delivery_jobs').get()},{status:'Failed',error_code:'TEST_PERMIT_REVOKED_UNSENT'});
 assert.ok(sql.prepare(`SELECT 1 FROM works WHERE id='work' AND ${reportRetryGuard}`).get());
});

test('owner can cancel an unregistered attempt, but not one already claimed or owned by another staff member',async()=>{
 for(const mode of ['wrong_owner','posting','waiting']){
  const {sql,db}=fixture();
  if(mode!=='posting')sql.exec("UPDATE chatwork_delivery_jobs SET status='TestAwaitingRegistration',lease_id=NULL,lease_until=NULL");
  const result=await revokeTestPermit(db,{permitId:'permit',operatorId:mode==='wrong_owner'?'other':'field',ownerId:mode==='wrong_owner'?'other':'field',ownerRevision:1,reason:'cancel unsent candidate',expectedGeneration:3});
  assert.equal(result,mode==='waiting');
  assert.equal((sql.prepare('SELECT status FROM chatwork_test_permits').get() as {status:string}).status,mode==='waiting'?'Revoked':'Active');
  if(mode==='waiting')assert.deepEqual({...sql.prepare('SELECT status,error_code FROM chatwork_delivery_jobs').get()},{status:'Failed',error_code:'TEST_PERMIT_REVOKED_UNSENT'});
 }
});
