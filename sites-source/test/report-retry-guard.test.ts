import { test } from "node:test";
import { strict as assert } from "node:assert";
import { DatabaseSync } from "node:sqlite";
import { reportRetryGuard } from "../lib/report-retry-guard.ts";

test("a new report is allowed only after every older delivery is safely resolved",()=>{
 const db=new DatabaseSync(":memory:");
 db.exec(`CREATE TABLE works(id TEXT PRIMARY KEY); INSERT INTO works VALUES('work');
 CREATE TABLE chatwork_delivery_jobs(id TEXT,work_id TEXT,kind TEXT,status TEXT,report_manifest_sealed INTEGER,message_id TEXT,error_code TEXT,lease_id TEXT,lease_until INTEGER,task_name TEXT,dispatch_attempted_at TEXT);
 CREATE TABLE chatwork_report_artifacts(job_id TEXT,status TEXT,message_id TEXT);`);
 db.exec("ALTER TABLE chatwork_delivery_jobs ADD COLUMN delivery_mode TEXT DEFAULT 'production'; ALTER TABLE chatwork_report_artifacts ADD COLUMN error_code TEXT; CREATE TABLE chatwork_delivery_events(job_id TEXT,action TEXT,detail_json TEXT)");
 const allowed=()=>!!db.prepare(`SELECT 1 FROM works WHERE id='work' AND ${reportRetryGuard}`).get();
 assert.equal(allowed(),true);
 db.exec("INSERT INTO chatwork_delivery_jobs(id,work_id,kind,status,report_manifest_sealed,message_id,error_code,lease_id,lease_until,task_name,dispatch_attempted_at) VALUES('j','work','ReportDelivery','Failed',1,NULL,'ACTOR_CHANGED',NULL,NULL,NULL,NULL); INSERT INTO chatwork_report_artifacts(job_id,status,message_id) VALUES('j','Pending',NULL)");
 assert.equal(allowed(),true);
 for(const status of ['Posting','Unknown','Sent','Failed']) {
  db.prepare("UPDATE chatwork_report_artifacts SET status=?").run(status);
  assert.equal(allowed(),false,status);
 }
 db.exec("UPDATE chatwork_report_artifacts SET status='Pending'; UPDATE chatwork_delivery_jobs SET report_manifest_sealed=0");
 assert.equal(allowed(),false);
 db.exec("UPDATE chatwork_delivery_jobs SET status='Unknown',report_manifest_sealed=1");
 assert.equal(allowed(),false);
 db.exec("UPDATE chatwork_delivery_jobs SET status='Sent'; UPDATE chatwork_report_artifacts SET status='Sent',message_id='message'");
 assert.equal(allowed(),true);
});


test("NULL or unrecognized failure reasons and contradictory artifact message IDs stay blocked",()=>{
 const db=new DatabaseSync(":memory:");
 db.exec(`CREATE TABLE works(id TEXT PRIMARY KEY); INSERT INTO works VALUES('work');
 CREATE TABLE chatwork_delivery_jobs(id TEXT,work_id TEXT,kind TEXT,status TEXT,report_manifest_sealed INTEGER,message_id TEXT,error_code TEXT,lease_id TEXT,lease_until INTEGER,task_name TEXT,dispatch_attempted_at TEXT);
 CREATE TABLE chatwork_report_artifacts(job_id TEXT,status TEXT,message_id TEXT);
 INSERT INTO chatwork_delivery_jobs(id,work_id,kind,status,report_manifest_sealed,message_id,error_code,lease_id,lease_until,task_name,dispatch_attempted_at) VALUES('j','work','ReportDelivery','Failed',1,NULL,NULL,NULL,NULL,NULL,NULL);
 INSERT INTO chatwork_report_artifacts(job_id,status,message_id) VALUES('j','Pending',NULL);`);
 db.exec("ALTER TABLE chatwork_delivery_jobs ADD COLUMN delivery_mode TEXT DEFAULT 'production'; ALTER TABLE chatwork_report_artifacts ADD COLUMN error_code TEXT; CREATE TABLE chatwork_delivery_events(job_id TEXT,action TEXT,detail_json TEXT)");
 const allowed=()=>!!db.prepare(`SELECT 1 FROM works WHERE id='work' AND ${reportRetryGuard}`).get();
 assert.equal(allowed(),false);
 db.exec("UPDATE chatwork_delivery_jobs SET error_code='OTHER'");
 assert.equal(allowed(),false);
 db.exec("UPDATE chatwork_delivery_jobs SET error_code='ACTOR_CHANGED'; UPDATE chatwork_report_artifacts SET message_id='contradiction'");
 assert.equal(allowed(),false);
});

test("only provably never-dispatched unsealed actor-change failures permit a new report",()=>{
 const db=new DatabaseSync(":memory:");
 db.exec(`CREATE TABLE works(id TEXT PRIMARY KEY); INSERT INTO works VALUES('work');
 CREATE TABLE chatwork_delivery_jobs(id TEXT,work_id TEXT,kind TEXT,status TEXT,report_manifest_sealed INTEGER,message_id TEXT,error_code TEXT,lease_id TEXT,lease_until INTEGER,task_name TEXT,dispatch_attempted_at TEXT);
 CREATE TABLE chatwork_report_artifacts(job_id TEXT,status TEXT,message_id TEXT);
 INSERT INTO chatwork_delivery_jobs(id,work_id,kind,status,report_manifest_sealed,message_id,error_code,lease_id,lease_until,task_name,dispatch_attempted_at) VALUES('j','work','ReportDelivery','Failed',0,NULL,'ACTOR_CHANGED_UNSEALED',NULL,NULL,NULL,NULL);`);
 db.exec("ALTER TABLE chatwork_delivery_jobs ADD COLUMN delivery_mode TEXT DEFAULT 'production'; ALTER TABLE chatwork_report_artifacts ADD COLUMN error_code TEXT; CREATE TABLE chatwork_delivery_events(job_id TEXT,action TEXT,detail_json TEXT)");
 const allowed=()=>!!db.prepare(`SELECT 1 FROM works WHERE id='work' AND ${reportRetryGuard}`).get();
 assert.equal(allowed(),true);
 db.exec("UPDATE chatwork_delivery_jobs SET task_name='old-task'");
 assert.equal(allowed(),false);
 db.exec("UPDATE chatwork_delivery_jobs SET task_name=NULL; INSERT INTO chatwork_report_artifacts(job_id,status,message_id) VALUES('j','Pending',NULL)");
 assert.equal(allowed(),false);
});
