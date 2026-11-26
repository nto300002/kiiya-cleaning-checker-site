import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyWorkerIdentity } from "../lib/worker-identity.ts";

const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
test("Google identity validation verifies signature, issuer, audience, expiry and subject", async () => {
  const keys = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
  const fetchKeys = async () => Response.json({ keys: [{ ...jwk, kid: "key-1", alg: "RS256", use: "sig" }] });
  const now = Math.floor(Date.now()/1000);
  const token = async (claims: Record<string, unknown>) => {
    const input = `${encode({ alg: "RS256", kid: "key-1" })}.${encode({ iss: "https://accounts.google.com", aud: "site-audience", sub: "123456", iat: now, exp: now + 60, ...claims })}`;
    const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, new TextEncoder().encode(input));
    return `${input}.${Buffer.from(sig).toString("base64url")}`;
  };
  assert.equal(await verifyWorkerIdentity(await token({}), "site-audience", fetchKeys), "123456");
  for (const claims of [{ aud: "other" }, { exp: now - 1 }, { iss: "https://evil.test" }, { sub: "not-numeric" }]) assert.equal(await verifyWorkerIdentity(await token(claims), "site-audience", fetchKeys), null);
  const valid = await token({});
  const parts = valid.split("."); parts[1] = encode({ iss: "https://accounts.google.com", aud: "site-audience", sub: "999", iat: now, exp: now+60 });
  assert.equal(await verifyWorkerIdentity(parts.join("."), "site-audience", fetchKeys), null);
  assert.equal(await verifyWorkerIdentity(valid, "site-audience", async () => new Response(null, { status: 503 })), null);
});
