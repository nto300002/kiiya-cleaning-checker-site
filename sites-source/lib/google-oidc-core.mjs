export const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const GOOGLE_JWKS_URI = "https://www.googleapis.com/oauth2/v3/certs";
export const GOOGLE_ISSUERS = new Set([
  "https://accounts.google.com",
  "accounts.google.com",
]);
export const OAUTH_TX_COOKIE = "kiiya_checker_oidc_tx";
export const OAUTH_TX_TTL_MS = 10 * 60 * 1000;
const CLOCK_SKEW_SEC = 60;

let cachedJwks = null;
let cachedJwksExpiresAtMs = 0;

export function base64UrlEncode(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function base64UrlDecode(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("Invalid base64url string");
  }
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function generateRandomToken(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}

export async function pkceChallenge(codeVerifier) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier));
  return base64UrlEncode(new Uint8Array(digest));
}

export function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) diff |= aBytes[i] ^ bBytes[i];
  return diff === 0;
}

export function resolveAppOrigin(requestUrl, configuredOrigin) {
  const candidate = typeof configuredOrigin === "string" ? configuredOrigin.trim() : "";
  if (candidate) return new URL(candidate).origin;
  return new URL(requestUrl).origin;
}

export function isSecureOrigin(originOrUrl) {
  try {
    const url = new URL(originOrUrl);
    if (url.protocol === "https:") return true;
    const host = url.hostname.toLowerCase();
    return !(host === "localhost" || host === "127.0.0.1" || host === "::1");
  } catch {
    return true;
  }
}

export function buildGoogleAuthUrl({ clientId, redirectUri, state, nonce, codeChallenge }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
}

export async function fetchGoogleJwks({ forceRefresh = false, fetcher = fetch, nowMs = Date.now() } = {}) {
  if (!forceRefresh && cachedJwks && nowMs < cachedJwksExpiresAtMs) return cachedJwks;
  const response = await fetcher(GOOGLE_JWKS_URI, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Google JWKS fetch failed (${response.status})`);
  const body = await response.json();
  if (!body || !Array.isArray(body.keys)) throw new Error("Invalid Google JWKS payload");
  const cacheControl = response.headers.get("cache-control") ?? "";
  const maxAgeMatch = /max-age=(\d+)/i.exec(cacheControl);
  const ttlSec = maxAgeMatch ? Math.min(Math.max(Number(maxAgeMatch[1]), 60), 21600) : 3600;
  cachedJwks = body;
  cachedJwksExpiresAtMs = nowMs + ttlSec * 1000;
  return body;
}

export function clearJwksCache() {
  cachedJwks = null;
  cachedJwksExpiresAtMs = 0;
}

export async function exchangeGoogleCode({ code, codeVerifier, clientId, clientSecret, redirectUri, fetcher = fetch }) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    code_verifier: codeVerifier,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
  });
  const response = await fetcher(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
    signal: AbortSignal.timeout(15000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || typeof payload.id_token !== "string") {
    throw new Error(`Google token exchange failed (${response.status})`);
  }
  return payload;
}

function decodeJwtPart(segment) {
  return JSON.parse(new TextDecoder().decode(base64UrlDecode(segment)));
}

export async function verifyGoogleIdToken(idToken, { clientId, expectedNonce, jwks, nowSec = Math.floor(Date.now() / 1000) }) {
  if (typeof idToken !== "string") throw new Error("ID token is required");
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("Malformed JWT");
  const [headerSeg, payloadSeg, sigSeg] = parts;
  const header = decodeJwtPart(headerSeg);
  const payload = decodeJwtPart(payloadSeg);

  if (header?.alg !== "RS256" || typeof header?.kid !== "string" || !header.kid) {
    throw new Error("Unsupported JWT algorithm or missing kid");
  }
  const jwk = jwks?.keys?.find(k => k && k.kid === header.kid && k.kty === "RSA" && (!k.use || k.use === "sig"));
  if (!jwk) {
    const err = new Error("Signing key not found in JWKS");
    err.code = "JWKS_KID_NOT_FOUND";
    throw err;
  }

  const cryptoKey = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const validSignature = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    base64UrlDecode(sigSeg),
    new TextEncoder().encode(`${headerSeg}.${payloadSeg}`),
  );
  if (!validSignature) throw new Error("Invalid ID token signature");
  if (!GOOGLE_ISSUERS.has(payload?.iss)) throw new Error("Invalid issuer");
  const aud = payload?.aud;
  const audMatches = Array.isArray(aud) ? aud.includes(clientId) && payload?.azp === clientId : aud === clientId;
  if (!audMatches) throw new Error("Invalid audience");
  if (typeof payload?.exp !== "number" || nowSec >= payload.exp + CLOCK_SKEW_SEC) throw new Error("ID token expired");
  if (typeof payload?.nbf === "number" && nowSec + CLOCK_SKEW_SEC < payload.nbf) throw new Error("ID token not yet valid");
  if (typeof payload?.iat === "number" && payload.iat > nowSec + CLOCK_SKEW_SEC) throw new Error("ID token issued in the future");
  if (!expectedNonce || !constantTimeEqual(String(payload?.nonce ?? ""), expectedNonce)) throw new Error("Nonce mismatch");
  if (typeof payload?.sub !== "string" || !payload.sub.trim()) throw new Error("Missing sub claim");
  if (typeof payload?.email !== "string" || !payload.email.trim()) throw new Error("Missing email claim");
  if (payload?.email_verified !== true) throw new Error("Email address is not verified");

  const email = payload.email.trim();
  const fullName = typeof payload.name === "string" && payload.name.trim() ? payload.name.trim() : null;
  return { sub: payload.sub.trim(), email, fullName, displayName: fullName ?? email };
}

export async function verifyGoogleIdTokenWithAutoRefresh(idToken, { clientId, expectedNonce, fetcher = fetch, nowMs = Date.now() }) {
  const nowSec = Math.floor(nowMs / 1000);
  let jwks = await fetchGoogleJwks({ forceRefresh: false, fetcher, nowMs });
  try {
    return await verifyGoogleIdToken(idToken, { clientId, expectedNonce, jwks, nowSec });
  } catch (error) {
    if (error?.code !== "JWKS_KID_NOT_FOUND") throw error;
    jwks = await fetchGoogleJwks({ forceRefresh: true, fetcher, nowMs });
    return await verifyGoogleIdToken(idToken, { clientId, expectedNonce, jwks, nowSec });
  }
}

export function oauthTxCookie(token, secure = true) {
  return `${OAUTH_TX_COOKIE}=${token}; Path=/auth/google; Max-Age=${Math.floor(OAUTH_TX_TTL_MS / 1000)}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export function clearOauthTxCookie(secure = true) {
  return `${OAUTH_TX_COOKIE}=; Path=/auth/google; Max-Age=0; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}
