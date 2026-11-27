import { env } from "cloudflare:workers";
import { authorizeUrl, chatworkMe, chatworkRoom, ChatworkHttpError, exchangeCode, randomSecret, refreshToken, seal, sha256, unseal, hasChatworkFileScope, type TokenBundle } from "@/lib/chatwork";
import { confirmAccount, confirmRoom, connectAccount } from "@/lib/chatwork-production-store";
import { reconcileVerification, invalidateObsoleteVerifications, invalidateObsoleteReportJobs, claimDelivery, confirmVerification, createVerification, finishArtifact, type DeliveryJob } from "@/lib/chatwork-delivery-store";
import { verifyWorkerIdentity } from "@/lib/worker-identity";
import { expireTestPermit, revokeTestPermit, claimTestArtifact, finishTestArtifact, completeTestJob, claimTestJob } from "@/lib/test-delivery-permit";
import { issueTestPermit } from "@/lib/test-permit-issuance";
import { registerTestDelivery } from "@/lib/test-delivery-registration";
import { confirmReportIsolation, reconcileReportArtifact, reconcileUnpostedReport, markUnknownReportArtifacts } from "@/lib/report-delivery-reconcile";
import { prepareStoredReport } from "@/lib/report-prepared-service";
import { createReportManifest } from "@/lib/report-manifest";
import {fetchReportFont,ReportFontError,withPreparationStage} from "@/lib/report-preparation-diagnostics";
import { workerReportFiles, readWorkerFile } from "@/lib/report-worker-files";
import { hasStaffAccess } from "@/lib/staff-access";
import { verificationPathReady } from "@/lib/verification-readiness";

export const runtime = "edge";
type Context = { params: Promise<{ path: string[] }> };
type ProductionEnv = { DB?: D1Database; BUCKET?: R2Bucket; CHATWORK_PRODUCTION_CLIENT_ID?: string; CHATWORK_PRODUCTION_CLIENT_SECRET?: string; CHATWORK_PRODUCTION_TOKEN_KEY?: string; APP_STAFF_USER_IDS?: string; DELIVERY_WORKER_URL?: string; DELIVERY_WORKER_SHARED_SECRET?: string; DELIVERY_CONTROL_SECRET?: string; DELIVERY_CONTROL_OPERATOR_ID?: string; DELIVERY_WORKER_IDENTITY_AUDIENCE?: string; DELIVERY_TEST_ACCOUNT_ID?: string; DELIVERY_TEST_ROOM_ID?: string; DELIVERY_TRIAL_WORKER_SUBJECT?:string; SITE_ASSET_ACCESS_TOKEN?:string };
const settings = env as unknown as ProductionEnv;
const ORIGIN = "https://kiiya-cleaning-checker.hherocl278.chatgpt.site";
const CALLBACK = `${ORIGIN}/api/chatwork/production/oauth/callback`;
const COOKIE = "kiiya_chatwork_production_state";
class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
function db(): D1Database { if (!settings.DB) throw new ApiError(503, "保存先を利用できません"); return settings.DB; }
function reply(value: unknown, status = 200): Response { return Response.json(value, { status, headers: { "cache-control": "no-store" } }); }
function failure(error: unknown): Response {
  if (error instanceof ApiError) return reply({ error: error.message }, error.status);
  if (error instanceof ChatworkHttpError) {
    const message = error.status === 401 ? "Chatworkの接続が失効しました" : error.status === 403 ? "このルームを確認する権限がありません" : error.status === 429 ? "Chatworkの利用制限に達しました" : "Chatworkを確認できません";
    return reply({ error: message, code: `CHATWORK_${error.status}` }, error.status === 429 ? 429 : 503);
  }
  console.error("production_chatwork_failure", error instanceof Error ? error.name : "unknown");
  return reply({ error: "Chatwork設定を処理できません" }, 500);
}
async function actor(request: Request): Promise<{ id: string; staffRevision: number }> {
  const id = request.headers.get("oai-authenticated-user-id");
  if (!id) throw new ApiError(401, "サインインしてください");
  if (!await hasStaffAccess(db(), settings.APP_STAFF_USER_IDS, id)) throw new ApiError(403, "このアカウントは利用できません");
  const user = await db().prepare("SELECT active,role,staff_revision FROM app_users WHERE id=?").bind(id).first<any>();
  if (!user?.active || !["normal", "field"].includes(user.role)) throw new ApiError(403, "このアカウントは利用できません");
  return { id, staffRevision: user.staff_revision };
}
async function requireRoomManager(id: string): Promise<void> {
  const user = await db().prepare("SELECT role FROM app_users WHERE id=? AND active=1").bind(id).first<{ role: string }>();
  if (user?.role !== "field") throw new ApiError(403, "送信先の設定は現場職員だけが行えます");
}
function guard(request: Request, mutation = false): void {
  if (new URL(request.url).origin !== ORIGIN || (mutation && request.headers.get("origin") !== ORIGIN)) throw new ApiError(403, "接続元が一致しません");
}
function credentials(): void {
  if (!settings.CHATWORK_PRODUCTION_CLIENT_ID || !settings.CHATWORK_PRODUCTION_CLIENT_SECRET || !settings.CHATWORK_PRODUCTION_TOKEN_KEY) throw new ApiError(503, "Chatworkの接続準備が完了していません");
}
async function value(request: Request): Promise<Record<string, unknown>> {
  const data = await request.json();
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new ApiError(400, "入力が不正です");
  return data as Record<string, unknown>;
}
async function current(): Promise<any> {
  const row = await db().prepare("SELECT * FROM chatwork_production_settings WHERE id='production'").first<any>();
  if (!row) throw new ApiError(503, "Chatwork本番設定の初期化が必要です");
  if (row.status === "RefreshInProgress" && (!row.refresh_lease_until || row.refresh_lease_until <= Date.now())) {
    await db().prepare("UPDATE chatwork_production_settings SET status='ReconnectRequired',destination_verified=0,refresh_lease_until=NULL WHERE id='production' AND token_revision=? AND status='RefreshInProgress' AND (refresh_lease_until IS NULL OR refresh_lease_until<=?)")
      .bind(row.token_revision, Date.now()).run();
    const updated = await db().prepare("SELECT * FROM chatwork_production_settings WHERE id='production'").first<any>();
    if (!updated) throw new ApiError(503, "Chatwork本番設定の初期化が必要です");
    return updated;
  }
  return row;
}
function detail(row: any) {
  return { version: String(row.version), controlRevision: String(row.control_revision), status: row.status,
    accountId: row.account_id, displayName: row.display_name, accountConfirmed: !!row.account_confirmed,
    roomId: row.room_id, roomName: row.room_name, destinationVerified: !!row.destination_verified,
    paused: !!row.paused, accountConfirmedAt: row.account_confirmed_at, roomConfirmedAt: row.room_confirmed_at,
    deliveryEnabled: false, deliveryReason: "DeliveryPathUnavailable", oauthConfigured: !!(settings.CHATWORK_PRODUCTION_CLIENT_ID && settings.CHATWORK_PRODUCTION_CLIENT_SECRET && settings.CHATWORK_PRODUCTION_TOKEN_KEY) };
}
function verificationView(job: DeliveryJob, actorId: string, staffRevision: number, row: any) {
  return { verificationId: job.id, requestId: job.request_id, marker: job.marker, status: job.status, messageId: job.message_id,
    errorCode: job.error_code, roomName: job.room_name, roomId: job.room_id, accountId: job.account_id, createdAt: job.created_at,
    canConfirm: job.actor_id === actorId && job.actor_staff_revision === staffRevision && job.settings_version === row.version
      && job.account_id === row.account_id && job.room_id === row.room_id };
}
async function dispatch(job: DeliveryJob): Promise<void> {
  if (!settings.DELIVERY_WORKER_URL || !settings.DELIVERY_WORKER_SHARED_SECRET) return;
  try {
    const url = new URL("/enqueue", settings.DELIVERY_WORKER_URL);
    if (url.protocol !== "https:") return;
    const response = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${settings.DELIVERY_WORKER_SHARED_SECRET}`, "content-type": "application/json" },
      body: JSON.stringify({ jobId: job.id }), signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return;
    const data = await response.json() as { taskName?: string };
    if (!data.taskName) return;
    await db().prepare("UPDATE chatwork_delivery_jobs SET status='Dispatched',task_name=?,dispatch_attempted_at=?,updated_at=? WHERE id=? AND status='DispatchPending'")
      .bind(data.taskName, new Date().toISOString(), new Date().toISOString(), job.id).run();
  } catch { /* The saved DispatchPending intent is retried by monitoring. */ }
}
function expected(input: Record<string, unknown>, row: any): void {
  if (input.expectedVersion === undefined) throw new ApiError(428, "設定を再読み込みしてください");
  if (input.expectedVersion !== String(row.version)) throw new ApiError(409, "設定が変更されました。再読み込みしてください");
}
function cookieState(request: Request): string | null {
  const found = request.headers.get("cookie")?.split(";").map(x => x.trim()).find(x => x.startsWith(COOKIE + "="));
  return found ? found.slice(COOKIE.length + 1) : null;
}
async function accessToken(requireFiles=false): Promise<string> {
  credentials();
  const row = await current();
  if (!row.token_cipher) throw new ApiError(409, "Chatworkを接続してください");
  if (row.status === "ReconnectRequired") throw new ApiError(409, "Chatworkの再接続が必要です");
  let tokens = JSON.parse(await unseal(row.token_cipher, settings.CHATWORK_PRODUCTION_TOKEN_KEY!)) as TokenBundle;
  if(requireFiles&&!hasChatworkFileScope(tokens.scope))throw new ApiError(409,'ファイル送信権限を確認できません。Chatworkを再接続してください');
  if (row.status === "RefreshInProgress") throw new ApiError(409, row.refresh_lease_until > Date.now() ? "接続情報を更新中です。少し待って再操作してください" : "Chatworkの再接続が必要です");
  if (tokens.expiresAt > Date.now() + 60_000) return tokens.accessToken;
  const lease = Date.now() + 20_000;
  const locked = await db().prepare("UPDATE chatwork_production_settings SET refresh_lease_until=?,token_revision=token_revision+1,status='RefreshInProgress' WHERE id='production' AND token_revision=? AND status=? AND (refresh_lease_until IS NULL OR refresh_lease_until<?)")
    .bind(lease, row.token_revision, row.status, Date.now()).run();
  if (!locked.meta.changes) throw new ApiError(409, "接続情報を更新中です。少し待って再操作してください");
  let refreshSucceeded = false;
  try {
    tokens = await refreshToken(settings.CHATWORK_PRODUCTION_CLIENT_ID!, settings.CHATWORK_PRODUCTION_CLIENT_SECRET!, tokens.refreshToken,tokens.scope);
    refreshSucceeded = true;
    if(requireFiles&&!hasChatworkFileScope(tokens.scope))throw new ApiError(409,'ファイル送信権限がありません。Chatworkを再接続してください');
    const encrypted = await seal(JSON.stringify(tokens), settings.CHATWORK_PRODUCTION_TOKEN_KEY!);
    const saved = await db().prepare("UPDATE chatwork_production_settings SET token_cipher=?,token_expires_at=?,refresh_lease_until=NULL,token_revision=token_revision+1,status=? WHERE id='production' AND token_revision=? AND refresh_lease_until=? AND status='RefreshInProgress'")
      .bind(encrypted, tokens.expiresAt, row.status, row.token_revision + 1, lease).run();
    if (!saved.meta.changes) throw new ApiError(409, "接続情報が変更されました");
    return tokens.accessToken;
  } catch (error) {
    if (refreshSucceeded || error instanceof ChatworkHttpError && (error.status === 400 || error.status === 401)) {
      try {
        await db().prepare("UPDATE chatwork_production_settings SET status='ReconnectRequired',destination_verified=0,refresh_lease_until=NULL WHERE id='production' AND token_revision=? AND refresh_lease_until=? AND status='RefreshInProgress'")
          .bind(row.token_revision + 1, lease).run();
      } catch { /* RefreshInProgress remains fail-closed if D1 cannot save. */ }
      throw new ApiError(409, "Chatworkの再接続が必要です");
    }
    try {
      await db().prepare("UPDATE chatwork_production_settings SET status=?,refresh_lease_until=NULL WHERE id='production' AND token_revision=? AND refresh_lease_until=? AND status='RefreshInProgress'")
        .bind(row.status, row.token_revision + 1, lease).run();
    } catch { /* A failed release remains fail-closed. */ }
    throw error;
  }
}
function authorizedSecret(request: Request, secret: string | undefined): boolean {
  if (!secret || secret.length < 24) return false;
  const supplied = request.headers.get("authorization") || "";
  const expected = `Bearer ${secret}`;
  let different = supplied.length ^ expected.length;
  for (let i = 0; i < Math.max(supplied.length, expected.length); i++) different |= (supplied.charCodeAt(i) || 0) ^ (expected.charCodeAt(i) || 0);
  return different === 0;
}
async function internal(request: Request, path: string[]): Promise<Response> {
  if (request.method !== "POST") throw new ApiError(405, "操作がありません");
  const input = await value(request), route = path.join("/");
  if (route === "control") {
    if (!settings.DELIVERY_CONTROL_OPERATOR_ID || !settings.DELIVERY_CONTROL_SECRET || settings.DELIVERY_CONTROL_SECRET.length < 32 || settings.DELIVERY_CONTROL_SECRET === settings.DELIVERY_WORKER_SHARED_SECRET || !authorizedSecret(request, settings.DELIVERY_CONTROL_SECRET)) throw new ApiError(403, "運用者認証に失敗しました");
    const action = input.action;
    if (!["initialize", "approve", "revoke", "reconcile-revoked", "confirm-isolation", "revoke-test-permit", "issue-test-permit", "confirm-report-isolation", "inspect-test-objects"].includes(String(action)) || typeof input.reason !== "string" || !input.reason.trim() || input.reason.length > 500
      || !Number.isSafeInteger(input.expectedGeneration) || Number(input.expectedGeneration) < 0) throw new ApiError(400, "運用操作が不正です");
    if (action === 'inspect-test-objects') {
      if(typeof input.jobId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.jobId)||Object.keys(input).some(key=>!['action','jobId','expectedGeneration','reason'].includes(key)))throw new ApiError(400,'対象ジョブが不正です');
      if(!settings.BUCKET)throw new ApiError(503,'ファイル保存先を利用できません');
      const job=await db().prepare("SELECT 1 FROM chatwork_delivery_jobs j JOIN chatwork_delivery_runtime r ON r.id='production' WHERE j.id=? AND j.kind='ReportDelivery' AND j.delivery_mode='test' AND j.status IN ('Failed','Sent') AND r.approval_generation=?").bind(input.jobId,input.expectedGeneration).first();
      if(!job)throw new ApiError(409,'ジョブまたは運用状態を確認してください');
      const result=await settings.BUCKET.list({prefix:`chatwork-trial/${input.jobId}/`,limit:1000});
      return reply({count:result.objects.length,truncated:result.truncated,objects:result.objects.map(object=>({size:object.size,uploaded:object.uploaded.toISOString()}))});
    }
    if (action === "issue-test-permit") {
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (typeof input.requestId !== 'string' || !uuid.test(input.requestId) || typeof input.reportId !== 'string' || !uuid.test(input.reportId)
        || !Number.isSafeInteger(input.expiresAt) || Object.keys(input).some(key => !['action','requestId','reportId','expiresAt','reason','expectedGeneration'].includes(key))) throw new ApiError(400, '試験許可の入力が不正です');
      if (!settings.DELIVERY_TEST_ACCOUNT_ID || !settings.DELIVERY_TEST_ROOM_ID || !settings.DELIVERY_TRIAL_WORKER_SUBJECT) throw new ApiError(503, '試験用の送信先またはワーカーが設定されていません');
      const issued=await issueTestPermit(db(),{requestId:input.requestId,reportId:input.reportId,jobId:crypto.randomUUID(),permitId:crypto.randomUUID(),operatorId:settings.DELIVERY_CONTROL_OPERATOR_ID,reason:input.reason as string,expectedGeneration:input.expectedGeneration as number,expiresAt:input.expiresAt as number,testAccountId:settings.DELIVERY_TEST_ACCOUNT_ID,testRoomId:settings.DELIVERY_TEST_ROOM_ID,trialWorkerSubject:settings.DELIVERY_TRIAL_WORKER_SUBJECT});
      if(!issued) throw new ApiError(409,'試験対象または運用状態を確認してください');
      return reply(issued);
    }
    if(action==='confirm-report-isolation'){
      if(typeof input.jobId!=='string'||!/^[0-9a-f-]{36}$/i.test(input.jobId)||input.workerStopped!==true||input.tokenInvalidated!==true||input.requestsEnded!==true||typeof input.evidence!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(input.evidence)||Object.keys(input).some(key=>!['action','jobId','expectedGeneration','reason','workerStopped','tokenInvalidated','requestsEnded','evidence'].includes(key))) throw new ApiError(400,'旧ワーカー停止・トークン無効化・実行中要求の終了確認が必要です');
      const saved=await confirmReportIsolation(db(),{jobId:input.jobId,operatorId:settings.DELIVERY_CONTROL_OPERATOR_ID,expectedGeneration:input.expectedGeneration as number,reason:input.reason as string,evidence:input.evidence});
      if(!saved)throw new ApiError(409,'ジョブまたは運用状態を確認してください');
      return reply({saved:true});
    }
    if (action === "revoke-test-permit") {
      if (typeof input.permitId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.permitId)
        || Object.keys(input).some(key => !["action","permitId","reason","expectedGeneration"].includes(key))) throw new ApiError(400, "試験許可が不正です");
      const saved = await revokeTestPermit(db(), {permitId:input.permitId,operatorId:settings.DELIVERY_CONTROL_OPERATOR_ID,
        reason:input.reason as string,expectedGeneration:input.expectedGeneration as number});
      if (!saved) throw new ApiError(409, "試験許可または運用状態が変更されました");
      return reply({saved:true});
    }
    if (action === "confirm-isolation") {
      if (typeof input.jobId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.jobId)
        || input.workerStopped !== true || input.tokenInvalidated !== true || input.requestsEnded !== true || typeof input.evidence !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(input.evidence)
        || Object.keys(input).some(key => !["action", "jobId", "expectedGeneration", "reason", "workerStopped", "tokenInvalidated", "requestsEnded", "evidence"].includes(key))) throw new ApiError(400, "旧ワーカー停止・トークン無効化・処理中リクエスト終了の確認が必要です");
      const eventId = crypto.randomUUID(), auditId = crypto.randomUUID(), now = new Date().toISOString();
      const detail = JSON.stringify({ evidence: input.evidence, workerStopped: true, tokenInvalidated: true, requestsEnded: true, generation: input.expectedGeneration });
      const result = await db().batch([
        db().prepare(`INSERT OR IGNORE INTO chatwork_delivery_events (id,job_id,actor_id,action,detail_json,created_at)
          SELECT ?,j.id,?,'WorkerIsolationConfirmedV2',?,? FROM chatwork_delivery_jobs j
          WHERE j.id=? AND j.kind='DestinationVerification' AND j.status='Unknown'
          AND EXISTS (SELECT 1 FROM chatwork_delivery_runtime WHERE id='production' AND approved=0 AND approval_generation=?)`)
          .bind(eventId, settings.DELIVERY_CONTROL_OPERATOR_ID, detail, now, input.jobId, input.expectedGeneration),
        db().prepare("INSERT INTO chatwork_delivery_control_audit (id,action,operator_id,reason,before_json,after_json,created_at) SELECT ?,?,?,?,'{}',?,? WHERE EXISTS (SELECT 1 FROM chatwork_delivery_events WHERE id=?)")
          .bind(auditId, action, settings.DELIVERY_CONTROL_OPERATOR_ID, input.reason.trim(), detail, now, eventId),
      ]);
      if (!result[0].meta.changes || !result[1].meta.changes) throw new ApiError(409, "ジョブまたは運用状態を再確認してください");
      return reply({ saved: true });
    }
    if (action === "reconcile-revoked") {
      const eventId = crypto.randomUUID(), now = new Date().toISOString();
      const result = await db().batch([
        db().prepare("INSERT INTO chatwork_delivery_control_audit (id,action,operator_id,reason,before_json,after_json,created_at) SELECT ?,?,?,?,'{}','{}',? WHERE EXISTS (SELECT 1 FROM chatwork_delivery_runtime WHERE id='production' AND approved=0 AND approval_generation=?)")
          .bind(eventId, action, settings.DELIVERY_CONTROL_OPERATOR_ID, input.reason.trim(), now, input.expectedGeneration),
        db().prepare("UPDATE chatwork_delivery_jobs SET status='Unknown',error_code='WORKER_REVOKED',lease_id=NULL,updated_at=? WHERE status='Posting' AND EXISTS (SELECT 1 FROM chatwork_delivery_control_audit WHERE id=?) AND EXISTS (SELECT 1 FROM chatwork_delivery_runtime WHERE id='production' AND approved=0 AND approval_generation=?)")
          .bind(now, eventId, input.expectedGeneration),
      ]);
      if (!result[0].meta.changes) throw new ApiError(409, "運用状態が変更されたか、承認が有効です");
      await markUnknownReportArtifacts(db(),{generation:input.expectedGeneration as number,approved:false});
      return reply({ saved: true, jobsTransitioned: true });
    }
    if (action === "approve" && (typeof input.workerSubject !== "string" || !/^\d{1,32}$/.test(input.workerSubject)
      || typeof input.workerRevision !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(input.workerRevision)
      || typeof input.siteRevision !== "string" || !/^[a-zA-Z0-9._-]{1,100}$/.test(input.siteRevision)
      || typeof input.imageDigest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(input.imageDigest))) throw new ApiError(400, "承認対象が不正です");
    const old = await db().prepare("SELECT * FROM chatwork_delivery_runtime WHERE id='production'").first<Record<string, unknown>>();
    const generation = Number(input.expectedGeneration);
    if (action === "initialize" && (old || generation !== 0) || action !== "initialize" && (!old || Number(old.approval_generation) !== generation)) throw new ApiError(409, "運用状態が変更されました");
    const eventId = crypto.randomUUID(), now = new Date().toISOString();
    const next = action === "approve" ? { subject: input.workerSubject, workerRevision: input.workerRevision, siteRevision: input.siteRevision, imageDigest: input.imageDigest, generation: generation + 1 } : { generation: action === "initialize" ? 0 : generation + 1 };
    const exists = action === "initialize" ? "NOT EXISTS (SELECT 1 FROM chatwork_delivery_runtime WHERE id='production')" : "EXISTS (SELECT 1 FROM chatwork_delivery_runtime WHERE id='production' AND approval_generation=?)";
    const unusedSubject = action === "approve" ? " AND NOT EXISTS (SELECT 1 FROM chatwork_delivery_control_audit WHERE (action='approve' AND json_extract(after_json,'$.subject')=?) OR json_extract(before_json,'$.worker_subject')=?) AND NOT EXISTS (SELECT 1 FROM chatwork_delivery_runtime WHERE worker_subject=?)" : "";
    const postingGuard = action === "revoke" ? "" : " AND NOT EXISTS (SELECT 1 FROM chatwork_delivery_jobs WHERE status='Posting')";
    const statement = db().prepare(`INSERT INTO chatwork_delivery_control_audit (id,action,operator_id,reason,before_json,after_json,created_at)
      SELECT ?,?,?,?,?,?,? WHERE ${exists}${postingGuard}${unusedSubject}`);
    const args = [eventId, action, settings.DELIVERY_CONTROL_OPERATOR_ID, input.reason.trim(), JSON.stringify(old || {}), JSON.stringify(next), now];
    const audit = action === "initialize" ? statement.bind(...args) : action === "approve" ? statement.bind(...args, generation, input.workerSubject, input.workerSubject, input.workerSubject) : statement.bind(...args, generation);
    const change = action === "initialize"
      ? db().prepare("INSERT INTO chatwork_delivery_runtime (id,updated_at) SELECT 'production',? WHERE EXISTS (SELECT 1 FROM chatwork_delivery_control_audit WHERE id=?)").bind(now, eventId)
      : db().prepare("UPDATE chatwork_delivery_runtime SET approved=?,report_approved=0,worker_subject=?,worker_revision=?,site_revision=?,approval_generation=approval_generation+1,last_healthy_heartbeat_at=NULL,last_monitor_run_id=NULL,updated_at=? WHERE id='production' AND approval_generation=? AND EXISTS (SELECT 1 FROM chatwork_delivery_control_audit WHERE id=?)")
        .bind(action === "approve" ? 1 : 0, action === "approve" ? input.workerSubject : null, action === "approve" ? input.workerRevision : null, action === "approve" ? input.siteRevision : null, now, generation, eventId);
    const statements = [audit, change];
    if (action === "initialize") statements.push(db().prepare("INSERT OR IGNORE INTO chatwork_production_settings (id,updated_at) SELECT 'production',? WHERE EXISTS (SELECT 1 FROM chatwork_delivery_control_audit WHERE id=?)").bind(now, eventId));
    const result = await db().batch(statements);
    if (!result[0].meta.changes || !result[1].meta.changes) throw new ApiError(409, "運用状態が変更されたか、投稿処理中です");
    if (action === "revoke") {
      try {
        await db().prepare("UPDATE chatwork_delivery_jobs SET status='Unknown',error_code='WORKER_REVOKED',lease_id=NULL,updated_at=? WHERE status='Posting' AND EXISTS (SELECT 1 FROM chatwork_delivery_runtime WHERE id='production' AND approved=0 AND approval_generation=?)")
          .bind(now, generation + 1).run();
        await markUnknownReportArtifacts(db(),{generation:generation+1,approved:false});
      } catch {
        console.error("delivery_revocation_reconciliation_failed");
        return reply({ saved: true, generation: next.generation, jobsTransitioned: false }, 202);
      }
    }
    return reply({ saved: true, generation: next.generation, ...(action === "revoke" ? { jobsTransitioned: true } : {}) });
  }
  if (!authorizedSecret(request, settings.DELIVERY_WORKER_SHARED_SECRET)) throw new ApiError(403, "ワーカー認証に失敗しました");
  const identity = request.headers.get("x-kiiya-worker-identity") || "";
  const subject = await verifyWorkerIdentity(identity, settings.DELIVERY_WORKER_IDENTITY_AUDIENCE || "");
  if (!subject) throw new ApiError(403, "ワーカー主体を確認できません");
  const runtime = await db().prepare("SELECT worker_subject,approval_generation FROM chatwork_delivery_runtime WHERE id='production' AND approved=1 AND worker_subject=?").bind(subject).first<{ worker_subject: string; approval_generation: number }>();
  if (!runtime) throw new ApiError(403, "ワーカーの配備版は承認されていません");
  const trialWorker=!!settings.DELIVERY_TRIAL_WORKER_SUBJECT && subject===settings.DELIVERY_TRIAL_WORKER_SUBJECT;
  if(route.startsWith('report/')&&!trialWorker)throw new ApiError(403,'試験配送のワーカーは承認されていません');
  if(['report/preflight','report/next','report/payload'].includes(route)){
    if(typeof input.jobId!=='string'||typeof input.leaseId!=='string'||(route==='report/payload'&&typeof input.artifactId!=='string')||Object.keys(input).some(key=>!(route==='report/payload'?['jobId','leaseId','artifactId']:['jobId','leaseId']).includes(key)))throw new ApiError(400,'成果物の指定が不正です');
    const access={jobId:input.jobId,leaseId:input.leaseId,subject,generation:runtime.approval_generation};
    const files=await workerReportFiles(db(),access);
    if(!files)throw new ApiError(409,'試験許可または成果物を確認してください');
    if(route==='report/next'){
      if(files.some(file=>['Posting','Unknown','Failed'].includes(file.status)))throw new ApiError(409,'成果物の結果確認が必要です');
      const next=files.find(file=>file.status==='Pending');
      return next?reply({artifactId:next.id,kind:next.kind}):reply({done:true});
    }
    if(!settings.BUCKET)throw new ApiError(503,'ファイル保存先を利用できません');
    if(route==='report/preflight'){
      for(const file of files)await readWorkerFile(settings.BUCKET,file);
      await accessToken(true);
      if(!await workerReportFiles(db(),access))throw new ApiError(409,'試験許可が変更されました');
      return reply({ready:true});
    }
    const file=files.find(file=>file.id===input.artifactId&&file.status==='Posting');
    if(!file)throw new ApiError(409,'成果物を確保できません');
    const bytes=await readWorkerFile(settings.BUCKET,file);
    const after=await workerReportFiles(db(),access);
    if(!after?.some(row=>row.id===file.id&&row.status==='Posting'))throw new ApiError(409,'成果物または試験許可が変更されました');
    if(file.kind==='body')return reply({body:new TextDecoder('utf-8',{fatal:true}).decode(bytes)});
    let binary='';for(let offset=0;offset<bytes.length;offset+=0x8000)binary+=String.fromCharCode(...bytes.subarray(offset,offset+0x8000));
    return reply({base64:btoa(binary),fileName:file.file_name,mime:file.mime});
  }
  if(route==='report/complete'){
    if(typeof input.jobId!=='string'||typeof input.leaseId!=='string'||Object.keys(input).some(key=>!['jobId','leaseId'].includes(key)))throw new ApiError(400,'ジョブの指定が不正です');
    if(!await completeTestJob(db(),{jobId:input.jobId,leaseId:input.leaseId,subject,generation:runtime.approval_generation}))throw new ApiError(409,'成果物が完了していません');
    return reply({saved:true});
  }
  if(route==='report/claim'||route==='report/result'){
    if(typeof input.jobId!=='string'||typeof input.leaseId!=='string'||typeof input.artifactId!=='string')throw new ApiError(400,'成果物の指定が不正です');
    const permit=await db().prepare("SELECT id FROM chatwork_test_permits WHERE job_id=?").bind(input.jobId).first<{id:string}>();
    if(!permit)throw new ApiError(409,'試験許可がありません');
    const access={jobId:input.jobId,leaseId:input.leaseId,artifactId:input.artifactId,permitId:permit.id,subject,generation:runtime.approval_generation};
    if(route==='report/claim'){
      if(Object.keys(input).some(key=>!['jobId','leaseId','artifactId'].includes(key)))throw new ApiError(400,'成果物の指定が不正です');
      if(!await claimTestArtifact(db(),access))throw new ApiError(409,'成果物を確保できません');
      return reply({claimed:true});
    }
    if(!['Sent','Failed','Unknown'].includes(String(input.status))||Object.keys(input).some(key=>!['jobId','leaseId','artifactId','status','messageId','errorCode'].includes(key))||(input.messageId!=null&&(typeof input.messageId!=='string'||input.messageId.length>100))||(input.errorCode!=null&&(typeof input.errorCode!=='string'||!/^[A-Za-z0-9_]{1,40}$/.test(input.errorCode))))throw new ApiError(400,'成果物の結果が不正です');
    const saved=await finishTestArtifact(db(),{...access,status:input.status as 'Sent'|'Failed'|'Unknown',messageId:typeof input.messageId==='string'?input.messageId:null,errorCode:typeof input.errorCode==='string'?input.errorCode:null});
    if(!saved)throw new ApiError(409,'成果物の結果を反映できません');
    return reply({saved:true});
  }
  if (route === "claim") {
    if (typeof input.jobId !== "string") throw new ApiError(400, "ジョブIDが不正です");
    const pending = await db().prepare("SELECT kind,delivery_mode FROM chatwork_delivery_jobs WHERE id=?").bind(input.jobId).first<{ kind: string; delivery_mode:string }>();
    if(pending?.kind==='ReportDelivery' && pending.delivery_mode==='test'){
      if(!trialWorker)throw new ApiError(403,'試験配送のワーカーは承認されていません');
      const leaseId=crypto.randomUUID();
      if(!await claimTestJob(db(),{jobId:input.jobId,leaseId,subject,generation:runtime.approval_generation})){
        const state=await db().prepare("SELECT status FROM chatwork_delivery_jobs WHERE id=?").bind(input.jobId).first<{status:string}>();
        if(state&&['DispatchPending','Dispatched'].includes(state.status))throw new ApiError(503,'試験ジョブの確保条件が整っていません');
        throw new ApiError(409,'このジョブは確保できません');
      }
      const job=await db().prepare("SELECT room_id,lease_until FROM chatwork_delivery_jobs WHERE id=? AND status='Posting' AND lease_id=?").bind(input.jobId,leaseId).first<{room_id:string;lease_until:number}>();
      if(!job)throw new ApiError(409,'ジョブの状態が変更されました');
      return reply({kind:'ReportDelivery',jobId:input.jobId,leaseId,roomId:job.room_id,leaseUntil:job.lease_until});
    }
    if (pending?.kind !== "DestinationVerification") throw new ApiError(409, "このジョブは確保できません");
    const leaseId = crypto.randomUUID();
    const job = await claimDelivery(db(), { id: input.jobId, leaseId, now: Date.now(), subject, generation: runtime.approval_generation });
    if (!job || job.kind !== "DestinationVerification") {
      await invalidateObsoleteVerifications(db(), Date.now(), input.jobId, { subject, generation: runtime.approval_generation });
      const currentJob = await db().prepare("SELECT status FROM chatwork_delivery_jobs WHERE id=?").bind(input.jobId).first<{ status: string }>();
      if (currentJob && ["DispatchPending", "Dispatched"].includes(currentJob.status)) throw new ApiError(503, "ジョブの確保条件が整っていません");
      throw new ApiError(409, "このジョブは確保できません");
    }
    return reply({ jobId: job.id, leaseId, roomId: job.room_id, body: `KIIYA送信先確認\n識別番号: ${job.marker}\n個人情報を含まない接続確認です。`, leaseUntil: job.lease_until });
  }
  if (route === "token") {
    if (typeof input.jobId !== "string" || typeof input.leaseId !== "string") throw new ApiError(400, "リースが不正です");
    const job = await db().prepare(`SELECT j.* FROM chatwork_delivery_jobs j JOIN chatwork_production_settings s ON s.id='production'
      WHERE j.id=? AND j.lease_id=? AND j.status='Posting' AND j.lease_until>?
      AND j.settings_version=s.version AND j.account_id=s.account_id AND j.room_id=s.room_id AND s.paused=0
      AND (j.kind='DestinationVerification' OR (j.kind='ReportDelivery' AND j.delivery_mode='test' AND EXISTS (SELECT 1 FROM chatwork_report_artifacts a WHERE a.id=? AND a.job_id=j.id AND a.status='Posting' AND a.message_id IS NULL) AND EXISTS (SELECT 1 FROM chatwork_test_permits p JOIN app_users u ON u.id=j.actor_id WHERE p.job_id=j.id AND p.actor_id=j.actor_id AND p.staff_revision=j.actor_staff_revision AND u.active=1 AND u.role IN ('normal','field') AND u.staff_revision=j.actor_staff_revision AND p.status='Active' AND p.expires_at>CAST(strftime('%s','now') AS INTEGER)*1000 AND p.worker_subject=? AND p.approval_generation=?)))
      AND EXISTS (SELECT 1 FROM chatwork_delivery_runtime WHERE id='production' AND approved=1 AND worker_subject=? AND approval_generation=?)`)
      .bind(input.jobId, input.leaseId, Date.now(), typeof input.artifactId === "string" ? input.artifactId : null, subject, runtime.approval_generation, subject, runtime.approval_generation).first<DeliveryJob>();
    if (!job) throw new ApiError(409, "リースまたは送信先が変更されました");
    if(job.kind==='ReportDelivery'&&!trialWorker)throw new ApiError(403,'試験配送のワーカーは承認されていません');
    const token = await accessToken(job.kind==='ReportDelivery');
    const stillAuthorized = await db().prepare(`SELECT 1 FROM chatwork_delivery_jobs j JOIN chatwork_production_settings s ON s.id='production'
      WHERE j.id=? AND j.lease_id=? AND j.status='Posting' AND j.lease_until>?
      AND j.settings_version=s.version AND j.account_id=s.account_id AND j.room_id=s.room_id AND s.paused=0
      AND (j.kind='DestinationVerification' OR (j.kind='ReportDelivery' AND j.delivery_mode='test' AND EXISTS (SELECT 1 FROM chatwork_report_artifacts a WHERE a.id=? AND a.job_id=j.id AND a.status='Posting' AND a.message_id IS NULL) AND EXISTS (SELECT 1 FROM chatwork_test_permits p JOIN app_users u ON u.id=j.actor_id WHERE p.job_id=j.id AND p.actor_id=j.actor_id AND p.staff_revision=j.actor_staff_revision AND u.active=1 AND u.role IN ('normal','field') AND u.staff_revision=j.actor_staff_revision AND p.status='Active' AND p.expires_at>CAST(strftime('%s','now') AS INTEGER)*1000 AND p.worker_subject=? AND p.approval_generation=?)))
      AND EXISTS (SELECT 1 FROM chatwork_delivery_runtime WHERE id='production' AND approved=1 AND worker_subject=? AND approval_generation=?)`)
      .bind(input.jobId, input.leaseId, Date.now(), typeof input.artifactId === "string" ? input.artifactId : null, subject, runtime.approval_generation, subject, runtime.approval_generation).first();
    if (!stillAuthorized) throw new ApiError(409, "リース、送信先またはワーカーの承認が変更されました");
    return reply({ accessToken: token });
  }
  if (route === "result") {
    if (typeof input.jobId !== "string" || typeof input.leaseId !== "string" || !["Sent", "Failed", "Unknown"].includes(String(input.status))) throw new ApiError(400, "投稿結果が不正です");
    const saved = await finishArtifact(db(), { id: input.jobId, leaseId: input.leaseId, status: input.status as "Sent" | "Failed" | "Unknown",
      messageId: typeof input.messageId === "string" && input.messageId.length <= 100 ? input.messageId : null,
      errorCode: typeof input.errorCode === "string" && /^[A-Za-z0-9_]{1,40}$/.test(input.errorCode) ? input.errorCode : null, now: Date.now(), identity: { subject, generation: runtime.approval_generation } });
    if (!saved) throw new ApiError(409, "この投稿結果は反映できません");
    return reply({ saved: true });
  }
  if (route === "monitor") {
    const now = Date.now();
    await db().prepare("UPDATE chatwork_delivery_jobs SET status='Unknown',error_code='LEASE_EXPIRED',lease_id=NULL,lease_until=NULL,updated_at=? WHERE status='Posting' AND lease_until<=? AND EXISTS (SELECT 1 FROM chatwork_delivery_runtime WHERE id='production' AND approved=1 AND worker_subject=? AND approval_generation=?)")
      .bind(new Date(now).toISOString(), now, subject, runtime.approval_generation).run();
    await markUnknownReportArtifacts(db(),{generation:runtime.approval_generation,approved:true,subject});
    await invalidateObsoleteVerifications(db(), now, undefined, { subject, generation: runtime.approval_generation });
    await invalidateObsoleteReportJobs(db(), now, { subject, generation: runtime.approval_generation });
    const expiredPermits = await db().prepare(`SELECT id FROM chatwork_test_permits
      WHERE status='Active' AND expires_at<=CAST(strftime('%s','now') AS INTEGER)*1000
      ORDER BY expires_at LIMIT 100`).all<{id:string}>();
    for (const permit of expiredPermits.results) {
      await expireTestPermit(db(), {permitId:permit.id,operatorId:"system-monitor",reason:"試験許可期限切れ",
        expectedGeneration:runtime.approval_generation,subject});
    }
    const pending = await db().prepare(`SELECT id,task_name FROM chatwork_delivery_jobs j WHERE status IN ('DispatchPending','Dispatched') AND (kind='DestinationVerification' OR (?=1 AND kind='ReportDelivery' AND delivery_mode='test' AND report_manifest_sealed=1 AND EXISTS(SELECT 1 FROM chatwork_test_permits p WHERE p.job_id=j.id AND p.status='Active' AND p.expires_at>CAST(strftime('%s','now') AS INTEGER)*1000 AND p.worker_subject=? AND p.approval_generation=?) AND EXISTS(SELECT 1 FROM chatwork_report_artifacts a WHERE a.job_id=j.id) AND NOT EXISTS(SELECT 1 FROM chatwork_report_artifacts a WHERE a.job_id=j.id AND NOT EXISTS(SELECT 1 FROM chatwork_report_prepared_files f WHERE f.artifact_id=a.id)))) AND EXISTS (SELECT 1 FROM chatwork_delivery_runtime WHERE id='production' AND approved=1 AND worker_subject=? AND approval_generation=?) ORDER BY updated_at LIMIT 100`)
      .bind(trialWorker?1:0,subject, runtime.approval_generation,subject, runtime.approval_generation).all<{ id: string; task_name: string | null }>();
    const active = await db().prepare("SELECT 1 FROM chatwork_delivery_runtime WHERE id='production' AND approved=1 AND worker_subject=? AND approval_generation=?").bind(subject, runtime.approval_generation).first();
    if (!active) throw new ApiError(403, "ワーカーの承認が取り消されました");
    return reply({ pendingJobs: pending.results.map(row => ({ id: row.id, taskName: row.task_name })) });
  }
  if (route === "dispatch-record") {
    if (typeof input.jobId !== "string" || typeof input.taskName !== "string" || input.taskName.length > 500 || !/^projects\/[^/]+\/locations\/[^/]+\/queues\/[^/]+\/tasks\/kiiya-[a-zA-Z0-9-]+$/.test(input.taskName)) throw new ApiError(400, "タスク名が不正です");
    await db().prepare(`UPDATE chatwork_delivery_jobs SET status='Dispatched',task_name=?,dispatch_attempted_at=?,updated_at=? WHERE id=? AND status IN ('DispatchPending','Dispatched') AND (kind='DestinationVerification' OR (?=1 AND kind='ReportDelivery' AND delivery_mode='test' AND report_manifest_sealed=1 AND EXISTS(SELECT 1 FROM chatwork_test_permits p WHERE p.job_id=chatwork_delivery_jobs.id AND p.status='Active' AND p.expires_at>CAST(strftime('%s','now') AS INTEGER)*1000 AND p.worker_subject=? AND p.approval_generation=?) AND NOT EXISTS(SELECT 1 FROM chatwork_report_artifacts a WHERE a.job_id=chatwork_delivery_jobs.id AND NOT EXISTS(SELECT 1 FROM chatwork_report_prepared_files f WHERE f.artifact_id=a.id)))) AND EXISTS (SELECT 1 FROM chatwork_delivery_runtime WHERE id='production' AND approved=1 AND worker_subject=? AND approval_generation=?)`)
      .bind(input.taskName, new Date().toISOString(), new Date().toISOString(), input.jobId,trialWorker?1:0, subject, runtime.approval_generation,subject, runtime.approval_generation).run();
    const active = await db().prepare("SELECT 1 FROM chatwork_delivery_runtime WHERE id='production' AND approved=1 AND worker_subject=? AND approval_generation=?").bind(subject, runtime.approval_generation).first();
    if (!active) throw new ApiError(403, "ワーカーの承認が取り消されました");
    return reply({ saved: true });
  }
  if (route === "heartbeat") {
    if (typeof input.monitorRunId !== "string" || !/^[0-9a-f-]{36}$/i.test(input.monitorRunId) || input.monitorSucceeded !== true
      || typeof input.workerRevision !== "string" || typeof input.siteRevision !== "string" || input.approvalGeneration !== runtime.approval_generation) throw new ApiError(400, "監視結果が不正です");
    const now = Date.now();
    const nonce = crypto.randomUUID(), at = new Date(now).toISOString();
    const result = await db().batch([
      db().prepare("INSERT OR IGNORE INTO chatwork_delivery_monitor_runs (run_id,nonce,created_at) SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM chatwork_delivery_runtime WHERE id='production' AND approved=1 AND worker_subject=? AND approval_generation=?)").bind(input.monitorRunId, nonce, at, subject, runtime.approval_generation),
      db().prepare("UPDATE chatwork_delivery_runtime SET last_healthy_heartbeat_at=?,last_monitor_run_id=?,updated_at=? WHERE id='production' AND approved=1 AND worker_subject=? AND approval_generation=? AND worker_revision=? AND site_revision=? AND EXISTS (SELECT 1 FROM chatwork_delivery_monitor_runs WHERE run_id=? AND nonce=?)")
        .bind(now, input.monitorRunId, at, subject, runtime.approval_generation, input.workerRevision, input.siteRevision, input.monitorRunId, nonce),
    ]);
    if (!result[1].meta.changes) throw new ApiError(409, "ワーカーの配備版または監視結果が一致しません");
    return reply({ receivedAt: new Date(now).toISOString() });
  }
  return reply({ error: "操作がありません" }, 404);
}
async function api(request: Request, path: string[]): Promise<Response> {
  if (path[0] === "internal") return internal(request, path.slice(1));
  const { id, staffRevision } = await actor(request), method = request.method, route = path.join("/");
  guard(request, method !== "GET");
  if(route==='trial/reconcile-unposted'&&method==='POST'){
    const input=await value(request);
    if(typeof input.jobId!=='string'||!/^[0-9a-f-]{36}$/i.test(input.jobId)||Object.keys(input).some(key=>key!=='jobId'))throw new ApiError(400,'照合内容が不正です');
    if(!await reconcileUnpostedReport(db(),{jobId:input.jobId,actorId:id,staffRevision,now:Date.now()}))throw new ApiError(409,'隔離と報告の状態を確認してください');
    return reply({saved:true});
  }
  if(route==='trial/self-cancel' && method==='POST'){
    const input=await value(request),uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if(typeof input.candidateId!=='string'||!uuid.test(input.candidateId)||Object.keys(input).some(key=>key!=='candidateId'))throw new ApiError(400,'報告候補が不正です');
    const prior=await db().prepare(`SELECT p.id,p.status,j.status AS job_status,j.error_code,r.approval_generation FROM chatwork_test_permits p JOIN chatwork_delivery_jobs j ON j.id=p.job_id JOIN report_snapshot_candidates c ON c.id=j.report_id JOIN chatwork_delivery_runtime r ON r.id='production'
      WHERE c.id=? AND c.actor_id=? AND c.staff_revision=? AND j.actor_id=c.actor_id AND j.actor_staff_revision=c.staff_revision AND p.actor_id=c.actor_id AND p.staff_revision=c.staff_revision`).bind(input.candidateId,id,staffRevision).first<{id:string;status:string;job_status:string;error_code:string|null;approval_generation:number}>();
    if(!prior)throw new ApiError(409,'送信状態を確認してください');
    if(prior.status==='Revoked'&&prior.job_status==='Failed'&&prior.error_code==='TEST_PERMIT_REVOKED_UNSENT')return reply({cancelled:true});
    const cancelled=await revokeTestPermit(db(),{permitId:prior.id,operatorId:id,ownerId:id,ownerRevision:staffRevision,expectedGeneration:prior.approval_generation,reason:'現場職員が未送信の報告候補を破棄'});
    if(!cancelled)throw new ApiError(409,'送信が開始されたか状態が変更されました。送信履歴を確認してください');
    return reply({cancelled:true});
  }
  if(route==='trial/self-reserve' && method==='POST'){
    const input=await value(request),uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if(typeof input.candidateId!=='string'||!uuid.test(input.candidateId)||Object.keys(input).some(key=>key!=='candidateId'))throw new ApiError(400,'報告候補が不正です');
    if(!settings.DELIVERY_TEST_ACCOUNT_ID||!settings.DELIVERY_TEST_ROOM_ID||!settings.DELIVERY_TRIAL_WORKER_SUBJECT)throw new ApiError(503,'送信先または配送ワーカーを確認してください');
    const candidateId=input.candidateId;
    const lookup=()=>db().prepare(`SELECT j.id AS jobId,p.id AS permitId FROM report_snapshot_candidates c
      JOIN works w ON w.id=c.work_id AND w.owner_id=c.actor_id AND w.revision=c.work_revision
      JOIN app_users u ON u.id=c.actor_id AND u.active=1 AND u.role IN ('normal','field') AND u.staff_revision=c.staff_revision
      JOIN chatwork_delivery_jobs j ON j.report_id=c.id AND j.actor_id=c.actor_id AND j.actor_staff_revision=c.staff_revision AND j.delivery_mode='test'
      JOIN chatwork_test_permits p ON p.job_id=j.id AND p.status='Active' AND p.expires_at>CAST(strftime('%s','now') AS INTEGER)*1000
      JOIN chatwork_production_settings s ON s.id='production' AND s.version=p.settings_version AND s.account_id=p.account_id AND s.room_id=p.room_id AND s.paused=0 AND s.destination_verified=1
      JOIN chatwork_delivery_runtime rt ON rt.id='production' AND rt.approved=1 AND rt.report_approved=0 AND rt.approval_generation=p.approval_generation AND rt.worker_subject=p.worker_subject AND rt.worker_revision=p.worker_revision AND rt.site_revision=p.site_revision
      WHERE c.id=? AND c.actor_id=? AND c.staff_revision=? AND c.status='Active' AND j.status IN ('TestAwaitingRegistration','DispatchPending','Dispatched','Posting','Sent') AND p.account_id=? AND p.room_id=? AND p.worker_subject=?`)
      .bind(candidateId,id,staffRevision,settings.DELIVERY_TEST_ACCOUNT_ID,settings.DELIVERY_TEST_ROOM_ID,settings.DELIVERY_TRIAL_WORKER_SUBJECT).first<{jobId:string;permitId:string}>();
    const existing=await lookup();if(existing)return reply(existing);
    const runtime=await db().prepare("SELECT approval_generation FROM chatwork_delivery_runtime WHERE id='production' AND approved=1").first<{approval_generation:number}>();
    if(!runtime)throw new ApiError(503,'配送ワーカーを確認してください');
    const issued=await issueTestPermit(db(),{requestId:candidateId,reportId:candidateId,jobId:crypto.randomUUID(),permitId:crypto.randomUUID(),operatorId:id,ownerId:id,ownerRevision:staffRevision,reason:'現場職員による固定送信先への送信準備',expectedGeneration:runtime.approval_generation,expiresAt:Date.now()+30*60_000,testAccountId:settings.DELIVERY_TEST_ACCOUNT_ID,testRoomId:settings.DELIVERY_TEST_ROOM_ID,trialWorkerSubject:settings.DELIVERY_TRIAL_WORKER_SUBJECT});
    const result=issued||await lookup();if(!result)throw new ApiError(409,'報告内容または送信設定を確認してください');
    return reply(result);
  }
  if(route==='trial/prepare' && method==='POST'){
    const input=await value(request),uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if(typeof input.jobId!=='string'||!uuid.test(input.jobId)||typeof input.permitId!=='string'||!uuid.test(input.permitId)||Object.keys(input).some(key=>!['jobId','permitId'].includes(key)))throw new ApiError(400,'試験準備が不正です');
    if(!settings.BUCKET)throw new ApiError(503,'ファイル保存先を利用できません');
    const owned=await db().prepare(`SELECT 1 FROM chatwork_delivery_jobs j JOIN chatwork_test_permits p ON p.job_id=j.id JOIN app_users u ON u.id=j.actor_id JOIN works w ON w.id=j.work_id AND w.owner_id=u.id WHERE j.id=? AND p.id=? AND j.actor_id=? AND u.active=1 AND u.role IN ('normal','field') AND u.staff_revision=? AND p.staff_revision=u.staff_revision AND p.status='Active' AND p.expires_at>CAST(strftime('%s','now') AS INTEGER)*1000 AND j.delivery_mode='test'
      AND (j.status='DispatchPending' OR (j.status='TestAwaitingRegistration' AND EXISTS (SELECT 1 FROM report_snapshot_candidates c WHERE c.id=j.report_id AND c.status='Active' AND c.work_revision=w.revision AND c.staff_revision=u.staff_revision)))`).bind(input.jobId,input.permitId,id,staffRevision).first();
    if(!owned)throw new ApiError(409,'試験許可または報告の状態を確認してください');
    const diagnosticId=crypto.randomUUID(),log=(...args:string[])=>console.info(...args,diagnosticId);
    await withPreparationStage(log,'token',()=>accessToken(true));
    if(!await withPreparationStage(log,'manifest',()=>createReportManifest(db(),{jobId:input.jobId as string,actorId:id,staffRevision,now:Date.now()})))throw new ApiError(409,'報告内容または添付を確認してください');
    const loadFont=async()=>{
      if(!settings.SITE_ASSET_ACCESS_TOKEN)throw new ApiError(503,'PDFフォント用の認証設定を確認してください');
      const bytes=await fetchReportFont(fetch,{'OAI-Sites-Authorization':`Bearer ${settings.SITE_ASSET_ACCESS_TOKEN}`},log);
      if(bytes.length>10_000_000)throw new ApiError(503,'PDFフォントが不正です');
      const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes).buffer)),b=>b.toString(16).padStart(2,'0')).join('');
      if(digest!=='59db22acee2c4c9e88bac7dbf6555c8be70a212e5e2cc884ae04b24166bd4794')throw new ApiError(503,'PDFフォントを検証できません');
      return bytes;
    };
    let prepared:boolean;
    try{prepared=await withPreparationStage(log,'prepare',()=>prepareStoredReport(db(),settings.BUCKET!,loadFont,{jobId:input.jobId as string,permitId:input.permitId as string,actorId:id,staffRevision},log));}
    catch(error){
      if(error instanceof ApiError)throw error;
      if(error instanceof ReportFontError)throw new ApiError(503,'PDFフォントを読み込めません');
      const message=error instanceof Error?error.message:'';
      if(message.includes('file limit')||message.includes('preparation limit'))throw new ApiError(409,'添付またはPDFの容量が送信上限を超えています。候補を破棄してから、画像を見直してください');
      if(message==='Unsupported image format')throw new ApiError(409,'PDFに使える画像はJPEGまたはPNGです。候補を破棄してから、画像を見直してください');
      if(message==='Unsupported report character')throw new ApiError(409,'PDFに表示できない文字が含まれています。候補を破棄してから、報告内容を見直してください');
      if(message==='Invalid image'||message==='Image unavailable'||message==='Image size changed')throw new ApiError(409,'画像を読み込めません。元の画像と報告内容を確認してください');
      throw error;
    }
    if(!prepared)throw new ApiError(409,'試験許可または報告の状態を確認してください');
    return reply({prepared:true,jobId:input.jobId});
  }
  if(route==='trial/reconcile' && method==='POST'){
    const input=await value(request);
    if(typeof input.jobId!=='string'||!/^[0-9a-f-]{36}$/i.test(input.jobId)||typeof input.artifactId!=='string'||!/^[0-9a-f]{32}$/i.test(input.artifactId)||!['Sent','NotSent'].includes(String(input.outcome))||Object.keys(input).some(key=>!['jobId','artifactId','outcome','messageId'].includes(key))||(input.outcome==='Sent'&&(typeof input.messageId!=='string'||!input.messageId||input.messageId.length>100))||(input.outcome==='NotSent'&&input.messageId!=null))throw new ApiError(400,'照合内容が不正です');
    const saved=await reconcileReportArtifact(db(),{jobId:input.jobId,artifactId:input.artifactId,actorId:id,staffRevision,outcome:input.outcome as 'Sent'|'NotSent',messageId:typeof input.messageId==='string'?input.messageId:null,now:Date.now()});
    if(!saved)throw new ApiError(409,'隔離と対象成果物の状態を確認してください');
    return reply({saved:true});
  }
  if (route === 'trial/register' && method === 'POST') {
    const input=await value(request), uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if(typeof input.jobId!=='string' || !uuid.test(input.jobId) || typeof input.permitId!=='string' || !uuid.test(input.permitId) || (input.candidateId!==undefined && (typeof input.candidateId!=='string'||!uuid.test(input.candidateId))) || Object.keys(input).some(key=>!['jobId','permitId','candidateId'].includes(key))) throw new ApiError(400,'試験登録が不正です');
    const registered=await registerTestDelivery(db(),{jobId:input.jobId,permitId:input.permitId,candidateId:typeof input.candidateId==='string'?input.candidateId:undefined,actorId:id,staffRevision,now:Date.now()});
    if(!registered) throw new ApiError(409,'試験許可または報告の状態を確認してください');
    return reply({registered:true,jobId:input.jobId});
  }
  if (route === "settings" && method === "GET") return reply({ ...detail(await current()), verificationReady: await verificationPathReady(db()) });
  if (route === "verify-posting" && method === "POST") {
    await requireRoomManager(id);
    const input = await value(request), row = await current(); expected(input, row);
    if (typeof input.requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId)
      || Object.keys(input).some(key => !["expectedVersion", "requestId"].includes(key))) throw new ApiError(400, "確認投稿の要求が不正です");
    await invalidateObsoleteVerifications(db(), Date.now());
    const job = await createVerification(db(), { actorId: id, staffRevision, expectedVersion: row.version, requestId: input.requestId,
      jobId: crypto.randomUUID(), marker: `KIIYA-${randomSecret(9)}`, now: Date.now() });
    if (!job) {
      const unresolved = await db().prepare("SELECT id FROM chatwork_delivery_jobs WHERE kind='DestinationVerification' AND status IN ('DispatchPending','Dispatched','Posting','Unknown') LIMIT 1").first<{ id: string }>();
      if (unresolved) throw new ApiError(409, "確認投稿の処理中または結果不明のため、新しい投稿はできません。最新状態を確認してください");
      throw new ApiError(503, "確認投稿の経路が利用できません");
    }
    if (job.status === "DispatchPending") await dispatch(job);
    const currentJob = await db().prepare("SELECT * FROM chatwork_delivery_jobs WHERE id=?").bind(job.id).first<DeliveryJob>();
    return reply(verificationView(currentJob || job, id, staffRevision, row), 202);
  }
  if (route === "verifications/latest" && method === "GET") {
    await invalidateObsoleteVerifications(db(), Date.now());
    const row = await current();
    const job = await db().prepare(`SELECT * FROM chatwork_delivery_jobs WHERE kind='DestinationVerification'
      AND (status IN ('DispatchPending','Dispatched','Posting','Unknown') OR (actor_id=? AND settings_version=?))
      ORDER BY CASE WHEN status IN ('DispatchPending','Dispatched','Posting','Unknown') THEN 0 ELSE 1 END, created_at DESC LIMIT 1`)
      .bind(id, row.version).first<DeliveryJob>();
    return reply(job ? { ...verificationView(job, id, staffRevision, row), requestId: job.actor_id === id ? job.request_id : null } : null);
  }
  if (path[0] === "verifications" && path[1] && path.length === 2 && method === "GET") {
    const job = await db().prepare("SELECT * FROM chatwork_delivery_jobs WHERE id=? AND kind='DestinationVerification'").bind(path[1]).first<DeliveryJob>();
    if (!job) throw new ApiError(404, "確認投稿がありません");
    return reply(verificationView(job, id, staffRevision, await current()));
  }
  if (path[0] === "verifications" && path[1] && path[2] === "resolve" && path.length === 3 && method === "POST") {
    await requireRoomManager(id);
    const input = await value(request);
    if (input.checked !== true || typeof input.marker !== "string" || !["Sent", "NotSent"].includes(String(input.outcome))
      || Object.keys(input).some(key => !["checked", "marker", "outcome", "messageId"].includes(key))
      || (input.outcome === "Sent" && (typeof input.messageId !== "string" || !/^[0-9]{1,100}$/.test(input.messageId)))
      || (input.outcome === "NotSent" && input.messageId !== undefined)) throw new ApiError(400, "照合結果を確認してください");
    const saved = await reconcileVerification(db(), { id: path[1], actorId: id, staffRevision, marker: input.marker,
      outcome: input.outcome as "Sent" | "NotSent", messageId: typeof input.messageId === "string" ? input.messageId : null, now: Date.now() });
    if (!saved) throw new ApiError(409, "投稿状態・識別番号を再確認してください。未送信の確定には旧ワーカー停止とChatworkトークン無効化の運用確認が必要です");
    return reply({ saved: true });
  }
  if (path[0] === "verifications" && path[1] && path[2] === "confirm" && path.length === 3 && method === "POST") {
    await requireRoomManager(id);
    const input = await value(request), row = await current(); expected(input, row);
    if (!await confirmVerification(db(), { id: path[1], actorId: id, staffRevision, expectedVersion: row.version, now: Date.now() }))
      throw new ApiError(409, "投稿結果と送信先を再確認してください");
    return reply(detail(await current()));
  }
  if (route === "oauth/start" && method === "POST") {
    credentials();
    const state = randomSecret(), verifier = randomSecret(48), now = Date.now();
    const inserted = await db().prepare("INSERT INTO chatwork_production_oauth_attempts (state_hash,actor_id,verifier_cipher,expires_at,created_at) SELECT ?,?,?,?,? FROM app_users WHERE id=? AND active=1 AND role IN ('normal','field') AND staff_revision=?")
      .bind(await sha256(state), id, await seal(verifier, settings.CHATWORK_PRODUCTION_TOKEN_KEY!), now + 600_000, new Date().toISOString(), id, staffRevision).run();
    if (!inserted.meta.changes) { await actor(request); throw new ApiError(409, "職員の権限が変更されました"); }
    const response = reply({ authorizeUrl: authorizeUrl(settings.CHATWORK_PRODUCTION_CLIENT_ID!, CALLBACK, state, await sha256(verifier), {files:true}) });
    response.headers.set("set-cookie", `${COOKIE}=${state}; Path=/api/chatwork/production/oauth/callback; Max-Age=600; HttpOnly; Secure; SameSite=Lax`);
    return response;
  }
  if (route === "oauth/callback" && method === "GET") {
    credentials();
    const url = new URL(request.url), state = url.searchParams.get("state"), code = url.searchParams.get("code");
    if (!state || state !== cookieState(request)) throw new ApiError(403, "Chatwork接続を最初からやり直してください");
    if (url.searchParams.get("error")) throw new ApiError(400, "Chatworkへの接続が取り消されました");
    if (!code) throw new ApiError(400, "認証コードがありません");
    const now = Date.now(), hash = await sha256(state);
    const pending = await db().prepare("SELECT * FROM chatwork_production_oauth_attempts WHERE state_hash=? AND actor_id=? AND consumed_at IS NULL AND expires_at>?").bind(hash, id, now).first<any>();
    if (!pending) throw new ApiError(403, "Chatwork接続の期限が切れました");
    const consumed = await db().prepare("UPDATE chatwork_production_oauth_attempts SET consumed_at=? WHERE state_hash=? AND actor_id=? AND consumed_at IS NULL AND expires_at>?")
      .bind(new Date().toISOString(), hash, id, now).run();
    if (!consumed.meta.changes) throw new ApiError(409, "この認証は使用済みです");
    const verifier = await unseal(pending.verifier_cipher, settings.CHATWORK_PRODUCTION_TOKEN_KEY!);
    const tokens = await exchangeCode(settings.CHATWORK_PRODUCTION_CLIENT_ID!, settings.CHATWORK_PRODUCTION_CLIENT_SECRET!, CALLBACK, code, verifier);
    const me = await chatworkMe(tokens.accessToken), row = await current(), accountId = String(me.account_id);
    const saved = await connectAccount(db(), { actorId: id, staffRevision, expectedVersion: row.version, accountId, displayName: me.name,
      tokenCipher: await seal(JSON.stringify(tokens), settings.CHATWORK_PRODUCTION_TOKEN_KEY!), expiresAt: tokens.expiresAt,
      now: new Date().toISOString(), auditId: crypto.randomUUID() });
    if (!saved) { await actor(request); throw new ApiError(409, "設定が変更されました。再接続してください"); }
    return new Response(null, { status: 303, headers: { location: `${ORIGIN}/?chatwork=production-connected`, "set-cookie": `${COOKIE}=; Path=/api/chatwork/production/oauth/callback; Max-Age=0; HttpOnly; Secure; SameSite=Lax`, "cache-control": "no-store" } });
  }
  if (route === "account/confirm" && method === "POST") {
    const input = await value(request), row = await current();
    if (!row.account_id || input.accountId !== row.account_id) throw new ApiError(409, "表示された送信元と一致しません");
    if (row.account_confirmed) return reply(detail(row));
    expected(input, row);
    const confirmed = await confirmAccount(db(), { actorId: id, staffRevision, expectedVersion: row.version, accountId: row.account_id,
      now: new Date().toISOString(), auditId: crypto.randomUUID() });
    if (!confirmed) { await actor(request); throw new ApiError(409, "設定が変更されました"); }
    return reply(detail(await current()));
  }
  if (route === "room/preview" && method === "POST") {
    await requireRoomManager(id);
    const input = await value(request), row = await current(); expected(input, row);
    if (!row.account_confirmed) throw new ApiError(409, "送信元を先に確認してください");
    const roomId = String(input.roomId || "");
    if (!/^\d{1,20}$/.test(roomId)) throw new ApiError(400, "ChatworkのルームIDは数字で入力してください");
    const room = await chatworkRoom(await accessToken(), roomId);
    const refreshed = await current();
    if (refreshed.version !== row.version || refreshed.account_id !== row.account_id) throw new ApiError(409, "接続情報が変更されました");
    const candidateId = crypto.randomUUID(), expiresAt = Date.now() + 600_000;
    const inserted = await db().prepare("INSERT INTO chatwork_room_candidates (id,actor_id,account_id,expected_version,room_id,room_name,expires_at,created_at) SELECT ?,?,?,?,?,?,?,? FROM chatwork_production_settings s JOIN app_users u ON u.id=? WHERE s.id='production' AND s.version=? AND s.account_id=? AND s.account_confirmed=1 AND u.active=1 AND u.role='field' AND u.staff_revision=?")
      .bind(candidateId, id, row.account_id, row.version, roomId, room.name, expiresAt, new Date().toISOString(), id, row.version, row.account_id, staffRevision).run();
    if (!inserted.meta.changes) { await actor(request); throw new ApiError(409, "接続情報または職員の権限が変更されました"); }
    return reply({ candidateId, roomId, roomName: room.name, expiresAt: new Date(expiresAt).toISOString() });
  }
  if (route === "room/confirm" && method === "POST") {
    await requireRoomManager(id);
    const input = await value(request), row = await current(); expected(input, row);
    if (typeof input.candidateId !== "string") throw new ApiError(400, "確認対象が不正です");
    const candidate = await db().prepare("SELECT * FROM chatwork_room_candidates WHERE id=? AND actor_id=? AND consumed_at IS NULL AND expires_at>?")
      .bind(input.candidateId, id, Date.now()).first<any>();
    if (!candidate || candidate.account_id !== row.account_id || candidate.expected_version !== row.version) throw new ApiError(409, "候補の期限が切れたか、設定が変更されました");
    const confirmed = await confirmRoom(db(), { actorId: id, staffRevision, expectedVersion: row.version, candidateId: input.candidateId,
      now: new Date().toISOString(), nowMs: Date.now(), auditId: crypto.randomUUID() });
    if (!confirmed) { await actor(request); throw new ApiError(409, "設定が変更されました"); }
    return reply(detail(await current()));
  }
  return reply({ error: "操作がありません" }, 404);
}
async function handle(request: Request, context: Context) { try { return await api(request, (await context.params).path); } catch (error) { return failure(error); } }
export const GET = handle;
export const POST = handle;
