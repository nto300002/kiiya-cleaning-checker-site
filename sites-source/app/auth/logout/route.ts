import { env } from "cloudflare:workers";
import { isSecureOrigin, resolveAppOrigin } from "@/lib/google-oidc-core.mjs";
import { clearSessionCookie, endSession } from "@/lib/idle-session";

export async function POST(request: Request) {
  const origin = resolveAppOrigin(request.url, env.APP_ORIGIN);
  const requestOrigin = request.headers.get("origin");
  if (requestOrigin && requestOrigin !== origin && requestOrigin !== new URL(request.url).origin) {
    return new Response("Invalid origin", { status: 403 });
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && !["same-origin", "same-site", "none"].includes(fetchSite)) {
    return new Response("Cross-site logout rejected", { status: 403 });
  }
  const secure = isSecureOrigin(origin);
  await endSession();
  return new Response(null, {
    status: 303,
    headers: {
      Location: `${origin}/signed-out`,
      "Set-Cookie": clearSessionCookie(secure),
      "Cache-Control": "no-store",
    },
  });
}
