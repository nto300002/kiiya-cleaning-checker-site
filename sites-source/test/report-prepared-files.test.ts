import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
test('prepared artifact metadata cannot be rebound or removed',()=>{
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON; CREATE TABLE chatwork_report_artifacts(id TEXT PRIMARY KEY); INSERT INTO chatwork_report_artifacts VALUES (\'artifact\')');
 db.exec(readFileSync(new URL('../drizzle/0013_report_prepared_files.sql',import.meta.url),'utf8'));
 db.exec("INSERT INTO chatwork_report_prepared_files(artifact_id,object_key,sha256,bytes,mime,file_name,created_at) VALUES('artifact','key','abc',12,'image/png','file.png','now')");
 assert.throws(()=>db.exec("UPDATE chatwork_report_prepared_files SET object_key='other'"));
 assert.throws(()=>db.exec('DELETE FROM chatwork_report_prepared_files'));
 assert.throws(()=>db.exec("INSERT INTO chatwork_report_prepared_files(artifact_id,object_key,sha256,bytes,mime,created_at) VALUES('missing','key2','abc',12,'image/png','now')"));
});
