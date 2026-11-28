import { env } from "cloudflare:workers";
import { safeRelativeReturnPath } from "@/app/chatgpt-auth";
import {
  buildGoogleAuthUrl,
  generateRandomToken,
  isSecureOrigin,
  oauthTxCookie,
  pkceChallenge,
  resolveAppOrigin,
} from "@/lib/google-oidc-core.mjs";
import { createOAuthState } from "@/lib/idle-session";

function configErrorPage(): Response {
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>KIIYA 見落としチェッカー｜認証設定エラー</title><style>
    body{font-family:system-ui,sans-serif;background:#e9ece5;color:#123b36;min-height:100vh;display:grid;place-items:center;margin:0;padding:20px;box-sizing:border-box}
    main{background:white;border:1px solid #d5ddd8;border-radius:18px;padding:32px;width:100%;max-width:480px;box-sizing:border-box;box-shadow:0 10px 32px #0001}
    h1{font-size:1.35rem;margin:0 0 12px}p{line-height:1.7}a{color:#123b36}
  </style></head><body><main><h1>Google 認証が未設定です</h1><p>管理者に Worker の環境変数（GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET）の設定を確認するよう依頼してください。</p><p><a href="/session">ログイン画面へ戻る</a></p></main></body></html>`;
  return new Response(html, {
    status: 503,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

export async function GET(request: Request) {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return configErrorPage();

  const requestUrl = new URL(request.url);
  const returnTo = safeRelativeReturnPath(requestUrl.searchParams.get("return_to") ?? "/");
  const origin = resolveAppOrigin(request.url, env.APP_ORIGIN);
  const redirectUri = `${origin}/auth/google/callback`;
  const secure = isSecureOrigin(origin);

  const state = generateRandomToken(32);
  const browserToken = generateRandomToken(32);
  const nonce = generateRandomToken(32);
  const codeVerifier = generateRandomToken(48);
  const codeChallenge = await pkceChallenge(codeVerifier);

  await createOAuthState({ state, browserToken, nonce, codeVerifier, returnTo });

  return new Response(null, {
    status: 302,
    headers: {
      Location: buildGoogleAuthUrl({ clientId, redirectUri, state, nonce, codeChallenge }),
      "Set-Cookie": oauthTxCookie(browserToken, secure),
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
