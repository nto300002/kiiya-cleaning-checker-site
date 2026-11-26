import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {reserveSnapshot, fenceSnapshotRequest, fenceSnapshotScope, findSnapshot, closeSnapshot} from '../lib/report-snapshot-reservation.ts';

function fixture(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(`CREATE TABLE works(id TEXT PRIMARY KEY, owner_id TEXT, revision INTEGER);
 CREATE TABLE app_users(id TEXT PRIMARY KEY,active INTEGER,role TEXT,staff_revision INTEGER);
 CREATE TABLE chatwork_delivery_jobs(id TEXT PRIMARY KEY,report_id TEXT,work_id TEXT,kind TEXT,status TEXT,report_manifest_sealed INTEGER,error_code TEXT,message_id TEXT,lease_id TEXT,lease_until INTEGER,task_name TEXT,dispatch_attempted_at TEXT,delivery_mode TEXT);
 CREATE TABLE chatwork_report_artifacts(job_id TEXT,status TEXT,message_id TEXT,error_code TEXT);
 CREATE TABLE chatwork_delivery_events(job_id TEXT,action TEXT,detail_json TEXT);
 INSERT INTO works VALUES('work','actor',1); INSERT INTO app_users VALUES('actor',1,'field',2);`);
 sql.exec(readFileSync(new URL('../drizzle/0014_naive_vampiro.sql',import.meta.url),'utf8'));
 sql.exec(readFileSync(new URL('../drizzle/0015_quiet_darkhawk.sql',import.meta.url),'utf8'));
 const db={prepare(query:string){let args:unknown[]=[];return {bind(...v:unknown[]){args=v;return this},run(){const x=sql.prepare(query).run(...args as []);return Promise.resolve({meta:{changes:Number(x.changes)}})},first<T>(){return Promise.resolve((sql.prepare(query).get(...args as [])??null) as T|null)}}},async batch(items:Array<{run():Promise<unknown>}>){sql.exec('BEGIN');try{const r=[];for(const x of items)r.push(await x.run());sql.exec('COMMIT');return r}catch(e){sql.exec('ROLLBACK');throw e}}} as unknown as D1Database;
 return {sql,db};
}
const base={workId:'work',actorId:'actor',workRevision:1,staffRevision:2,epoch:0,body:'report',snapshotJson:'{"imageIds":[]}',fingerprint:'a'.repeat(64)};
test('lost response and another device recover one identical candidate',async()=>{
 const {sql,db}=fixture();
 assert.deepEqual(await reserveSnapshot(db,{...base,requestId:'r1',candidateId:'c1'}),{candidateId:'c1'});
 assert.deepEqual(await reserveSnapshot(db,{...base,requestId:'r1',candidateId:'different'}),{candidateId:'c1'});
 assert.deepEqual(await reserveSnapshot(db,{...base,requestId:'r2',candidateId:'c2'}),{candidateId:'c1'});
 assert.equal(await reserveSnapshot(db,{...base,requestId:'r1',candidateId:'c3',body:'altered',fingerprint:'b'.repeat(64)}),null);
 assert.equal(await reserveSnapshot(db,{...base,requestId:'r1',candidateId:'c3',actorId:'other'}),null);
 assert.equal((sql.prepare('SELECT count(*) n FROM report_snapshot_candidates').get() as {n:number}).n,1);
 assert.equal((await findSnapshot(db,{workId:'work',actorId:'actor'}))?.id,'c1');
});
test('conflicting content or a fenced late request never creates a candidate',async()=>{
 const {sql,db}=fixture();
 assert.equal(await fenceSnapshotRequest(db,{workId:'work',actorId:'actor',workRevision:1,requestId:'r1'}),true);
 assert.equal(await reserveSnapshot(db,{...base,requestId:'r1',candidateId:'c1'}),null);
 assert.deepEqual(await reserveSnapshot(db,{...base,requestId:'r2',candidateId:'c2'}),{candidateId:'c2'});
 assert.equal(await reserveSnapshot(db,{...base,body:'other',fingerprint:'b'.repeat(64),requestId:'r3',candidateId:'c3'}),null);
 assert.equal((sql.prepare('SELECT count(*) n FROM report_snapshot_candidates').get() as {n:number}).n,1);
 assert.equal(await fenceSnapshotRequest(db,{workId:'work',actorId:'actor',workRevision:1,requestId:'r2'}),false);
});
test('stale or unauthorized staff cannot reserve or read a candidate',async()=>{
 const {sql,db}=fixture();
 sql.exec("UPDATE app_users SET staff_revision=3 WHERE id='actor'");
 assert.equal(await reserveSnapshot(db,{...base,requestId:'r1',candidateId:'c1'}),null);
 assert.equal(await findSnapshot(db,{workId:'work',actorId:'other'}),null);
});
test('the owner can find and safely close an obsolete staff-version candidate',async()=>{
 const {sql,db}=fixture();
 await reserveSnapshot(db,{...base,requestId:'old',candidateId:'old-candidate'});
 sql.exec("UPDATE app_users SET staff_revision=3 WHERE id='actor'");
 assert.deepEqual(await findSnapshot(db,{workId:'work',actorId:'actor'}),{id:'old-candidate',stale:true});
 assert.equal(await reserveSnapshot(db,{...base,staffRevision:3,requestId:'new',candidateId:'new-candidate'}),null);
 assert.equal(await closeSnapshot(db,{workId:'work',actorId:'actor',candidateId:'old-candidate'}),true);
 assert.equal(await reserveSnapshot(db,{...base,staffRevision:3,requestId:'late',candidateId:'late-candidate'}),null);
 assert.deepEqual(await reserveSnapshot(db,{...base,staffRevision:3,epoch:1,requestId:'new',candidateId:'new-candidate'}),{candidateId:'new-candidate'});
});
test('snapshot data and request fences cannot be rewritten or removed',async()=>{
 const {sql,db}=fixture();
 assert.deepEqual(await reserveSnapshot(db,{...base,requestId:'r1',candidateId:'c1'}),{candidateId:'c1'});
 assert.throws(()=>sql.exec("UPDATE report_snapshot_candidates SET body='different' WHERE id='c1'"));
 assert.throws(()=>sql.exec("UPDATE report_snapshot_requests SET candidate_id='elsewhere' WHERE id='r1'"));
 assert.throws(()=>sql.exec("DELETE FROM report_snapshot_requests WHERE id='r1'"));
 sql.exec("UPDATE report_snapshot_candidates SET status='Closed' WHERE id='c1'");
 assert.throws(()=>sql.exec("UPDATE report_snapshot_candidates SET status='Active' WHERE id='c1'"));
});
test('a scope fence prevents an old request with a lost request ID from arriving later',async()=>{
 const {sql,db}=fixture();
 assert.equal(await fenceSnapshotScope(db,{workId:'work',actorId:'actor',workRevision:1,expectedEpoch:0}),true);
 assert.equal(await reserveSnapshot(db,{...base,requestId:'late',candidateId:'old'}),null);
 assert.deepEqual(await reserveSnapshot(db,{...base,epoch:1,requestId:'new',candidateId:'new'}),{candidateId:'new'});
 assert.equal(await fenceSnapshotScope(db,{workId:'work',actorId:'actor',workRevision:1,expectedEpoch:1}),false);
 assert.equal((sql.prepare('SELECT count(*) n FROM report_snapshot_candidates').get() as {n:number}).n,1);
});
test('closing an unused snapshot fences all late requests and refuses a snapshot with a delivery job',async()=>{
 const {sql,db}=fixture();
 await reserveSnapshot(db,{...base,requestId:'r1',candidateId:'c1'});
 sql.exec("INSERT INTO chatwork_delivery_jobs(id,report_id,work_id,kind,status) VALUES('job','c1','work','ReportDelivery','Unknown')");
 assert.equal(await closeSnapshot(db,{workId:'work',actorId:'actor',candidateId:'c1'}),false);
 sql.exec("DELETE FROM chatwork_delivery_jobs WHERE id='job'");
 assert.equal(await closeSnapshot(db,{workId:'work',actorId:'other',candidateId:'c1'}),false);
 assert.equal(await closeSnapshot(db,{workId:'work',actorId:'actor',candidateId:'c1'}),true);
 assert.equal(await reserveSnapshot(db,{...base,requestId:'late',candidateId:'late'}),null);
 assert.deepEqual(await reserveSnapshot(db,{...base,epoch:1,requestId:'r2',candidateId:'c2'}),{candidateId:'c2'});
 assert.equal((sql.prepare('SELECT epoch FROM report_snapshot_scopes').get() as {epoch:number}).epoch,1);
});
