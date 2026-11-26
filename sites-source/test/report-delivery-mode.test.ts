import { test } from "node:test";
import { strict as assert } from "node:assert";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

test("migration preserves existing jobs and fixes their delivery mode", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE chatwork_delivery_jobs(id TEXT PRIMARY KEY, kind TEXT NOT NULL); INSERT INTO chatwork_delivery_jobs VALUES('old','ReportDelivery');");
  db.exec(readFileSync(new URL("../drizzle/0012_report_delivery_mode.sql", import.meta.url), "utf8"));
  assert.equal((db.prepare("SELECT delivery_mode FROM chatwork_delivery_jobs WHERE id='old'").get() as {delivery_mode:string}).delivery_mode, "production");
  db.exec("INSERT INTO chatwork_delivery_jobs(id,kind,delivery_mode) VALUES('test','ReportDelivery','test')");
  assert.throws(() => db.exec("UPDATE chatwork_delivery_jobs SET delivery_mode='production' WHERE id='test'"));
  assert.throws(() => db.exec("UPDATE chatwork_delivery_jobs SET delivery_mode='test' WHERE id='old'"));
  assert.throws(() => db.exec("INSERT INTO chatwork_delivery_jobs VALUES('invalid','ReportDelivery','other')"));
  assert.throws(() => db.exec("INSERT INTO chatwork_delivery_jobs VALUES('verification','DestinationVerification','test')"));
  db.exec("UPDATE chatwork_delivery_jobs SET delivery_mode='test' WHERE id='test'");
});
