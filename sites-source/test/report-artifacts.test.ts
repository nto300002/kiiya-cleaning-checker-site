import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { claimReportArtifact, finishReportArtifact } from "../lib/report-artifacts.ts";

function fixture() {
  const sql = new DatabaseSync(":memory:");
  sql.exec(`CREATE TABLE chatwork_delivery_jobs (id TEXT PRIMARY KEY,kind TEXT,status TEXT,lease_id TEXT,lease_until INTEGER,settings_version INTEGER,account_id TEXT,room_id TEXT,actor_id TEXT,actor_staff_revision INTEGER,work_id TEXT);
    CREATE TABLE chatwork_production_settings (id TEXT PRIMARY KEY,version INTEGER,account_id TEXT,room_id TEXT,paused INTEGER);
    CREATE TABLE chatwork_delivery_runtime (id TEXT PRIMARY KEY,approved INTEGER,worker_subject TEXT,approval_generation INTEGER,report_approved INTEGER);
    CREATE TABLE app_users (id TEXT PRIMARY KEY,active INTEGER,role TEXT,staff_revision INTEGER);
    CREATE TABLE works (id TEXT PRIMARY KEY,owner_id TEXT);
    INSERT INTO chatwork_delivery_jobs VALUES ('job','ReportDelivery','Posting','lease',100000,2,'account','room','field',1,'work');
    INSERT INTO chatwork_production_settings VALUES ('production',2,'account','room',0);
    INSERT INTO chatwork_delivery_runtime VALUES ('production',1,'subject',3,1);
    INSERT INTO app_users VALUES ('field',1,'field',1);
    INSERT INTO works VALUES ('work','field');`);
  sql.exec(readFileSync(new URL("../drizzle/0010_report_delivery_artifacts.sql", import.meta.url), "utf8"));
  sql.exec(readFileSync(new URL("../drizzle/0012_report_delivery_mode.sql", import.meta.url), "utf8"));
  sql.exec("INSERT INTO chatwork_report_artifacts (id,job_id,ordinal,kind,source_id,status,updated_at) VALUES ('body','job',0,'body',NULL,'Pending','now'),('image','job',1,'image','image-1','Pending','now')");
  sql.exec("UPDATE chatwork_delivery_jobs SET report_manifest_sealed=1 WHERE id='job'");
  const db = {
    prepare(query: string) { let args: unknown[]=[]; return { bind(...values:unknown[]){args=values;return this;}, run(){const r=sql.prepare(query).run(...args as []);return Promise.resolve({meta:{changes:Number(r.changes)}});}, first<T>(){return Promise.resolve((sql.prepare(query).get(...args as []) ?? null) as T | null);} }; }
  } as unknown as D1Database;
  return { sql, db };
}
const access={jobId:"job",leaseId:"lease",subject:"subject",generation:3,now:1000};

test("production artifact operations cannot process a test job", async () => {
  const {sql,db}=fixture();
  sql.exec(`INSERT INTO chatwork_delivery_jobs (id,kind,status,lease_id,lease_until,settings_version,account_id,room_id,actor_id,actor_staff_revision,work_id,delivery_mode)
    VALUES ('trial','ReportDelivery','Posting','lease',100000,2,'account','room','field',1,'work','test');
    INSERT INTO chatwork_report_artifacts (id,job_id,ordinal,kind,status,updated_at) VALUES ('trial-body','trial',0,'body','Pending','now');
    UPDATE chatwork_delivery_jobs SET report_manifest_sealed=1 WHERE id='trial'`);
  const trial={...access,jobId:'trial',artifactId:'trial-body'};
  assert.equal(await claimReportArtifact(db,trial),false);
  sql.exec("UPDATE chatwork_report_artifacts SET status='Posting' WHERE id='trial-body'");
  assert.equal(await finishReportArtifact(db,{...trial,status:'Sent',messageId:'msg'}),false);
});

test("artifacts are claimed in order, only once, under the current lease and destination", async () => {
  const {sql,db}=fixture();
  assert.equal(await claimReportArtifact(db,{...access,artifactId:"image"}),false);
  assert.equal(await claimReportArtifact(db,{...access,artifactId:"body"}),true);
  assert.equal(await claimReportArtifact(db,{...access,artifactId:"body"}),false);
  assert.equal(await finishReportArtifact(db,{...access,artifactId:"body",status:"Sent",messageId:"msg-1"}),true);
  sql.exec("UPDATE chatwork_production_settings SET version=3");
  assert.equal(await claimReportArtifact(db,{...access,artifactId:"image"}),false);
  assert.equal((sql.prepare("SELECT message_id FROM chatwork_report_artifacts WHERE id='body'").get() as {message_id:string}).message_id,"msg-1");
});

test("unknown outcome blocks subsequent artifacts and stale identities cannot write", async () => {
  const {sql,db}=fixture();
  assert.equal(await claimReportArtifact(db,{...access,artifactId:"body"}),true);
  assert.equal(await finishReportArtifact(db,{...access,subject:"old",artifactId:"body",status:"Sent",messageId:"msg"}),false);
  assert.equal(await finishReportArtifact(db,{...access,artifactId:"body",status:"Unknown",messageId:null}),true);
  assert.equal(await claimReportArtifact(db,{...access,artifactId:"image"}),false);
  assert.equal(await claimReportArtifact(db,{...access,artifactId:"body"}),false);
  assert.equal((sql.prepare("SELECT status FROM chatwork_report_artifacts WHERE id='body'").get() as {status:string}).status,"Unknown");
});

test("artifact result requires a message id for Sent and an unexpired approved lease", async () => {
  const {sql,db}=fixture();
  assert.equal(await claimReportArtifact(db,{...access,artifactId:"body"}),true);
  assert.equal(await finishReportArtifact(db,{...access,artifactId:"body",status:"Sent",messageId:null}),false);
  assert.equal(await finishReportArtifact(db,{...access,now:100000,artifactId:"body",status:"Sent",messageId:"late"}),false);
  sql.exec("UPDATE chatwork_delivery_runtime SET approved=0");
  assert.equal(await finishReportArtifact(db,{...access,artifactId:"body",status:"Sent",messageId:"revoked"}),false);
  assert.equal((sql.prepare("SELECT status FROM chatwork_report_artifacts WHERE id='body'").get() as {status:string}).status,"Posting");
});

test("failed or unknown artifacts never allow later items or the same item to be retried", async () => {
  const {db}=fixture();
  assert.equal(await claimReportArtifact(db,{...access,artifactId:"body"}),true);
  assert.equal(await finishReportArtifact(db,{...access,artifactId:"body",status:"Failed",messageId:null,errorCode:"REJECTED"}),true);
  assert.equal(await claimReportArtifact(db,{...access,artifactId:"body"}),false);
  assert.equal(await claimReportArtifact(db,{...access,artifactId:"image"}),false);
});


test("unsealed artifact manifest cannot start a report post", async () => {
  const {sql,db}=fixture();
  sql.exec("DROP TRIGGER chatwork_report_manifest_no_unseal; UPDATE chatwork_delivery_jobs SET report_manifest_sealed=0 WHERE id='job'");
  assert.equal(await claimReportArtifact(db,{...access,artifactId:"body"}),false);
});

test("staff or report approval changes before an artifact prevent the next external post",async()=>{
 for(const change of ["staff","report"]){
  const {sql,db}=fixture();
  sql.exec(change==="staff"?"UPDATE app_users SET staff_revision=2":"UPDATE chatwork_delivery_runtime SET report_approved=0");
  assert.equal(await claimReportArtifact(db,{...access,artifactId:"body"}),false,change);
 }
});
