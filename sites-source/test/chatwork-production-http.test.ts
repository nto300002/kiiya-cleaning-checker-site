import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { build } from "esbuild";
import { seal, sha256 } from "../lib/chatwork.ts";
import { makeWork, activeTasks } from "../lib/domain.ts";

const origin = "https://kiiya-cleaning-checker.hherocl278.chatgpt.site";
const tokenKey = Buffer.alloc(32, 7).toString("base64url");
const testEnv: { SITE_ASSET_ACCESS_TOKEN?: string; DB?: D1Database; CHATWORK_PRODUCTION_CLIENT_ID?: string; CHATWORK_PRODUCTION_CLIENT_SECRET?: string; CHATWORK_PRODUCTION_TOKEN_KEY?: string; APP_STAFF_USER_IDS?: string; APP_ADMIN_USER_ID?: string; DELIVERY_WORKER_SHARED_SECRET?: string; DELIVERY_CONTROL_SECRET?: string; DELIVERY_CONTROL_OPERATOR_ID?: string; DELIVERY_WORKER_IDENTITY_AUDIENCE?: string } = {
  SITE_ASSET_ACCESS_TOKEN: "test-site-asset-secret", APP_STAFF_USER_IDS: "manager,worker", APP_ADMIN_USER_ID: "manager", CHATWORK_PRODUCTION_CLIENT_ID: "local-client", CHATWORK_PRODUCTION_CLIENT_SECRET: "local-secret", CHATWORK_PRODUCTION_TOKEN_KEY: tokenKey, DELIVERY_WORKER_SHARED_SECRET: "local-secret-for-worker-only", DELIVERY_CONTROL_SECRET: "local-control-secret-for-only-operator", DELIVERY_CONTROL_OPERATOR_ID: "test-operator", DELIVERY_WORKER_IDENTITY_AUDIENCE: "https://site.example/worker",
};
(globalThis as typeof globalThis & { __kiiyaTestEnv?: typeof testEnv }).__kiiyaTestEnv = testEnv;
async function route(entry: string) {
  const result = await build({ entryPoints: [fileURLToPath(new URL(entry, import.meta.url))], bundle: true, write: false,
    platform: "node", format: "esm", target: "es2022", tsconfig: fileURLToPath(new URL("../tsconfig.json", import.meta.url)),
    plugins: [{ name: "mock-cloudflare-env", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/worker-identity$/ }, () => ({ path: "worker-id", namespace: "test-env" }));
      builder.onLoad({ filter: /^worker-id$/, namespace: "test-env" }, () => ({ contents: "export async function verifyWorkerIdentity(token) { return token === 'valid-worker' ? '123456' : token === 'old-worker' ? '999999' : token === 'new-worker' ? '888888' : null }", loader: "js" }));
      builder.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: "env", namespace: "test-env" }));
      builder.onLoad({ filter: /^env$/, namespace: "test-env" }, () => ({ contents: "export const env = globalThis.__kiiyaTestEnv", loader: "js" }));
    } }] });
  const data = Buffer.from(result.outputFiles[0].contents).toString("base64");
  return import(`data:text/javascript;base64,${data}`) as Promise<{ GET(request: Request, context: { params: Promise<{ path: string[] }> }): Promise<Response>; POST(request: Request, context: { params: Promise<{ path: string[] }> }): Promise<Response>; PUT(request: Request, context: { params: Promise<{ path: string[] }> }): Promise<Response> }>;
}
const production = await route("../app/api/chatwork/production/[...path]/route.ts");
const app = await route("../app/api/[...path]/route.ts");

function fixture(withSettings = true, onWorkerRead?: (sqlite: DatabaseSync) => void, onTokenJobRead?: (sqlite: DatabaseSync) => void) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("CREATE TABLE app_users (id TEXT PRIMARY KEY, email TEXT, display_name TEXT, role TEXT, active INTEGER NOT NULL, manage_chatwork INTEGER NOT NULL DEFAULT 0, staff_revision INTEGER NOT NULL DEFAULT 1, created_at TEXT)");
  sqlite.exec("INSERT INTO app_users VALUES ('manager','manager@example.test','担当者','field',1,1,1,'2026-10-28'),('worker','worker@example.test','職員','normal',1,0,1,'2026-10-28'),('legacy','legacy@example.test','旧職員','it',1,1,1,'2026-10-28')");
  const schema = readFileSync(new URL("../drizzle/0003_harsh_puff_adder.sql", import.meta.url), "utf8");
  for (const sql of schema.split("--> statement-breakpoint")) {
    const trimmed = sql.trim();
    if (trimmed && !trimmed.startsWith("ALTER TABLE")) sqlite.exec(trimmed);
  }
  if (withSettings) sqlite.exec("INSERT INTO chatwork_production_settings (id,updated_at) VALUES ('production','2026-10-28T00:00:00Z')");
  sqlite.exec(readFileSync(new URL("../drizzle/0005_staff-display-name-history.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../drizzle/0006_staff-two-roles.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../drizzle/0007_robust_namorita.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../drizzle/0008_chatwork-delivery.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../drizzle/0009_delivery_identity.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../drizzle/0010_report_delivery_artifacts.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../drizzle/0011_test_delivery_permits.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../drizzle/0012_report_delivery_mode.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../drizzle/0013_report_prepared_files.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../drizzle/0014_naive_vampiro.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../drizzle/0015_quiet_darkhawk.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../drizzle/0016_shiny_scream.sql", import.meta.url), "utf8"));
  sqlite.exec("INSERT INTO chatwork_delivery_runtime (id,updated_at) VALUES ('production','2026-10-29')");
  sqlite.exec("UPDATE chatwork_delivery_runtime SET worker_subject='123456',approval_generation=1");
  sqlite.exec("CREATE TABLE works (id TEXT PRIMARY KEY, day TEXT, owner_id TEXT, revision INTEGER, status TEXT, data_json TEXT, first_pressed_at TEXT, latest_report_id TEXT, created_at TEXT, updated_at TEXT)");
  sqlite.exec("CREATE TABLE images (id TEXT PRIMARY KEY, work_id TEXT, object_key TEXT, file_name TEXT, mime TEXT, bytes INTEGER, uploaded_at TEXT)");
  sqlite.exec("CREATE TABLE report_versions (id TEXT PRIMARY KEY, work_id TEXT, sequence INTEGER, format TEXT, status TEXT, body TEXT, snapshot_json TEXT, created_at TEXT)");
  sqlite.exec("CREATE TABLE master_revisions (id TEXT PRIMARY KEY, version INTEGER NOT NULL, data_json TEXT NOT NULL, effective_day TEXT NOT NULL, created_at TEXT NOT NULL)");
  sqlite.exec("CREATE TABLE work_changes (id TEXT PRIMARY KEY, work_id TEXT NOT NULL, actor_id TEXT NOT NULL, revision INTEGER NOT NULL, before_json TEXT NOT NULL, after_json TEXT NOT NULL, changed_at TEXT NOT NULL)");
  sqlite.exec("CREATE TABLE chatwork_oauth_attempts (state_hash TEXT PRIMARY KEY, actor_id TEXT, consumed_at TEXT)");
  let batchQueue: Promise<void> = Promise.resolve();
  const db = {
    prepare(sql: string) {
      let args: unknown[] = [];
      return {
        bind(...values: unknown[]) { args = values; return this; },
        run() { const result = sqlite.prepare(sql).run(...args as []); return Promise.resolve({ meta: { changes: Number(result.changes) } }); },
        first<T>() { const row = sqlite.prepare(sql).get(...args as []) as T | null; if (onWorkerRead && sql.startsWith("SELECT worker_subject,approval_generation FROM chatwork_delivery_runtime")) onWorkerRead(sqlite); if (onTokenJobRead && sql.startsWith("SELECT j.* FROM chatwork_delivery_jobs j JOIN chatwork_production_settings")) onTokenJobRead(sqlite); return Promise.resolve(row); },
        all<T>() { return Promise.resolve({ results: sqlite.prepare(sql).all(...args as []) as T[] }); },
      };
    },
    async batch(statements: Array<{ run(): Promise<{ meta: { changes: number } }> }>) {
      const previous = batchQueue;
      let release!: () => void;
      batchQueue = new Promise<void>(resolve => { release = resolve; });
      await previous;
      sqlite.exec("BEGIN");
      try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec("COMMIT"); return results; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
      finally { release(); }
    },
  };
  testEnv.DB = db as unknown as D1Database;
  return sqlite;
}
function request(path: string, user: string, method = "GET", body?: unknown) {
  const headers: Record<string, string> = { "oai-authenticated-user-id": user, "oai-authenticated-user-email": `${user}@example.test` };
  if (method !== "GET") { headers.origin = origin; headers["content-type"] = "application/json"; }
  return new Request(`${origin}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
function context(path: string[]) { return { params: Promise.resolve({ path }) }; }

test("staff directory hides IDs until opened in UI and name changes are revision checked", async () => {
  const sqlite = fixture();
  const list = await app.GET(request("/api/users", "manager"), context(["users"]));
  assert.equal(list.status, 200);
  const users = await list.json() as Array<{ id: string; displayName: string; authorized: boolean; staffRevision: string; appAdmin: boolean }>;
  assert.equal(users.find(user => user.id === "legacy"), undefined);
  assert.equal(users.find(user => user.id === "worker")?.authorized, true);
  assert.equal(users.find(user => user.id === "manager")?.appAdmin, true);
  assert.equal(users.find(user => user.id === "worker")?.appAdmin, false);
  const change = await app.PUT(request("/api/users/manager/display-name", "manager", "PUT", { name: "新しい氏名", expectedStaffRevision: "1" }), context(["users", "manager", "display-name"]));
  assert.equal(change.status, 200);
  assert.equal((await change.json() as { displayName: string }).displayName, "新しい氏名");
  assert.equal((sqlite.prepare("SELECT display_name AS name FROM app_users WHERE id='manager'").get() as { name: string }).name, "新しい氏名");
  assert.equal((sqlite.prepare("SELECT COUNT(*) AS n FROM staff_name_changes").get() as { n: number }).n, 1);
  const me = await app.GET(request("/api/me", "manager"), context(["me"]));
  const ownProfile = await me.json() as { name: string; appAdmin: boolean };
  assert.deepEqual([ownProfile.name, ownProfile.appAdmin], ["新しい氏名", true]);
  const stale = await app.PUT(request("/api/users/manager/display-name", "manager", "PUT", { name: "別名", expectedStaffRevision: "1" }), context(["users", "manager", "display-name"]));
  assert.equal(stale.status, 409);
  const stranger = await app.PUT(request("/api/users/manager/display-name", "legacy", "PUT", { name: "変更", expectedStaffRevision: "2" }), context(["users", "manager", "display-name"]));
  assert.equal(stranger.status, 403);
});

test("unregistered login is denied; newly appointed staff can create own work", async () => {
  const sqlite = fixture();
  const stranger = await app.GET(request("/api/me", "stranger"), context(["me"]));
  assert.equal((await stranger.json() as { active: boolean }).active, false);
  assert.equal((await app.GET(request("/api/users", "stranger"), context(["users"]))).status, 403);
  assert.equal((await app.GET(request("/api/works", "stranger"), context(["works"]))).status, 403);
  sqlite.exec("DELETE FROM app_users WHERE id='worker'");
  const normal = await app.GET(request("/api/me", "worker"), context(["me"]));
  assert.equal((await normal.json() as { role: string }).role, "normal");
  assert.equal((await app.POST(request("/api/works", "worker", "POST", { day: "2026-10-28" }), context(["works"]))).status, 201);
  assert.equal((await production.GET(request("/api/chatwork/production/settings", "worker"), context(["settings"]))).status, 200);
  assert.equal((sqlite.prepare("SELECT role FROM app_users WHERE id='worker'").get() as { role: string }).role, "normal");
});

test("production verification requires a healthy worker and cannot be created by a normal staff member", async () => {
  const sqlite = fixture();
  sqlite.exec("UPDATE chatwork_production_settings SET version=2,account_id='account',account_confirmed=1,room_id='123',room_name='検証ルーム',status='DestinationVerificationRequired'");
  const payload = { expectedVersion: "2", requestId: "00000000-0000-4000-8000-000000000001" };
  const send = (user: string) => production.POST(request("/api/chatwork/production/verify-posting", user, "POST", payload), context(["verify-posting"]));
  assert.equal((await send("worker")).status, 403);
  assert.equal((await send("manager")).status, 503);
  assert.equal((sqlite.prepare("SELECT COUNT(*) AS n FROM chatwork_delivery_jobs").get() as { n: number }).n, 0);
  sqlite.prepare("UPDATE chatwork_delivery_runtime SET approved=1,worker_revision='worker-1',site_revision='site-1',last_healthy_heartbeat_at=? WHERE id='production'").run(Date.now());
  const created = await send("manager");
  assert.equal(created.status, 202);
  const job = await created.json() as { verificationId: string; marker: string; status: string };
  assert.equal(job.status, "DispatchPending");
  assert.equal((await send("manager").then(r => r.json()) as { verificationId: string }).verificationId, job.verificationId);
  assert.equal((sqlite.prepare("SELECT room_id FROM chatwork_delivery_jobs WHERE id=?").get(job.verificationId) as { room_id: string }).room_id, "123");
  sqlite.prepare("UPDATE chatwork_delivery_jobs SET status='Failed' WHERE id=?").run(job.verificationId);
  const nextId = "00000000-0000-4000-8000-000000000002";
  const retry = () => production.POST(request("/api/chatwork/production/verify-posting", "manager", "POST", { ...payload, requestId: nextId }), context(["verify-posting"]));
  const next = await (await retry()).json() as { verificationId: string; requestId: string };
  assert.notEqual(next.verificationId, job.verificationId);
  assert.equal(next.requestId, nextId);
  assert.equal((await (await retry()).json() as { verificationId: string }).verificationId, next.verificationId);

  const read = await production.GET(request(`/api/chatwork/production/verifications/${job.verificationId}`, "manager"), context(["verifications", job.verificationId]));
  assert.equal(read.status, 200);
  assert.equal((await read.json() as { marker: string }).marker, job.marker);
});

test("worker endpoints reject visitors, issue a token only for a claimed job, and save one result", async () => {
  const sqlite = fixture();
  sqlite.exec("UPDATE chatwork_production_settings SET version=2,account_id='account',account_confirmed=1,room_id='123',room_name='検証ルーム',status='DestinationVerificationRequired'");
  const cipher = await seal(JSON.stringify({ accessToken: "access-only", refreshToken: "must-not-leak", expiresAt: Date.now() + 600000 }), tokenKey);
  sqlite.prepare("UPDATE chatwork_production_settings SET token_cipher=? WHERE id='production'").run(cipher);
  sqlite.prepare("UPDATE chatwork_delivery_runtime SET approved=1,worker_revision='worker-1',site_revision='site-1',last_healthy_heartbeat_at=? WHERE id='production'").run(Date.now());
  const created = await production.POST(request("/api/chatwork/production/verify-posting", "manager", "POST", { expectedVersion: "2", requestId: crypto.randomUUID() }), context(["verify-posting"]));
  const { verificationId } = await created.json() as { verificationId: string };
  const internal = (path: string[], body: unknown, bearer = "local-secret-for-worker-only") => production.POST(new Request(`${origin}/api/chatwork/production/${path.join("/")}`, {
    method: "POST", headers: { authorization: `Bearer ${bearer}`, "x-kiiya-worker-identity": "valid-worker", "content-type": "application/json" }, body: JSON.stringify(body),
  }), context(path));
  assert.equal((await internal(["internal", "claim"], { jobId: verificationId }, "wrong")).status, 403);
  assert.equal((await internal(["internal", "token"], { jobId: verificationId, leaseId: "other" })).status, 409);
  sqlite.prepare("UPDATE chatwork_delivery_runtime SET last_healthy_heartbeat_at=? WHERE id='production'").run(Date.now() - 300000);
  assert.equal((await internal(["internal", "claim"], { jobId: verificationId })).status, 503);
  sqlite.prepare("UPDATE chatwork_delivery_runtime SET last_healthy_heartbeat_at=? WHERE id='production'").run(Date.now());
  const claim = await internal(["internal", "claim"], { jobId: verificationId });
  assert.equal(claim.status, 200);
  const leased = await claim.json() as { leaseId: string; body: string; roomId: string };
  assert.equal(leased.roomId, "123");
  assert.equal(leased.body.includes("KIIYA-"), true);
  assert.equal((await internal(["internal", "claim"], { jobId: verificationId })).status, 409);
  const token = await internal(["internal", "token"], { jobId: verificationId, leaseId: leased.leaseId });
  assert.equal((await token.json() as { accessToken: string }).accessToken, "access-only");
  const done = await internal(["internal", "result"], { jobId: verificationId, leaseId: leased.leaseId, status: "Sent", messageId: "message-1" });
  assert.equal(done.status, 200);
  assert.equal((await internal(["internal", "result"], { jobId: verificationId, leaseId: leased.leaseId, status: "Sent", messageId: "message-2" })).status, 409);
  assert.equal((sqlite.prepare("SELECT message_id FROM chatwork_delivery_jobs WHERE id=?").get(verificationId) as { message_id: string }).message_id, "message-1");
});

test("app administrator registers a signed-in candidate as a normal staff member", async () => {
  const sqlite = fixture();
  const waiting = await app.GET(request("/api/me", "stranger"), context(["me"]));
  assert.equal((await waiting.json() as { active: boolean }).active, false);
  const candidate = await app.GET(request("/api/users/registration-candidate/stranger", "manager"), context(["users", "registration-candidate", "stranger"]));
  assert.equal(candidate.status, 200);
  const preview = await candidate.json() as { id: string; email: string; displayName: string; seenAt: string };
  assert.deepEqual([preview.id, preview.email], ["stranger", "stranger@example.test"]);
  const registered = await app.POST(request("/api/users", "manager", "POST", { registrationId: preview.id, expectedSeenAt: preview.seenAt }), context(["users"]));
  assert.equal(registered.status, 201);
  assert.equal((await registered.json() as { role: string }).role, "normal");
  assert.equal((await app.GET(request("/api/me", "stranger"), context(["me"])).then(r => r.json()) as { active: boolean }).active, true);
  assert.equal((await production.GET(request("/api/chatwork/production/settings", "stranger"), context(["settings"]))).status, 200);
  assert.equal((await app.POST(request("/api/works", "stranger", "POST", { day: "2026-10-29" }), context(["works"]))).status, 201);
  const list = await app.GET(request("/api/users", "manager"), context(["users"]));
  assert.equal((await list.json() as Array<{ id: string }>).some(person => person.id === "stranger"), true);
  assert.equal((sqlite.prepare("SELECT approved_by FROM staff_registration_requests WHERE id='stranger'").get() as { approved_by: string }).approved_by, "manager");
  assert.equal((await app.POST(request("/api/users", "manager", "POST", { registrationId: preview.id, expectedSeenAt: preview.seenAt }), context(["users"]))).status, 409);
});

test("administrator can rename a pending legacy staff ID without approving it", async () => {
  const sqlite = fixture();
  const waiting = await app.GET(request("/api/me", "legacy"), context(["me"]));
  assert.equal((await waiting.json() as { active: boolean }).active, false);
  const preview = await app.GET(request("/api/users/registration-candidate/legacy", "manager"), context(["users", "registration-candidate", "legacy"]));
  const { seenAt } = await preview.json() as { seenAt: string };
  const renamed = await app.PUT(request("/api/users/registration-candidate/legacy/display-name", "manager", "PUT", { name: "テストユーザー", expectedSeenAt: seenAt }), context(["users", "registration-candidate", "legacy", "display-name"]));
  assert.equal(renamed.status, 200);
  const pending = sqlite.prepare("SELECT display_name, approved_at FROM staff_registration_requests WHERE id='legacy'").get() as { display_name: string; approved_at: string | null };
  assert.equal(pending.display_name, "テストユーザー");
  assert.equal(pending.approved_at, null);
  const oldRow = sqlite.prepare("SELECT display_name, role, active FROM app_users WHERE id='legacy'").get() as { display_name: string; role: string; active: number };
  assert.deepEqual([oldRow.display_name, oldRow.role, oldRow.active], ["テストユーザー", "it", 0]);
  await app.GET(request("/api/me", "legacy"), context(["me"]));
  assert.equal((sqlite.prepare("SELECT display_name FROM staff_registration_requests WHERE id='legacy'").get() as { display_name: string }).display_name, "テストユーザー");
  const denied = await app.PUT(request("/api/users/registration-candidate/legacy/display-name", "worker", "PUT", { name: "別名", expectedSeenAt: seenAt }), context(["users", "registration-candidate", "legacy", "display-name"]));
  assert.equal(denied.status, 403);
  const stale = await app.PUT(request("/api/users/registration-candidate/legacy/display-name", "manager", "PUT", { name: "別名", expectedSeenAt: "outdated" }), context(["users", "registration-candidate", "legacy", "display-name"]));
  assert.equal(stale.status, 409);
  const listed = await app.GET(request("/api/users", "manager"), context(["users"]));
  assert.equal((await listed.json() as Array<{ id: string }>).some(x => x.id === "legacy"), false);
  const refreshed = await app.GET(request("/api/users/registration-candidate/legacy", "manager"), context(["users", "registration-candidate", "legacy"]));
  const current = await refreshed.json() as { seenAt: string; displayName: string };
  assert.equal(current.displayName, "テストユーザー");
  const approved = await app.POST(request("/api/users", "manager", "POST", { registrationId: "legacy", expectedSeenAt: current.seenAt }), context(["users"]));
  assert.equal(approved.status, 201);
  const registeredRow = sqlite.prepare("SELECT display_name, role, active FROM app_users WHERE id='legacy'").get() as { display_name: string; role: string; active: number };
  assert.deepEqual([registeredRow.display_name, registeredRow.role, registeredRow.active], ["テストユーザー", "normal", 1]);
});

test("normal staff cannot inspect or approve candidates; unknown IDs cannot be registered", async () => {
  const sqlite = fixture();
  await app.GET(request("/api/me", "stranger"), context(["me"]));
  assert.equal((await app.GET(request("/api/users/registration-candidate/stranger", "worker"), context(["users", "registration-candidate", "stranger"]))).status, 403);
  assert.equal((await app.POST(request("/api/users", "worker", "POST", { registrationId: "stranger", expectedSeenAt: "now" }), context(["users"]))).status, 403);
  const promoted = await app.PUT(request("/api/users/worker/role", "manager", "PUT", { role: "field", expectedStaffRevision: "1" }), context(["users", "worker", "role"]));
  assert.equal(promoted.status, 200);
  assert.equal((await app.GET(request("/api/users/registration-candidate/stranger", "worker"), context(["users", "registration-candidate", "stranger"]))).status, 403);
  assert.equal((await app.GET(request("/api/users/registration-candidate/unknown", "manager"), context(["users", "registration-candidate", "unknown"]))).status, 404);
  assert.equal((await app.POST(request("/api/users", "manager", "POST", { registrationId: "unknown", expectedSeenAt: "now" }), context(["users"]))).status, 404);
  assert.equal((sqlite.prepare("SELECT COUNT(*) AS n FROM app_users WHERE id='stranger'").get() as { n: number }).n, 0);
});

test("registration rolls back approval if staff insertion fails", async () => {
  const sqlite = fixture();
  await app.GET(request("/api/me", "stranger"), context(["me"]));
  const candidate = await app.GET(request("/api/users/registration-candidate/stranger", "manager"), context(["users", "registration-candidate", "stranger"]));
  const { seenAt } = await candidate.json() as { seenAt: string };
  sqlite.exec("CREATE TRIGGER block_registration BEFORE INSERT ON app_users WHEN NEW.id='stranger' BEGIN SELECT RAISE(ABORT, 'registration failed'); END");
  const response = await app.POST(request("/api/users", "manager", "POST", { registrationId: "stranger", expectedSeenAt: seenAt }), context(["users"]));
  assert.equal(response.status, 500);
  assert.equal((sqlite.prepare("SELECT approved_at FROM staff_registration_requests WHERE id='stranger'").get() as { approved_at: string | null }).approved_at, null);
  assert.equal((sqlite.prepare("SELECT COUNT(*) AS n FROM app_users WHERE id='stranger'").get() as { n: number }).n, 0);
});

test("only the developer-designated account inherits field access from a legacy role", async () => {
  const sqlite = fixture();
  sqlite.exec("UPDATE app_users SET role='it' WHERE id IN ('manager','worker')");
  const manager = await app.GET(request("/api/me", "manager"), context(["me"]));
  const worker = await app.GET(request("/api/me", "worker"), context(["me"]));
  assert.equal((await manager.json() as { role: string }).role, "field");
  assert.equal((await worker.json() as { role: string }).role, "normal");
});

test("field staff promotes a normal colleague with audit, while the fixed app administrator cannot be demoted", async () => {
  const sqlite = fixture();
  const me = await app.GET(request("/api/me", "manager"), context(["me"]));
  assert.equal((await me.json() as { role: string }).role, "field");
  const listed = await app.GET(request("/api/users", "worker"), context(["users"]));
  assert.equal((await listed.json() as Array<{ id?: string; displayName: string }>).some(x => x.id === "manager"), false);
  assert.equal((await app.PUT(request("/api/users/manager/role", "worker", "PUT", { role: "normal", expectedStaffRevision: "1" }), context(["users", "manager", "role"]))).status, 403);
  assert.equal((await app.PUT(request("/api/users/manager/role", "manager", "PUT", { role: "normal", expectedStaffRevision: "1" }), context(["users", "manager", "role"]))).status, 409);
  const promoted = await app.PUT(request("/api/users/worker/role", "manager", "PUT", { role: "field", expectedStaffRevision: "1" }), context(["users", "worker", "role"]));
  assert.equal(promoted.status, 200);
  assert.equal((await promoted.json() as { role: string }).role, "field");
  assert.equal((await app.GET(request("/api/me", "worker"), context(["me"])).then(r => r.json()) as { role: string }).role, "field");
  assert.equal((await production.GET(request("/api/chatwork/production/settings", "worker"), context(["settings"]))).status, 200);
  assert.equal((await app.PUT(request("/api/users/manager/role", "worker", "PUT", { role: "normal", expectedStaffRevision: "1" }), context(["users", "manager", "role"]))).status, 403);
  assert.equal((await app.PUT(request("/api/users/worker/role", "manager", "PUT", { role: "normal", expectedStaffRevision: "1" }), context(["users", "worker", "role"]))).status, 409);
  assert.equal((sqlite.prepare("SELECT COUNT(*) AS n FROM staff_role_changes").get() as { n: number }).n, 1);
});

test("demotion removes pending Chatwork attempts and takes effect on the next API request", async () => {
  const sqlite = fixture();
  await app.GET(request("/api/me", "manager"), context(["me"]));
  const promoted = await app.PUT(request("/api/users/worker/role", "manager", "PUT", { role: "field", expectedStaffRevision: "1" }), context(["users", "worker", "role"]));
  assert.equal(promoted.status, 200);
  sqlite.exec("INSERT INTO chatwork_production_oauth_attempts (state_hash,actor_id,verifier_cipher,expires_at,created_at) VALUES ('pending','worker','cipher',9999999999999,'now')");
  const demoted = await app.PUT(request("/api/users/worker/role", "manager", "PUT", { role: "normal", expectedStaffRevision: "2" }), context(["users", "worker", "role"]));
  assert.equal(demoted.status, 200);
  assert.ok((sqlite.prepare("SELECT consumed_at FROM chatwork_production_oauth_attempts WHERE state_hash='pending'").get() as { consumed_at: string | null }).consumed_at);
  assert.equal((await app.GET(request("/api/me", "worker"), context(["me"])).then(r => r.json()) as { role: string }).role, "normal");
  assert.equal((await production.GET(request("/api/chatwork/production/settings", "worker"), context(["settings"]))).status, 200);
  assert.equal((await app.PUT(request("/api/users/manager/display-name", "worker", "PUT", { name: "不可", expectedStaffRevision: "1" }), context(["users", "manager", "display-name"]))).status, 403);
});

test("role and audit both remain unchanged when audit insertion fails", async () => {
  const sqlite = fixture();
  await app.GET(request("/api/me", "manager"), context(["me"]));
  sqlite.exec("CREATE TRIGGER block_role_audit BEFORE INSERT ON staff_role_changes BEGIN SELECT RAISE(ABORT, 'audit failed'); END");
  const response = await app.PUT(request("/api/users/worker/role", "manager", "PUT", { role: "field", expectedStaffRevision: "1" }), context(["users", "worker", "role"]));
  assert.equal(response.status, 500);
  assert.equal((sqlite.prepare("SELECT role FROM app_users WHERE id='worker'").get() as { role: string }).role, "normal");
  assert.equal((sqlite.prepare("SELECT COUNT(*) AS n FROM staff_role_changes").get() as { n: number }).n, 0);
});

test("the fixed app administrator cannot be demoted even if another account has the field role", async () => {
  const sqlite = fixture();
  sqlite.exec("UPDATE app_users SET role='field' WHERE id='legacy'");
  const response = await app.PUT(request("/api/users/manager/role", "manager", "PUT", { role: "normal", expectedStaffRevision: "1" }), context(["users", "manager", "role"]));
  assert.equal(response.status, 409);
  assert.equal((sqlite.prepare("SELECT role FROM app_users WHERE id='manager'").get() as { role: string }).role, "field");
});

test("normal staff can read another person's work but cannot alter it", async () => {
  const sqlite = fixture();
  await app.GET(request("/api/me", "manager"), context(["me"]));
  await app.GET(request("/api/me", "worker"), context(["me"]));
  sqlite.prepare("INSERT INTO works (id,day,owner_id,revision,status,data_json,created_at,updated_at) VALUES ('work-a','2026-10-28','manager',1,'Draft','{}','now','now')").run();
  const list = await app.GET(request("/api/works", "worker"), context(["works"]));
  assert.equal((await list.json() as Array<{ id: string }>).some(x => x.id === "work-a"), true);
  const detail = await app.GET(request("/api/works/work-a", "worker"), context(["works", "work-a"]));
  assert.equal(detail.status, 200);
  assert.equal((await app.PUT(request("/api/works/work-a", "worker", "PUT", { revision: 1, data: {} }), context(["works", "work-a"]))).status, 403);
});

test("normal staff can rename self but cannot change room, master, or another staff member", async () => {
  const sqlite = fixture();
  const self = await app.PUT(request("/api/users/worker/display-name", "worker", "PUT", { name: "新しい職員名", expectedStaffRevision: "1" }), context(["users", "worker", "display-name"]));
  assert.equal(self.status, 200);
  assert.equal((sqlite.prepare("SELECT display_name FROM app_users WHERE id='worker'").get() as { display_name: string }).display_name, "新しい職員名");
  assert.equal((await app.PUT(request("/api/users/manager/display-name", "worker", "PUT", { name: "他人", expectedStaffRevision: "1" }), context(["users", "manager", "display-name"]))).status, 403);
  assert.equal((await app.POST(request("/api/master/changes", "worker", "POST", { reason: "変更", approverName: "承認者", approved: true }), context(["master", "changes"]))).status, 403);
  assert.equal((await production.POST(request("/api/chatwork/production/room/preview", "worker", "POST", { roomId: "123", expectedVersion: "0" }), context(["room", "preview"]))).status, 403);
  assert.equal((await production.POST(request("/api/chatwork/production/room/confirm", "worker", "POST", { candidateId: "missing" }), context(["room", "confirm"]))).status, 403);
  assert.equal((sqlite.prepare("SELECT COUNT(*) AS n FROM staff_name_changes").get() as { n: number }).n, 1);
});

test("normal staff can view Chatwork settings, while strangers cannot", async () => {
  const sqlite = fixture();
  const detail = await production.GET(request("/api/chatwork/production/settings", "manager"), context(["settings"]));
  assert.equal(detail.status, 200);
  assert.equal((await production.GET(request("/api/chatwork/production/settings", "worker"), context(["settings"]))).status, 200);
  const stranger = await app.GET(request("/api/me", "stranger"), context(["me"]));
  assert.equal(stranger.status, 200);
  assert.equal((await stranger.json() as { active: boolean }).active, false);
  assert.equal((sqlite.prepare("SELECT COUNT(*) AS n FROM app_users WHERE id='stranger'").get() as { n: number }).n, 0);
  const denied = await production.GET(request("/api/chatwork/production/settings", "stranger"), context(["settings"]));
  assert.equal(denied.status, 403);
  const formerStaff = await app.GET(request("/api/me", "legacy"), context(["me"]));
  assert.equal((await formerStaff.json() as { active: boolean }).active, false);
  assert.equal((await production.GET(request("/api/chatwork/production/settings", "legacy"), context(["settings"]))).status, 403);
  const master = await app.GET(request("/api/master/changes", "stranger"), context(["master", "changes"]));
  assert.equal(master.status, 403);
});

test("HTTP settings report a missing singleton as 503", async () => {
  fixture(false);
  const manager = await production.GET(request("/api/chatwork/production/settings", "manager"), context(["settings"]));
  assert.equal(manager.status, 503);
  const publicView = await app.GET(request("/api/report-delivery-settings", "worker"), context(["report-delivery-settings"]));
  assert.equal(publicView.status, 503);
});

test("HTTP public delivery response exposes a confirmed name but no account, room ID or token", async () => {
  const sqlite = fixture();
  sqlite.exec("UPDATE chatwork_production_settings SET version=2,account_id='42',display_name='担当者',account_confirmed=1,room_id='123',room_name='業務ルーム',status='DestinationVerificationRequired',token_cipher='secret-cipher'");
  const response = await app.GET(request("/api/report-delivery-settings", "worker"), context(["report-delivery-settings"]));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const value = await response.json() as Record<string, unknown>;
  assert.equal(value.roomName, "業務ルーム");
  assert.equal(value.sourceDisplayName, "担当者");
  assert.equal(value.setupReason, "RoomVerificationRequired");
  assert.equal(value.deliveryEnabled, false);
  for (const secret of ["42", "123", "secret-cipher"]) assert.equal(JSON.stringify(value).includes(secret), false);
});

test("room preview cannot create a candidate after permission is revoked during Chatwork lookup", async () => {
  const sqlite = fixture();
  const tokenCipher = await seal(JSON.stringify({ accessToken: "local-token", refreshToken: "local-refresh", expiresAt: Date.now() + 600_000 }), tokenKey);
  sqlite.prepare("UPDATE chatwork_production_settings SET account_id='42',display_name='担当者',account_confirmed=1,token_cipher=?,status='Unconfigured'").run(tokenCipher);
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async input => {
      assert.equal(input, "https://api.chatwork.com/v2/rooms/123");
      sqlite.exec("UPDATE app_users SET active=0,staff_revision=2 WHERE id='manager'");
      return Response.json({ room_id: 123, name: "業務ルーム" });
    };
    const response = await production.POST(request("/api/chatwork/production/room/preview", "manager", "POST", { roomId: "123", expectedVersion: "0" }), context(["room", "preview"]));
    assert.equal(response.status, 403);
    assert.equal((sqlite.prepare("SELECT COUNT(*) AS n FROM chatwork_room_candidates").get() as { n: number }).n, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("OAuth callback cannot save a connection after permission is revoked during Chatwork lookup", async () => {
  const sqlite = fixture();
  const state = "local-oauth-state";
  const stateHash = await sha256(state);
  const verifierCipher = await seal("local-verifier", tokenKey);
  sqlite.prepare("INSERT INTO chatwork_production_oauth_attempts (state_hash,actor_id,verifier_cipher,expires_at,created_at) VALUES (?,?,?,?,?)")
    .run(stateHash, "manager", verifierCipher, Date.now() + 600_000, new Date().toISOString());
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input, init) => {
      if (input === "https://oauth.chatwork.com/token") {
        assert.equal(init?.method, "POST");
        return Response.json({ access_token: "local-access", refresh_token: "local-refresh", expires_in: 1800 });
      }
      assert.equal(input, "https://api.chatwork.com/v2/me");
      sqlite.exec("UPDATE app_users SET active=0,staff_revision=2 WHERE id='manager'");
      return Response.json({ account_id: 42, name: "担当者" });
    };
    const response = await production.GET(new Request(`${origin}/api/chatwork/production/oauth/callback?code=local-code&state=${state}`, {
      headers: { "oai-authenticated-user-id": "manager", cookie: `kiiya_chatwork_production_state=${state}` },
    }), context(["oauth", "callback"]));
    assert.equal(response.status, 403);
    const settings = sqlite.prepare("SELECT account_id,token_cipher,version FROM chatwork_production_settings WHERE id='production'").get() as { account_id: string | null; token_cipher: string | null; version: number };
    assert.equal(settings.account_id, null);
    assert.equal(settings.token_cipher, null);
    assert.equal(settings.version, 0);
    assert.equal((sqlite.prepare("SELECT COUNT(*) AS n FROM chatwork_production_audit").get() as { n: number }).n, 0);
    assert.ok((sqlite.prepare("SELECT consumed_at FROM chatwork_production_oauth_attempts WHERE state_hash=?").get(stateHash) as { consumed_at: string | null }).consumed_at);
  } finally { globalThis.fetch = originalFetch; }
});

test("monitor and claim retire obsolete unclaimed jobs and recover dispatched jobs", async () => {
  const sqlite = fixture();
  sqlite.exec("UPDATE chatwork_production_settings SET version=2,account_id='account',account_confirmed=1,room_id='123',room_name='検証',status='DestinationVerificationRequired'");
  sqlite.prepare("UPDATE chatwork_delivery_runtime SET approved=1,worker_revision='worker-1',site_revision='site-1',last_healthy_heartbeat_at=?").run(Date.now());
  const create = async () => (await (await production.POST(request("/api/chatwork/production/verify-posting", "manager", "POST", { expectedVersion: "2", requestId: crypto.randomUUID() }), context(["verify-posting"]))).json() as { verificationId: string }).verificationId;
  const internal = (path: string, body: unknown) => production.POST(new Request(`${origin}/api/chatwork/production/internal/${path}`, { method: "POST", headers: { authorization: "Bearer local-secret-for-worker-only", "x-kiiya-worker-identity": "valid-worker", "content-type": "application/json" }, body: JSON.stringify(body) }), context(["internal", path]));
  // Simulate legacy rows created before the global unresolved-job guard.
  const old = await create();
  sqlite.prepare("UPDATE chatwork_delivery_jobs SET status='Failed' WHERE id=?").run(old);
  const dispatched = await create();
  sqlite.prepare("UPDATE chatwork_delivery_jobs SET status='Failed' WHERE id=?").run(dispatched);
  const uncertain = await create();
  sqlite.prepare("UPDATE chatwork_delivery_jobs SET status='DispatchPending' WHERE id=?").run(old);
  sqlite.prepare("UPDATE chatwork_delivery_jobs SET status='Unknown' WHERE id=?").run(uncertain);
  const newTask = 'projects/p/locations/l/queues/q/tasks/kiiya-new';
  await internal("dispatch-record", { jobId: uncertain, taskName: newTask });
  assert.equal((sqlite.prepare("SELECT status FROM chatwork_delivery_jobs WHERE id=?").get(uncertain) as { status: string }).status, "Unknown");
  const taskName = 'projects/p/locations/l/queues/q/tasks/kiiya-abc';
  sqlite.prepare("UPDATE chatwork_delivery_jobs SET status='Dispatched',task_name=? WHERE id=?").run(taskName, dispatched);
  let jobs = await (await internal("monitor", {})).json() as { pendingJobs: Array<{ id: string; taskName: string | null }> };
  assert.equal(jobs.pendingJobs.find(job => job.id === dispatched)?.taskName, taskName);
  sqlite.prepare("UPDATE app_users SET staff_revision=staff_revision+1 WHERE id='manager'").run();
  assert.equal((await internal("claim", { jobId: old })).status, 409);
  assert.equal((sqlite.prepare("SELECT status,error_code FROM chatwork_delivery_jobs WHERE id=?").get(old) as { status: string }).status, "Failed");
  jobs = await (await internal("monitor", {})).json() as typeof jobs;
  assert.equal(jobs.pendingJobs.length, 0);
  assert.equal((sqlite.prepare("SELECT status FROM chatwork_delivery_jobs WHERE id=?").get(dispatched) as { status: string }).status, "Failed");
  sqlite.prepare("UPDATE chatwork_delivery_jobs SET status='Failed' WHERE id=?").run(uncertain);
  const currentJob = await create();
  sqlite.prepare("UPDATE chatwork_delivery_jobs SET status='Unknown' WHERE id=?").run(uncertain);
  sqlite.exec("UPDATE chatwork_production_settings SET version=3");
  const latest = await production.GET(request('/api/chatwork/production/verifications/latest', 'manager'), context(['verifications', 'latest']));
  assert.equal((await latest.json() as { verificationId: string }).verificationId, uncertain);
  sqlite.prepare("UPDATE chatwork_delivery_jobs SET status='Failed' WHERE id=?").run(uncertain);
  const after = await production.GET(request('/api/chatwork/production/verifications/latest', 'manager'), context(['verifications', 'latest']));
  assert.equal(await after.json(), null);
  await internal("monitor", {});
  assert.equal((sqlite.prepare("SELECT status FROM chatwork_delivery_jobs WHERE id=?").get(currentJob) as { status: string }).status, "Failed");
});

test("other field staff cannot start a verification while a job is unresolved", async () => {
  const sqlite = fixture();
  sqlite.exec("UPDATE chatwork_production_settings SET version=2,account_id='account',account_confirmed=1,room_id='123',room_name='検証',status='DestinationVerificationRequired'; UPDATE app_users SET role='field' WHERE id='worker'");
  sqlite.prepare("UPDATE chatwork_delivery_runtime SET approved=1,worker_revision='worker-1',site_revision='site-1',last_healthy_heartbeat_at=?").run(Date.now());
  const send = (user: string, requestId: string) => production.POST(request('/api/chatwork/production/verify-posting', user, 'POST', { expectedVersion: '2', requestId }), context(['verify-posting']));
  const id = crypto.randomUUID();
  const first = await send('manager', id);
  assert.equal(first.status, 202);
  const job = await first.json() as { verificationId: string };
  assert.equal((await send('manager', id)).status, 202);
  sqlite.prepare("UPDATE chatwork_delivery_jobs SET status='Unknown' WHERE id=?").run(job.verificationId);
  assert.equal((await send('worker', crypto.randomUUID())).status, 409);
  const latest = await production.GET(request('/api/chatwork/production/verifications/latest', 'worker'), context(['verifications', 'latest']));
  const view = await latest.json() as { verificationId: string; status: string; requestId: string | null };
  assert.equal(view.verificationId, job.verificationId);
  assert.equal(view.status, 'Unknown');
  assert.equal(view.requestId, null);
  assert.equal((sqlite.prepare('SELECT COUNT(*) AS n FROM chatwork_delivery_jobs').get() as { n: number }).n, 1);
});

test("field staff can audit reconciliation of unknown verification without automatically confirming destination", async () => {
  const sqlite = fixture();
  sqlite.exec("UPDATE chatwork_production_settings SET version=2,account_id='account',account_confirmed=1,room_id='123',room_name='検証',status='DestinationVerificationRequired'");
  sqlite.prepare("UPDATE chatwork_delivery_runtime SET approved=1,worker_revision='worker-1',site_revision='site-1',last_healthy_heartbeat_at=?").run(Date.now());
  const send = () => production.POST(request('/api/chatwork/production/verify-posting', 'manager', 'POST', { expectedVersion: '2', requestId: crypto.randomUUID() }), context(['verify-posting']));
  const first = await (await send()).json() as { verificationId: string; marker: string };
  sqlite.prepare("UPDATE chatwork_delivery_jobs SET status='Unknown' WHERE id=?").run(first.verificationId);
  const resolve = (user: string, body: unknown) => production.POST(request(`/api/chatwork/production/verifications/${first.verificationId}/resolve`, user, 'POST', body), context(['verifications', first.verificationId, 'resolve']));
  const body = { outcome: 'NotSent', marker: first.marker, checked: true };
  assert.equal((await resolve('worker', body)).status, 403);
  assert.equal((await resolve('manager', { ...body, marker: 'wrong' })).status, 409);
  assert.equal((await resolve('manager', { ...body, checked: false })).status, 400);
  assert.equal((await resolve('manager', body)).status, 409);
  sqlite.prepare("INSERT INTO chatwork_delivery_events (id,job_id,actor_id,action,detail_json,created_at) VALUES ('isolated',?,'operator','WorkerIsolationConfirmedV2','{\"workerStopped\":true,\"tokenInvalidated\":true,\"requestsEnded\":true}','now')").run(first.verificationId);
  assert.equal((await resolve('manager', body)).status, 200);
  assert.equal((await resolve('manager', body)).status, 409);
  assert.equal((sqlite.prepare('SELECT status FROM chatwork_delivery_jobs WHERE id=?').get(first.verificationId) as { status: string }).status, 'Failed');
  assert.equal((sqlite.prepare("SELECT COUNT(*) AS n FROM chatwork_delivery_events WHERE job_id=? AND action='UnknownReconciled'").get(first.verificationId) as { n: number }).n, 1);
  const next = await (await send()).json() as { verificationId: string; marker: string };
  sqlite.prepare("UPDATE chatwork_delivery_jobs SET status='Unknown' WHERE id=?").run(next.verificationId);
  const sent = await production.POST(request(`/api/chatwork/production/verifications/${next.verificationId}/resolve`, 'manager', 'POST', { outcome: 'Sent', marker: next.marker, checked: true, messageId: '123456' }), context(['verifications', next.verificationId, 'resolve']));
  assert.equal(sent.status, 200);
  const row = sqlite.prepare('SELECT status,message_id FROM chatwork_delivery_jobs WHERE id=?').get(next.verificationId) as { status: string; message_id: string };
  assert.deepEqual([row.status, row.message_id], ['Sent', '123456']);
  assert.equal((sqlite.prepare('SELECT destination_verified FROM chatwork_production_settings').get() as { destination_verified: number }).destination_verified, 0);
});

test("reconciliation races once and a recovered old-destination post cannot verify new settings", async () => {
  const sqlite = fixture();
  sqlite.exec("UPDATE chatwork_production_settings SET version=2,account_id='account',account_confirmed=1,room_id='123',room_name='検証',status='DestinationVerificationRequired'");
  sqlite.prepare("UPDATE chatwork_delivery_runtime SET approved=1,worker_revision='worker-1',site_revision='site-1',last_healthy_heartbeat_at=?").run(Date.now());
  const created = await production.POST(request('/api/chatwork/production/verify-posting', 'manager', 'POST', { expectedVersion: '2', requestId: crypto.randomUUID() }), context(['verify-posting']));
  const job = await created.json() as { verificationId: string; marker: string };
  sqlite.prepare("UPDATE chatwork_delivery_jobs SET status='Unknown' WHERE id=?").run(job.verificationId);
  sqlite.exec("UPDATE chatwork_production_settings SET version=3,room_id='456'");
  const path = ['verifications', job.verificationId, 'resolve'];
  const resolve = (body: unknown) => production.POST(request(`/api/chatwork/production/${path.join('/')}`, 'manager', 'POST', body), context(path));
  assert.equal((await resolve({ outcome: 'Sent', marker: job.marker, checked: true, messageId: '' })).status, 400);
  const results = await Promise.all([
    resolve({ outcome: 'Sent', marker: job.marker, checked: true, messageId: '123' }),
    resolve({ outcome: 'NotSent', marker: job.marker, checked: true }),
  ]);
  assert.deepEqual(results.map(x => x.status).sort(), [200, 409]);
  assert.equal((sqlite.prepare("SELECT COUNT(*) AS n FROM chatwork_delivery_events WHERE job_id=? AND action='UnknownReconciled'").get(job.verificationId) as { n: number }).n, 1);
  const confirm = await production.POST(request(`/api/chatwork/production/verifications/${job.verificationId}/confirm`, 'manager', 'POST', { expectedVersion: '3' }), context(['verifications', job.verificationId, 'confirm']));
  assert.equal(confirm.status, 409);
  assert.equal((sqlite.prepare('SELECT destination_verified FROM chatwork_production_settings').get() as { destination_verified: number }).destination_verified, 0);
});

test("reconciliation audit is rolled back if job update fails", async () => {
  const sqlite = fixture();
  sqlite.exec("UPDATE chatwork_production_settings SET version=2,account_id='account',account_confirmed=1,room_id='123',room_name='検証',status='DestinationVerificationRequired'");
  sqlite.prepare("UPDATE chatwork_delivery_runtime SET approved=1,worker_revision='w',site_revision='s',last_healthy_heartbeat_at=?").run(Date.now());
  const response = await production.POST(request('/api/chatwork/production/verify-posting', 'manager', 'POST', { expectedVersion: '2', requestId: crypto.randomUUID() }), context(['verify-posting']));
  const job = await response.json() as { verificationId: string; marker: string };
  sqlite.prepare("UPDATE chatwork_delivery_jobs SET status='Unknown' WHERE id=?").run(job.verificationId);
  sqlite.prepare("INSERT INTO chatwork_delivery_events (id,job_id,actor_id,action,detail_json,created_at) VALUES ('isolated',?,'operator','WorkerIsolationConfirmedV2','{\"workerStopped\":true,\"tokenInvalidated\":true,\"requestsEnded\":true}','now')").run(job.verificationId);
  sqlite.exec("CREATE TRIGGER reject_resolution BEFORE UPDATE OF status ON chatwork_delivery_jobs WHEN OLD.status='Unknown' BEGIN SELECT RAISE(ABORT, 'injected failure'); END");
  const path = ['verifications', job.verificationId, 'resolve'];
  assert.equal((await production.POST(request(`/api/chatwork/production/${path.join('/')}`, 'manager', 'POST', { outcome: 'NotSent', marker: job.marker, checked: true }), context(path))).status, 500);
  assert.equal((sqlite.prepare('SELECT status FROM chatwork_delivery_jobs WHERE id=?').get(job.verificationId) as { status: string }).status, 'Unknown');
  assert.equal((sqlite.prepare("SELECT COUNT(*) AS n FROM chatwork_delivery_events WHERE job_id=? AND action='UnknownReconciled'").get(job.verificationId) as { n: number }).n, 0);
});


test("operator approval binds heartbeat to a new subject and rejects old and replayed runs", async () => {
  const sqlite = fixture();
  sqlite.exec("UPDATE chatwork_delivery_runtime SET approved=1,worker_revision='old',site_revision='site',last_healthy_heartbeat_at=100");
  const invoke = (route: string, value: unknown, secret: string, identity = "") => production.POST(new Request(`${origin}/api/chatwork/production/internal/${route}`, { method: "POST", headers: { authorization: `Bearer ${secret}`, "x-kiiya-worker-identity": identity, "content-type": "application/json" }, body: JSON.stringify(value) }), context(["internal",route]));
  const approval = { action: "approve", expectedGeneration: 1, reason: "verified deployment", workerSubject: "888888", workerRevision: "new", siteRevision: "site", imageDigest: `sha256:${"a".repeat(64)}` };
  assert.equal((await invoke("control", approval, "local-secret-for-worker-only", "valid-worker")).status, 403);
  assert.equal((await invoke("control", approval, "local-control-secret-for-only-operator")).status, 200);
  const hb = { workerRevision: "new", siteRevision: "site", approvalGeneration: 2, monitorRunId: "00000000-0000-4000-8000-000000000001", monitorSucceeded: true };
  assert.equal((await invoke("heartbeat", hb, "local-secret-for-worker-only", "valid-worker")).status, 403);
  assert.equal((sqlite.prepare("SELECT last_healthy_heartbeat_at AS t FROM chatwork_delivery_runtime").get() as {t: number | null}).t, null);
  assert.equal((await invoke("heartbeat", hb, "local-secret-for-worker-only", "new-worker")).status, 200);
  assert.equal((await invoke("heartbeat", hb, "local-secret-for-worker-only", "new-worker")).status, 409);
  assert.equal((await invoke("control", { action: "revoke", expectedGeneration: 2, reason: "rotation" }, "local-control-secret-for-only-operator")).status, 200);
  assert.equal((await invoke("heartbeat", { ...hb, monitorRunId: crypto.randomUUID(), approvalGeneration: 3 }, "local-secret-for-worker-only", "new-worker")).status, 403);
  assert.equal((await invoke("control", { ...approval, expectedGeneration: 3 }, "local-control-secret-for-only-operator")).status, 409);
  assert.equal((await invoke("control", { ...approval, workerSubject: "123456", expectedGeneration: 3 }, "local-control-secret-for-only-operator")).status, 409);
  assert.equal((sqlite.prepare("SELECT COUNT(*) AS n FROM chatwork_delivery_control_audit").get() as {n:number}).n, 2);
});

test("operator initialization and audit failure are atomic", async () => {
  const sqlite = fixture(); sqlite.exec("DELETE FROM chatwork_delivery_runtime");
  const control = (body: unknown) => production.POST(new Request(`${origin}/api/chatwork/production/internal/control`, { method: "POST", headers: { authorization: "Bearer local-control-secret-for-only-operator", "content-type": "application/json" }, body: JSON.stringify(body) }), context(["internal", "control"]));
  sqlite.exec("CREATE TRIGGER fail_control BEFORE INSERT ON chatwork_delivery_control_audit BEGIN SELECT RAISE(ABORT,'audit failed'); END");
  assert.equal((await control({ action: "initialize", expectedGeneration: 0, reason: "setup" })).status, 500);
  assert.equal((sqlite.prepare("SELECT COUNT(*) AS n FROM chatwork_delivery_runtime").get() as {n:number}).n, 0);
  sqlite.exec("DROP TRIGGER fail_control");
  assert.equal((await control({ action: "initialize", expectedGeneration: 0, reason: "setup" })).status, 200);
  assert.equal((await control({ action: "initialize", expectedGeneration: 0, reason: "setup" })).status, 409);
});


test("revocation during Posting immediately preserves an Unknown outcome and rejects late result", async () => {
  const sqlite = fixture();
  sqlite.exec("UPDATE chatwork_production_settings SET version=2,account_id='account',account_confirmed=1,room_id='123',room_name='検証',status='DestinationVerificationRequired'");
  sqlite.prepare("UPDATE chatwork_delivery_runtime SET approved=1,worker_revision='w',site_revision='s',last_healthy_heartbeat_at=?").run(Date.now());
  const created = await production.POST(request('/api/chatwork/production/verify-posting', 'manager', 'POST', { expectedVersion: '2', requestId: crypto.randomUUID() }), context(['verify-posting']));
  const job = await created.json() as { verificationId: string; marker: string };
  sqlite.prepare("UPDATE chatwork_delivery_jobs SET status='Posting',lease_id='lease',lease_until=? WHERE id=?").run(Date.now()+300000,job.verificationId);
  const internal = (route:string, body:unknown, secret:string, identity='valid-worker') => production.POST(new Request(`${origin}/api/chatwork/production/internal/${route}`, { method:'POST', headers: {authorization:`Bearer ${secret}`, 'x-kiiya-worker-identity':identity,'content-type':'application/json'}, body:JSON.stringify(body) }), context(['internal',route]));
  assert.equal((await internal('control',{ action:'revoke',expectedGeneration:1,reason:'credential compromised' },'local-control-secret-for-only-operator')).status,200);
  const row = sqlite.prepare('SELECT status,error_code FROM chatwork_delivery_jobs WHERE id=?').get(job.verificationId) as {status:string;error_code:string};
  assert.deepEqual([row.status,row.error_code],['Unknown','WORKER_REVOKED']);
  assert.equal((await internal('result',{jobId:job.verificationId,leaseId:'lease',status:'Sent',messageId:'1'},'local-secret-for-worker-only')).status,403);
  const path=['verifications',job.verificationId,'resolve'];
  const resolve=()=>production.POST(request(`/api/chatwork/production/${path.join('/')}`,'manager','POST',{checked:true,marker:job.marker,outcome:'NotSent'}),context(path));
  assert.equal((await resolve()).status,409);
  sqlite.prepare("UPDATE chatwork_delivery_jobs SET lease_until=? WHERE id=?").run(Date.now()-1,job.verificationId);
  assert.equal((await resolve()).status,409);
  const isolated = { action:'confirm-isolation', expectedGeneration:2, jobId:job.verificationId, reason:'verified stop and token revocation', workerStopped:true, tokenInvalidated:true, requestsEnded:true, evidence:'private-record-1' };
  assert.equal((await internal('control', isolated, 'local-secret-for-worker-only')).status,403);
  assert.equal((await internal('control', { ...isolated, tokenInvalidated:false }, 'local-control-secret-for-only-operator')).status,400);
  assert.equal((await internal('control', { ...isolated, requestsEnded:false }, 'local-control-secret-for-only-operator')).status,400);
  const { requestsEnded: _omitted, ...withoutEnded } = isolated;
  assert.equal((await internal('control', withoutEnded, 'local-control-secret-for-only-operator')).status,400);
  assert.equal((await internal('control', isolated, 'local-control-secret-for-only-operator')).status,200);
  const isolation = sqlite.prepare("SELECT detail_json FROM chatwork_delivery_events WHERE job_id=? AND action='WorkerIsolationConfirmedV2'").get(job.verificationId) as { detail_json:string };
  assert.deepEqual(JSON.parse(isolation.detail_json), { evidence:'private-record-1', workerStopped:true, tokenInvalidated:true, requestsEnded:true, generation:2 });
  assert.equal((await resolve()).status,200);

});

test("stale monitor and dispatch-record cannot mutate after concurrent revocation", async () => {
  for (const route of ['monitor','dispatch-record']) {
    let armed=false;
    const sqlite=fixture(true, db=>{ if (armed) { armed=false; db.exec("UPDATE chatwork_delivery_runtime SET approved=0,approval_generation=approval_generation+1,worker_subject=NULL"); } });
    sqlite.exec("UPDATE chatwork_delivery_runtime SET approved=1,worker_revision='w',site_revision='s'; UPDATE chatwork_production_settings SET version=2,account_id='account',account_confirmed=1,room_id='123',room_name='検証',status='DestinationVerificationRequired'");
    sqlite.prepare("UPDATE chatwork_delivery_runtime SET last_healthy_heartbeat_at=?").run(Date.now());
    const created=await production.POST(request('/api/chatwork/production/verify-posting','manager','POST',{expectedVersion:'2',requestId:crypto.randomUUID()}),context(['verify-posting']));
    const job=await created.json() as {verificationId:string};
    if(route==='monitor') sqlite.exec("UPDATE chatwork_production_settings SET version=3");
    armed=true;
    const body=route==='monitor'?{}:{jobId:job.verificationId,taskName:'projects/p/locations/l/queues/q/tasks/kiiya-abc'};
    const response = await production.POST(new Request(`${origin}/api/chatwork/production/internal/${route}`,{method:'POST',headers:{authorization:'Bearer local-secret-for-worker-only','x-kiiya-worker-identity':'valid-worker','content-type':'application/json'},body:JSON.stringify(body)}),context(['internal',route]));
    assert.equal(response.status,403);
    const row=sqlite.prepare('SELECT status,task_name FROM chatwork_delivery_jobs WHERE id=?').get(job.verificationId) as {status:string;task_name:string|null};
    assert.deepEqual([row.status,row.task_name],['DispatchPending',null]);
  }
});


test("stale heartbeat and late result do not write after revocation races authentication", async () => {
  for (const route of ['heartbeat','result']) {
    let armed = false;
    const sqlite = fixture(true, db => { if (armed) { armed=false; db.exec("UPDATE chatwork_delivery_runtime SET approved=0,approval_generation=approval_generation+1,worker_subject=NULL"); } });
    sqlite.exec("UPDATE chatwork_delivery_runtime SET approved=1,worker_revision='w',site_revision='s'; UPDATE chatwork_production_settings SET version=2,account_id='account',account_confirmed=1,room_id='123',room_name='検証',status='DestinationVerificationRequired'");
    sqlite.prepare("UPDATE chatwork_delivery_runtime SET last_healthy_heartbeat_at=?").run(Date.now());
    const created=await production.POST(request('/api/chatwork/production/verify-posting','manager','POST',{expectedVersion:'2',requestId:crypto.randomUUID()}),context(['verify-posting']));
    const job=await created.json() as {verificationId:string};
    sqlite.prepare("UPDATE chatwork_delivery_jobs SET status='Posting',lease_id='lease',lease_until=? WHERE id=?").run(Date.now()+300000,job.verificationId);
    const body=route==='heartbeat'?{workerRevision:'w',siteRevision:'s',approvalGeneration:1,monitorRunId:crypto.randomUUID(),monitorSucceeded:true}:{jobId:job.verificationId,leaseId:'lease',status:'Sent',messageId:'1'};
    armed=true;
    const response=await production.POST(new Request(`${origin}/api/chatwork/production/internal/${route}`,{method:'POST',headers:{authorization:'Bearer local-secret-for-worker-only','x-kiiya-worker-identity':'valid-worker','content-type':'application/json'},body:JSON.stringify(body)}),context(['internal',route]));
    assert.equal(response.status,409);
    assert.equal((sqlite.prepare('SELECT status FROM chatwork_delivery_jobs WHERE id=?').get(job.verificationId) as {status:string}).status,'Posting');
    assert.equal((sqlite.prepare('SELECT COUNT(*) AS n FROM chatwork_delivery_monitor_runs').get() as {n:number}).n,0);
  }
});

test("revocation survives Unknown transition failure and operator can repair it", async () => {
  const sqlite=fixture();
  sqlite.exec("UPDATE chatwork_delivery_runtime SET approved=1; INSERT INTO chatwork_delivery_jobs (id,kind,actor_id,actor_staff_revision,settings_version,account_id,room_id,room_name,status,lease_id,lease_until,created_at,updated_at) VALUES ('job','DestinationVerification','manager',1,1,'a','1','room','Posting','lease',9999999999999,'now','now'); CREATE TRIGGER reject_revoke BEFORE UPDATE OF status ON chatwork_delivery_jobs WHEN OLD.status='Posting' BEGIN SELECT RAISE(ABORT,'injected failure'); END");
  const response=await production.POST(new Request(`${origin}/api/chatwork/production/internal/control`,{method:'POST',headers:{authorization:'Bearer local-control-secret-for-only-operator','content-type':'application/json'},body:JSON.stringify({action:'revoke',expectedGeneration:1,reason:'test'})}),context(['internal','control']));
  assert.equal(response.status,202);
  assert.equal((await response.json() as {jobsTransitioned:boolean}).jobsTransitioned,false);
  assert.equal((sqlite.prepare("SELECT approved FROM chatwork_delivery_runtime").get() as {approved:number}).approved,0);
  assert.equal((sqlite.prepare("SELECT COUNT(*) AS n FROM chatwork_delivery_control_audit").get() as {n:number}).n,1);
  sqlite.exec("DROP TRIGGER reject_revoke");
  const recovered=await production.POST(new Request(`${origin}/api/chatwork/production/internal/control`,{method:'POST',headers:{authorization:'Bearer local-control-secret-for-only-operator','content-type':'application/json'},body:JSON.stringify({action:'reconcile-revoked',expectedGeneration:2,reason:'repair'})}),context(['internal','control']));
  assert.equal(recovered.status,200);
  assert.equal((sqlite.prepare("SELECT status FROM chatwork_delivery_jobs WHERE id='job'").get() as {status:string}).status,'Unknown');
});

test("isolation confirmation cannot be partially saved when audit fails", async () => {
  const sqlite = fixture();
  sqlite.exec("UPDATE chatwork_delivery_runtime SET approved=0,approval_generation=2; INSERT INTO chatwork_delivery_jobs (id,kind,actor_id,actor_staff_revision,settings_version,account_id,room_id,room_name,status,error_code,lease_until,created_at,updated_at) VALUES ('00000000-0000-4000-8000-000000000001','DestinationVerification','manager',1,1,'a','1','room','Unknown','WORKER_REVOKED',1,'now','now'); CREATE TRIGGER fail_isolation BEFORE INSERT ON chatwork_delivery_control_audit BEGIN SELECT RAISE(ABORT,'audit failed'); END");
  const body = { action:'confirm-isolation',expectedGeneration:2,jobId:'00000000-0000-4000-8000-000000000001',reason:'confirmed',workerStopped:true,tokenInvalidated:true,requestsEnded:true,evidence:'record-1' };
  const response = await production.POST(new Request(`${origin}/api/chatwork/production/internal/control`,{method:'POST',headers:{authorization:'Bearer local-control-secret-for-only-operator','content-type':'application/json'},body:JSON.stringify(body)}),context(['internal','control']));
  assert.equal(response.status,500);
  assert.equal((sqlite.prepare("SELECT COUNT(*) AS n FROM chatwork_delivery_events WHERE action='WorkerIsolationConfirmed'").get() as {n:number}).n,0);
});

test("expired lease stays blocked until the old worker and token are isolated", async () => {
  const sqlite=fixture();
  sqlite.exec("UPDATE chatwork_production_settings SET version=2,account_id='account',account_confirmed=1,room_id='123',room_name='検証',status='DestinationVerificationRequired'");
  sqlite.prepare("UPDATE chatwork_delivery_runtime SET approved=1,worker_revision='w',site_revision='s',last_healthy_heartbeat_at=?").run(Date.now());
  const send=()=>production.POST(request('/api/chatwork/production/verify-posting','manager','POST',{expectedVersion:'2',requestId:crypto.randomUUID()}),context(['verify-posting']));
  const job=await (await send()).json() as {verificationId:string;marker:string};
  sqlite.prepare("UPDATE chatwork_delivery_jobs SET status='Posting',lease_id='old-lease',lease_until=? WHERE id=?").run(Date.now()-1,job.verificationId);
  const internal=(route:string,body:unknown,secret:string)=>production.POST(new Request(`${origin}/api/chatwork/production/internal/${route}`,{method:'POST',headers:{authorization:`Bearer ${secret}`,'x-kiiya-worker-identity':'valid-worker','content-type':'application/json'},body:JSON.stringify(body)}),context(['internal',route]));
  assert.equal((await internal('monitor',{},'local-secret-for-worker-only')).status,200);
  const old=sqlite.prepare('SELECT status,error_code FROM chatwork_delivery_jobs WHERE id=?').get(job.verificationId) as {status:string;error_code:string};
  assert.deepEqual([old.status,old.error_code],['Unknown','LEASE_EXPIRED']);
  const path=['verifications',job.verificationId,'resolve'];
  const resolve=()=>production.POST(request(`/api/chatwork/production/${path.join('/')}`,'manager','POST',{outcome:'NotSent',marker:job.marker,checked:true}),context(path));
  sqlite.prepare("INSERT INTO chatwork_delivery_events (id,job_id,actor_id,action,detail_json,created_at) VALUES ('legacy-isolation',?,'operator','WorkerIsolationConfirmed','{}','now')").run(job.verificationId);
  assert.equal((await resolve()).status,409);
  assert.equal((await send()).status,409);
  assert.equal((await internal('control',{action:'revoke',expectedGeneration:1,reason:'isolate old worker'},'local-control-secret-for-only-operator')).status,200);
  assert.equal((await resolve()).status,409);
  assert.equal((await internal('control',{action:'confirm-isolation',jobId:job.verificationId,expectedGeneration:2,reason:'isolation verified',workerStopped:true,tokenInvalidated:true,requestsEnded:true,evidence:'private-1'},'local-control-secret-for-only-operator')).status,200);
  assert.equal((await resolve()).status,200);
  assert.equal((sqlite.prepare("SELECT COUNT(*) AS n FROM chatwork_delivery_events WHERE job_id=? AND action='WorkerIsolationConfirmedV2'").get(job.verificationId) as {n:number}).n,1);
});


test("worker token is not returned if its job expires or destination changes during retrieval", async () => {
  for (const change of ["UPDATE chatwork_delivery_jobs SET status='Unknown',lease_id=NULL,lease_until=NULL", "UPDATE chatwork_production_settings SET version=3"]) {
    let armed = false;
    const sqlite = fixture(true, undefined, db => { if (armed) { armed = false; db.exec(change); } });
    sqlite.exec("UPDATE chatwork_production_settings SET version=2,account_id='account',account_confirmed=1,room_id='123',room_name='test',status='DestinationVerificationRequired'");
    const cipher = await seal(JSON.stringify({ accessToken:'access-only', refreshToken:'never-return', expiresAt:Date.now()+600000 }), tokenKey);
    sqlite.prepare("UPDATE chatwork_production_settings SET token_cipher=? WHERE id='production'").run(cipher);
    sqlite.prepare("UPDATE chatwork_delivery_runtime SET approved=1,worker_revision='worker-1',site_revision='site-1',last_healthy_heartbeat_at=? WHERE id='production'").run(Date.now());
    const created = await production.POST(request('/api/chatwork/production/verify-posting','manager','POST',{expectedVersion:'2',requestId:crypto.randomUUID()}),context(['verify-posting']));
    const job = await created.json() as {verificationId:string};
    const call = (path:string, body:unknown) => production.POST(new Request(`${origin}/api/chatwork/production/internal/${path}`,{method:'POST',headers:{authorization:'Bearer local-secret-for-worker-only','x-kiiya-worker-identity':'valid-worker','content-type':'application/json'},body:JSON.stringify(body)}),context(['internal',path]));
    const claim = await (await call('claim',{jobId:job.verificationId})).json() as {leaseId:string};
    armed = true;
    const response = await call('token',{jobId:job.verificationId,leaseId:claim.leaseId});
    assert.equal(response.status,409);
    assert.equal((await response.text()).includes('access-only'),false);
  }
});

test("operator initializes an empty database atomically including production settings", async () => {
  const sqlite = fixture(false);
  sqlite.exec("DELETE FROM chatwork_delivery_runtime");
  const control = (secret: string) => production.POST(new Request(`${origin}/api/chatwork/production/internal/control`, {method:'POST',headers:{authorization:`Bearer ${secret}`,'content-type':'application/json'},body:JSON.stringify({action:'initialize',expectedGeneration:0,reason:'initialize empty database'})}),context(['internal','control']));
  assert.equal((await control('wrong-secret')).status,403);
  assert.equal((await control('local-control-secret-for-only-operator')).status,200);
  assert.equal((sqlite.prepare("SELECT COUNT(*) AS n FROM chatwork_production_settings WHERE id='production'").get() as {n:number}).n,1);
  assert.equal((sqlite.prepare("SELECT COUNT(*) AS n FROM chatwork_delivery_runtime WHERE id='production' AND approved=0").get() as {n:number}).n,1);
  assert.equal((await control('local-control-secret-for-only-operator')).status,409);
});

test("production Chatwork settings reject requests from the old site origin", async () => {
  fixture();
  const req = new Request('https://kiiya-cleaning-rebuild.hherocl278.chatgpt.site/api/chatwork/production/settings', {headers:{'oai-authenticated-user-id':'manager'}});
  const res = await production.GET(req, context(['settings']));
  assert.equal(res.status,403);
});


test("monitor invalidates only provably unposted obsolete reports and respects concurrent revocation", async () => {
  for (const revoked of [false,true]) {
    let armed=false;
    const sqlite=fixture(true,db=>{if(armed){armed=false;db.exec("UPDATE chatwork_delivery_runtime SET approved=0,approval_generation=2,worker_subject=NULL")}});
    sqlite.exec(`UPDATE chatwork_delivery_runtime SET approved=1;
      INSERT INTO works(id,owner_id) VALUES ('work','manager');
      INSERT INTO chatwork_delivery_jobs(id,kind,report_id,work_id,actor_id,actor_staff_revision,settings_version,account_id,room_id,room_name,status,created_at,updated_at)
       VALUES ('report-job','ReportDelivery','report','work','manager',1,2,'account','room','test','DispatchPending','now','now');
      INSERT INTO chatwork_report_artifacts(id,job_id,ordinal,kind,status,updated_at) VALUES ('artifact','report-job',0,'body','Pending','now');
      UPDATE chatwork_delivery_jobs SET report_manifest_sealed=1 WHERE id='report-job';
      UPDATE app_users SET staff_revision=2 WHERE id='manager';`);
    armed=revoked;
    const response=await production.POST(new Request(`${origin}/api/chatwork/production/internal/monitor`,{method:'POST',headers:{authorization:'Bearer local-secret-for-worker-only','x-kiiya-worker-identity':'valid-worker','content-type':'application/json'},body:'{}'}),context(['internal','monitor']));
    assert.equal(response.status,revoked?403:200);
    assert.equal((sqlite.prepare("SELECT status FROM chatwork_delivery_jobs WHERE id='report-job'").get() as {status:string}).status,revoked?'DispatchPending':'Failed');
  }
});

test("report owner can read delivery history without exposing destination or credentials", async () => {
 const sqlite=fixture();
 sqlite.exec(`INSERT INTO works(id,owner_id) VALUES ('work','manager');
 INSERT INTO report_versions(id,work_id,sequence,format,status,body,snapshot_json,created_at)
 VALUES ('report','work',1,'markdown','Prepared','body','{"imageIds":[]}','now');
 INSERT INTO chatwork_delivery_jobs(id,kind,report_id,work_id,actor_id,actor_staff_revision,settings_version,account_id,room_id,room_name,status,error_code,created_at,updated_at)
 VALUES ('job','ReportDelivery','report','work','manager',1,2,'private-account','private-room','test','Failed','ACTOR_CHANGED','now','now');
 INSERT INTO chatwork_report_artifacts(id,job_id,ordinal,kind,status,updated_at) VALUES ('artifact','job',0,'body','Pending','now');`);
 const path=['works','work','reports','report','delivery'];
 const response=await app.GET(request('/api/works/work/reports/report/delivery','manager'),context(path));
 assert.equal(response.status,200);
 const result=await response.json() as {status:string;reason:string;artifacts:Array<{kind:string;status:string}>};
 assert.equal(result.status,'Failed');
 assert.equal(result.reason,'ACTOR_CHANGED');
 assert.deepEqual(result.artifacts,[{kind:'body',status:'Pending'}]);
 assert.ok(!JSON.stringify(result).includes('private-'));
 assert.equal((await app.GET(request('/api/works/work/reports/report/delivery','worker'),context(path))).status,403);
});


test("edited report text is saved exactly and empty or oversized edits are rejected",async()=>{
 const sqlite=fixture();
 const work=makeWork("担当者");
 work.startedAt="2026-11-02T01:00:00Z";work.staffNames=["テスト"];work.roomCodes=[];work.showerTarget=0;work.toiletTarget=0;work.breakAnswer="no";
 for(const id of activeTasks(work)){work.tasks[id].completed=true;work.tasks[id].assignees=["テスト"];work.tasks[id].timeNote="完了";}
 sqlite.prepare("INSERT INTO works(id,day,owner_id,revision,status,data_json) VALUES ('work','2026-11-02','manager',1,'Draft',?)").run(JSON.stringify(work));
 const send=(body:unknown)=>app.POST(request('/api/works/work/reports','manager','POST',{revision:1,format:'markdown',body}),context(['works','work','reports']));
 assert.equal((await send('  \n')).status,400);
 assert.equal((await send('あ'.repeat(50001))).status,400);
 const edited='テスト報告\n変更した内容';
 assert.equal((await send(edited)).status,201);
 assert.equal((sqlite.prepare('SELECT body FROM report_versions').get() as {body:string}).body,edited);
});

test('snapshot creation recovers lost responses and prevents unauthorized or fenced requests',async()=>{
 const sqlite=fixture(); const work=makeWork('担当者');
 work.startedAt='2026-11-02T01:00:00Z';work.staffNames=['テスト'];work.roomCodes=[];work.showerTarget=0;work.toiletTarget=0;work.breakAnswer='no';
 for(const id of activeTasks(work)){work.tasks[id].completed=true;work.tasks[id].assignees=['テスト'];work.tasks[id].timeNote='完了';}
 sqlite.prepare("INSERT INTO works(id,day,owner_id,revision,status,data_json) VALUES('work','2026-11-02','manager',1,'Draft',?)").run(JSON.stringify(work));
 const path=['works','work','report-candidate'];
 const initial=await app.GET(request('/api/works/work/report-candidate','manager'),context(path));
 assert.equal((await initial.json() as {epoch:number}).epoch,0);
 const advance=await app.POST(request('/api/works/work/report-candidate/fence-scope','manager','POST',{revision:1,expectedEpoch:0}),context([...path,'fence-scope']));
 assert.equal(advance.status,200);
 const late=await app.POST(request('/api/works/work/report-candidate','manager','POST',{requestId:crypto.randomUUID(),revision:1,epoch:0,body:'遅延要求',format:'markdown'}),context(path));
 assert.equal(late.status,409);
 const requestId=crypto.randomUUID();
 const create=(actor:string,id:string,body='編集済み報告')=>app.POST(request('/api/works/work/report-candidate',actor,'POST',{requestId:id,revision:1,epoch:1,body,format:'markdown'}),context(path));
 assert.equal((await create('worker',crypto.randomUUID())).status,403);
 const first=await create('manager',requestId);assert.equal(first.status,200);
 const candidate=(await first.json() as {candidateId:string}).candidateId;
 assert.equal((await (await create('manager',requestId)).json() as {candidateId:string}).candidateId,candidate);
 assert.equal((await (await create('manager',crypto.randomUUID())).json() as {candidateId:string}).candidateId,candidate);
 assert.equal((await create('manager',requestId,'別の内容')).status,409);
 const lookupPath=[...path,'requests',requestId];
 const lookup=await app.GET(request('/api/works/work/report-candidate/requests/'+requestId,'manager'),context(lookupPath));
 assert.equal(lookup.status,200);assert.deepEqual(await lookup.json(),{status:'Linked',candidateId:candidate});
 assert.equal((await app.GET(request('/api/works/work/report-candidate/requests/'+requestId,'worker'),context(lookupPath))).status,403);
 const read=await app.GET(request('/api/works/work/report-candidate','manager'),context(path));assert.equal(read.status,200);
 assert.equal((await read.json() as {candidate:{id:string}}).candidate.id,candidate);
 sqlite.exec("UPDATE app_users SET staff_revision=2 WHERE id='manager'");
 const stale=await app.GET(request('/api/works/work/report-candidate','manager'),context(path));
 assert.deepEqual((await stale.json() as {candidate:{id:string;stale:boolean}}).candidate.id,candidate);
 const staleAgain=await app.GET(request('/api/works/work/report-candidate','manager'),context(path));
 assert.equal((await staleAgain.json() as {candidate:{stale:boolean}}).candidate.stale,true);
 sqlite.exec("UPDATE app_users SET staff_revision=1 WHERE id='manager'");
 assert.equal((await app.GET(request('/api/works/work/report-candidate','worker'),context(path))).status,403);
 const delayed=crypto.randomUUID();
 const unknown=await app.GET(request('/api/works/work/report-candidate/requests/'+delayed,'manager'),context([...path,'requests',delayed]));
 assert.equal(unknown.status,404);assert.match((await unknown.json() as {error:string}).error,/遅延中/);
 const fence=await app.POST(request('/api/works/work/report-candidate/fence','manager','POST',{requestId:delayed,revision:1}),context([...path,'fence']));assert.equal(fence.status,200);
 const fenceRead=await app.GET(request('/api/works/work/report-candidate/requests/'+delayed,'manager'),context([...path,'requests',delayed]));
 assert.deepEqual(await fenceRead.json(),{status:'Fenced',candidateId:null});
 assert.equal((await create('manager',delayed)).status,409);
 const scopeFence=await app.POST(request('/api/works/work/report-candidate/fence-scope','manager','POST',{revision:1,expectedEpoch:1}),context([...path,'fence-scope']));
 assert.equal(scopeFence.status,409);
 assert.equal((sqlite.prepare('SELECT count(*) n FROM report_snapshot_candidates').get() as {n:number}).n,1);
 const closePath=[...path,'close'];
 assert.equal((await app.POST(request('/api/works/work/report-candidate/close','worker','POST',{revision:1,candidateId:candidate}),context(closePath))).status,403);
 assert.equal((await app.POST(request('/api/works/work/report-candidate/close','manager','POST',{revision:1,candidateId:candidate}),context(closePath))).status,200);
 assert.equal((await create('manager',crypto.randomUUID())).status,409);
 const after=await app.GET(request('/api/works/work/report-candidate','manager'),context(path));
 assert.deepEqual(await after.json(),{epoch:2,candidate:null});
});

test('candidate owner can see the fixed permit and cannot reuse a stale work version',async()=>{
 const sqlite=fixture();
 sqlite.exec(`INSERT INTO works(id,owner_id,revision) VALUES('work','manager',1);
 INSERT INTO report_snapshot_candidates VALUES('candidate','work','manager',1,1,'hash','報告','{}','Active','now');
 INSERT INTO report_versions(id,work_id,status,format,snapshot_json,body) VALUES('candidate','work','Prepared','markdown','{}','報告');
 INSERT INTO chatwork_delivery_jobs(id,kind,report_id,work_id,actor_id,actor_staff_revision,settings_version,account_id,room_id,room_name,status,delivery_mode,created_at,updated_at)
 VALUES('candidate-job','ReportDelivery','candidate','work','manager',1,1,'account','room','試験室','TestAwaitingRegistration','test','now','now');`);
 sqlite.prepare(`INSERT INTO chatwork_test_permits VALUES('candidate-permit','candidate-job','manager',1,'candidate','account','room',1,'123456','worker','site',1,'digest',?,'Active','now')`).run(Date.now()+60000);
 sqlite.exec(`UPDATE chatwork_production_settings SET version=1,account_id='account',room_id='room',account_confirmed=1,destination_verified=1,paused=0,status='DestinationVerified',token_cipher='encrypted';
 UPDATE chatwork_delivery_runtime SET approved=1,report_approved=0,worker_subject='123456',worker_revision='worker',site_revision='site',approval_generation=1,last_healthy_heartbeat_at=CAST(strftime('%s','now') AS INTEGER)*1000;`);
 const path=['works','work','report-candidate'];
 const response=await app.GET(request('/api/works/work/report-candidate','manager'),context(path));
 const result=await response.json() as {candidate:{trial:{roomName:string;status:string;permitValid:boolean}}};
 assert.equal(result.candidate.trial.roomName,'試験室');assert.equal(result.candidate.trial.status,'TestAwaitingRegistration');
 assert.equal(result.candidate.trial.permitValid,true);
 assert.equal((await app.GET(request('/api/works/work/reports/candidate/markdown','worker'),context(['works','work','reports','candidate','markdown']))).status,404);
 sqlite.exec("UPDATE chatwork_delivery_jobs SET status='Failed' WHERE id='candidate-job'");
 assert.equal((await app.GET(request('/api/works/work/reports/candidate/markdown','worker'),context(['works','work','reports','candidate','markdown']))).status,404);
 sqlite.exec("UPDATE chatwork_delivery_jobs SET status='TestAwaitingRegistration' WHERE id='candidate-job'");
 sqlite.exec('UPDATE works SET revision=2');
 const stale=await app.GET(request('/api/works/work/report-candidate','manager'),context(path));
 assert.equal((await stale.json() as {candidate:{trial:{permitValid:boolean}}}).candidate.trial.permitValid,false);
 assert.equal((await app.GET(request('/api/works/work/report-candidate','worker'),context(path))).status,403);
});

for (const deliveryFormat of ['markdown', 'pdf'] as const) test(`fixed ${deliveryFormat} candidate flows through preparation and confirmation`,async()=>{
 const sqlite=fixture();const work=makeWork('担当者');
 work.startedAt='2026-11-02T01:00:00Z';work.staffNames=['テスト'];work.roomCodes=[];work.showerTarget=0;work.toiletTarget=0;work.breakAnswer='no';
 for(const id of activeTasks(work)){work.tasks[id].completed=true;work.tasks[id].assignees=['テスト'];work.tasks[id].timeNote='完了';}
 sqlite.prepare("INSERT INTO works(id,day,owner_id,revision,status,data_json) VALUES('work','2026-11-02','manager',1,'Draft',?)").run(JSON.stringify(work));
 sqlite.exec(`UPDATE chatwork_production_settings SET version=2,account_id='test-account',room_id='123',room_name='試験室',account_confirmed=1,destination_verified=1,paused=0,status='DestinationVerified',token_cipher='cipher';
 UPDATE chatwork_delivery_runtime SET approved=1,report_approved=0,worker_revision='worker',site_revision='site',last_healthy_heartbeat_at=CAST(strftime('%s','now') AS INTEGER)*1000;
 INSERT INTO chatwork_delivery_control_audit VALUES ('approval','approve','operator','ok','{}','{"subject":"123456","generation":1,"workerRevision":"worker","siteRevision":"site","imageDigest":"sha256:test"}','now');`);
 Object.assign(testEnv,{DELIVERY_TEST_ACCOUNT_ID:'test-account',DELIVERY_TEST_ROOM_ID:'123',DELIVERY_TRIAL_WORKER_SUBJECT:'123456'});
 const path=['works','work','report-candidate'];
 const created=await app.POST(request('/api/works/work/report-candidate','manager','POST',{requestId:crypto.randomUUID(),revision:1,epoch:0,body:'固定された試験本文',format:deliveryFormat}),context(path));
 assert.equal(created.status,200);const candidateId=(await created.json() as {candidateId:string}).candidateId;
 const payload={action:'issue-test-permit',requestId:crypto.randomUUID(),reportId:candidateId,expiresAt:Date.now()+60000,reason:'test',expectedGeneration:1};
 const issued=await production.POST(new Request(`${origin}/api/chatwork/production/internal/control`,{method:'POST',headers:{authorization:'Bearer local-control-secret-for-only-operator','content-type':'application/json'},body:JSON.stringify(payload)}),context(['internal','control']));
 assert.equal(issued.status,200);const job=await issued.json() as {jobId:string;permitId:string};
 const waiting=await app.GET(request('/api/works/work/report-candidate','manager'),context(path));
 assert.equal((await waiting.json() as {candidate:{trial:{permitValid:boolean}}}).candidate.trial.permitValid,true);
 assert.equal((sqlite.prepare('SELECT status FROM chatwork_delivery_jobs').get() as {status:string}).status,'TestAwaitingRegistration');
 assert.equal((sqlite.prepare('SELECT count(*) n FROM report_snapshot_confirmations').get() as {n:number}).n,0);
 const confirm=()=>production.POST(request('/api/chatwork/production/trial/register','manager','POST',{...job,candidateId}),context(['trial','register']));
 assert.equal((await confirm()).status,409);
 sqlite.prepare("UPDATE chatwork_production_settings SET token_cipher=?").run(await seal(JSON.stringify({accessToken:'token',refreshToken:'refresh',expiresAt:Date.now()+3600000,scope:'rooms.files:write'}),tokenKey));
 const objects=new Map<string,Uint8Array>();Object.assign(testEnv,{SITE_ASSET_ACCESS_TOKEN:"test-site-asset-secret",BUCKET:{async put(k:string,v:Uint8Array){objects.set(k,new Uint8Array(v));return {}},async get(k:string){const v=objects.get(k);return v?{arrayBuffer:async()=>new Uint8Array(v).buffer}:null}}});
 const oldFetch=globalThis.fetch;globalThis.fetch=async(_url,options)=>{assert.equal(new Headers(options?.headers).get('OAI-Sites-Authorization'),'Bearer test-site-asset-secret');return new Response(readFileSync(new URL('../public/assets/fonts/NotoSansJP.ttf',import.meta.url)))};
 try{assert.equal((await production.POST(request('/api/chatwork/production/trial/prepare','manager','POST',job),context(['trial','prepare']))).status,200)}finally{globalThis.fetch=oldFetch;delete (testEnv as Record<string,unknown>).BUCKET;}
 const artifacts=sqlite.prepare('SELECT kind FROM chatwork_report_artifacts WHERE job_id=? ORDER BY ordinal').all(job.jobId) as {kind:string}[];
 assert.deepEqual(artifacts.map(a=>a.kind),deliveryFormat==='markdown'?['body']:['pdf']);
 const preparedStatus=await app.GET(request('/api/works/work/report-candidate','manager'),context(path));
 assert.equal((await preparedStatus.json() as {candidate:{trial:{prepared:boolean}}}).candidate.trial.prepared,true);
 assert.equal((await confirm()).status,200);assert.equal((await confirm()).status,200);
 const confirmed=await app.GET(request('/api/works/work/report-candidate','manager'),context(path));
 assert.equal((await confirmed.json() as {candidate:{confirmed:boolean}}).candidate.confirmed,true);
 assert.equal((sqlite.prepare('SELECT count(*) n FROM report_snapshot_confirmations').get() as {n:number}).n,1);
 assert.equal((sqlite.prepare('SELECT count(*) n FROM chatwork_delivery_jobs').get() as {n:number}).n,1);
});

test("creating a new report version blocks unknown or partially sent old deliveries",async()=>{
 const sqlite=fixture();
 const work=makeWork("担当者");
 work.startedAt="2026-11-02T01:00:00Z";work.staffNames=["テスト"];work.roomCodes=[];work.showerTarget=0;work.toiletTarget=0;work.breakAnswer="no";
 for(const id of activeTasks(work)){work.tasks[id].completed=true;work.tasks[id].assignees=["テスト"];work.tasks[id].timeNote="完了";}
 sqlite.prepare("INSERT INTO works(id,day,owner_id,revision,status,data_json,latest_report_id) VALUES ('work','2026-11-02','manager',1,'Prepared',?,'report')").run(JSON.stringify(work));
 sqlite.exec(`INSERT INTO report_versions(id,work_id,sequence,format,status,body,snapshot_json,created_at) VALUES ('report','work',1,'markdown','Prepared','body','{"imageIds":[]}','now');
 INSERT INTO chatwork_delivery_jobs(id,kind,report_id,work_id,actor_id,actor_staff_revision,settings_version,account_id,room_id,room_name,status,created_at,updated_at) VALUES ('job','ReportDelivery','report','work','manager',1,2,'a','r','test','Unknown','now','now');`);
 const send=()=>app.POST(request('/api/works/work/reports','manager','POST',{revision:1,format:'markdown'}),context(['works','work','reports']));
 const blocked=await send();
 assert.equal(blocked.status,409);
 assert.equal((sqlite.prepare("SELECT count(*) AS n FROM report_versions").get() as {n:number}).n,1);
 sqlite.exec("INSERT INTO chatwork_report_artifacts(id,job_id,ordinal,kind,status,updated_at) VALUES ('art','job',0,'body','Pending','now'); UPDATE chatwork_delivery_jobs SET status='Failed',error_code='ACTOR_CHANGED',report_manifest_sealed=1");
 assert.equal((await send()).status,201);
});

test("monitor releases an unsealed never-dispatched stale report for a new version",async()=>{
 const sqlite=fixture();
 const work=makeWork("担当者");
 work.startedAt="2026-11-02T01:00:00Z";work.staffNames=["テスト"];work.roomCodes=[];work.showerTarget=0;work.toiletTarget=0;work.breakAnswer="no";
 for(const id of activeTasks(work)){work.tasks[id].completed=true;work.tasks[id].assignees=["テスト"];work.tasks[id].timeNote="完了";}
 sqlite.prepare("INSERT INTO works(id,day,owner_id,revision,status,data_json,latest_report_id) VALUES ('work','2026-11-02','manager',1,'Prepared',?,'report')").run(JSON.stringify(work));
 sqlite.exec(`UPDATE chatwork_delivery_runtime SET approved=1;
 UPDATE app_users SET staff_revision=2 WHERE id='manager';
 INSERT INTO report_versions(id,work_id,sequence,format,status,body,snapshot_json,created_at) VALUES ('report','work',1,'markdown','Prepared','body','{"imageIds":[]}','now');
 INSERT INTO chatwork_delivery_jobs(id,kind,report_id,work_id,actor_id,actor_staff_revision,settings_version,account_id,room_id,room_name,status,created_at,updated_at)
 VALUES ('job','ReportDelivery','report','work','manager',1,2,'a','r','test','DispatchPending','now','now');`);
 const monitor=()=>production.POST(new Request(`${origin}/api/chatwork/production/internal/monitor`,{method:'POST',headers:{authorization:'Bearer local-secret-for-worker-only','x-kiiya-worker-identity':'valid-worker','content-type':'application/json'},body:'{}'}),context(['internal','monitor']));
 assert.equal((await monitor()).status,200);
 assert.deepEqual({...sqlite.prepare("SELECT status,error_code FROM chatwork_delivery_jobs WHERE id='job'").get()},{status:'Failed',error_code:'ACTOR_CHANGED_UNSEALED'});
 const response=await app.POST(request('/api/works/work/reports','manager','POST',{revision:1,format:'markdown'}),context(['works','work','reports']));
 assert.equal(response.status,201);
 assert.equal((sqlite.prepare("SELECT count(*) AS n FROM report_versions").get() as {n:number}).n,2);
 assert.equal((sqlite.prepare("SELECT count(*) AS n FROM chatwork_delivery_jobs WHERE id='job'").get() as {n:number}).n,1);
});


test("operator can revoke a test permit and prepared work stays unknown",async()=>{
 const sqlite=fixture();
 sqlite.exec(`UPDATE chatwork_delivery_runtime SET approved=1,approval_generation=1;
 INSERT INTO chatwork_delivery_jobs(id,kind,report_id,work_id,actor_id,actor_staff_revision,settings_version,account_id,room_id,room_name,status,lease_id,lease_until,created_at,updated_at)
 VALUES ('job','ReportDelivery','report','work','manager',1,1,'account','room','test','Posting','lease',9999999999999,'now','now');
 INSERT INTO chatwork_report_artifacts(id,job_id,ordinal,kind,status,updated_at) VALUES ('artifact','job',0,'body','Posting','now');
 INSERT INTO chatwork_test_permits VALUES ('00000000-0000-4000-8000-000000000001','job','manager',1,'report','account','room',1,'123456','worker','site',1,'digest',9999999999999,'Active','now');`);
 const invoke=(secret:string)=>production.POST(new Request(`${origin}/api/chatwork/production/internal/control`,{method:'POST',headers:{authorization:'Bearer '+secret,'content-type':'application/json'},body:JSON.stringify({action:'revoke-test-permit',permitId:'00000000-0000-4000-8000-000000000001',reason:'test ended',expectedGeneration:1})}),context(['internal','control']));
 assert.equal((await invoke('local-secret-for-worker-only')).status,403);
 assert.equal((await invoke('local-control-secret-for-only-operator')).status,200);
 assert.equal((sqlite.prepare("SELECT status FROM chatwork_report_artifacts").get() as {status:string}).status,'Unknown');
 assert.equal((sqlite.prepare("SELECT status FROM chatwork_delivery_jobs WHERE id='job'").get() as {status:string}).status,'Unknown');
});

test("monitor expires trial permit conservatively and stale monitor cannot mutate it",async()=>{
 for(const stale of [false,true]){
  let armed=false;
  const sqlite=fixture(true,db=>{if(armed){armed=false;db.exec("UPDATE chatwork_delivery_runtime SET approved=0,approval_generation=2,worker_subject=NULL")}});
  sqlite.exec(`UPDATE chatwork_delivery_runtime SET approved=1;
  INSERT INTO chatwork_delivery_jobs(id,kind,report_id,work_id,actor_id,actor_staff_revision,settings_version,account_id,room_id,room_name,status,lease_id,lease_until,created_at,updated_at)
  VALUES ('job','ReportDelivery','report','work','manager',1,1,'account','room','test','Posting','lease',9999999999999,'now','now');
  INSERT INTO chatwork_report_artifacts(id,job_id,ordinal,kind,status,updated_at) VALUES ('artifact','job',0,'body','Posting','now');
  INSERT INTO chatwork_test_permits VALUES ('00000000-0000-4000-8000-000000000001','job','manager',1,'report','account','room',1,'123456','worker','site',1,'digest',0,'Active','now');`);
  armed=stale;
  const response=await production.POST(new Request(`${origin}/api/chatwork/production/internal/monitor`,{method:'POST',headers:{authorization:'Bearer local-secret-for-worker-only','x-kiiya-worker-identity':'valid-worker','content-type':'application/json'},body:'{}'}),context(['internal','monitor']));
  assert.equal(response.status,stale?403:200);
  assert.equal((sqlite.prepare("SELECT status FROM chatwork_test_permits").get() as {status:string}).status,stale?'Active':'Expired');
  assert.equal((sqlite.prepare("SELECT status FROM chatwork_report_artifacts").get() as {status:string}).status,stale?'Posting':'Unknown');
 }
});

test('only authenticated operators may issue a fixed-destination trial reservation',async()=>{
 const sqlite=fixture();
 Object.assign(testEnv,{DELIVERY_TEST_ACCOUNT_ID:'test-account',DELIVERY_TEST_ROOM_ID:'123',DELIVERY_TRIAL_WORKER_SUBJECT:'123456'});
 const report='00000000-0000-4000-8000-000000000001';
 sqlite.exec(`INSERT INTO works (id,owner_id,latest_report_id) VALUES ('work','manager','${report}');
 INSERT INTO report_versions (id,work_id,status,format,snapshot_json,body) VALUES ('${report}','work','Prepared','markdown','{"imageIds":[]}','報告');
 UPDATE chatwork_production_settings SET version=2,account_id='test-account',room_id='123',room_name='test',account_confirmed=1,destination_verified=1,paused=0,status='DestinationVerified',token_cipher='cipher';
 UPDATE chatwork_delivery_runtime SET approved=1,report_approved=0,worker_revision='worker',site_revision='site',last_healthy_heartbeat_at=CAST(strftime('%s','now') AS INTEGER)*1000;
 INSERT INTO chatwork_delivery_control_audit VALUES ('approval','approve','operator','ok','{}','{"subject":"123456","generation":1,"workerRevision":"worker","siteRevision":"site","imageDigest":"sha256:test"}','now');`);
 const body={action:'issue-test-permit',requestId:'00000000-0000-4000-8000-000000000002',reportId:report,expiresAt:Date.now()+60000,reason:'test',expectedGeneration:1};
 const call=(secret:string,payload:unknown)=>production.POST(new Request(`${origin}/api/chatwork/production/internal/control`,{method:'POST',headers:{authorization:'Bearer '+secret,'content-type':'application/json'},body:JSON.stringify(payload)}),context(['internal','control']));
 assert.equal((await call('local-secret-for-worker-only',body)).status,403);
 assert.equal((await call('local-control-secret-for-only-operator',{...body,roomId:'another'})).status,400);
 const response=await call('local-control-secret-for-only-operator',body);assert.equal(response.status,200);
 const result=await response.json() as {jobId:string;permitId:string};
 assert.ok(result.jobId);assert.ok(result.permitId);
 assert.deepEqual(await (await call('local-control-secret-for-only-operator',body)).json(),result);
 assert.equal((sqlite.prepare('SELECT status FROM chatwork_delivery_jobs').get() as {status:string}).status,'TestAwaitingRegistration');
 const history=await app.GET(request(`/api/works/work/reports/${report}/delivery`,'manager'),context(['works','work','reports',report,'delivery']));
 const historyBody=await history.json() as {trial?:{jobId:string;permitId:string;roomName:string}};
 assert.deepEqual(historyBody.trial,{jobId:result.jobId,permitId:result.permitId,roomName:'test'});

 const register=(user:string)=>production.POST(request('/api/chatwork/production/trial/register',user,'POST',{jobId:result.jobId,permitId:result.permitId}),context(['trial','register']));
 assert.equal((await register('worker')).status,409);
 assert.equal((await register('manager')).status,200);
 assert.equal((sqlite.prepare('SELECT report_manifest_sealed FROM chatwork_delivery_jobs').get() as {report_manifest_sealed:number}).report_manifest_sealed,1);
 sqlite.prepare("UPDATE chatwork_production_settings SET token_cipher=?").run(await seal(JSON.stringify({accessToken:'token',refreshToken:'refresh',expiresAt:Date.now()+3600000,scope:'rooms.files:write'}),tokenKey));
 const objects=new Map<string,Uint8Array>();const bucket={async put(key:string,value:Uint8Array){objects.set(key,new Uint8Array(value));return {}},async get(key:string){const v=objects.get(key);return v?{arrayBuffer:async()=>new Uint8Array(v).buffer}:null}};
 Object.assign(testEnv,{BUCKET:bucket});const oldFetch=globalThis.fetch;
 globalThis.fetch=async()=>new Response(readFileSync(new URL('../public/assets/fonts/NotoSansJP.ttf',import.meta.url)));
 try{const prepared=await production.POST(request('/api/chatwork/production/trial/prepare','manager','POST',{jobId:result.jobId,permitId:result.permitId}),context(['trial','prepare']));assert.equal(prepared.status,200)}finally{globalThis.fetch=oldFetch;delete (testEnv as Record<string,unknown>).BUCKET;}
 assert.equal((sqlite.prepare('SELECT count(*) n FROM chatwork_report_prepared_files').get() as {n:number}).n,3);
 const worker=(path:string,body:unknown)=>production.POST(new Request(`${origin}/api/chatwork/production/internal/${path}`,{method:'POST',headers:{authorization:'Bearer local-secret-for-worker-only','x-kiiya-worker-identity':'valid-worker','content-type':'application/json'},body:JSON.stringify(body)}),context(['internal',path]));
 delete (testEnv as Record<string,unknown>).DELIVERY_TRIAL_WORKER_SUBJECT;
 const blockedMonitor=await worker('monitor',{});assert.equal(((await blockedMonitor.json()) as {pendingJobs:{id:string}[]}).pendingJobs.some(job=>job.id===result.jobId),false);
 assert.equal((await worker('claim',{jobId:result.jobId})).status,403);
 Object.assign(testEnv,{DELIVERY_TRIAL_WORKER_SUBJECT:'123456'});
 const monitor=await worker('monitor',{});assert.equal(monitor.status,200);
 assert.ok(((await monitor.json()) as {pendingJobs:{id:string}[]}).pendingJobs.some(job=>job.id===result.jobId));
 const claim=await worker('claim',{jobId:result.jobId});assert.equal(claim.status,200);
 assert.equal(((await claim.json()) as {kind:string}).kind,'ReportDelivery');

 sqlite.exec("UPDATE chatwork_delivery_jobs SET status='Unknown',error_code='LEASE_EXPIRED'; UPDATE chatwork_report_artifacts SET status='Unknown' WHERE ordinal=0; UPDATE chatwork_delivery_runtime SET approved=0,approval_generation=2");
 const artifactId=(sqlite.prepare("SELECT id FROM chatwork_report_artifacts WHERE ordinal=0").get() as {id:string}).id;
 const reconcile=()=>production.POST(request('/api/chatwork/production/trial/reconcile','manager','POST',{jobId:result.jobId,artifactId,outcome:'NotSent'}),context(['trial','reconcile']));
 assert.equal((await reconcile()).status,409);
 const isolation={action:'confirm-report-isolation',jobId:result.jobId,expectedGeneration:2,reason:'verified',evidence:'evidence',workerStopped:true,tokenInvalidated:true,requestsEnded:true};
 assert.equal((await call('local-control-secret-for-only-operator',{...isolation,requestsEnded:false})).status,400);
 assert.equal((await call('local-control-secret-for-only-operator',isolation)).status,200);
 const isolatedHistory=await app.GET(request(`/api/works/work/reports/${report}/delivery`,'manager'),context(['works','work','reports',report,'delivery']));
 const isolatedBody=await isolatedHistory.json() as {canReconcile:boolean;artifacts:{id?:string;status:string}[]};
 assert.equal(isolatedBody.canReconcile,true);assert.ok(isolatedBody.artifacts.some(a=>a.id===artifactId&&a.status==='Unknown'));
 assert.equal((await reconcile()).status,200);
 delete (testEnv as Record<string,unknown>).DELIVERY_TEST_ACCOUNT_ID;delete (testEnv as Record<string,unknown>).DELIVERY_TEST_ROOM_ID;delete (testEnv as Record<string,unknown>).DELIVERY_TRIAL_WORKER_SUBJECT;
});

test('report token is bound to the same artifact and current staff before and after retrieval',async()=>{
 for(const change of ["UPDATE chatwork_report_artifacts SET status='Sent',message_id='sent' WHERE id='artifact'; UPDATE chatwork_report_artifacts SET status='Posting' WHERE id='other'", "UPDATE app_users SET active=0 WHERE id='manager'", "UPDATE app_users SET role='it' WHERE id='manager'", "UPDATE app_users SET staff_revision=staff_revision+1 WHERE id='manager'"]){
 for(const timing of ['before','during']){
 let armed=false;
 const sqlite=fixture(true,undefined,db=>{if(armed){armed=false;db.exec(change)}});
 Object.assign(testEnv,{DELIVERY_TRIAL_WORKER_SUBJECT:'123456'});
 sqlite.exec(`UPDATE chatwork_production_settings SET version=2,account_id='account',room_id='123',paused=0;
 UPDATE chatwork_delivery_runtime SET approved=1;
 INSERT INTO chatwork_delivery_jobs(id,kind,report_id,work_id,actor_id,actor_staff_revision,settings_version,account_id,room_id,room_name,status,lease_id,lease_until,created_at,updated_at,delivery_mode) VALUES('job','ReportDelivery','report','work','manager',1,2,'account','123','test','Posting','lease',CAST(strftime('%s','now') AS INTEGER)*1000+60000,'now','now','test');
 INSERT INTO chatwork_report_artifacts(id,job_id,ordinal,kind,status,updated_at) VALUES('artifact','job',0,'body','Posting','now'),('other','job',1,'markdown','Pending','now');
 INSERT INTO chatwork_test_permits VALUES('permit','job','manager',1,'report','account','123',2,'123456','worker','site',1,'digest',CAST(strftime('%s','now') AS INTEGER)*1000+60000,'Active','now');`);
 sqlite.prepare("UPDATE chatwork_production_settings SET token_cipher=?").run(await seal(JSON.stringify({accessToken:'test-access-token',refreshToken:'refresh',expiresAt:Date.now()+3600000,scope:'rooms.files:write'}),tokenKey));
 if(timing==='before')sqlite.exec(change); else armed=true;
 const response=await production.POST(new Request(`${origin}/api/chatwork/production/internal/token`,{method:'POST',headers:{authorization:'Bearer local-secret-for-worker-only','x-kiiya-worker-identity':'valid-worker','content-type':'application/json'},body:JSON.stringify({jobId:'job',leaseId:'lease',artifactId:'artifact'})}),context(['internal','token']));
 assert.equal(response.status,409,change);
 assert.equal((await response.text()).includes('test-access-token'),false);
 }
 }
 delete (testEnv as Record<string,unknown>).DELIVERY_TRIAL_WORKER_SUBJECT;
});

test('worker report artifact operations require the bound permit and current subject',async()=>{
 const sqlite=fixture();
 Object.assign(testEnv,{DELIVERY_TRIAL_WORKER_SUBJECT:'123456'});
 sqlite.exec(`INSERT INTO works (id,owner_id,latest_report_id) VALUES ('work','manager','report');
 INSERT INTO report_versions(id,work_id,sequence,format,status,body,snapshot_json,created_at) VALUES('report','work',1,'markdown','Prepared','body','{"imageIds":[]}','now');
 UPDATE chatwork_production_settings SET version=2,account_id='account',room_id='123',paused=0;
 UPDATE chatwork_delivery_runtime SET approved=1,report_approved=0,worker_revision='worker',site_revision='site',last_healthy_heartbeat_at=CAST(strftime('%s','now') AS INTEGER)*1000;
 INSERT INTO chatwork_delivery_control_audit VALUES ('approval','approve','operator','ok','{}','{"subject":"123456","generation":1,"workerRevision":"worker","siteRevision":"site","imageDigest":"digest"}','now');
 INSERT INTO chatwork_delivery_jobs(id,kind,report_id,work_id,actor_id,actor_staff_revision,settings_version,account_id,room_id,room_name,status,lease_id,lease_until,created_at,updated_at,delivery_mode) VALUES('job','ReportDelivery','report','work','manager',1,2,'account','123','test','Posting','lease',CAST(strftime('%s','now') AS INTEGER)*1000+60000,'now','now','test');
 INSERT INTO chatwork_report_artifacts(id,job_id,ordinal,kind,status,updated_at) VALUES('artifact','job',0,'body','Pending','now');
 UPDATE chatwork_delivery_jobs SET report_manifest_sealed=1 WHERE id='job';
 INSERT INTO chatwork_test_permits VALUES('permit','job','manager',1,'report','account','123',2,'123456','worker','site',1,'digest',CAST(strftime('%s','now') AS INTEGER)*1000+60000,'Active','now');`);
 const call=(path:string,body:unknown,identity='valid-worker')=>production.POST(new Request(`${origin}/api/chatwork/production/internal/report/${path}`,{method:'POST',headers:{authorization:'Bearer local-secret-for-worker-only','x-kiiya-worker-identity':identity,'content-type':'application/json'},body:JSON.stringify(body)}),context(['internal','report',path]));
 const item={jobId:'job',leaseId:'lease',artifactId:'artifact'};
 const objects=new Map<string,Uint8Array>();const content=new TextEncoder().encode('body');const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',content)),b=>b.toString(16).padStart(2,'0')).join('');
 sqlite.exec("DROP TRIGGER chatwork_report_artifacts_no_insert_after_seal; INSERT INTO chatwork_report_artifacts(id,job_id,ordinal,kind,status,updated_at) VALUES('markdown','job',1,'markdown','Pending','now'),('pdf','job',2,'pdf','Pending','now')");
 for(const id of ['artifact','markdown','pdf']){const key='key-'+id;objects.set(key,content);sqlite.prepare('INSERT INTO chatwork_report_prepared_files VALUES(?,?,?,?,?,?,?)').run(id,key,digest,content.length,id==='artifact'?'text/plain':id==='markdown'?'text/markdown':'application/pdf',id+'.txt','now')}
 Object.assign(testEnv,{BUCKET:{async get(key:string){const v=objects.get(key);return v?{arrayBuffer:async()=>new Uint8Array(v).buffer}:null}}});
 sqlite.prepare("UPDATE chatwork_production_settings SET token_cipher=?").run(await seal(JSON.stringify({accessToken:'token',refreshToken:'refresh',expiresAt:Date.now()+3600000}),tokenKey));
 assert.equal((await call('preflight',{jobId:'job',leaseId:'lease'})).status,409);
 sqlite.prepare("UPDATE chatwork_production_settings SET token_cipher=?").run(await seal(JSON.stringify({accessToken:'token',refreshToken:'refresh',expiresAt:Date.now()+3600000,scope:'rooms.files:write'}),tokenKey));
 const tokenRequest=()=>production.POST(new Request(`${origin}/api/chatwork/production/internal/token`,{method:'POST',headers:{authorization:'Bearer local-secret-for-worker-only','x-kiiya-worker-identity':'valid-worker','content-type':'application/json'},body:JSON.stringify({jobId:'job',leaseId:'lease',artifactId:'artifact'})}),context(['internal','token']));
 assert.equal((await tokenRequest()).status,409);
 assert.equal((await call('preflight',{jobId:'job',leaseId:'lease'})).status,200);
 objects.set('key-pdf',new Uint8Array([1,2,3]));
 assert.equal((await call('preflight',{jobId:'job',leaseId:'lease'})).status,500);
 objects.set('key-pdf',content);
 assert.equal(((await (await call('next',{jobId:'job',leaseId:'lease'})).json()) as {artifactId:string}).artifactId,'artifact');
 assert.equal((await call('claim',item,'old-worker')).status,403);
 assert.equal((await call('claim',item)).status,200);
 const noArtifact=await production.POST(new Request(`${origin}/api/chatwork/production/internal/token`,{method:'POST',headers:{authorization:'Bearer local-secret-for-worker-only','x-kiiya-worker-identity':'valid-worker','content-type':'application/json'},body:JSON.stringify({jobId:'job',leaseId:'lease'})}),context(['internal','token']));
 assert.equal(noArtifact.status,409);
 assert.equal((await tokenRequest()).status,200);
 assert.equal(((await (await call('payload',item)).json()) as {body:string}).body,'body');
 assert.equal((await call('result',{...item,status:'Sent',messageId:'message',errorCode:null})).status,200);
 assert.equal((sqlite.prepare("SELECT message_id FROM chatwork_report_artifacts WHERE id='artifact'").get() as {message_id:string}).message_id,'message');
 assert.equal((await call('result',{...item,status:'Sent',messageId:'other'})).status,409);
 assert.equal((await call('complete',{jobId:'job',leaseId:'lease'})).status,409);
 delete (testEnv as Record<string,unknown>).BUCKET;delete (testEnv as Record<string,unknown>).DELIVERY_TRIAL_WORKER_SUBJECT;
});

test('trial report reaches the worker and records every prepared artifact once',async()=>{
 const sqlite=fixture();
 Object.assign(testEnv,{DELIVERY_TEST_ACCOUNT_ID:'test-account',DELIVERY_TEST_ROOM_ID:'123',DELIVERY_TRIAL_WORKER_SUBJECT:'123456'});
 const report='00000000-0000-4000-8000-000000000011';
 sqlite.exec(`INSERT INTO works(id,owner_id,latest_report_id) VALUES('work','manager','${report}');
 INSERT INTO report_versions(id,work_id,status,format,snapshot_json,body) VALUES('${report}','work','Prepared','markdown','{"imageIds":["image"]}','試験報告');
 UPDATE chatwork_production_settings SET version=2,account_id='test-account',room_id='123',room_name='test',account_confirmed=1,destination_verified=1,paused=0,status='DestinationVerified';
 UPDATE chatwork_delivery_runtime SET approved=1,report_approved=0,worker_revision='worker',site_revision='site',last_healthy_heartbeat_at=CAST(strftime('%s','now') AS INTEGER)*1000;
 INSERT INTO chatwork_delivery_control_audit VALUES ('approval','approve','operator','ok','{}','{"subject":"123456","generation":1,"workerRevision":"worker","siteRevision":"site","imageDigest":"sha256:test"}','now');`);
 sqlite.prepare("UPDATE chatwork_production_settings SET token_cipher=?").run(await seal(JSON.stringify({accessToken:'test-token',refreshToken:'test-refresh',expiresAt:Date.now()+3600000,scope:'rooms.files:write'}),tokenKey));
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=','base64');
 sqlite.prepare("INSERT INTO images(id,work_id,object_key,file_name,mime,bytes) VALUES('image','work','source','photo.png','image/png',?)").run(png.length);
 const objects=new Map<string,Uint8Array>([['source',png]]);const bucket={async put(k:string,v:Uint8Array){objects.set(k,new Uint8Array(v));return {}},async get(k:string){const v=objects.get(k);return v?{arrayBuffer:async()=>new Uint8Array(v).buffer}:null}};
 Object.assign(testEnv,{BUCKET:bucket});
 const control=await production.POST(new Request(`${origin}/api/chatwork/production/internal/control`,{method:'POST',headers:{authorization:'Bearer local-control-secret-for-only-operator','content-type':'application/json'},body:JSON.stringify({action:'issue-test-permit',reportId:report,requestId:'00000000-0000-4000-8000-000000000012',expiresAt:Date.now()+60000,reason:'test',expectedGeneration:1})}),context(['internal','control']));
 assert.equal(control.status,200);const job=await control.json() as {jobId:string;permitId:string};
 assert.equal((await production.POST(request('/api/chatwork/production/trial/register','manager','POST',job),context(['trial','register']))).status,200);
 const oldFetch=globalThis.fetch;globalThis.fetch=async()=>new Response(readFileSync(new URL('../public/assets/fonts/NotoSansJP.ttf',import.meta.url)));
 try{assert.equal((await production.POST(request('/api/chatwork/production/trial/prepare','manager','POST',job),context(['trial','prepare']))).status,200)}finally{globalThis.fetch=oldFetch}
 const {createHandler}=await import('../delivery-worker/handler.mjs');
 const calls:string[]=[];let n=0;
 const handler=createHandler({mode:'worker',siteOrigin:origin,sharedSecret:'local-secret-for-worker-only',siteIdentityAudience:'https://site.example/worker'},{fetchImpl:async(url:string|URL,init:RequestInit)=>{
  const u=new URL(url);if(u.hostname==='metadata.google.internal')return new Response('valid-worker');
  if(u.hostname==='api.chatwork.com'){calls.push(u.pathname);return Response.json(u.pathname.endsWith('/messages')?{message_id:'msg'}:{file_id:`file-${++n}`});}
  const path=u.pathname.split('/').filter(Boolean).slice(3);return production.POST(new Request(u,init),context(path));
 }});
 const response=await handler(new Request('http://localhost/deliver',{method:'POST',body:JSON.stringify({jobId:job.jobId})}));
 assert.equal(response.status,200);assert.deepEqual(calls,['/v2/rooms/123/messages','/v2/rooms/123/files','/v2/rooms/123/files','/v2/rooms/123/files']);
 assert.equal((sqlite.prepare('SELECT status FROM chatwork_delivery_jobs WHERE id=?').get(job.jobId) as {status:string}).status,'Sent');
 assert.deepEqual(sqlite.prepare('SELECT kind,status FROM chatwork_report_artifacts WHERE job_id=? ORDER BY ordinal').all(job.jobId).map(x=>({...x})),[{kind:'body',status:'Sent'},{kind:'markdown',status:'Sent'},{kind:'pdf',status:'Sent'},{kind:'image',status:'Sent'}]);
 delete (testEnv as Record<string,unknown>).BUCKET;delete (testEnv as Record<string,unknown>).DELIVERY_TEST_ACCOUNT_ID;delete (testEnv as Record<string,unknown>).DELIVERY_TEST_ROOM_ID;delete (testEnv as Record<string,unknown>).DELIVERY_TRIAL_WORKER_SUBJECT;
});

test('isolated trial owner can download only an unresolved prepared file for manual recovery',async()=>{
 const sqlite=fixture();sqlite.exec(`INSERT INTO works(id,owner_id,latest_report_id) VALUES('work','manager','report');
 INSERT INTO report_versions(id,work_id,status,format,snapshot_json,body) VALUES('report','work','Prepared','markdown','{"imageIds":[]}','body');
 INSERT INTO chatwork_delivery_jobs(id,kind,report_id,work_id,actor_id,actor_staff_revision,settings_version,account_id,room_id,room_name,status,created_at,updated_at,delivery_mode) VALUES('job','ReportDelivery','report','work','manager',1,1,'a','r','test','Unknown','now','now','test');
 INSERT INTO chatwork_report_artifacts(id,job_id,ordinal,kind,status,error_code,updated_at) VALUES('file','job',1,'markdown','Failed','MANUALLY_CONFIRMED_NOT_SENT','now');
 INSERT INTO chatwork_delivery_events(id,job_id,actor_id,action,detail_json,created_at) VALUES('isolation','job','operator','ReportIsolationConfirmed','{"workerStopped":true,"tokenInvalidated":true,"requestsEnded":true}','now');`);
 const content=new TextEncoder().encode('report');const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',content)),b=>b.toString(16).padStart(2,'0')).join('');
 sqlite.prepare('INSERT INTO chatwork_report_prepared_files VALUES(?,?,?,?,?,?,?)').run('file','private-key',digest,content.length,'text/markdown','report.md','now');
 Object.assign(testEnv,{BUCKET:{async get(key:string){return key==='private-key'?{arrayBuffer:async()=>new Uint8Array(content).buffer}:null}}});
 const path=['works','work','reports','report','delivery','file','file'];
 assert.equal((await app.GET(request('/api/works/work/reports/report/delivery/file/file','worker'),context(path))).status,403);
 const response=await app.GET(request('/api/works/work/reports/report/delivery/file/file','manager'),context(path));assert.equal(response.status,200);assert.equal(await response.text(),'report');
 delete (testEnv as Record<string,unknown>).BUCKET;
});

test('identical concurrent work updates return one success and one conflict',async()=>{
 const sqlite=fixture();
 const work=makeWork('担当者');
 sqlite.prepare("INSERT INTO works(id,day,owner_id,revision,status,data_json) VALUES('work','2026-11-02','manager',1,'Draft',?)").run(JSON.stringify(work));
 const next={...work,notes:'同一の更新'};
 const send=()=>app.PUT(request('/api/works/work','manager','PUT',{revision:1,data:next}),context(['works','work']));
 const responses=await Promise.all([send(),send()]);
 assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
 assert.equal((sqlite.prepare('SELECT count(*) AS n FROM work_changes').get() as {n:number}).n,1);
 assert.equal((sqlite.prepare("SELECT revision FROM works WHERE id='work'").get() as {revision:number}).revision,2);
});

test('operator can inspect only a specified test job storage prefix without exposing object keys',async()=>{
 const sqlite=fixture();const job='00000000-0000-4000-8000-000000000001';
 sqlite.prepare("INSERT INTO chatwork_delivery_jobs (id,kind,actor_id,actor_staff_revision,settings_version,account_id,room_id,room_name,status,created_at,updated_at,delivery_mode) VALUES (?,'ReportDelivery','manager',1,1,'a','r','test','Failed','now','now','test')").run(job);
 let checked='';Object.assign(testEnv,{BUCKET:{async list(options:{prefix:string}){checked=options.prefix;return {objects:[{size:123,uploaded:new Date('2026-11-03T00:00:00Z'),key:'private/key'}],truncated:false}}}});
 const payload={action:'inspect-test-objects',jobId:job,expectedGeneration:1,reason:'trial diagnosis'};
 const invoke=(secret:string)=>production.POST(new Request(`${origin}/api/chatwork/production/internal/control`,{method:'POST',headers:{authorization:`Bearer ${secret}`,'content-type':'application/json'},body:JSON.stringify(payload)}),context(['internal','control']));
 try{assert.equal((await invoke('wrong-secret')).status,403);const result=await invoke('local-control-secret-for-only-operator');assert.equal(result.status,200);const body=await result.json() as {count:number};assert.equal(checked,`chatwork-trial/${job}/`);assert.equal(body.count,1);assert.doesNotMatch(JSON.stringify(body),/private\/key/)}finally{delete (testEnv as Record<string,unknown>).BUCKET}
});

test('report owner can reserve a fixed test delivery without an operator action, with idempotent recovery',async()=>{
 const sqlite=fixture();const work=makeWork('担当者');work.startedAt='2026-11-02T01:00:00Z';work.staffNames=['テスト'];work.roomCodes=[];work.showerTarget=0;work.toiletTarget=0;work.breakAnswer='no';
 for(const id of activeTasks(work)){work.tasks[id].completed=true;work.tasks[id].assignees=['テスト'];work.tasks[id].timeNote='完了'}
 sqlite.prepare("INSERT INTO works(id,day,owner_id,revision,status,data_json) VALUES('work','2026-11-02','manager',1,'Draft',?)").run(JSON.stringify(work));
 sqlite.exec(`UPDATE chatwork_production_settings SET version=2,account_id='test-account',room_id='123',room_name='試験室',account_confirmed=1,destination_verified=1,paused=0,status='DestinationVerified',token_cipher='cipher'; UPDATE chatwork_delivery_runtime SET approved=1,report_approved=0,worker_revision='worker',site_revision='site',last_healthy_heartbeat_at=CAST(strftime('%s','now') AS INTEGER)*1000; INSERT INTO chatwork_delivery_control_audit VALUES ('approval','approve','operator','ok','{}','{"subject":"123456","generation":1,"workerRevision":"worker","siteRevision":"site","imageDigest":"sha256:test"}','now');`);
 Object.assign(testEnv,{DELIVERY_TEST_ACCOUNT_ID:'test-account',DELIVERY_TEST_ROOM_ID:'123',DELIVERY_TRIAL_WORKER_SUBJECT:'123456'});
 const created=await app.POST(request('/api/works/work/report-candidate','manager','POST',{requestId:crypto.randomUUID(),revision:1,epoch:0,body:'個人情報なし',format:'markdown'}),context(['works','work','report-candidate']));const candidate=(await created.json() as {candidateId:string}).candidateId;
 const reserve=(user:string)=>production.POST(request('/api/chatwork/production/trial/self-reserve',user,'POST',{candidateId:candidate}),context(['trial','self-reserve']));
 assert.equal((await reserve('worker')).status,409);
 sqlite.exec("UPDATE app_users SET role='field' WHERE id='worker'");
 assert.equal((await reserve('worker')).status,409);
 assert.equal((sqlite.prepare('SELECT count(*) n FROM chatwork_delivery_jobs').get() as {n:number}).n,0);
 const [a,b]=await Promise.all([reserve('manager'),reserve('manager')]);assert.equal(a.status,200);assert.equal(b.status,200);
 const first=await a.json() as {jobId:string;permitId:string};const second=await b.json() as typeof first;assert.deepEqual(first,second);
 const cancel=(user:string)=>production.POST(request('/api/chatwork/production/trial/self-cancel',user,'POST',{candidateId:candidate}),context(['trial','self-cancel']));
 assert.equal((await cancel('worker')).status,409);
 assert.equal((sqlite.prepare('SELECT count(*) n FROM chatwork_delivery_jobs').get() as {n:number}).n,1);
 assert.equal((sqlite.prepare('SELECT status FROM chatwork_delivery_jobs').get() as {status:string}).status,'TestAwaitingRegistration');
 assert.equal((sqlite.prepare('SELECT count(*) n FROM report_snapshot_confirmations').get() as {n:number}).n,0);
 sqlite.prepare("UPDATE chatwork_production_settings SET token_cipher=?").run(await seal(JSON.stringify({accessToken:'token',refreshToken:'refresh',expiresAt:Date.now()+3600000,scope:'rooms.files:write'}),tokenKey));
 const objects=new Map<string,Uint8Array>();Object.assign(testEnv,{BUCKET:{async put(k:string,v:Uint8Array){objects.set(k,new Uint8Array(v));return {}},async get(k:string){const v=objects.get(k);return v?{arrayBuffer:async()=>new Uint8Array(v).buffer}:null}}});
 const oldFetch=globalThis.fetch;globalThis.fetch=async()=>new Response(readFileSync(new URL('../public/assets/fonts/NotoSansJP.ttf',import.meta.url)));
 try{
  const prepare=()=>production.POST(request('/api/chatwork/production/trial/prepare','manager','POST',first),context(['trial','prepare']));
  assert.equal((await prepare()).status,200);
  const confirm=()=>production.POST(request('/api/chatwork/production/trial/register','manager','POST',{...first,candidateId:candidate}),context(['trial','register']));
  assert.equal((await confirm()).status,200);assert.equal((await confirm()).status,200);
  assert.equal((await cancel('manager')).status,409);
  assert.equal((sqlite.prepare('SELECT status FROM chatwork_delivery_jobs').get() as {status:string}).status,'DispatchPending');
  assert.equal((sqlite.prepare('SELECT count(*) n FROM report_snapshot_confirmations').get() as {n:number}).n,1);
 }finally{globalThis.fetch=oldFetch;delete (testEnv as Record<string,unknown>).BUCKET}
 delete (testEnv as Record<string,unknown>).DELIVERY_TEST_ACCOUNT_ID;delete (testEnv as Record<string,unknown>).DELIVERY_TEST_ROOM_ID;delete (testEnv as Record<string,unknown>).DELIVERY_TRIAL_WORKER_SUBJECT;
});

test('public status distinguishes verification path readiness from report delivery', async()=>{
 const sqlite=fixture();sqlite.prepare("UPDATE chatwork_delivery_runtime SET approved=1,worker_revision='worker-1',site_revision='site-1',last_healthy_heartbeat_at=? WHERE id='production'").run(Date.now());
 let response=await app.GET(request('/api/report-delivery-settings','worker'),context(['report-delivery-settings']));let value=await response.json() as any;assert.equal(value.verificationReady,true);assert.equal(value.deliveryEnabled,false);
 sqlite.prepare("UPDATE chatwork_delivery_runtime SET last_healthy_heartbeat_at=? WHERE id='production'").run(Date.now()-300000);response=await app.GET(request('/api/report-delivery-settings','worker'),context(['report-delivery-settings']));value=await response.json();assert.equal(value.verificationReady,false);
});
