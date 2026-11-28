import { env } from "cloudflare:workers";
import { googleSignInPath, safeRelativeReturnPath } from "@/app/chatgpt-auth";
import { isSecureOrigin, resolveAppOrigin } from "@/lib/google-oidc-core.mjs";
import { clearSessionCookie, getActiveSession } from "@/lib/idle-session";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

function errorMessageFor(code: string | null): string | null {
  if (!code) return null;
  if (code === "google_denied") return "Google アカウントでのログインがキャンセルされました。もう一度お試しください。";
  if (code === "invalid_state") return "ログインの有効期限が切れたか、状態が一致しませんでした。もう一度お試しください。";
  if (code === "oauth_not_configured") return "Google 認証の設定が未完了です。管理者へご連絡ください。";
  return "ログインの確認に失敗しました。時間をおいてもう一度お試しください。";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const returnTo = safeRelativeReturnPath(url.searchParams.get("return_to") ?? "/");
  const origin = resolveAppOrigin(request.url, env.APP_ORIGIN);
  const secure = isSecureOrigin(origin);

  if (await getActiveSession()) {
    return Response.redirect(new URL(returnTo, origin), 303);
  }

  const errorMessage = errorMessageFor(url.searchParams.get("error"));
  const oauthReady = Boolean(env.GOOGLE_CLIENT_ID?.trim() && env.GOOGLE_CLIENT_SECRET?.trim());
  const siteTitle = "KIIYA 見落としチェッカー";
  const signInHref = escapeHtml(googleSignInPath(returnTo));
  const noticeHtml = errorMessage
    ? `<p class="notice error" role="alert">${escapeHtml(errorMessage)}</p>`
    : `<p>KIIYA 見落としチェッカーを利用するには、許可された Google アカウントでログインしてください。</p>`;
  const actionHtml = oauthReady
    ? `<a class="login-btn" href="${signInHref}">Google アカウントでログイン</a>`
    : `<p class="notice warn">Google 認証環境変数（GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET）が未設定のためログインできません。</p>`;

  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${siteTitle}｜Google アカウントでログイン</title><style>
    body{--accent:#123b36;font-family:system-ui,sans-serif;background:#e9ece5;color:#123b36;min-height:100vh;display:grid;place-items:center;margin:0;padding:20px;box-sizing:border-box}
    main{background:white;border:1px solid #d5ddd8;border-radius:18px;padding:32px;width:100%;max-width:440px;box-sizing:border-box;box-shadow:0 18px 60px rgba(18,59,54,.12)}
    .site-brand{display:flex;align-items:center;gap:12px;padding-bottom:20px;margin-bottom:22px;border-bottom:1px solid #e7ebe8}
    .brand-mark{display:grid;place-items:center;width:40px;height:40px;border-radius:10px;background:var(--accent);color:white;font-weight:800;font-size:1.1rem}
    .site-title{font-weight:800;font-size:1.1rem}
    h1{font-size:1.35rem;margin:0 0 14px}p{line-height:1.7;margin:0 0 18px;color:#4a5d57}
    .notice{padding:12px 14px;border-radius:10px;font-size:.95rem}
    .notice.error{background:#fef2f2;color:#991b1b;border:1px solid #fecaca}
    .notice.warn{background:#fffbeb;color:#92400e;border:1px solid #fde68a}
    .login-btn{display:inline-flex;align-items:center;justify-content:center;background:var(--accent);color:white;text-decoration:none;border:0;border-radius:10px;padding:12px 22px;font:inherit;font-weight:700;min-height:44px;box-sizing:border-box}
    .login-btn:focus-visible{outline:3px solid #e8ad81;outline-offset:3px}
  </style></head><body><main><div class="site-brand"><span class="brand-mark">K</span><span class="site-title">${siteTitle}</span></div><h1>Google アカウントでログイン</h1>${noticeHtml}${actionHtml}</main></body></html>`;

  const response = new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
  response.headers.set("Set-Cookie", clearSessionCookie(secure));
  return response;
}
