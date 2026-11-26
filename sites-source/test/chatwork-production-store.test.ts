import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { confirmAccount, confirmRoom, connectAccount, publicDeliverySettings } from "../lib/chatwork-production-store.ts";

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  const schema = readFileSync(new URL("../drizzle/0003_harsh_puff_adder.sql", import.meta.url), "utf8");
  for (const sql of schema.split("--> statement-breakpoint")) {
    const trimmed = sql.trim();
    if (trimmed && !trimmed.startsWith("ALTER TABLE")) sqlite.exec(trimmed);
  }
  sqlite.exec("CREATE TABLE app_users (id TEXT PRIMARY KEY, email TEXT, display_name TEXT, role TEXT, active INTEGER NOT NULL, manage_chatwork INTEGER NOT NULL, staff_revision INTEGER NOT NULL, created_at TEXT)");
  sqlite.exec("INSERT INTO app_users (id,email,display_name,role,active,manage_chatwork,staff_revision,created_at) VALUES ('staff-a','a@example.test','A','field',1,1,1,'2026-10-28'),('staff-b','b@example.test','B','field',1,1,1,'2026-10-28')");
  sqlite.exec("INSERT INTO chatwork_production_settings (id,updated_at) VALUES ('production','2026-10-28T00:00:00Z')");
  sqlite.exec(readFileSync(new URL("../drizzle/0008_chatwork-delivery.sql", import.meta.url), "utf8"));
  const db = {
    prepare(sql: string) {
      let args: unknown[] = [];
      return {
        bind(...values: unknown[]) { args = values; return this; },
        run() { const result = sqlite.prepare(sql).run(...args as []); return Promise.resolve({ meta: { changes: Number(result.changes) } }); },
        first<T>() { return Promise.resolve(sqlite.prepare(sql).get(...args as []) as T | null); },
      };
    },
    async batch(statements: Array<{ run(): Promise<{ meta: { changes: number } }> }>) {
      sqlite.exec("BEGIN");
      try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec("COMMIT"); return results; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
  return { sqlite, db: db as unknown as D1Database };
}

const now = "2026-10-28T01:00:00.000Z";
function row(sqlite: DatabaseSync) { return sqlite.prepare("SELECT * FROM chatwork_production_settings WHERE id='production'").get() as Record<string, unknown>; }
function audits(sqlite: DatabaseSync) { return Number((sqlite.prepare("SELECT COUNT(*) AS n FROM chatwork_production_audit").get() as { n: number }).n); }

test("OAuth account storage and audit roll back together, including a stale version", async () => {
  const { sqlite, db } = fixture();
  sqlite.exec("CREATE TRIGGER block_audit BEFORE INSERT ON chatwork_production_audit BEGIN SELECT RAISE(ABORT, 'audit failed'); END");
  await assert.rejects(connectAccount(db, { actorId: "staff-a", staffRevision: 1, expectedVersion: 0, accountId: "acct-a", displayName: "担当者", tokenCipher: "encrypted", expiresAt: 123, now, auditId: "audit-1" }));
  assert.equal(row(sqlite).account_id, null); assert.equal(audits(sqlite), 0);
  sqlite.exec("DROP TRIGGER block_audit");
  assert.equal(await connectAccount(db, { actorId: "staff-a", staffRevision: 1, expectedVersion: 1, accountId: "acct-a", displayName: "担当者", tokenCipher: "encrypted", expiresAt: 123, now, auditId: "audit-2" }), false);
  assert.equal(row(sqlite).account_id, null); assert.equal(audits(sqlite), 0);
  assert.equal(await connectAccount(db, { actorId: "staff-a", staffRevision: 1, expectedVersion: 0, accountId: "acct-a", displayName: "担当者", tokenCipher: "encrypted", expiresAt: 123, now, auditId: "audit-3" }), true);
  assert.equal(row(sqlite).status, "AccountConfirmationRequired"); assert.equal(audits(sqlite), 1);
  assert.equal(await connectAccount(db, { actorId: "staff-a", staffRevision: 1, expectedVersion: 1, accountId: "acct-b", displayName: "別人", tokenCipher: "encrypted2", expiresAt: 124, now, auditId: "audit-4" }), true);
  assert.equal(row(sqlite).account_confirmed, 0); assert.equal(row(sqlite).room_id, null);
  sqlite.exec("UPDATE chatwork_production_settings SET account_confirmed=1,room_id='123',room_name='業務ルーム',destination_verified=1,status='DestinationVerified' WHERE id='production'");
  assert.equal(await connectAccount(db, { actorId: "staff-a", staffRevision: 1, expectedVersion: 2, accountId: "acct-b", displayName: "担当者", tokenCipher: "encrypted3", expiresAt: 125, now, auditId: "audit-5" }), true);
  assert.equal(row(sqlite).room_id, "123");
  assert.equal(row(sqlite).destination_verified, 0);
  assert.equal(row(sqlite).status, "DestinationVerificationRequired");
});

test("demoted field staff cannot save a Chatwork connection after OAuth completes", async () => {
  const { sqlite, db } = fixture();
  sqlite.exec("UPDATE app_users SET role='normal',staff_revision=2 WHERE id='staff-a'");
  const saved = await connectAccount(db, { actorId: "staff-a", staffRevision: 1, expectedVersion: 0, accountId: "acct-a", displayName: "担当者", tokenCipher: "encrypted", expiresAt: 123, now, auditId: "demoted" });
  assert.equal(saved, false);
  assert.equal(row(sqlite).account_id, null);
  assert.equal(audits(sqlite), 0);
});

test("account confirmation is atomic and cannot be repeated with an old version", async () => {
  const { sqlite, db } = fixture();
  sqlite.exec("UPDATE chatwork_production_settings SET version=1,account_id='acct-a',display_name='担当者',status='AccountConfirmationRequired'");
  sqlite.exec("CREATE TRIGGER block_audit BEFORE INSERT ON chatwork_production_audit BEGIN SELECT RAISE(ABORT, 'audit failed'); END");
  await assert.rejects(confirmAccount(db, { actorId: "staff-a", staffRevision: 1, expectedVersion: 1, accountId: "acct-a", now, auditId: "audit-1" }));
  assert.equal(row(sqlite).account_confirmed, 0); assert.equal(audits(sqlite), 0);
  sqlite.exec("DROP TRIGGER block_audit");
  assert.equal(await confirmAccount(db, { actorId: "staff-a", staffRevision: 1, expectedVersion: 1, accountId: "acct-a", now, auditId: "audit-2" }), true);
  assert.equal(await confirmAccount(db, { actorId: "staff-a", staffRevision: 1, expectedVersion: 1, accountId: "acct-a", now, auditId: "audit-3" }), false);
  assert.equal(row(sqlite).account_confirmed, 1); assert.equal(audits(sqlite), 1);
});

test("room confirmation binds candidate, version, actor and 10 minute expiry atomically", async () => {
  const { sqlite, db } = fixture();
  sqlite.exec("UPDATE chatwork_production_settings SET version=2,account_id='acct-a',display_name='担当者',account_confirmed=1");
  sqlite.prepare("INSERT INTO chatwork_room_candidates (id,actor_id,account_id,expected_version,room_id,room_name,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?)")
    .run("candidate", "staff-a", "acct-a", 2, "123", "業務ルーム", Date.parse(now) + 600_000, now);
  const attempt = (actorId: string, at: number, expectedVersion = 2, auditId = crypto.randomUUID()) => confirmRoom(db, { actorId, staffRevision: 1, candidateId: "candidate", expectedVersion, now: new Date(at).toISOString(), nowMs: at, auditId });
  assert.equal(await attempt("staff-b", Date.parse(now)), false);
  sqlite.exec("UPDATE chatwork_production_settings SET account_id='acct-b' WHERE id='production'");
  assert.equal(await attempt("staff-a", Date.parse(now)), false);
  sqlite.exec("UPDATE chatwork_production_settings SET account_id='acct-a' WHERE id='production'");
  assert.equal(await attempt("staff-a", Date.parse(now) + 600_000), false);
  assert.equal(await attempt("staff-a", Date.parse(now) + 600_001), false);
  assert.equal(await attempt("staff-a", Date.parse(now), 1), false);
  assert.equal(audits(sqlite), 0);
  sqlite.exec("CREATE TRIGGER block_audit BEFORE INSERT ON chatwork_production_audit BEGIN SELECT RAISE(ABORT, 'audit failed'); END");
  await assert.rejects(attempt("staff-a", Date.parse(now)));
  assert.equal(row(sqlite).room_id, null);
  assert.equal((sqlite.prepare("SELECT consumed_at FROM chatwork_room_candidates WHERE id='candidate'").get() as { consumed_at: string | null }).consumed_at, null);
  sqlite.exec("DROP TRIGGER block_audit");
  sqlite.exec("CREATE TRIGGER block_consume BEFORE UPDATE OF consumed_at ON chatwork_room_candidates BEGIN SELECT RAISE(ABORT, 'consume failed'); END");
  await assert.rejects(attempt("staff-a", Date.parse(now)));
  assert.equal(row(sqlite).room_id, null); assert.equal(audits(sqlite), 0);
  sqlite.exec("DROP TRIGGER block_consume");
  assert.equal(await attempt("staff-a", Date.parse(now)), true);
  assert.equal(row(sqlite).room_name, "業務ルーム"); assert.equal(row(sqlite).status, "DestinationVerificationRequired");
  assert.equal(row(sqlite).destination_verified, 0); assert.equal(audits(sqlite), 1);
  assert.equal(await attempt("staff-a", Date.parse(now)), false); assert.equal(audits(sqlite), 1);
});

test("public delivery state shows a saved destination as awaiting posting, without sensitive IDs", () => {
  const { sqlite } = fixture();
  sqlite.exec("UPDATE chatwork_production_settings SET account_id='acct-a',display_name='担当者',account_confirmed=1,room_id='123',room_name='業務ルーム',status='DestinationVerificationRequired',token_cipher='encrypted'");
  const value = publicDeliverySettings(row(sqlite) as Parameters<typeof publicDeliverySettings>[0], Date.parse(now));
  assert.equal(value.setupReason, "RoomVerificationRequired");
  assert.equal(value.roomName, "業務ルーム");
  assert.equal(value.sourceDisplayName, "担当者");
  assert.equal(value.deliveryEnabled, false);
  assert.equal(value.configurationVersion, null);
  const json = JSON.stringify(value);
  for (const secret of ["acct-a", "123", "encrypted"]) assert.equal(json.includes(secret), false);
});

test("a revoked actor cannot save an OAuth connection, account confirmation, or room selection", async () => {
  const { sqlite, db } = fixture();
  sqlite.exec("UPDATE app_users SET active=0,staff_revision=2 WHERE id='staff-a'");
  assert.equal(await connectAccount(db, { actorId: "staff-a", staffRevision: 1, expectedVersion: 0, accountId: "acct-a", displayName: "A", tokenCipher: "encrypted", expiresAt: 123, now, auditId: "revoked-oauth" }), false);
  assert.equal(row(sqlite).account_id, null);
  sqlite.exec("UPDATE chatwork_production_settings SET version=1,account_id='acct-a',account_confirmed=0");
  assert.equal(await confirmAccount(db, { actorId: "staff-a", staffRevision: 1, expectedVersion: 1, accountId: "acct-a", now, auditId: "revoked-confirm" }), false);
  sqlite.exec("UPDATE chatwork_production_settings SET account_confirmed=1");
  sqlite.prepare("INSERT INTO chatwork_room_candidates (id,actor_id,account_id,expected_version,room_id,room_name,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?)")
    .run("candidate-revoked", "staff-a", "acct-a", 1, "123", "業務ルーム", Date.parse(now) + 600_000, now);
  assert.equal(await confirmRoom(db, { actorId: "staff-a", staffRevision: 1, candidateId: "candidate-revoked", expectedVersion: 1, now, nowMs: Date.parse(now), auditId: "revoked-room" }), false);
  assert.equal(row(sqlite).room_id, null); assert.equal(audits(sqlite), 0);
  sqlite.exec("UPDATE app_users SET active=1,staff_revision=3 WHERE id='staff-a'");
  assert.equal(await confirmRoom(db, { actorId: "staff-a", staffRevision: 1, candidateId: "candidate-revoked", expectedVersion: 1, now, nowMs: Date.parse(now), auditId: "old-permission" }), false);
});

test("account and room changes wait while an external POST is in flight", async () => {
  const { sqlite, db } = fixture();
  sqlite.exec("UPDATE chatwork_production_settings SET version=1,account_id='acct-a',account_confirmed=1");
  sqlite.prepare("INSERT INTO chatwork_delivery_jobs (id,kind,actor_id,actor_staff_revision,settings_version,account_id,room_id,room_name,status,created_at,updated_at) VALUES ('posting','DestinationVerification','staff-a',1,1,'acct-a','123','業務ルーム','Posting',?,?)").run(now, now);
  const changed = await connectAccount(db, { actorId: "staff-a", staffRevision: 1, expectedVersion: 1, accountId: "acct-b", displayName: "別人", tokenCipher: "encrypted", expiresAt: 123, now, auditId: "blocked-account" });
  assert.equal(changed, false);
  sqlite.prepare("INSERT INTO chatwork_room_candidates (id,actor_id,account_id,expected_version,room_id,room_name,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?)")
    .run("candidate-inflight", "staff-a", "acct-a", 1, "456", "新ルーム", Date.parse(now) + 600_000, now);
  const room = await confirmRoom(db, { actorId: "staff-a", staffRevision: 1, expectedVersion: 1, candidateId: "candidate-inflight", now, nowMs: Date.parse(now), auditId: "blocked-room" });
  assert.equal(room, false);
  assert.equal(audits(sqlite), 0);
  assert.equal(row(sqlite).version, 1);
});
