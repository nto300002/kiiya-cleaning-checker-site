import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createReportManifest } from "../lib/report-manifest.ts";

function fixture(snapshot = JSON.stringify({imageIds:["img-1","img-2"]})) {
  const sql=new DatabaseSync(":memory:");
  sql.exec(`CREATE TABLE chatwork_delivery_jobs (id TEXT PRIMARY KEY,kind TEXT,status TEXT,report_id TEXT,work_id TEXT,actor_id TEXT,actor_staff_revision INTEGER);
    CREATE TABLE app_users (id TEXT PRIMARY KEY,active INTEGER,role TEXT,staff_revision INTEGER);
    CREATE TABLE works (id TEXT PRIMARY KEY,owner_id TEXT,latest_report_id TEXT);
    CREATE TABLE report_versions (id TEXT PRIMARY KEY,work_id TEXT,format TEXT,status TEXT,snapshot_json TEXT);
    CREATE TABLE images (id TEXT PRIMARY KEY,work_id TEXT);
    INSERT INTO chatwork_delivery_jobs VALUES ('job','ReportDelivery','DispatchPending','report','work','field',1);
    INSERT INTO app_users VALUES ('field',1,'field',1);
    INSERT INTO works VALUES ('work','field','report');
    INSERT INTO images VALUES ('img-1','work'),('img-2','work');`);
  sql.prepare("INSERT INTO report_versions VALUES ('report','work','markdown','Prepared',?)").run(snapshot);
  sql.exec(readFileSync(new URL("../drizzle/0010_report_delivery_artifacts.sql",import.meta.url),"utf8"));
  sql.exec(readFileSync(new URL("../drizzle/0012_report_delivery_mode.sql",import.meta.url),"utf8"));
  sql.exec("ALTER TABLE works ADD COLUMN revision INTEGER NOT NULL DEFAULT 1");
  sql.exec(readFileSync(new URL("../drizzle/0014_naive_vampiro.sql",import.meta.url),"utf8"));
  const db={
    prepare(query:string){let args:unknown[]=[];return {bind(...v:unknown[]){args=v;return this},run(){let x=sql.prepare(query).run(...args as []);return Promise.resolve({meta:{changes:Number(x.changes)}})},first<T>(){return Promise.resolve((sql.prepare(query).get(...args as []) ?? null) as T | null)}}},
    async batch(items:Array<{run():Promise<unknown>}>){sql.exec("BEGIN");try{const out=[];for(const i of items)out.push(await i.run());sql.exec("COMMIT");return out}catch(e){sql.exec("ROLLBACK");throw e}}
  } as unknown as D1Database;
  return {sql,db};
}
const input={jobId:"job",actorId:"field",staffRevision:1,now:1761700001000};
test("manifest is derived from saved report, sealed atomically, and repeat is idempotent",async()=>{
 const {sql,db}=fixture();
 assert.equal(await createReportManifest(db,input),true);
 assert.deepEqual(sql.prepare("SELECT ordinal,kind,source_id FROM chatwork_report_artifacts ORDER BY ordinal").all().map(x=>({...x})),[
  {ordinal:0,kind:"body",source_id:null},{ordinal:1,kind:"markdown",source_id:null},
  {ordinal:2,kind:"image",source_id:"img-1"},{ordinal:3,kind:"image",source_id:"img-2"}]);
 assert.equal(await createReportManifest(db,input),true);
 assert.throws(()=>sql.exec("DELETE FROM chatwork_report_artifacts WHERE id=(SELECT id FROM chatwork_report_artifacts LIMIT 1)"));
 assert.throws(()=>sql.exec("UPDATE chatwork_report_artifacts SET source_id='different' WHERE kind='image'"));
 assert.throws(()=>sql.exec("INSERT INTO chatwork_report_artifacts VALUES ('extra','job',5,'body',NULL,'Pending',NULL,NULL,'now')"));
 assert.throws(()=>sql.exec("UPDATE chatwork_delivery_jobs SET report_manifest_sealed=0 WHERE id='job'"));
});
test("missing or foreign images, stale staff and malformed snapshots do not create a partial manifest",async()=>{
 for(const mode of ["missing","foreign","stale","malformed","duplicates"]) {
  const {sql,db}=fixture(mode==="malformed"?'{"imageIds":"invalid"}':mode==="duplicates"?'{"imageIds":["img-1","img-1"]}':undefined);
  if(mode==="missing")sql.exec("DELETE FROM images WHERE id='img-2'");
  if(mode==="foreign")sql.exec("UPDATE images SET work_id='elsewhere' WHERE id='img-2'");
  if(mode==="stale")sql.exec("UPDATE app_users SET staff_revision=2");
  assert.equal(await createReportManifest(db,input),false,mode);
  assert.equal((sql.prepare("SELECT count(*) AS n FROM chatwork_report_artifacts").get() as {n:number}).n,0,mode);
  assert.equal((sql.prepare("SELECT report_manifest_sealed AS n FROM chatwork_delivery_jobs").get() as {n:number}).n,0,mode);
 }
});

test("if sealing fails after insertion, the entire new manifest is rolled back",async()=>{
 const {sql,db}=fixture();
 sql.exec("CREATE TRIGGER simulate_seal_failure BEFORE UPDATE OF report_manifest_sealed ON chatwork_delivery_jobs WHEN NEW.report_manifest_sealed=1 BEGIN SELECT RAISE(IGNORE); END;");
 await assert.rejects(createReportManifest(db,input));
 assert.equal((sql.prepare("SELECT count(*) AS n FROM chatwork_report_artifacts").get() as {n:number}).n,0);
 assert.equal((sql.prepare("SELECT report_manifest_sealed AS n FROM chatwork_delivery_jobs").get() as {n:number}).n,0);
});
