import { env } from "cloudflare:workers";
import { cleanWork, initialMaster, makeWork, missingForReport, reportBody, todayJst, type WorkData } from "@/lib/domain";
import { leadNameForNewWork } from "@/lib/lead-name";
import { resetWork } from "@/lib/work-reset";
import { publicDeliverySettings } from "@/lib/chatwork-production-store";
import { verificationPathReady } from "@/lib/verification-readiness";
import { reportRetryGuard } from "@/lib/report-retry-guard";
import { readWorkerFile } from "@/lib/report-worker-files";
import { hasStaffAccess, isAppointedStaff } from "@/lib/staff-access";
import { reserveSnapshot, fenceSnapshotRequest, fenceSnapshotScope, closeSnapshot } from "@/lib/report-snapshot-reservation";

export const runtime = "edge";
type Context = { params: Promise<{ path: string[] }> };
type User = { id: string; email: string; name: string; role: "normal" | "field" };
class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
function db(): D1Database { if (!env.DB) throw new ApiError(503, "D1が未設定です"); return env.DB; }
function bucket(): R2Bucket { if (!env.BUCKET) throw new ApiError(503, "R2が未設定です"); return env.BUCKET; }
function reply(value: unknown, status = 200): Response { return Response.json(value, { status, headers: { "cache-control": "no-store" } }); }
function fail(error: unknown): Response {
  if (error instanceof ApiError) return reply({ error: error.message }, error.status);
  if (error instanceof SyntaxError) return reply({ error: "JSONが不正です" }, 400);
  console.error("api_failure", error instanceof Error ? error.message : String(error));
  return reply({ error: "処理に失敗しました" }, 500);
}
async function body(request: Request): Promise<Record<string, any>> {
  const result = await request.json();
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new ApiError(400, "入力が不正です");
  return result as Record<string, any>;
}
function identity(request: Request): { id: string; email: string; name: string } {
  const id = request.headers.get("oai-authenticated-user-id");
  const email = request.headers.get("oai-authenticated-user-email");
  if (!id || !email) throw new ApiError(401, "サインインが必要です");
  const encoded = request.headers.get("oai-authenticated-user-full-name");
  let name = email;
  if (encoded) { try { name = decodeURIComponent(encoded); } catch { /* email fallback */ } }
  return { id, email, name };
}
async function staffRow(who: { id: string; email: string; name: string }): Promise<any> {
  if (!await hasStaffAccess(db(), env.APP_STAFF_USER_IDS, who.id)) return null;
  const initialRole = who.id === env.APP_ADMIN_USER_ID ? "field" : "normal";
  if (isAppointedStaff(env.APP_STAFF_USER_IDS, who.id)) {
    await db().prepare("INSERT OR IGNORE INTO app_users (id,email,display_name,role,active,created_at) VALUES (?,?,?,?,1,?)")
      .bind(who.id, who.email, who.name, initialRole, new Date().toISOString()).run();
  }
  await db().prepare("UPDATE app_users SET role=? WHERE id=? AND role NOT IN ('normal','field')")
    .bind(initialRole, who.id).run();
  return db().prepare("SELECT * FROM app_users WHERE id = ?").bind(who.id).first<any>();
}
async function staff(request: Request): Promise<User> {
  const who = identity(request);
  const row = await staffRow(who);
  if (!row?.active) throw new ApiError(403, "このアカウントは利用できません");
  return { id: who.id, email: who.email, name: row.display_name, role: row.role };
}
function field(user: User): void { if (user.role !== "field") throw new ApiError(403, "現場職員だけが操作できます"); }
function owner(user: User, work: any): void { if (work.owner_id !== user.id) throw new ApiError(403, "作成者だけが編集できます"); }
function validDay(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value + "T00:00:00Z"))) throw new ApiError(400, "作業日が不正です");
  return value;
}
async function workRow(id: string): Promise<any> {
  const row = await db().prepare("SELECT * FROM works WHERE id = ?").bind(id).first<any>();
  if (!row) throw new ApiError(404, "作業がありません");
  return row;
}
async function master(day: string): Promise<any> {
  await db().prepare("INSERT OR IGNORE INTO master_revisions (id,version,data_json,effective_day,created_at) VALUES ('initial',1,?,'2000-01-01',?)")
    .bind(JSON.stringify(initialMaster), new Date().toISOString()).run();
  return await db().prepare("SELECT * FROM master_revisions WHERE effective_day <= ? ORDER BY effective_day DESC, version DESC LIMIT 1").bind(day).first<any>();
}
function parsed(row: any): WorkData { return JSON.parse(row.data_json) as WorkData; }
function reportMatchesWork(snapshotJson: string, workJson: string): boolean {
  try {
    const snapshot = JSON.parse(snapshotJson);
    delete snapshot.deliveryFormat;
    return JSON.stringify(snapshot) === JSON.stringify(JSON.parse(workJson));
  } catch { return false; }
}
async function updateWork(row: any, next: WorkData, user: User): Promise<any> {
  const revision = row.revision + 1, now = new Date().toISOString();
  const nextJson = JSON.stringify(next);
  const result = await db().batch([
    db().prepare("UPDATE works SET data_json=?, revision=?, updated_at=? WHERE id=? AND revision=? AND owner_id=? AND EXISTS (SELECT 1 FROM app_users WHERE id=? AND active=1 AND role IN ('normal','field'))")
      .bind(nextJson, revision, now, row.id, row.revision, user.id, user.id),
    db().prepare("INSERT INTO work_changes (id,work_id,actor_id,revision,before_json,after_json,changed_at) SELECT ?,?,?,?,?,?,? WHERE changes()=1 AND EXISTS (SELECT 1 FROM works WHERE id=? AND revision=? AND data_json=?)")
      .bind(crypto.randomUUID(), row.id, user.id, revision, row.data_json, nextJson, now, row.id, revision, nextJson),
  ]);
  if (!result[0].meta.changes) throw new ApiError(409, "他の更新と競合しました。再読込してください");
  return { ...row, revision, data_json: nextJson, updated_at: now };
}
async function workDetail(id: string): Promise<any> {
  const row = await workRow(id);
  const images = await db().prepare("SELECT id,file_name,mime,bytes,uploaded_at FROM images WHERE work_id=? ORDER BY uploaded_at").bind(id).all<any>();
  const reports = await db().prepare(`SELECT r.id,r.sequence,r.format,r.status,r.body,r.snapshot_json,r.created_at FROM report_versions r WHERE r.work_id=?
    AND NOT EXISTS (SELECT 1 FROM report_snapshot_candidates c WHERE c.id=r.id AND NOT EXISTS (SELECT 1 FROM report_snapshot_confirmations x WHERE x.candidate_id=c.id)) ORDER BY r.sequence DESC`).bind(id).all<any>();
  return { id: row.id, day: row.day, ownerId: row.owner_id, revision: row.revision, status: row.status, firstPressedAt: row.first_pressed_at,
    data: parsed(row), hasChangesSinceReport: !!reports.results.length && !reportMatchesWork(reports.results[0].snapshot_json, row.data_json),
    images: images.results.map(({ id, file_name, mime, bytes, uploaded_at }: any) => ({ id, file_name, mime, bytes, uploaded_at })),
    reports: reports.results.map(({ snapshot_json, ...report }: any) => report), createdAt: row.created_at };
}
async function api(request: Request, path: string[]): Promise<Response> {
  const method = request.method;
  if (path[0] === "me" && method === "GET") {
    const who = identity(request);
    const row = await staffRow(who);
    if (!row) {
      const now = new Date().toISOString();
      await db().prepare("INSERT OR IGNORE INTO staff_registration_requests (id,email,display_name,first_seen_at,last_seen_at) VALUES (?,?,?,?,?)")
        .bind(who.id, who.email, who.name, now, now).run();
      await db().prepare("UPDATE staff_registration_requests SET email=?,last_seen_at=? WHERE id=? AND approved_at IS NULL")
        .bind(who.email, now, who.id).run();
    }
    return reply({ ...who, name: row?.display_name || who.name, active: !!row?.active, role: row?.active ? row.role : null, appAdmin: !!row?.active && who.id === env.APP_ADMIN_USER_ID, manageChatwork: !!row?.active && row.role === "field" });
  }
  const user = await staff(request);
  if (path[0] === "users" && path.length === 1 && method === "GET") {
    const rows = await db().prepare("SELECT id,display_name,role,staff_revision,active FROM app_users ORDER BY display_name").all<any>();
    const visible = (await Promise.all(rows.results.filter(row => !!row.active).map(async row => ({ row, allowed: await hasStaffAccess(db(), env.APP_STAFF_USER_IDS, row.id) })))).filter(item => item.allowed).map(item => item.row);
    return reply(visible.map(row => user.role === "field" || row.id === user.id
      ? { id: row.id, displayName: row.display_name, role: row.role, appAdmin: row.id === env.APP_ADMIN_USER_ID, staffRevision: String(row.staff_revision), authorized: true }
      : { displayName: row.display_name, role: row.role }));
  }
  if (path[0] === "users" && path[1] === "registration-candidate" && path[2] && path.length === 3 && method === "GET") {
    field(user);
    if (user.id !== env.APP_ADMIN_USER_ID) throw new ApiError(403, "アプリ管理者だけが利用登録できます");
    const candidate = await db().prepare("SELECT id,email,display_name,last_seen_at,approved_at FROM staff_registration_requests WHERE id=?").bind(path[2]).first<any>();
    if (!candidate) throw new ApiError(404, "この登録用IDで仮ログインした人が見つかりません");
    if (candidate.approved_at) throw new ApiError(409, "この職員は登録済みです");
    return reply({ id: candidate.id, email: candidate.email, displayName: candidate.display_name, seenAt: candidate.last_seen_at });
  }
  if (path[0] === "users" && path[1] === "registration-candidate" && path[2] && path[3] === "display-name" && path.length === 4 && method === "PUT") {
    if (user.id !== env.APP_ADMIN_USER_ID) throw new ApiError(403, "アプリ管理者だけが利用登録できます");
    if (request.headers.get("origin") !== new URL(request.url).origin) throw new ApiError(403, "接続元が一致しません");
    const input = await body(request);
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) throw new ApiError(400, "氏名は80文字以内で入力してください");
    if (typeof input.expectedSeenAt !== "string" || !input.expectedSeenAt) throw new ApiError(428, "候補をもう一度照合してください");
    const candidate = await db().prepare("SELECT display_name,last_seen_at,approved_at FROM staff_registration_requests WHERE id=?").bind(path[2]).first<any>();
    if (!candidate) throw new ApiError(404, "この登録用IDで仮ログインした人が見つかりません");
    if (candidate.approved_at || candidate.last_seen_at !== input.expectedSeenAt) throw new ApiError(409, "登録状態が変わりました。もう一度照合してください");
    if (candidate.display_name === name) return reply({ id: path[2], displayName: name, seenAt: candidate.last_seen_at });
    const now = new Date().toISOString();
    const guard = "EXISTS (SELECT 1 FROM staff_registration_requests WHERE id=? AND display_name=? AND last_seen_at=? AND approved_at IS NULL) AND EXISTS (SELECT 1 FROM app_users WHERE id=? AND active=1 AND role='field')";
    const results = await db().batch([
      db().prepare("UPDATE staff_registration_requests SET display_name=? WHERE id=? AND last_seen_at=? AND approved_at IS NULL AND EXISTS (SELECT 1 FROM app_users WHERE id=? AND active=1 AND role='field')")
        .bind(name, path[2], input.expectedSeenAt, user.id),
      db().prepare(`UPDATE app_users SET display_name=?,active=0 WHERE id=? AND role NOT IN ('normal','field') AND ${guard}`)
        .bind(name, path[2], path[2], name, input.expectedSeenAt, user.id),
      db().prepare(`INSERT INTO staff_name_changes (id,staff_id,actor_id,before_name,after_name,changed_at) SELECT ?,?,?,?,?,? WHERE ${guard}`)
        .bind(crypto.randomUUID(), path[2], user.id, candidate.display_name, name, now, path[2], name, input.expectedSeenAt, user.id),
    ]);
    if (!results[0].meta.changes || !results[2].meta.changes) throw new ApiError(409, "登録状態が変わりました。もう一度照合してください");
    return reply({ id: path[2], displayName: name, seenAt: candidate.last_seen_at });
  }
  if (path[0] === "users" && path.length === 1 && method === "POST") {
    if (user.id !== env.APP_ADMIN_USER_ID) throw new ApiError(403, "アプリ管理者だけが利用登録できます");
    if (request.headers.get("origin") !== new URL(request.url).origin) throw new ApiError(403, "接続元が一致しません");
    const input = await body(request);
    const registrationId = typeof input.registrationId === "string" ? input.registrationId.trim() : "";
    if (!registrationId || registrationId.length > 512 || !input.expectedSeenAt || typeof input.expectedSeenAt !== "string") throw new ApiError(400, "登録用IDを確認してください");
    const candidate = await db().prepare("SELECT id,display_name,last_seen_at,approved_at FROM staff_registration_requests WHERE id=?").bind(registrationId).first<any>();
    if (!candidate) throw new ApiError(404, "この登録用IDで仮ログインした人が見つかりません");
    if (candidate.approved_at || candidate.last_seen_at !== input.expectedSeenAt) throw new ApiError(409, "登録状態が変わりました。もう一度照合してください");
    const now = new Date().toISOString(), approvalId = crypto.randomUUID();
    const results = await db().batch([
      db().prepare("UPDATE staff_registration_requests SET approval_id=?,approved_by=?,approved_at=? WHERE id=? AND last_seen_at=? AND approved_at IS NULL AND NOT EXISTS (SELECT 1 FROM app_users WHERE id=? AND role IN ('normal','field')) AND EXISTS (SELECT 1 FROM app_users WHERE id=? AND active=1 AND role='field')")
        .bind(approvalId, user.id, now, registrationId, input.expectedSeenAt, registrationId, user.id),
      db().prepare("INSERT INTO app_users (id,email,display_name,role,active,created_at) SELECT id,email,display_name,'normal',1,? FROM staff_registration_requests WHERE id=? AND approval_id=? AND approved_by=? AND approved_at=? ON CONFLICT(id) DO UPDATE SET email=excluded.email,display_name=excluded.display_name,role='normal',active=1 WHERE app_users.role NOT IN ('normal','field')")
        .bind(now, registrationId, approvalId, user.id, now),
    ]);
    if (!results[0].meta.changes || !results[1].meta.changes) throw new ApiError(409, "登録状態または権限が変わりました。もう一度照合してください");
    return reply({ id: registrationId, displayName: candidate.display_name, role: "normal" }, 201);
  }
  if (path[0] === "users" && path[1] && path[2] === "role" && path.length === 3 && method === "PUT") {
    if (user.id !== env.APP_ADMIN_USER_ID) throw new ApiError(403, "アプリ管理者だけが権限を変更できます");
    if (request.headers.get("origin") !== new URL(request.url).origin) throw new ApiError(403, "接続元が一致しません");
    const input = await body(request);
    if (input.role !== "normal" && input.role !== "field") throw new ApiError(400, "権限を確認してください");
    if (input.expectedStaffRevision === undefined) throw new ApiError(428, "職員台帳を再読み込みしてください");
    const target = await db().prepare("SELECT id,role,staff_revision,active FROM app_users WHERE id=?").bind(path[1]).first<any>();
    if (!target || !target.active || !await hasStaffAccess(db(), env.APP_STAFF_USER_IDS, target.id)) throw new ApiError(404, "職員が見つかりません");
    if (String(target.staff_revision) !== input.expectedStaffRevision) throw new ApiError(409, "職員情報が変更されました。再読み込みしてください");
    if (target.id === env.APP_ADMIN_USER_ID && input.role === "normal") throw new ApiError(409, "アプリ管理者は通常職員に変更できません");
    if (target.role === input.role) return reply({ id: target.id, role: target.role, staffRevision: String(target.staff_revision) });
    const now = new Date().toISOString(), changeId = crypto.randomUUID();
    const actorRow = await db().prepare("SELECT staff_revision FROM app_users WHERE id=? AND active=1 AND role='field'").bind(user.id).first<any>();
    if (!actorRow) throw new ApiError(403, "現場職員だけが操作できます");
    const guard = "EXISTS (SELECT 1 FROM app_users WHERE id=? AND active=1 AND role='field' AND staff_revision=?)";
    const targetGuard = "EXISTS (SELECT 1 FROM app_users WHERE id=? AND active=1 AND role=? AND staff_revision=?)";
    const statements = [
      db().prepare(`INSERT INTO staff_role_changes (id,staff_id,actor_id,before_role,after_role,changed_at) SELECT ?,?,?,?,?,? WHERE ${guard} AND ${targetGuard} AND NOT (?=? AND ?='normal')`)
        .bind(changeId, target.id, user.id, target.role, input.role, now, user.id, actorRow.staff_revision, target.id, target.role, target.staff_revision, target.id, env.APP_ADMIN_USER_ID ?? "", input.role),
      db().prepare(`UPDATE app_users SET role=?,staff_revision=staff_revision+1 WHERE id=? AND role=? AND staff_revision=? AND ${guard} AND EXISTS (SELECT 1 FROM staff_role_changes WHERE id=?)`)
        .bind(input.role, target.id, target.role, target.staff_revision, user.id, actorRow.staff_revision, changeId),
    ];
    if (input.role === "normal") {
      for (const table of ["chatwork_production_oauth_attempts", "chatwork_room_candidates", "chatwork_oauth_attempts"] as const) {
        statements.push(db().prepare(`UPDATE ${table} SET consumed_at=? WHERE actor_id=? AND consumed_at IS NULL AND EXISTS (SELECT 1 FROM staff_role_changes WHERE id=?)`).bind(now, target.id, changeId));
      }
    }
    const results = await db().batch(statements);
    if (!results[0].meta.changes || !results[1].meta.changes) throw new ApiError(409, "職員情報または権限が変更されました。再読み込みしてください");
    return reply({ id: target.id, role: input.role, staffRevision: String(target.staff_revision + 1) });
  }
  if (path[0] === "users" && path[1] && path[2] === "display-name" && path.length === 3 && method === "PUT") {
    if (user.role !== "field" && path[1] !== user.id) throw new ApiError(403, "自分の表示名だけ変更できます");
    if (request.headers.get("origin") !== new URL(request.url).origin) throw new ApiError(403, "接続元が一致しません");
    const input = await body(request);
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) throw new ApiError(400, "氏名は80文字以内で入力してください");
    if (input.expectedStaffRevision === undefined) throw new ApiError(428, "職員台帳を再読み込みしてください");
    const target = await db().prepare("SELECT id,display_name,staff_revision FROM app_users WHERE id=?").bind(path[1]).first<any>();
    if (!target) throw new ApiError(404, "職員が見つかりません");
    if (String(target.staff_revision) !== input.expectedStaffRevision) throw new ApiError(409, "職員情報が変更されました。再読み込みしてください");
    if (name === target.display_name) return reply({ id: target.id, displayName: name, staffRevision: String(target.staff_revision) });
    const now = new Date().toISOString(), changeId = crypto.randomUUID(), nextRevision = target.staff_revision + 1;
    const results = await db().batch([
      db().prepare("INSERT INTO staff_name_changes (id,staff_id,actor_id,before_name,after_name,changed_at) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM app_users WHERE id=? AND staff_revision=? AND display_name=?) AND EXISTS (SELECT 1 FROM app_users WHERE id=? AND active=1 AND (role='field' OR id=?))")
        .bind(changeId, target.id, user.id, target.display_name, name, now, target.id, target.staff_revision, target.display_name, user.id, target.id),
      db().prepare("UPDATE app_users SET display_name=?,staff_revision=? WHERE id=? AND staff_revision=? AND EXISTS (SELECT 1 FROM staff_name_changes WHERE id=?)")
        .bind(name, nextRevision, target.id, target.staff_revision, changeId),
    ]);
    if (!results[0].meta.changes || !results[1].meta.changes) throw new ApiError(409, "職員情報が変更されました。再読み込みしてください");
    return reply({ id: target.id, displayName: name, staffRevision: String(nextRevision) });
  }
  if (path[0] === "report-delivery-settings" && path.length === 1 && method === "GET") {
    const row = await db().prepare("SELECT status,account_id,display_name,account_confirmed,room_id,room_name,destination_verified,paused,version,refresh_lease_until FROM chatwork_production_settings WHERE id='production'").first<any>();
    if (!row) throw new ApiError(503, "Chatwork本番設定の初期化が必要です");
    return reply({ ...publicDeliverySettings(row, Date.now()), verificationReady: await verificationPathReady(db()) });
  }
  if (path[0] === "master" && path.length === 1 && method === "GET") {
    const day = validDay(new URL(request.url).searchParams.get("day") || todayJst());
    const row = await master(day);
    return reply({ id: row.id, version: row.version, effectiveDay: row.effective_day, data: JSON.parse(row.data_json) });
  }
  if (path[0] === "master" && path[1] === "changes") {
    if (method === "GET") {
      const rows = await db().prepare("SELECT id,applicant_id,approver_name,reason,status,created_at FROM master_changes ORDER BY created_at DESC LIMIT 100").all<any>();
      return reply(rows.results);
    }
    if (method === "POST" && path.length === 2) {
      field(user);
      const v = await body(request);
      const approver = typeof v.approverName === "string" ? v.approverName.trim() : "";
      const reason = typeof v.reason === "string" ? v.reason.trim() : "";
      if (!approver || approver.length > 100 || approver === user.name || !reason || reason.length > 3000 || v.approved !== true) throw new ApiError(400, "別職員の承認取得、氏名、変更内容が必要です");
      const today = todayJst();
      const own = await db().prepare("SELECT data_json FROM works WHERE owner_id=? AND day=?").bind(user.id, today).first<any>();
      if (!own || !parsed(own).startedAt) throw new ApiError(403, "当日の担当職員が作業開始後に申請してください");
      const current = await master(today), id = crypto.randomUUID(), now = new Date().toISOString();
      const inserted = await db().prepare("INSERT INTO master_changes (id,applicant_id,approver_name,reason,status,candidate_json,editor_ids_json,created_at) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM app_users WHERE id=? AND active=1 AND role='field')")
        .bind(id, user.id, approver, reason, "PendingNotification", current.data_json, "[]", now, user.id).run();
      if (!inserted.meta.changes) throw new ApiError(403, "現場職員だけが操作できます");
      return reply({ id, status: "PendingNotification", note: "Chatwork通知は未接続です。通知成功まで候補編集・適用は行いません" }, 201);
    }
  }
  if (path[0] === "works" && path.length === 1) {
    if (method === "GET") {
      const rows = await db().prepare("SELECT id,day,owner_id,revision,status,updated_at FROM works ORDER BY day DESC, updated_at DESC LIMIT 200").all<any>();
      return reply(rows.results);
    }
    if (method === "POST") {
      const v = await body(request), day = validDay(v.day || todayJst());
      const current = await db().prepare("SELECT id FROM works WHERE owner_id=? AND day=?").bind(user.id, day).first<any>();
      if (current) return reply(await workDetail(current.id));
      const now = new Date().toISOString(), id = crypto.randomUUID();
      await master(day);
      const data = makeWork(leadNameForNewWork(user.id, user.name, env.APP_ADMIN_USER_ID, env.APP_ADMIN_LEAD_NAME));
      try {
        const inserted = await db().prepare("INSERT INTO works (id,day,owner_id,revision,status,data_json,created_at,updated_at) SELECT ?,?,?,1,'Draft',?,?,? WHERE EXISTS (SELECT 1 FROM app_users WHERE id=? AND active=1 AND role IN ('normal','field'))")
          .bind(id, day, user.id, JSON.stringify(data), now, now, user.id).run();
        if (!inserted.meta.changes) throw new ApiError(403, "現場職員だけが操作できます");
      } catch (error) {
        if (error instanceof ApiError) throw error;
        const again = await db().prepare("SELECT id FROM works WHERE owner_id=? AND day=?").bind(user.id, day).first<any>();
        if (again) return reply(await workDetail(again.id));
        throw new ApiError(500, "作業を作成できません");
      }
      return reply(await workDetail(id), 201);
    }
  }
  if (path[0] === "works" && path[1]) {
    const id = path[1], row = await workRow(id);
    if (method !== "GET") owner(user, row);
    if (path[2] === "revisions" && path[3] && path.length === 4 && method === "GET") {
      owner(user, row);
      const revision = Number(path[3]);
      if (!Number.isInteger(revision) || revision < 1 || revision > row.revision) throw new ApiError(400, "更新番号が不正です");
      if (revision === row.revision) return reply({ revision, data: parsed(row) });
      const exact = await db().prepare("SELECT after_json FROM work_changes WHERE work_id=? AND revision=?").bind(id, revision).first<any>();
      const later = exact ? null : await db().prepare("SELECT before_json FROM work_changes WHERE work_id=? AND revision>? ORDER BY revision ASC LIMIT 1").bind(id, revision).first<any>();
      const data = exact?.after_json || later?.before_json;
      if (!data) throw new ApiError(404, "変更前の記録が見つかりません");
      return reply({ revision, data: JSON.parse(data) });
    }
    if(path[2]==='report-candidate' && path[3]==='requests' && path.length===5 && method==='GET'){
      owner(user,row);
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(path[4]))throw new ApiError(400,'候補の要求が不正です');
      const result=await db().prepare(`SELECT r.status,r.candidate_id FROM report_snapshot_requests r
        JOIN app_users u ON u.id=r.actor_id AND u.active=1 AND u.role IN ('normal','field')
        WHERE r.id=? AND r.work_id=? AND r.actor_id=?`).bind(path[4],id,user.id).first<{status:string;candidate_id:string|null}>();
      if(!result)throw new ApiError(404,'要求は確認できません。遅延中の可能性があるため再照会してください');
      return reply({status:result.status,candidateId:result.candidate_id});
    }
    if(path[2]==='report-candidate' && (path.length===3 || path.length===4 && ['fence','fence-scope','close'].includes(path[3]))){
      owner(user,row);
      if(method==='GET' && path.length===3){
        const candidate=await db().prepare(`SELECT c.id,c.body,c.snapshot_json,c.work_revision,c.staff_revision,c.status,u.staff_revision AS current_staff_revision FROM report_snapshot_candidates c
          JOIN works w ON w.id=c.work_id AND w.owner_id=c.actor_id JOIN app_users u ON u.id=c.actor_id
          WHERE c.work_id=? AND c.actor_id=? AND c.status='Active' AND u.active=1 AND u.role IN ('normal','field')`)
          .bind(id,user.id).first<{id:string;body:string;snapshot_json:string;work_revision:number;staff_revision:number;current_staff_revision:number;status:string}>();
        const scope=await db().prepare('SELECT epoch FROM report_snapshot_scopes WHERE work_id=? AND actor_id=?').bind(id,user.id).first<{epoch:number}>();
        const trial=candidate?await db().prepare(`SELECT j.id AS jobId,p.id AS permitId,j.room_name AS roomName,j.status,p.expires_at AS expiresAt,p.status AS permitStatus,
          CASE WHEN j.report_manifest_sealed=1 AND EXISTS (SELECT 1 FROM chatwork_report_artifacts a WHERE a.job_id=j.id)
          AND NOT EXISTS (SELECT 1 FROM chatwork_report_artifacts a LEFT JOIN chatwork_report_prepared_files f ON f.artifact_id=a.id WHERE a.job_id=j.id AND f.artifact_id IS NULL) THEN 1 ELSE 0 END AS prepared,
          CASE WHEN p.status='Active' AND p.expires_at>CAST(strftime('%s','now') AS INTEGER)*1000 AND j.status='TestAwaitingRegistration'
          AND p.actor_id=j.actor_id AND p.staff_revision=j.actor_staff_revision AND p.staff_revision=u.staff_revision
          AND p.report_id=j.report_id AND p.account_id=j.account_id AND p.room_id=j.room_id AND p.settings_version=j.settings_version
          AND s.account_id=p.account_id AND s.room_id=p.room_id AND s.version=p.settings_version AND s.paused=0 AND s.status='DestinationVerified'
          AND s.account_confirmed=1 AND s.destination_verified=1 AND s.token_cipher IS NOT NULL
          AND rt.approved=1 AND rt.report_approved=0 AND rt.worker_subject=p.worker_subject AND rt.approval_generation=p.approval_generation
          AND rt.worker_revision=p.worker_revision AND rt.site_revision=p.site_revision AND rt.last_healthy_heartbeat_at>=CAST(strftime('%s','now') AS INTEGER)*1000-180000
          AND w.revision=c.work_revision AND u.staff_revision=c.staff_revision THEN 1 ELSE 0 END AS permitValid
          FROM report_snapshot_candidates c JOIN chatwork_delivery_jobs j ON j.report_id=c.id AND j.actor_id=c.actor_id AND j.delivery_mode='test'
          JOIN chatwork_test_permits p ON p.job_id=j.id AND p.actor_id=c.actor_id JOIN works w ON w.id=c.work_id AND w.owner_id=c.actor_id
          JOIN app_users u ON u.id=c.actor_id AND u.active=1 AND u.role IN ('normal','field')
          JOIN chatwork_production_settings s ON s.id='production' JOIN chatwork_delivery_runtime rt ON rt.id='production'
          WHERE c.id=? AND c.actor_id=?`).bind(candidate.id,user.id).first<{jobId:string;permitId:string;roomName:string;status:string;expiresAt:number;permitStatus:string;permitValid:number;prepared:number}>():null;
        const confirmed=candidate?!!await db().prepare('SELECT 1 FROM report_snapshot_confirmations WHERE candidate_id=? AND actor_id=?').bind(candidate.id,user.id).first():false;
        const snapshot=candidate?JSON.parse(candidate.snapshot_json):null;
        return reply({epoch:scope?.epoch??0,candidate:candidate?{id:candidate.id,body:candidate.body,imageIds:snapshot.imageIds,format:snapshot.deliveryFormat??'legacy',workRevision:candidate.work_revision,stale:candidate.work_revision!==row.revision || candidate.staff_revision!==candidate.current_staff_revision,confirmed,...(trial?{trial:{...trial,permitValid:!!trial.permitValid,prepared:!!trial.prepared}}:{})}:null});
      }
      if(method==='POST'){
        const v=await body(request),uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if(!Number.isSafeInteger(v.revision))throw new ApiError(400,'候補の要求が不正です');
        if(path[3]==='close'){
          if(Object.keys(v).some(k=>!['revision','candidateId'].includes(k))||typeof v.candidateId!=='string'||!uuid.test(v.candidateId))throw new ApiError(400,'候補の要求が不正です');
          if(!await closeSnapshot(db(),{workId:id,actorId:user.id,candidateId:v.candidateId}))throw new ApiError(409,'候補または配送の状態を確認してください');
          return reply({closed:true});
        }
        if(path[3]==='fence-scope'){
          if(Object.keys(v).some(k=>!['revision','expectedEpoch'].includes(k))||!Number.isSafeInteger(v.expectedEpoch)||v.expectedEpoch<0)throw new ApiError(400,'候補の要求が不正です');
          if(!await fenceSnapshotScope(db(),{workId:id,actorId:user.id,workRevision:v.revision,expectedEpoch:v.expectedEpoch}))throw new ApiError(409,'既存の候補または作業の状態を確認してください');
          return reply({fenced:true,epoch:v.expectedEpoch+1});
        }
        if(typeof v.requestId!=='string'||!uuid.test(v.requestId))throw new ApiError(400,'候補の要求が不正です');
        if(path[3]==='fence'){
          if(Object.keys(v).some(k=>!['requestId','revision'].includes(k)))throw new ApiError(400,'候補の要求が不正です');
          if(!await fenceSnapshotRequest(db(),{requestId:v.requestId,workId:id,actorId:user.id,workRevision:v.revision}))throw new ApiError(409,'候補または作業の状態を確認してください');
          return reply({fenced:true});
        }
        if(Object.keys(v).some(k=>!['requestId','revision','epoch','body','format'].includes(k))||!['markdown','pdf'].includes(v.format)||!Number.isSafeInteger(v.epoch)||v.epoch<0||typeof v.body!=='string'||!v.body.trim()||v.body.length>50000)throw new ApiError(400,'報告内容または形式が不正です');
        if(v.revision!==row.revision)throw new ApiError(409,'作業が更新されています');
        const data=parsed(row),missing=missingForReport(data);if(missing.length)throw new ApiError(422,'不足項目: '+missing.join('、'));
        const staff=await db().prepare("SELECT staff_revision FROM app_users WHERE id=? AND active=1 AND role IN ('normal','field')").bind(user.id).first<{staff_revision:number}>();
        if(!staff)throw new ApiError(403,'利用できないアカウントです');
        const snapshotJson=JSON.stringify({...data,deliveryFormat:v.format}),material=JSON.stringify({workId:id,actorId:user.id,workRevision:row.revision,staffRevision:staff.staff_revision,body:v.body,snapshotJson});
        const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(material));
        const fingerprint=Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
        const result=await reserveSnapshot(db(),{requestId:v.requestId,candidateId:crypto.randomUUID(),workId:id,actorId:user.id,workRevision:row.revision,staffRevision:staff.staff_revision,epoch:v.epoch,fingerprint,body:v.body,snapshotJson});
        if(!result)throw new ApiError(409,'候補または作業の状態を確認してください');
        return reply(result);
      }
    }
    if(path[2]==='reports'&&path[3]&&path[4]==='delivery'&&path[5]==='file'&&path[6]&&path.length===7&&method==='GET'){
      owner(user,row);
      const sql=`SELECT a.id,a.kind,a.status,f.object_key,f.sha256,f.bytes,f.mime,f.file_name FROM chatwork_delivery_jobs j JOIN chatwork_report_artifacts a ON a.job_id=j.id JOIN chatwork_report_prepared_files f ON f.artifact_id=a.id JOIN app_users u ON u.id=j.actor_id JOIN works w ON w.id=j.work_id AND w.owner_id=u.id
        WHERE j.work_id=? AND j.report_id=? AND j.actor_id=? AND j.delivery_mode='test' AND j.status='Unknown' AND u.active=1 AND u.role IN ('normal','field')
        AND a.id=? AND a.kind IN ('markdown','pdf','image') AND (a.status='Pending' OR (a.status='Failed' AND a.error_code='MANUALLY_CONFIRMED_NOT_SENT'))
        AND EXISTS(SELECT 1 FROM chatwork_delivery_events e WHERE e.job_id=j.id AND e.action='ReportIsolationConfirmed' AND json_extract(e.detail_json,'$.workerStopped')=1 AND json_extract(e.detail_json,'$.tokenInvalidated')=1 AND json_extract(e.detail_json,'$.requestsEnded')=1)`;
      const args=[id,path[3],user.id,path[6]];
      const file=await db().prepare(sql).bind(...args).first<{id:string;kind:string;status:string;object_key:string;sha256:string;bytes:number;mime:string;file_name:string|null}>();
      if(!file)throw new ApiError(404,'ダウンロードできる成果物がありません');
      const data=await readWorkerFile(bucket(),file);
      if(!await db().prepare(sql).bind(...args).first())throw new ApiError(409,'成果物の状態が変更されました');
      const name=encodeURIComponent(file.file_name||'report-file');
      return new Response(new Uint8Array(data).buffer,{headers:{'content-type':file.mime,'content-disposition':`attachment; filename*=UTF-8''${name}`,'cache-control':'no-store','x-content-type-options':'nosniff'}});
    }
    if (path[2] === "reports" && path[3] && path[4] === "delivery" && path.length === 5 && method === "GET") {
      owner(user, row);
      const report = await db().prepare(`SELECT r.id FROM report_versions r JOIN works w ON w.id=r.work_id
        JOIN app_users u ON u.id=w.owner_id WHERE r.id=? AND w.id=? AND u.id=? AND u.active=1`)
        .bind(path[3],id,user.id).first();
      if (!report) throw new ApiError(404, "報告版がありません");
      const job = await db().prepare(`SELECT j.id,j.status,j.error_code,j.delivery_mode,j.room_name FROM chatwork_delivery_jobs j JOIN works w ON w.id=j.work_id
        JOIN app_users u ON u.id=w.owner_id WHERE j.report_id=? AND j.work_id=? AND j.kind='ReportDelivery'
          AND u.id=? AND u.active=1`).bind(path[3],id,user.id).first<{id:string;status:string;error_code:string|null;delivery_mode:string;room_name:string}>();
      if (!job) return reply(null);
      const artifacts = await db().prepare(`SELECT a.id,a.kind,a.status,a.error_code FROM chatwork_report_artifacts a
        JOIN chatwork_delivery_jobs j ON j.id=a.job_id JOIN works w ON w.id=j.work_id JOIN app_users u ON u.id=w.owner_id
        WHERE j.id=? AND w.id=? AND u.id=? AND u.active=1 ORDER BY a.ordinal`).bind(job.id,id,user.id).all<{id:string;kind:string;status:string;error_code:string|null}>();
      const canReconcile=job.delivery_mode==='test' && job.status==='Unknown' && (user.role==='field'||user.role==='normal') && !!await db().prepare(`SELECT 1 FROM chatwork_delivery_events WHERE job_id=? AND action='ReportIsolationConfirmed' AND json_extract(detail_json,'$.workerStopped')=1 AND json_extract(detail_json,'$.tokenInvalidated')=1 AND json_extract(detail_json,'$.requestsEnded')=1`).bind(job.id).first();
      const permit=job.delivery_mode==='test' && (user.role==='field'||user.role==='normal') && ['TestAwaitingRegistration','DispatchPending'].includes(job.status)
        ? await db().prepare(`SELECT p.id FROM chatwork_test_permits p JOIN app_users u ON u.id=p.actor_id
          WHERE p.job_id=? AND p.actor_id=? AND p.status='Active' AND p.expires_at>CAST(strftime('%s','now') AS INTEGER)*1000
          AND u.active=1 AND u.role IN ('normal','field') AND u.staff_revision=p.staff_revision
          AND (SELECT count(*) FROM chatwork_report_artifacts a JOIN chatwork_report_prepared_files f ON f.artifact_id=a.id WHERE a.job_id=p.job_id)<(SELECT count(*) FROM chatwork_report_artifacts a WHERE a.job_id=p.job_id)
          OR p.job_id=? AND p.actor_id=? AND p.status='Active' AND p.expires_at>CAST(strftime('%s','now') AS INTEGER)*1000 AND u.active=1 AND u.role IN ('normal','field') AND u.staff_revision=p.staff_revision AND NOT EXISTS(SELECT 1 FROM chatwork_report_artifacts a WHERE a.job_id=p.job_id)`)
          .bind(job.id,user.id,job.id,user.id).first<{id:string}>() : null;
      return reply({status:job.status,reason:job.error_code,artifacts:artifacts.results.map(a=>({kind:a.kind,status:a.status,...(canReconcile&&['Unknown','Failed','Pending'].includes(a.status)?{id:a.id}:{}),...(canReconcile&&a.kind!=='body'&&(a.status==='Pending'||a.status==='Failed'&&a.error_code==='MANUALLY_CONFIRMED_NOT_SENT')?{downloadable:true}:{})})),...(canReconcile?{canReconcile:true,jobId:job.id,roomName:job.room_name}:{}),...(permit?{trial:{jobId:job.id,permitId:permit.id,roomName:job.room_name}}:{})});
    }
    if (path[2] === "reports" && path[3] && path[4] === "markdown" && method === "GET") {
      const report = await db().prepare(`SELECT r.sequence,r.body FROM report_versions r WHERE r.id=? AND r.work_id=?
        AND NOT EXISTS (SELECT 1 FROM report_snapshot_candidates c WHERE c.id=r.id AND NOT EXISTS (SELECT 1 FROM report_snapshot_confirmations x WHERE x.candidate_id=c.id))`).bind(path[3], id).first<any>();
      if (!report) throw new ApiError(404, "報告版がありません");
      return new Response(report.body, { headers: { "content-type": "text/markdown; charset=utf-8", "content-disposition": `attachment; filename="kiiya-${row.day}-v${report.sequence}.md"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
    }
    if (path.length === 2 && method === "GET") return reply(await workDetail(id));
    if (path[2] === "reset" && path.length === 3 && method === "POST") {
      const v = await body(request);
      if (row.day !== todayJst()) throw new ApiError(409, "本日以外の作業はリセットできません");
      if (v.revision !== row.revision) throw new ApiError(409, "更新番号が古くなっています。再読込してください");
      const data = makeWork(parsed(row).leadName);
      if (!await resetWork(db(), {workId:id, actorId:user.id, day:todayJst(), revision:row.revision, nextJson:JSON.stringify(data), changeId:crypto.randomUUID(), now:new Date().toISOString()}))
        throw new ApiError(409, "報告候補や送信状態、または作業の更新を確認してください");
      return reply(await workDetail(id));
    }
    if (path.length === 2 && method === "PUT") {
      owner(user, row);
      const v = await body(request);
      if (v.revision !== row.revision) throw new ApiError(409, "更新番号が古くなっています");
      let next: WorkData;
      try { next = cleanWork(v.data, parsed(row)); } catch (error) { throw new ApiError(400, error instanceof Error ? error.message : "作業内容が不正です"); }
      for (const imageId of next.imageIds) {
        const image = await db().prepare("SELECT id FROM images WHERE id=? AND work_id=?").bind(imageId, id).first();
        if (!image) throw new ApiError(400, "別の作業の画像は指定できません");
      }
      await updateWork(row, next, user);
      return reply(await workDetail(id));
    }
    if (path[2] === "start" && method === "POST") {
      owner(user, row);
      const v = await body(request);
      if (v.revision !== row.revision) throw new ApiError(409, "更新番号が古くなっています");
      if (parsed(row).startedAt) return reply(await workDetail(id));
      const next = parsed(row); next.startedAt = new Date().toISOString();
      await updateWork(row, next, user);
      return reply(await workDetail(id));
    }
    if (path[2] === "preview" && method === "GET") {
      const data = parsed(row), missing = missingForReport(data);
      return reply({ ready: missing.length === 0, missing, body: reportBody(row.day, data) });
    }
    if (path[2] === "press" && method === "POST") {
      owner(user, row);
      const now = new Date().toISOString();
      const pressed = await db().prepare("UPDATE works SET first_pressed_at=COALESCE(first_pressed_at,?) WHERE id=? AND owner_id=? AND EXISTS (SELECT 1 FROM app_users WHERE id=? AND active=1 AND role IN ('normal','field'))").bind(now, id, user.id, user.id).run();
      if (!pressed.meta.changes) throw new ApiError(403, "現場職員だけが操作できます");
      return reply({ firstPressedAt: (await workRow(id)).first_pressed_at });
    }
    if (path[2] === "reports" && method === "POST") {
      owner(user, row);
      const v = await body(request);
      if (v.revision !== row.revision) throw new ApiError(409, "更新番号が古くなっています");
      if (v.format !== "markdown") throw new ApiError(400, "PDF確定は未実装です");
      const data = parsed(row), missing = missingForReport(data);
      if (missing.length) throw new ApiError(422, "不足項目: " + missing.join("、"));
      if (v.body !== undefined && (typeof v.body !== "string" || !v.body.trim() || v.body.length > 50000)) throw new ApiError(400, "報告内容は1文字以上、50000文字以内で入力してください");
      const text = v.body === undefined ? reportBody(row.day, data) : v.body;
      const last = await db().prepare("SELECT MAX(sequence) AS n FROM report_versions WHERE work_id=?").bind(id).first<any>();
      const sequence = Number(last?.n || 0) + 1, reportId = crypto.randomUUID(), now = new Date().toISOString();
      const result = await db().batch([
        db().prepare(`UPDATE works SET revision=?,status='Prepared',first_pressed_at=COALESCE(first_pressed_at,?),latest_report_id=?,updated_at=? WHERE id=? AND revision=? AND owner_id=? AND EXISTS (SELECT 1 FROM app_users WHERE id=? AND active=1 AND role IN ('normal','field')) AND ${reportRetryGuard}`)
          .bind(row.revision + 1, now, reportId, now, id, row.revision, user.id, user.id),
        db().prepare("INSERT INTO report_versions (id,work_id,sequence,format,status,body,snapshot_json,created_at) SELECT ?,?,?,'markdown','Prepared',?,?,? WHERE EXISTS (SELECT 1 FROM works WHERE id=? AND latest_report_id=? AND revision=?)")
          .bind(reportId, id, sequence, text, JSON.stringify(data), now, id, reportId, row.revision + 1),
      ]);
      if (!result[0].meta.changes) throw new ApiError(409, "更新または以前の報告の送信状態を確認してください");
      return reply({ reportId, sequence, status: "Prepared", delivery: "外部送信は未接続です" }, 201);
    }
    if (path[2] === "images" && path.length === 3 && method === "POST") {
      owner(user, row);
      const form = await request.formData(), file = form.get("file");
      if (!(file instanceof File) || !["image/jpeg","image/png","image/webp"].includes(file.type) || file.size < 1 || file.size > 8_000_000) throw new ApiError(400, "JPEG・PNG・WebPの8MB以下の画像を選んでください");
      const imageId = crypto.randomUUID(), key = "works/" + id + "/" + imageId;
      await bucket().put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type }, onlyIf: { etagDoesNotMatch: "*" } });
      try {
        const saved = await db().prepare("INSERT INTO images (id,work_id,object_key,file_name,mime,bytes,uploaded_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM app_users WHERE id=? AND active=1 AND role IN ('normal','field'))")
          .bind(imageId, id, key, file.name.slice(0, 200), file.type, file.size, new Date().toISOString(), user.id).run();
        if (!saved.meta.changes) throw new ApiError(403, "現場職員だけが操作できます");
      } catch (error) { await bucket().delete(key); throw error; }
      return reply({ id: imageId, fileName: file.name, bytes: file.size }, 201);
    }
    if (path[2] === "images" && path[3] && method === "GET") {
      const image = await db().prepare("SELECT * FROM images WHERE id=? AND work_id=?").bind(path[3], id).first<any>();
      if (!image) throw new ApiError(404, "画像がありません");
      const object = await bucket().get(image.object_key);
      if (!object) throw new ApiError(404, "画像本体がありません");
      return new Response(object.body, { headers: { "content-type": image.mime, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
    }
  }
  throw new ApiError(404, "操作がありません");
}
async function handle(request: Request, context: Context): Promise<Response> {
  try { return await api(request, (await context.params).path); } catch (error) { return fail(error); }
}
export const GET = handle;
export const POST = handle;
export const PUT = handle;
