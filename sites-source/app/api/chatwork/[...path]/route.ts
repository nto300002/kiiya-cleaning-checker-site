import { env } from "cloudflare:workers";
import { getAuthenticatedUser } from "@/app/chatgpt-auth";
import { resolveAppOrigin } from "@/lib/google-oidc-core.mjs";
import { hasStaffAccess } from "@/lib/staff-access";
import { authorizeUrl, chatworkMe, chatworkRoom, ChatworkHttpError, completedOAuthRedirect, exchangeCode, postTestMessage, randomSecret, refreshToken, seal, sha256, unseal, type TokenBundle } from "@/lib/chatwork";

export const runtime = "edge";
type Context = { params: Promise<{ path: string[] }> };
type SmokeEnv = { DB?: D1Database; APP_ENV?: string; APP_ORIGIN?: string; CHATWORK_SMOKE_ENABLED?: string; CHATWORK_SMOKE_EXPIRES_AT?: string; CHATWORK_SMOKE_CLIENT_ID?: string; CHATWORK_SMOKE_CLIENT_SECRET?: string; CHATWORK_SMOKE_TOKEN_KEY?: string; CHATWORK_SMOKE_ROOM_ID?: string; APP_STAFF_USER_IDS?: string };
const settings = env as unknown as SmokeEnv;
function configuredOrigin(request: Request): string { return resolveAppOrigin(request.url, settings.APP_ORIGIN); }
function callbackUrl(request: Request): string { return `${configuredOrigin(request)}/api/chatwork/oauth/callback`; }
const COOKIE = "kiiya_chatwork_oauth_state";
class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
function db(): D1Database { if (!settings.DB) throw new ApiError(503, "D1が未設定です"); return settings.DB; }
function response(data: unknown, status = 200): Response { return Response.json(data, { status, headers: { "cache-control": "no-store" } }); }
function errorReply(error: unknown): Response {
  if (error instanceof ApiError) return response({ error: error.message }, error.status);
  if (error instanceof SyntaxError) return response({ error: "JSONが不正です" }, 400);
  if (error instanceof ChatworkHttpError) {
    const message = error.status === 401 ? "Chatwork認証が失効しました" : error.status === 403 ? "Chatworkのルーム権限がありません" : error.status === 429 ? "Chatworkの利用制限に達しました" : "Chatworkの処理に失敗しました";
    return response({ error: message, code: `CHATWORK_${error.status}` }, error.status === 429 ? 429 : error.status >= 400 && error.status < 500 ? 502 : 503);
  }
  console.error("chatwork_failure", error instanceof Error ? error.name : "unknown");
  return response({ error: "Chatwork接続の処理に失敗しました" }, 500);
}
async function itUser(_request: Request): Promise<string> {
  const user = await getAuthenticatedUser();
  const id = user?.userId ?? null;
  if (!id) throw new ApiError(401, "サインインが必要です");
  if (!await hasStaffAccess(db(), settings.APP_STAFF_USER_IDS, id)) throw new ApiError(403, "このアカウントは利用できません");
  const userRow = await db().prepare("SELECT active,role FROM app_users WHERE id=?").bind(id).first<{ active: number; role: string }>();
  if (!userRow?.active || userRow.role !== "field") throw new ApiError(403, "現場職員だけが操作できます");
  return id;
}
function enabled(): boolean {
  const until = Date.parse(settings.CHATWORK_SMOKE_EXPIRES_AT || "");
  return settings.APP_ENV === "production" && settings.CHATWORK_SMOKE_ENABLED === "true" && Number.isFinite(until) && until > Date.now();
}
function configured(): boolean { return !!(settings.CHATWORK_SMOKE_CLIENT_ID && settings.CHATWORK_SMOKE_CLIENT_SECRET && settings.CHATWORK_SMOKE_TOKEN_KEY && /^\d+$/.test(settings.CHATWORK_SMOKE_ROOM_ID || "")); }
function guard(request: Request): void {
  if (!enabled() || !configured()) throw new ApiError(503, "検証用Chatwork接続は無効です");
  if (new URL(request.url).origin !== configuredOrigin(request)) throw new ApiError(403, "SiteのURLが一致しません");
}
function mutationGuard(request: Request): void {
  guard(request);
  if (request.headers.get("origin") !== configuredOrigin(request)) throw new ApiError(403, "送信元が一致しません");
}
async function json(request: Request): Promise<Record<string, unknown>> {
  const value = await request.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(400, "入力が不正です");
  return value as Record<string, unknown>;
}
async function connection(): Promise<any> { return db().prepare("SELECT * FROM chatwork_smoke_connection WHERE id='smoke'").first<any>(); }
function safeConnection(row: any): Record<string, unknown> {
  return { enabled: enabled(), configured: configured(), status: row?.status || "Disconnected", accountId: row?.account_id || null,
    displayName: row?.display_name || null, accountConfirmed: !!row?.account_confirmed, roomId: row?.room_id || null,
    roomName: row?.room_name || null, roomConfirmed: !!row?.room_confirmed, lastVerifiedAt: row?.last_verified_at || null,
    expiresAt: settings.CHATWORK_SMOKE_EXPIRES_AT || null };
}
function cookieState(request: Request): string | null {
  const found = request.headers.get("cookie")?.split(";").map(x => x.trim()).find(x => x.startsWith(COOKIE + "="));
  return found ? found.slice(COOKIE.length + 1) : null;
}
function clearCookie(): string { return `${COOKIE}=; Path=/api/chatwork/oauth/callback; Max-Age=0; HttpOnly; Secure; SameSite=Lax`; }
async function accessToken(): Promise<string> {
  let row = await connection();
  if (!row?.token_cipher || ["Disconnected", "ReconnectRequired"].includes(row.status)) throw new ApiError(409, "Chatworkの再接続が必要です");
  let tokens = JSON.parse(await unseal(row.token_cipher, settings.CHATWORK_SMOKE_TOKEN_KEY!)) as TokenBundle;
  if (tokens.expiresAt > Date.now() + 60_000) return tokens.accessToken;
  const now = Date.now(), leaseUntil = now + 20_000;
  const locked = await db().prepare("UPDATE chatwork_smoke_connection SET refresh_lease_until=?,revision=revision+1 WHERE id='smoke' AND revision=? AND (refresh_lease_until IS NULL OR refresh_lease_until<?)")
    .bind(leaseUntil, row.revision, now).run();
  if (!locked.meta.changes) throw new ApiError(409, "トークン更新中です。再試行してください");
  try {
    tokens = await refreshToken(settings.CHATWORK_SMOKE_CLIENT_ID!, settings.CHATWORK_SMOKE_CLIENT_SECRET!, tokens.refreshToken);
    const cipher = await seal(JSON.stringify(tokens), settings.CHATWORK_SMOKE_TOKEN_KEY!);
    const saved = await db().prepare("UPDATE chatwork_smoke_connection SET token_cipher=?,token_expires_at=?,refresh_lease_until=NULL,revision=revision+1,updated_at=? WHERE id='smoke' AND revision=? AND refresh_lease_until=?")
      .bind(cipher, tokens.expiresAt, new Date().toISOString(), row.revision + 1, leaseUntil).run();
    if (!saved.meta.changes) throw new Error("Token update conflict");
    return tokens.accessToken;
  } catch {
    await db().prepare("UPDATE chatwork_smoke_connection SET status='ReconnectRequired',refresh_lease_until=NULL,updated_at=? WHERE id='smoke' AND revision=? AND refresh_lease_until=?")
      .bind(new Date().toISOString(), row.revision + 1, leaseUntil).run();
    throw new ApiError(409, "トークンを更新できません。職員が再接続してください");
  }
}
async function api(request: Request, path: string[]): Promise<Response> {
  const method = request.method;
  const actor = await itUser(request);
  guard(request);
  if (method === "GET" && path.length === 1 && path[0] === "connection") return response(safeConnection(await connection()));
  if (method === "GET" && path.length === 1 && path[0] === "posts") {
    const rows = await db().prepare("SELECT request_id,marker,status,message_id,error_code,created_at,updated_at FROM chatwork_smoke_posts ORDER BY created_at DESC LIMIT 20").all<any>();
    return response(rows.results);
  }
  if (method === "POST" && path.join("/") === "oauth/start") {
    mutationGuard(request);
    const state = randomSecret(), verifier = randomSecret(48), hash = await sha256(state), challenge = await sha256(verifier);
    const now = Date.now();
    await db().prepare("INSERT INTO chatwork_oauth_attempts (state_hash,actor_id,verifier_cipher,expires_at,created_at) VALUES (?,?,?,?,?)")
      .bind(hash, actor, await seal(verifier, settings.CHATWORK_SMOKE_TOKEN_KEY!), now + 600_000, new Date().toISOString()).run();
    const reply = response({ authorizeUrl: authorizeUrl(settings.CHATWORK_SMOKE_CLIENT_ID!, callbackUrl(request), state, challenge) });
    reply.headers.set("set-cookie", `${COOKIE}=${state}; Path=/api/chatwork/oauth/callback; Max-Age=600; HttpOnly; Secure; SameSite=Lax`);
    return reply;
  }
  if (method === "GET" && path.join("/") === "oauth/callback") {
    guard(request);
    const url = new URL(request.url), state = url.searchParams.get("state"), code = url.searchParams.get("code");
    if (!state || state !== cookieState(request)) throw new ApiError(403, "OAuthの状態が一致しません");
    if (url.searchParams.get("error")) throw new ApiError(400, "Chatworkの認可が取り消されました");
    if (!code) throw new ApiError(400, "OAuthコードがありません");
    const hash = await sha256(state), now = Date.now();
    const pending = await db().prepare("SELECT * FROM chatwork_oauth_attempts WHERE state_hash=? AND actor_id=? AND consumed_at IS NULL AND expires_at>?").bind(hash, actor, now).first<any>();
    if (!pending) throw new ApiError(403, "OAuthの開始記録が無効です");
    const consumed = await db().prepare("UPDATE chatwork_oauth_attempts SET consumed_at=? WHERE state_hash=? AND actor_id=? AND consumed_at IS NULL AND expires_at>?")
      .bind(new Date().toISOString(), hash, actor, now).run();
    if (!consumed.meta.changes) throw new ApiError(409, "OAuthコードは使用済みです");
    const verifier = await unseal(pending.verifier_cipher, settings.CHATWORK_SMOKE_TOKEN_KEY!);
    const tokens = await exchangeCode(settings.CHATWORK_SMOKE_CLIENT_ID!, settings.CHATWORK_SMOKE_CLIENT_SECRET!, callbackUrl(request), code, verifier);
    const me = await chatworkMe(tokens.accessToken), current = await connection(), nowText = new Date().toISOString();
    const same = current?.account_id === String(me.account_id);
    const cipher = await seal(JSON.stringify(tokens), settings.CHATWORK_SMOKE_TOKEN_KEY!);
    if (!current) {
      await db().prepare("INSERT INTO chatwork_smoke_connection (id,revision,account_id,display_name,account_confirmed,room_confirmed,token_cipher,token_expires_at,status,updated_at) VALUES ('smoke',1,?,?,0,0,?,?,'AccountConfirmationRequired',?)")
        .bind(String(me.account_id), me.name, cipher, tokens.expiresAt, nowText).run();
    } else {
      const updated = await db().prepare("UPDATE chatwork_smoke_connection SET revision=revision+1,account_id=?,display_name=?,account_confirmed=?,room_id=?,room_name=?,room_confirmed=0,token_cipher=?,token_expires_at=?,refresh_lease_until=NULL,status=?,updated_at=? WHERE id='smoke' AND revision=?")
        .bind(String(me.account_id), me.name, same ? current.account_confirmed : 0, same ? current.room_id : null, same ? current.room_name : null,
          cipher, tokens.expiresAt, same && current.account_confirmed ? "DestinationVerificationRequired" : "AccountConfirmationRequired", nowText, current.revision).run();
      if (!updated.meta.changes) throw new ApiError(409, "接続が競合しました。再接続してください");
    }
    return completedOAuthRedirect(configuredOrigin(request), clearCookie());
  }
  if (method === "POST" && path.join("/") === "account/confirm") {
    mutationGuard(request);
    const value = await json(request), row = await connection();
    if (!row?.account_id || value.accountId !== row.account_id) throw new ApiError(409, "ChatworkアカウントIDが一致しません");
    const updated = await db().prepare("UPDATE chatwork_smoke_connection SET account_confirmed=1,status='DestinationVerificationRequired',revision=revision+1,updated_at=? WHERE id='smoke' AND revision=?")
      .bind(new Date().toISOString(), row.revision).run();
    if (!updated.meta.changes) throw new ApiError(409, "接続が競合しました");
    return response(safeConnection(await connection()));
  }
  if (method === "POST" && path.join("/") === "disconnect") {
    mutationGuard(request);
    const row = await connection();
    if (row) {
      const updated = await db().prepare("UPDATE chatwork_smoke_connection SET revision=revision+1,account_id=NULL,display_name=NULL,account_confirmed=0,room_id=NULL,room_name=NULL,room_confirmed=0,token_cipher=NULL,token_expires_at=NULL,refresh_lease_until=NULL,status='Disconnected',last_verified_at=NULL,updated_at=? WHERE id='smoke' AND revision=?")
        .bind(new Date().toISOString(), row.revision).run();
      if (!updated.meta.changes) throw new ApiError(409, "接続が競合しました");
    }
    return response(safeConnection(await connection()));
  }
  if (method === "POST" && path.join("/") === "room/verify") {
    mutationGuard(request);
    const value = await json(request), roomId = String(value.roomId || ""), row = await connection();
    if (!row?.account_confirmed) throw new ApiError(409, "送信元アカウントを先に確認してください");
    if (!/^\d+$/.test(roomId) || roomId !== settings.CHATWORK_SMOKE_ROOM_ID) throw new ApiError(403, "この検証用ルーム以外は指定できません");
    const room = await chatworkRoom(await accessToken(), roomId), current = await connection();
    if (current.account_id !== row.account_id) throw new ApiError(409, "送信元が変わりました。再確認してください");
    const result = await db().prepare("UPDATE chatwork_smoke_connection SET room_id=?,room_name=?,room_confirmed=1,status='TestPostRequired',revision=revision+1,updated_at=? WHERE id='smoke' AND revision=? AND account_confirmed=1 AND account_id=?")
      .bind(roomId, room.name, new Date().toISOString(), current.revision, row.account_id).run();
    if (!result.meta.changes) throw new ApiError(409, "設定が競合しました");
    return response(safeConnection(await connection()));
  }
  if (method === "POST" && path.join("/") === "smoke/test-message") {
    mutationGuard(request);
    const value = await json(request), requestId = value.requestId;
    if (typeof requestId !== "string" || !/^[a-f0-9-]{36}$/i.test(requestId)) throw new ApiError(400, "テスト識別子が不正です");
    const row = await connection();
    if (!row?.account_confirmed || !row.room_confirmed || row.room_id !== settings.CHATWORK_SMOKE_ROOM_ID) throw new ApiError(409, "検証用の送信元・ルームが未確認です");
    const marker = `KIIYA-TEST-${requestId}`, now = new Date().toISOString();
    const inserted = await db().prepare("INSERT OR IGNORE INTO chatwork_smoke_posts (request_id,actor_id,marker,status,created_at,updated_at) VALUES (?,?,?,'Posting',?,?)")
      .bind(requestId, actor, marker, now, now).run();
    if (!inserted.meta.changes) {
      const previous = await db().prepare("SELECT request_id,marker,status,message_id,error_code FROM chatwork_smoke_posts WHERE request_id=?").bind(requestId).first<any>();
      return response(previous, previous?.status === "Sent" ? 200 : 202);
    }
    let postStarted = false;
    try {
      const token = await accessToken();
      postStarted = true;
      const messageId = await postTestMessage(token, row.room_id, `[info][title]KIIYA接続試験[/title]個人情報を含まないテスト投稿です。\n識別子: ${marker}[/info]`);
      const saved = await db().prepare("UPDATE chatwork_smoke_posts SET status='Sent',message_id=?,updated_at=? WHERE request_id=? AND status='Posting'")
        .bind(messageId, new Date().toISOString(), requestId).run();
      if (!saved.meta.changes) throw new Error("Test post state conflict");
      try {
        await db().prepare("UPDATE chatwork_smoke_connection SET status='SmokeVerified',last_verified_at=?,revision=revision+1,updated_at=? WHERE id='smoke' AND room_id=? AND account_id=? AND room_confirmed=1")
          .bind(new Date().toISOString(), new Date().toISOString(), row.room_id, row.account_id).run();
      } catch (error) {
        console.error("chatwork_smoke_verification_state_update_failed", error instanceof Error ? error.name : "unknown");
      }
      return response({ requestId, marker, messageId, status: "Sent" });
    } catch (error) {
      const knownFailure = error instanceof ChatworkHttpError || !postStarted;
      await db().prepare("UPDATE chatwork_smoke_posts SET status=?,error_code=?,updated_at=? WHERE request_id=? AND status='Posting'")
        .bind(knownFailure ? "Failed" : "Unknown", error instanceof ChatworkHttpError ? `CHATWORK_${error.status}` : postStarted ? "RESPONSE_UNKNOWN" : "PRE_SEND_FAILED", new Date().toISOString(), requestId).run();
      if (error instanceof ChatworkHttpError && error.status === 401) await db().prepare("UPDATE chatwork_smoke_connection SET status='ReconnectRequired',updated_at=? WHERE id='smoke'").bind(new Date().toISOString()).run();
      if (error instanceof ChatworkHttpError && error.status === 403) await db().prepare("UPDATE chatwork_smoke_connection SET status='DestinationVerificationRequired',room_confirmed=0,updated_at=? WHERE id='smoke'").bind(new Date().toISOString()).run();
      if (knownFailure) throw error;
      return response({ requestId, marker, status: "Unknown", note: "Chatwork画面で識別子を照合してください。自動再送はしません" }, 202);
    }
  }
  throw new ApiError(404, "操作がありません");
}
async function handle(request: Request, context: Context): Promise<Response> {
  try { return await api(request, (await context.params).path); } catch (error) { return errorReply(error); }
}
export const GET = handle;
export const POST = handle;
