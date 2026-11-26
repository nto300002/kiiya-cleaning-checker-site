export type TokenBundle = { accessToken: string; refreshToken: string; expiresAt: number; scope?:string };
export function hasChatworkFileScope(scope:string|undefined):boolean{return typeof scope==='string'&&scope.split(/\s+/).includes('rooms.files:write')}
export class ChatworkHttpError extends Error {
  status: number;
  constructor(status: number) { super(`Chatwork HTTP ${status}`); this.status = status; }
}
const encoder = new TextEncoder();
const decoder = new TextDecoder();
function base64url(bytes: Uint8Array): string {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function fromBase64url(value: string): Uint8Array {
  const raw = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, char => char.charCodeAt(0));
}
export function randomSecret(bytes = 32): string { return base64url(crypto.getRandomValues(new Uint8Array(bytes))); }
export async function sha256(value: string): Promise<string> { return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)))); }
export async function seal(value: string, encodedKey: string): Promise<string> {
  const keyBytes = fromBase64url(encodedKey);
  if (keyBytes.length !== 32) throw new Error("CHATWORK_SMOKE_TOKEN_KEY must be 32 bytes");
  const key = await crypto.subtle.importKey("raw", new Uint8Array(keyBytes).buffer, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: new Uint8Array(iv).buffer }, key, encoder.encode(value)));
  return `v1.${base64url(iv)}.${base64url(ciphertext)}`;
}
export async function unseal(cipher: string, encodedKey: string): Promise<string> {
  const [version, ivText, payload] = cipher.split(".");
  if (version !== "v1" || !ivText || !payload) throw new Error("Invalid ciphertext");
  const keyBytes = fromBase64url(encodedKey);
  if (keyBytes.length !== 32) throw new Error("Invalid encryption key");
  const key = await crypto.subtle.importKey("raw", new Uint8Array(keyBytes).buffer, "AES-GCM", false, ["decrypt"]);
  const clear = await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(fromBase64url(ivText)).buffer }, key, new Uint8Array(fromBase64url(payload)).buffer);
  return decoder.decode(clear);
}
export function authorizeUrl(clientId: string, redirectUri: string, state: string, challenge: string, options: {files?:boolean} = {}): string {
  const url = new URL("https://www.chatwork.com/packages/oauth2/login.php");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", `users.profile.me:read rooms.info:read rooms.messages:write ${options.files ? "rooms.files:write " : ""}offline_access`);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}
export function completedOAuthRedirect(origin: string, stateCookie: string): Response {
  return new Response(null, {
    status: 303,
    headers: {
      location: `${origin}/?chatwork=connected`,
      "set-cookie": stateCookie,
      "cache-control": "no-store",
    },
  });
}
async function tokenRequest(clientId: string, clientSecret: string, params: URLSearchParams): Promise<any> {
  const basic = btoa(`${clientId}:${clientSecret}`);
  const response = await fetch("https://oauth.chatwork.com/token", {
    method: "POST", headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: params, cache: "no-store", signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new ChatworkHttpError(response.status);
  return await response.json();
}
function bundle(value: any, previousRefresh?: string, previousScope?:string): TokenBundle {
  if (typeof value.access_token !== "string" || !(typeof value.refresh_token === "string" || previousRefresh) || !Number.isFinite(Number(value.expires_in))) throw new Error("Invalid Chatwork token response");
  const scope=typeof value.scope==='string'?value.scope:previousScope;
  return { accessToken: value.access_token, refreshToken: value.refresh_token || previousRefresh!, expiresAt: Date.now() + Number(value.expires_in) * 1000,...(scope?{scope}:{}) };
}
export async function exchangeCode(clientId: string, clientSecret: string, redirectUri: string, code: string, verifier: string): Promise<TokenBundle> {
  return bundle(await tokenRequest(clientId, clientSecret, new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: verifier })));
}
export async function refreshToken(clientId: string, clientSecret: string, refresh: string, previousScope?:string): Promise<TokenBundle> {
  return bundle(await tokenRequest(clientId, clientSecret, new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh })), refresh,previousScope);
}
async function chatworkResponse(accessToken: string, path: string, init?: RequestInit): Promise<any> {
  const response = await fetch(`https://api.chatwork.com/v2/${path}`, {
    ...init, headers: { ...init?.headers, authorization: `Bearer ${accessToken}` }, cache: "no-store", signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new ChatworkHttpError(response.status);
  return await response.json();
}
export async function chatworkMe(token: string): Promise<{ account_id: number; name: string }> {
  const value = await chatworkResponse(token, "me");
  if (!Number.isInteger(Number(value.account_id)) || typeof value.name !== "string") throw new Error("Invalid Chatwork account response");
  return value;
}
export async function chatworkRoom(token: string, roomId: string): Promise<{ room_id: number; name: string }> {
  const value = await chatworkResponse(token, `rooms/${roomId}`);
  if (typeof value.name !== "string" || value.room_id !== undefined && String(value.room_id) !== roomId) throw new Error("Invalid Chatwork room response");
  return value;
}
export async function postTestMessage(token: string, roomId: string, body: string): Promise<string> {
  const value = await chatworkResponse(token, `rooms/${roomId}/messages`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ body }),
  });
  if (!value.message_id) throw new Error("Chatwork response has no message_id");
  return String(value.message_id);
}
