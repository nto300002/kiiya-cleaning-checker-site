import { env } from "cloudflare:workers";
import { cookies } from "next/headers";
import {
  IDLE_LIMIT_MS,
  getActiveSession as getActiveSessionInDb,
  sessionExpiresAt as sessionExpiresAtInDb,
  startSession as startSessionInDb,
  touchSession as touchSessionInDb,
  endSession as endSessionInDb,
  revokeUserSessions as revokeUserSessionsInDb,
  createOAuthState as createOAuthStateInDb,
  consumeOAuthState as consumeOAuthStateInDb,
  resolveMappedUserId as resolveMappedUserIdInDb,
} from "./idle-session-core.mjs";

export { IDLE_LIMIT_MS };
export const SESSION_COOKIE = "kiiya_checker_session";
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

export type ActiveSession = {
  userId: string;
  email: string;
  displayName: string;
  expiresAt: number;
};

function db(): D1Database {
  if (!env.DB) throw new Error("D1 binding DB unavailable");
  return env.DB;
}

async function requestToken(): Promise<string | null> {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}

export async function getActiveSession(): Promise<ActiveSession | null> {
  return getActiveSessionInDb(db(), await requestToken());
}

export async function sessionExpiresAt(): Promise<number | null> {
  return sessionExpiresAtInDb(db(), await requestToken());
}

export async function startSession(identity: { userId: string; email: string; displayName: string }): Promise<string> {
  return startSessionInDb(db(), identity);
}

export async function touchSession(): Promise<boolean> {
  return touchSessionInDb(db(), await requestToken());
}

export async function endSession(): Promise<void> {
  return endSessionInDb(db(), await requestToken());
}

export async function revokeUserSessions(userId: string): Promise<void> {
  return revokeUserSessionsInDb(db(), userId);
}

export async function createOAuthState(params: {
  state: string;
  browserToken: string;
  nonce: string;
  codeVerifier: string;
  returnTo: string;
}): Promise<void> {
  return createOAuthStateInDb(db(), params);
}

export async function consumeOAuthState(params: {
  state: string;
  browserToken: string;
}): Promise<{ nonce: string; codeVerifier: string; returnTo: string } | null> {
  return consumeOAuthStateInDb(db(), params);
}

export async function resolveMappedUserId(googleSub: string): Promise<string> {
  return resolveMappedUserIdInDb(db(), googleSub);
}

export function sessionCookie(token: string, secure = true): string {
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export function clearSessionCookie(secure = true): string {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}
