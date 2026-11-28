import { generateRandomToken, sha256Hex, OAUTH_TX_TTL_MS } from "./google-oidc-core.mjs";

export const IDLE_LIMIT_MS = 12 * 60 * 60 * 1000;

export async function getActiveSession(db, token, now = Date.now()) {
  if (!token) return null;
  const row = await db.prepare(
    "SELECT user_id, email, display_name, last_activity_ms FROM app_sessions WHERE token_hash = ?",
  )
    .bind(await sha256Hex(token))
    .first();
  if (!row || !row.user_id || row.last_activity_ms <= now - IDLE_LIMIT_MS) return null;
  const email = typeof row.email === "string" ? row.email : "";
  const displayName = typeof row.display_name === "string" && row.display_name ? row.display_name : email || row.user_id;
  return { userId: row.user_id, email, displayName, expiresAt: row.last_activity_ms + IDLE_LIMIT_MS };
}

export async function sessionExpiresAt(db, token, now = Date.now()) {
  const session = await getActiveSession(db, token, now);
  return session ? session.expiresAt : null;
}

export async function startSession(db, identity, now = Date.now()) {
  const userId = typeof identity === "string" ? identity : identity.userId;
  const email = typeof identity === "string" ? "" : (identity.email ?? "");
  const displayName = typeof identity === "string" ? "" : (identity.displayName ?? email);
  const token = generateRandomToken(32);
  await db.prepare(
    "INSERT INTO app_sessions (token_hash, user_id, email, display_name, last_activity_ms, created_at_ms) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(await sha256Hex(token), userId, email, displayName, now, now)
    .run();
  return token;
}

export async function touchSession(db, token, now = Date.now()) {
  if (!token) return false;
  const result = await db.prepare(
    "UPDATE app_sessions SET last_activity_ms = ? WHERE token_hash = ? AND last_activity_ms > ?",
  )
    .bind(now, await sha256Hex(token), now - IDLE_LIMIT_MS)
    .run();
  return (result.meta?.changes ?? 0) === 1;
}

export async function endSession(db, token) {
  if (!token) return;
  await db.prepare("DELETE FROM app_sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
}

export async function revokeUserSessions(db, userId) {
  if (!userId) return;
  await db.prepare("DELETE FROM app_sessions WHERE user_id = ?").bind(userId).run();
}

export async function createOAuthState(db, { state, browserToken, nonce, codeVerifier, returnTo }, now = Date.now()) {
  const expiresAtMs = now + OAUTH_TX_TTL_MS;
  await db.batch([
    db.prepare("DELETE FROM oauth_states WHERE expires_at_ms <= ?").bind(now),
    db.prepare(
      `INSERT INTO oauth_states (state_hash, browser_token_hash, nonce, code_verifier, return_to, expires_at_ms, created_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(await sha256Hex(state), await sha256Hex(browserToken), nonce, codeVerifier, returnTo, expiresAtMs, now),
  ]);
}

export async function consumeOAuthState(db, { state, browserToken }, now = Date.now()) {
  if (!state || !browserToken) return null;
  const stateHash = await sha256Hex(state);
  const browserTokenHash = await sha256Hex(browserToken);
  const row = await db.prepare(
    "SELECT nonce, code_verifier, return_to, expires_at_ms FROM oauth_states WHERE state_hash = ? AND browser_token_hash = ?",
  )
    .bind(stateHash, browserTokenHash)
    .first();
  if (!row) return null;
  const deleted = await db.prepare(
    "DELETE FROM oauth_states WHERE state_hash = ? AND browser_token_hash = ? AND expires_at_ms > ?",
  )
    .bind(stateHash, browserTokenHash, now)
    .run();
  if ((deleted.meta?.changes ?? 0) !== 1 || row.expires_at_ms <= now) {
    await db.prepare("DELETE FROM oauth_states WHERE state_hash = ?").bind(stateHash).run();
    return null;
  }
  return { nonce: row.nonce, codeVerifier: row.code_verifier, returnTo: row.return_to };
}

export async function resolveMappedUserId(db, googleSub) {
  const mapped = await db.prepare("SELECT user_id FROM staff_identities WHERE google_sub = ?").bind(googleSub).first();
  return typeof mapped?.user_id === "string" && mapped.user_id ? mapped.user_id : googleSub;
}
