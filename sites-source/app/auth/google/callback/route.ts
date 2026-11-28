import { env } from "cloudflare:workers";
import { cookies } from "next/headers";
import { safeRelativeReturnPath } from "@/app/chatgpt-auth";
import {
  clearOauthTxCookie,
  exchangeGoogleCode,
  isSecureOrigin,
  OAUTH_TX_COOKIE,
  resolveAppOrigin,
  verifyGoogleIdTokenWithAutoRefresh,
} from "@/lib/google-oidc-core.mjs";
import {
  consumeOAuthState,
  endSession,
  resolveMappedUserId,
  sessionCookie,
  startSession,
} from "@/lib/idle-session";

function errorRedirect(origin: string, code: string, secure: boolean): Response {
  return new Response(null, {
    status: 303,
    headers: {
      Location: `${origin}/session?error=${encodeURIComponent(code)}`,
      "Set-Cookie": clearOauthTxCookie(secure),
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(request: Request) {
  const origin = resolveAppOrigin(request.url, env.APP_ORIGIN);
  const secure = isSecureOrigin(origin);
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return errorRedirect(origin, "oauth_not_configured", secure);

  const url = new URL(request.url);
  if (url.searchParams.get("error")) return errorRedirect(origin, "google_denied", secure);

  const code = url.searchParams.get("code")?.trim() ?? "";
  const state = url.searchParams.get("state")?.trim() ?? "";
  const browserToken = (await cookies()).get(OAUTH_TX_COOKIE)?.value ?? "";
  if (!code || !state || !browserToken) return errorRedirect(origin, "invalid_state", secure);

  const tx = await consumeOAuthState({ state, browserToken });
  if (!tx) return errorRedirect(origin, "invalid_state", secure);

  try {
    const redirectUri = `${origin}/auth/google/callback`;
    const tokens = await exchangeGoogleCode({ code, codeVerifier: tx.codeVerifier, clientId, clientSecret, redirectUri });
    const verified = await verifyGoogleIdTokenWithAutoRefresh(tokens.id_token, { clientId, expectedNonce: tx.nonce });

    const userId = await resolveMappedUserId(verified.sub);
    await endSession();
    const sessionToken = await startSession({ userId, email: verified.email, displayName: verified.displayName });
    const returnTo = safeRelativeReturnPath(tx.returnTo);

    const headers = new Headers({
      Location: new URL(returnTo, origin).toString(),
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    });
    headers.append("Set-Cookie", clearOauthTxCookie(secure));
    headers.append("Set-Cookie", sessionCookie(sessionToken, secure));
    return new Response(null, { status: 303, headers });
  } catch (error) {
    console.error("Google OIDC callback failed", error instanceof Error ? error.message : "unknown");
    return errorRedirect(origin, "auth_failed", secure);
  }
}
