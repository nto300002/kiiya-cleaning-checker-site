const GOOGLE_KEYS = "https://www.googleapis.com/oauth2/v3/certs";
function decodePart(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid token encoding");
  const decoded = atob(value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4));
  return Uint8Array.from(decoded, c => c.charCodeAt(0));
}
export async function verifyWorkerIdentity(token: string, audience: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  try {
    if (!audience || token.length > 8192) return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const header = JSON.parse(new TextDecoder().decode(decodePart(parts[0])));
    const payload = JSON.parse(new TextDecoder().decode(decodePart(parts[1])));
    const now = Math.floor(Date.now() / 1000);
    if (header.alg !== "RS256" || typeof header.kid !== "string" || !["https://accounts.google.com", "accounts.google.com"].includes(payload.iss)
      || payload.aud !== audience || typeof payload.sub !== "string" || !/^\d{1,32}$/.test(payload.sub)
      || !Number.isInteger(payload.exp) || payload.exp <= now || !Number.isInteger(payload.iat) || payload.iat > now + 60) return null;
    const response = await fetchImpl(GOOGLE_KEYS, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return null;
    const body = await response.json() as { keys?: Array<JsonWebKey & { kid?: string }> };
    const key = body.keys?.find(k => k.kid === header.kid && k.kty === "RSA" && (!k.alg || k.alg === "RS256") && (!k.use || k.use === "sig"));
    if (!key) return null;
    const publicKey = await crypto.subtle.importKey("jwk", key, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    return await crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, decodePart(parts[2]) as BufferSource, new TextEncoder().encode(`${parts[0]}.${parts[1]}`)) ? payload.sub : null;
  } catch { return null; }
}
