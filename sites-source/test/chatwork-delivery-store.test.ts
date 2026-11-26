import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { createVerification, confirmVerification, createReportDelivery, claimDelivery, finishArtifact, invalidateObsoleteReportJobs } from "../lib/chatwork-delivery-store.ts";

function fixture() {
  const sql = new DatabaseSync(":memory:");
  sql.exec("CREATE TABLE app_users (id TEXT PRIMARY KEY, active INTEGER, role TEXT, staff_revision INTEGER)");
  sql.exec("INSERT INTO app_users VALUES ('field',1,'field',1),('normal',1,'normal',1)");
  sql.exec("CREATE TABLE chatwork_production_settings (id TEXT PRIMARY KEY,version INTEGER,account_id TEXT,account_confirmed INTEGER,room_id TEXT,room_name TEXT,destination_verified INTEGER,paused INTEGER,status TEXT,updated_at TEXT)");
  sql.exec("INSERT INTO chatwork_production_settings VALUES ('production',2,'acct',1,'456','業務ルーム',0,0,'DestinationVerificationRequired','2026-10-29')");
  sql.exec("CREATE TABLE works (id TEXT PRIMARY KEY,owner_id TEXT,latest_report_id TEXT)");
  sql.exec("CREATE TABLE images (id TEXT PRIMARY KEY,work_id TEXT)");
  sql.exec("CREATE TABLE report_versions (id TEXT PRIMARY KEY,work_id TEXT,status TEXT,body TEXT,format TEXT,snapshot_json TEXT)");
  sql.exec(`INSERT INTO works VALUES ('work','field','report'); INSERT INTO report_versions VALUES ('report','work','Prepared','本文','markdown','{"imageIds":[]}')`);
  sql.exec(readFileSync(new URL("../drizzle/0008_chatwork-delivery.sql", import.meta.url), "utf8"));
  sql.exec(readFileSync(new URL("../drizzle/0009_delivery_identity.sql", import.meta.url), "utf8"));
  sql.exec(readFileSync(new URL("../drizzle/0010_report_delivery_artifacts.sql", import.meta.url), "utf8"));
  sql.exec(readFileSync(new URL("../drizzle/0012_report_delivery_mode.sql", import.meta.url), "utf8"));
  sql.exec("ALTER TABLE works ADD COLUMN revision INTEGER NOT NULL DEFAULT 1");
  sql.exec(readFileSync(new URL("../drizzle/0014_naive_vampiro.sql", import.meta.url), "utf8"));
  sql.exec("INSERT INTO chatwork_delivery_runtime (id,updated_at) VALUES ('production','2026-10-29')");
  sql.exec("UPDATE chatwork_delivery_runtime SET approved=1, report_approved=1, worker_subject='123456',approval_generation=1, worker_revision='worker-1',site_revision='site-1',last_healthy_heartbeat_at=1761700000000 WHERE id='production'");
  const db = {
    prepare(query: string) { let args: unknown[] = []; return { bind(...values: unknown[]) { args = values; return this; }, run() { const result = sql.prepare(query).run(...args as []); return Promise.resolve({ meta: { changes: Number(result.changes) } }); }, first<T>() { return Promise.resolve(sql.prepare(query).get(...args as []) as T | null); }, all<T>() { return Promise.resolve({ results: sql.prepare(query).all(...args as []) as T[] }); } }; },
    async batch(statements: Array<{ run(): Promise<unknown> }>) { sql.exec("BEGIN"); try { const results = []; for (const statement of statements) results.push(await statement.run()); sql.exec("COMMIT"); return results; } catch (error) { sql.exec("ROLLBACK"); throw error; } },
  };
  return { sql, db: db as unknown as D1Database };
}
const now = 1761700001000;

test("production registration and claim cannot consume a test job", async () => {
  const { sql, db } = fixture();
  sql.exec("UPDATE chatwork_production_settings SET destination_verified=1,status='DestinationVerified'");
  sql.exec(`INSERT INTO chatwork_delivery_jobs(id,kind,report_id,work_id,actor_id,actor_staff_revision,settings_version,account_id,room_id,room_name,status,report_manifest_sealed,created_at,updated_at,delivery_mode)
    VALUES('trial','ReportDelivery','report','work','field',1,2,'acct','456','room','DispatchPending',1,'now','now','test')`);
  assert.equal(await createReportDelivery(db, {actorId:'field',staffRevision:1,expectedVersion:2,reportId:'report',workId:'work',jobId:'other',now}), null);
  assert.equal(await claimDelivery(db,{id:'trial',leaseId:'lease',now}), null);
  assert.equal((sql.prepare("SELECT status FROM chatwork_delivery_jobs WHERE id='trial'").get() as {status:string}).status, 'DispatchPending');
});

test("verification request is fixed to saved destination and idempotent", async () => {
  const { sql, db } = fixture();
  const first = await createVerification(db, { actorId: "field", staffRevision: 1, expectedVersion: 2, requestId: "request-1", jobId: "job-1", marker: "KIIYA-test-1", now });
  assert.equal(first?.status, "DispatchPending");
  assert.equal(first?.room_id, "456");
  assert.equal(first?.account_id, "acct");
  const repeat = await createVerification(db, { actorId: "field", staffRevision: 1, expectedVersion: 2, requestId: "request-1", jobId: "job-2", marker: "KIIYA-test-2", now });
  assert.equal(repeat?.id, "job-1");
  assert.equal((sql.prepare("SELECT COUNT(*) AS n FROM chatwork_delivery_jobs").get() as { n: number }).n, 1);
  assert.equal(await createVerification(db, { actorId: "normal", staffRevision: 1, expectedVersion: 2, requestId: "request-2", jobId: "job-3", marker: "KIIYA-test-3", now }), null);
});

test("only a delivered and matching verification can confirm the destination", async () => {
  const { sql, db } = fixture();
  await createVerification(db, { actorId: "field", staffRevision: 1, expectedVersion: 2, requestId: "request-1", jobId: "job-1", marker: "KIIYA-test-1", now });
  assert.equal(await confirmVerification(db, { id: "job-1", actorId: "field", staffRevision: 1, expectedVersion: 2, now }), false);
  sql.exec("UPDATE chatwork_delivery_jobs SET status='Sent',message_id='msg-1' WHERE id='job-1'");
  assert.equal(await confirmVerification(db, { id: "job-1", actorId: "field", staffRevision: 1, expectedVersion: 2, now }), true);
  assert.equal((sql.prepare("SELECT destination_verified FROM chatwork_production_settings").get() as { destination_verified: number }).destination_verified, 1);
  assert.equal(await confirmVerification(db, { id: "job-1", actorId: "field", staffRevision: 1, expectedVersion: 2, now }), false);
});

test("report delivery requires confirmed destination and owner, with one job per report", async () => {
  const { sql, db } = fixture();
  assert.equal(await createReportDelivery(db, { actorId: "field", staffRevision: 1, expectedVersion: 2, reportId: "report", workId: "work", jobId: "delivery-1", now }), null);
  sql.exec("UPDATE chatwork_production_settings SET destination_verified=1,status='DestinationVerified'");
  sql.exec("UPDATE chatwork_delivery_runtime SET report_approved=0");
  assert.equal(await createReportDelivery(db, { actorId: "field", staffRevision: 1, expectedVersion: 2, reportId: "report", workId: "work", jobId: "delivery-1", now }), null);
  sql.exec("UPDATE chatwork_delivery_runtime SET report_approved=1");
  const first = await createReportDelivery(db, { actorId: "field", staffRevision: 1, expectedVersion: 2, reportId: "report", workId: "work", jobId: "delivery-1", now });
  assert.equal(first?.status, "DispatchPending");
  assert.equal((await createReportDelivery(db, { actorId: "field", staffRevision: 1, expectedVersion: 2, reportId: "report", workId: "work", jobId: "delivery-2", now }))?.id, "delivery-1");
  assert.equal(await createReportDelivery(db, { actorId: "normal", staffRevision: 1, expectedVersion: 2, reportId: "report", workId: "work", jobId: "delivery-3", now }), null);
});

test("claim is single use; lost response becomes Unknown without another POST", async () => {
  const { sql, db } = fixture();
  await createVerification(db, { actorId: "field", staffRevision: 1, expectedVersion: 2, requestId: "request-1", jobId: "job-1", marker: "KIIYA-test-1", now });
  const claimed = await claimDelivery(db, { id: "job-1", leaseId: "lease-1", now });
  assert.equal(claimed?.status, "Posting");
  assert.equal(await claimDelivery(db, { id: "job-1", leaseId: "lease-2", now }), null);
  assert.equal(await finishArtifact(db, { id: "job-1", leaseId: "wrong", status: "Sent", messageId: "msg", now }), false);
  assert.equal(await finishArtifact(db, { id: "job-1", leaseId: "lease-1", status: "Unknown", messageId: null, now }), true);
  assert.equal(await claimDelivery(db, { id: "job-1", leaseId: "lease-3", now }), null);
  assert.equal((sql.prepare("SELECT status FROM chatwork_delivery_jobs WHERE id='job-1'").get() as { status: string }).status, "Unknown");
});

test("unresolved verification globally blocks new requests atomically, but same ID is idempotent", async () => {
  const { sql, db } = fixture();
  sql.exec("INSERT INTO app_users VALUES ('field2',1,'field',1)");
  const input = { actorId: "field", staffRevision: 1, expectedVersion: 2, requestId: "first", jobId: "first-job", marker: "marker", now };
  const first = await createVerification(db, input);
  for (const status of ["DispatchPending", "Dispatched", "Posting", "Unknown"]) {
    sql.prepare("UPDATE chatwork_delivery_jobs SET status=? WHERE id='first-job'").run(status);
    assert.equal(await createVerification(db, { ...input, actorId: "field2", requestId: `other-${status}`, jobId: `other-${status}` }), null);
    assert.equal((await createVerification(db, input))?.id, first?.id);
  }
  sql.exec("UPDATE chatwork_production_settings SET version=3; UPDATE chatwork_delivery_jobs SET status='Unknown'");
  assert.equal(await createVerification(db, { ...input, expectedVersion: 3, requestId: 'new', jobId: 'new' }), null);
  sql.exec("UPDATE chatwork_delivery_jobs SET status='Failed'");
  assert.equal((await createVerification(db, { ...input, expectedVersion: 3, requestId: 'new', jobId: 'new' }))?.id, 'new');
});

test("simultaneous different verification requests create only one job", async () => {
  const { sql, db } = fixture();
  const base = { actorId: 'field', staffRevision: 1, expectedVersion: 2, marker: 'marker', now };
  const jobs = await Promise.all([
    createVerification(db, { ...base, requestId: 'one', jobId: 'one' }),
    createVerification(db, { ...base, requestId: 'two', jobId: 'two' }),
  ]);
  assert.equal(jobs.filter(Boolean).length, 1);
  assert.equal((sql.prepare('SELECT COUNT(*) AS n FROM chatwork_delivery_jobs').get() as { n: number }).n, 1);
});

test("repeated report registration requires the current owner and active staff revision", async () => {
  const { sql, db } = fixture();
  sql.exec("UPDATE chatwork_production_settings SET destination_verified=1,status='DestinationVerified'");
  const input = { actorId: "field", staffRevision: 1, expectedVersion: 2, reportId: "report", workId: "work", jobId: "delivery-1", now };
  assert.ok(await createReportDelivery(db, input));
  sql.exec("UPDATE app_users SET active=0 WHERE id='field'");
  assert.equal(await createReportDelivery(db, input), null);
  sql.exec("UPDATE app_users SET active=1,staff_revision=2 WHERE id='field'");
  assert.equal(await createReportDelivery(db, input), null);
});

test("a current staff revision cannot reuse a report job created under an older revision", async () => {
  const { sql, db } = fixture();
  sql.exec("UPDATE chatwork_production_settings SET destination_verified=1,status='DestinationVerified'");
  const input = { actorId: "field", staffRevision: 1, expectedVersion: 2, reportId: "report", workId: "work", jobId: "delivery-1", now };
  assert.ok(await createReportDelivery(db, input));
  assert.equal((await createReportDelivery(db, input))?.id, "delivery-1");
  sql.exec("UPDATE app_users SET staff_revision=2 WHERE id='field'");
  for (const status of ["DispatchPending", "Dispatched", "Posting", "Unknown", "Sent", "Failed"]) {
    sql.prepare("UPDATE chatwork_delivery_jobs SET status=? WHERE id='delivery-1'").run(status);
    assert.equal(await createReportDelivery(db, {...input, staffRevision: 2, jobId: "delivery-2"}), null, status);
    assert.equal((sql.prepare("SELECT COUNT(*) AS n FROM chatwork_delivery_jobs WHERE report_id='report'").get() as {n:number}).n, 1);
  }
});


test("obsolete unsent report jobs become Failed only under an approved monitor identity", async () => {
  const { sql, db } = fixture();
  sql.exec("UPDATE chatwork_production_settings SET destination_verified=1,status='DestinationVerified'");
  const input = { actorId:"field", staffRevision:1, expectedVersion:2, reportId:"report", workId:"work", jobId:"job", now };
  assert.ok(await createReportDelivery(db,input));
  sql.exec("UPDATE app_users SET staff_revision=2 WHERE id='field'");
  sql.exec("DROP TRIGGER chatwork_report_manifest_no_unseal; UPDATE chatwork_delivery_jobs SET report_manifest_sealed=0 WHERE id='job'");
  await invalidateObsoleteReportJobs(db,now,{subject:"123456",generation:1});
  assert.equal((sql.prepare("SELECT status FROM chatwork_delivery_jobs WHERE id='job'").get() as {status:string}).status,"DispatchPending");
  sql.exec("UPDATE chatwork_delivery_jobs SET report_manifest_sealed=1 WHERE id='job'");
  await invalidateObsoleteReportJobs(db,now,{subject:"old",generation:1});
  assert.equal((sql.prepare("SELECT status FROM chatwork_delivery_jobs WHERE id='job'").get() as {status:string}).status,"DispatchPending");
  await invalidateObsoleteReportJobs(db,now,{subject:"123456",generation:1});
  assert.deepEqual({...sql.prepare("SELECT status,error_code FROM chatwork_delivery_jobs WHERE id='job'").get()}, {status:"Failed",error_code:"ACTOR_CHANGED"});
  assert.equal(await createReportDelivery(db,{...input,staffRevision:2,jobId:"new"}),null);
});

test("obsolete report jobs with possible external posts are not failed or retried", async () => {
  for (const status of ["Posting","Unknown","Sent","Failed","DispatchPending","Dispatched"]) {
    const {sql,db}=fixture();
    sql.exec("UPDATE chatwork_production_settings SET destination_verified=1,status='DestinationVerified'");
    await createReportDelivery(db,{actorId:"field",staffRevision:1,expectedVersion:2,reportId:"report",workId:"work",jobId:"job",now});
    sql.prepare("UPDATE chatwork_delivery_jobs SET status=? WHERE id='job'").run(status);
    if (status === "DispatchPending" || status === "Dispatched")
      sql.exec("UPDATE chatwork_report_artifacts SET status='Sent',message_id='message' WHERE job_id='job' AND ordinal=0");
    sql.exec("UPDATE chatwork_delivery_jobs SET report_manifest_sealed=1 WHERE id='job'; UPDATE app_users SET staff_revision=2 WHERE id='field'");
    await invalidateObsoleteReportJobs(db,now,{subject:"123456",generation:1});
    assert.equal((sql.prepare("SELECT status FROM chatwork_delivery_jobs WHERE id='job'").get() as {status:string}).status,status);
  }
});

test("an unsealed report manifest cannot acquire a posting lease", async () => {
 const {sql,db}=fixture();
 sql.exec("UPDATE chatwork_production_settings SET destination_verified=1,status='DestinationVerified'");
 await createReportDelivery(db,{actorId:"field",staffRevision:1,expectedVersion:2,reportId:"report",workId:"work",jobId:"job",now});
 sql.exec("DROP TRIGGER chatwork_report_manifest_no_unseal; UPDATE chatwork_delivery_jobs SET report_manifest_sealed=0 WHERE id='job'");
 assert.equal(await claimDelivery(db,{id:"job",leaseId:"lease",now}),null);
});


test("registration seals a manifest before returning and same-report retries reuse it",async()=>{
 const {sql,db}=fixture();
 sql.exec("UPDATE chatwork_production_settings SET destination_verified=1,status='DestinationVerified'");
 const input={actorId:"field",staffRevision:1,expectedVersion:2,reportId:"report",workId:"work",jobId:"job",now};
 assert.ok(await createReportDelivery(db,input));
 assert.equal((sql.prepare("SELECT report_manifest_sealed AS n FROM chatwork_delivery_jobs WHERE id='job'").get() as {n:number}).n,1);
 assert.equal((sql.prepare("SELECT count(*) AS n FROM chatwork_report_artifacts WHERE job_id='job'").get() as {n:number}).n,2);
 assert.equal((await createReportDelivery(db,{...input,jobId:"other"}))?.id,"job");
});

test("missing attachment leaves the job unsealed and retry seals the same job after repair",async()=>{
 const {sql,db}=fixture();
 sql.exec(`UPDATE chatwork_production_settings SET destination_verified=1,status='DestinationVerified';
 UPDATE report_versions SET snapshot_json='{"imageIds":["missing"]}' WHERE id='report';`);
 const input={actorId:"field",staffRevision:1,expectedVersion:2,reportId:"report",workId:"work",jobId:"job",now};
 assert.equal(await createReportDelivery(db,input),null);
 assert.equal((sql.prepare("SELECT report_manifest_sealed AS n FROM chatwork_delivery_jobs WHERE id='job'").get() as {n:number}).n,0);
 assert.equal(await claimDelivery(db,{id:"job",leaseId:"lease",now}),null);
 sql.exec("INSERT INTO images VALUES ('missing','work')");
 assert.equal((await createReportDelivery(db,{...input,jobId:"other"}))?.id,"job");
 assert.equal((sql.prepare("SELECT report_manifest_sealed AS n FROM chatwork_delivery_jobs WHERE id='job'").get() as {n:number}).n,1);
});


test("obsolete unsealed and never-dispatched job can fail closed and permit recovery",async()=>{
 const {sql,db}=fixture();
 sql.exec(`UPDATE chatwork_production_settings SET destination_verified=1,status='DestinationVerified';
 UPDATE report_versions SET snapshot_json='{"imageIds":["missing"]}' WHERE id='report';`);
 const input={actorId:"field",staffRevision:1,expectedVersion:2,reportId:"report",workId:"work",jobId:"job",now};
 assert.equal(await createReportDelivery(db,input),null);
 sql.exec("UPDATE app_users SET staff_revision=2 WHERE id='field'");
 await invalidateObsoleteReportJobs(db,now,{subject:"old",generation:1});
 assert.equal((sql.prepare("SELECT status FROM chatwork_delivery_jobs WHERE id='job'").get() as {status:string}).status,"DispatchPending");
 await invalidateObsoleteReportJobs(db,now,{subject:"123456",generation:1});
 assert.deepEqual({...sql.prepare("SELECT status,error_code FROM chatwork_delivery_jobs WHERE id='job'").get()},{status:'Failed',error_code:'ACTOR_CHANGED_UNSEALED'});
 assert.equal(await createReportDelivery(db,{...input,staffRevision:2,jobId:"another"}),null);
});

test("an inconsistent pending artifact carrying a message ID never auto-fails",async()=>{
 const {sql,db}=fixture();
 sql.exec("UPDATE chatwork_production_settings SET destination_verified=1,status='DestinationVerified'");
 await createReportDelivery(db,{actorId:"field",staffRevision:1,expectedVersion:2,reportId:"report",workId:"work",jobId:"job",now});
 sql.exec("UPDATE chatwork_report_artifacts SET message_id='already-posted' WHERE job_id='job' AND ordinal=0; UPDATE app_users SET staff_revision=2 WHERE id='field'");
 await invalidateObsoleteReportJobs(db,now,{subject:"123456",generation:1});
 assert.equal((sql.prepare("SELECT status FROM chatwork_delivery_jobs WHERE id='job'").get() as {status:string}).status,"DispatchPending");
});

test("unsealed jobs with any evidence of dispatch, lease, result, or artifacts stay blocked",async()=>{
 for(const mode of ['dispatch','attempt','lease','deadline','message','artifact']){
  const {sql,db}=fixture();
  sql.exec(`UPDATE chatwork_production_settings SET destination_verified=1,status='DestinationVerified'; UPDATE report_versions SET snapshot_json='{"imageIds":["missing"]}' WHERE id='report';`);
  await createReportDelivery(db,{actorId:"field",staffRevision:1,expectedVersion:2,reportId:"report",workId:"work",jobId:"job",now});
  sql.exec("UPDATE app_users SET staff_revision=2 WHERE id='field'");
  if(mode==='dispatch')sql.exec("UPDATE chatwork_delivery_jobs SET task_name='task' WHERE id='job'");
  if(mode==='attempt')sql.exec("UPDATE chatwork_delivery_jobs SET dispatch_attempted_at='now' WHERE id='job'");
  if(mode==='lease')sql.exec("UPDATE chatwork_delivery_jobs SET lease_id='lease' WHERE id='job'");
  if(mode==='deadline')sql.exec("UPDATE chatwork_delivery_jobs SET lease_until=1 WHERE id='job'");
  if(mode==='message')sql.exec("UPDATE chatwork_delivery_jobs SET message_id='message' WHERE id='job'");
  if(mode==='artifact')sql.exec("INSERT INTO chatwork_report_artifacts (id,job_id,ordinal,kind,status,updated_at) VALUES ('a','job',0,'body','Pending','now')");
  await invalidateObsoleteReportJobs(db,now,{subject:"123456",generation:1});
  assert.equal((sql.prepare("SELECT status FROM chatwork_delivery_jobs WHERE id='job'").get() as {status:string}).status,"DispatchPending",mode);
 }
});

test('a never-posted job invalidated by a destination change is safely closed',async()=>{
 const {sql,db}=fixture();sql.exec("UPDATE chatwork_production_settings SET destination_verified=1,status='DestinationVerified'");
 await createReportDelivery(db,{actorId:'field',staffRevision:1,expectedVersion:2,reportId:'report',workId:'work',jobId:'job',now});
 sql.exec("UPDATE chatwork_production_settings SET version=3,room_id='other'");
 await invalidateObsoleteReportJobs(db,now,{subject:'123456',generation:1});
 assert.deepEqual({...sql.prepare("SELECT status,error_code FROM chatwork_delivery_jobs WHERE id='job'").get()},{status:'Failed',error_code:'SETTINGS_CHANGED'});
});
