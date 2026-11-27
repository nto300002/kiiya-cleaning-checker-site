import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {DatabaseSync} from 'node:sqlite';
import {resetWork} from '../lib/work-reset.ts';
function fixture(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(`CREATE TABLE works(id TEXT PRIMARY KEY,owner_id TEXT,day TEXT,revision INTEGER,data_json TEXT,status TEXT,first_pressed_at TEXT,updated_at TEXT);
 CREATE TABLE app_users(id TEXT PRIMARY KEY,active INTEGER,role TEXT);
 CREATE TABLE work_changes(id TEXT,work_id TEXT,actor_id TEXT,revision INTEGER,before_json TEXT,after_json TEXT,changed_at TEXT);
 CREATE TABLE report_snapshot_candidates(id TEXT,work_id TEXT,status TEXT);
 CREATE TABLE chatwork_delivery_jobs(id TEXT,work_id TEXT,kind TEXT,status TEXT,report_manifest_sealed INTEGER,error_code TEXT,message_id TEXT,lease_id TEXT,lease_until INTEGER,task_name TEXT,dispatch_attempted_at TEXT,delivery_mode TEXT);
 CREATE TABLE chatwork_report_artifacts(job_id TEXT,status TEXT,message_id TEXT,error_code TEXT);
 CREATE TABLE chatwork_delivery_events(job_id TEXT,action TEXT,detail_json TEXT);
 INSERT INTO works VALUES ('w','u','2026-11-05',1,'old','Draft','time','old'); INSERT INTO app_users VALUES('u',1,'field');`);
 const db={prepare(q:string){let a:unknown[]=[];return{bind(...v:unknown[]){a=v;return this},async run(){return {meta:{changes:Number(sql.prepare(q).run(...a as []).changes)}}}}},async batch(stmts:any[]){sql.exec('BEGIN');try{const r=[];for(const s of stmts)r.push(await s.run());sql.exec('COMMIT');return r}catch(e){sql.exec('ROLLBACK');throw e}}} as unknown as D1Database;
 return {sql,db};
}
const input={workId:'w',actorId:'u',day:'2026-11-05',revision:1,nextJson:'new',changeId:'id',now:'now'};
test('本日の自分の作業を監査付きで初期化する',async()=>{const {sql,db}=fixture();assert.equal(await resetWork(db,input),true);assert.deepEqual({...sql.prepare('SELECT revision,data_json,status,first_pressed_at FROM works').get()},{revision:2,data_json:'new',status:'Draft',first_pressed_at:null});assert.equal((sql.prepare('SELECT count(*) n FROM work_changes').get() as any).n,1)});
test('未送信の候補を閉じて初期化する',async()=>{const {sql,db}=fixture();sql.exec("INSERT INTO report_snapshot_candidates VALUES ('c','w','Active')");assert.equal(await resetWork(db,input),true);assert.equal((sql.prepare('SELECT status FROM report_snapshot_candidates').get() as any).status,'Closed')});
test('配送中、他人、過去日、版の競合では初期化しない',async()=>{for(const sqlChange of ["INSERT INTO chatwork_delivery_jobs (id,work_id,kind,status) VALUES ('j','w','ReportDelivery','Posting')","UPDATE works SET owner_id='other'","UPDATE works SET day='2026-11-04'","UPDATE works SET revision=2","UPDATE app_users SET active=0"]){const {sql,db}=fixture();sql.exec(sqlChange);assert.equal(await resetWork(db,input),false);assert.equal((sql.prepare('SELECT count(*) n FROM work_changes').get() as any).n,0)}});
