import assert from "node:assert/strict";
import { test } from "node:test";
import { authorizeUrl, chatworkMe, chatworkRoom, completedOAuthRedirect, postTestMessage, seal, unseal } from "../lib/chatwork.ts";

test("GET /me identifies the account and GET /rooms binds the displayed room name to the entered ID", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (input, init) => {
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer token");
      if (input === "https://api.chatwork.com/v2/me") return Response.json({ account_id: 42, name: "担当者" });
      assert.equal(input, "https://api.chatwork.com/v2/rooms/123");
      return Response.json({ room_id: 123, name: "業務ルーム" });
    };
    assert.deepEqual(await chatworkMe("token"), { account_id: 42, name: "担当者" });
    assert.equal((await chatworkRoom("token", "123")).name, "業務ルーム");
    globalThis.fetch = async () => Response.json({ room_id: 999, name: "別ルーム" });
    await assert.rejects(chatworkRoom("token", "123"));
  } finally { globalThis.fetch = original; }
});

test("OAuth consent URL requests only the scopes required for the connection smoke test", () => {
  const url = new URL(authorizeUrl("client", "https://example.com/callback", "state", "challenge"));
  assert.equal(url.origin, "https://www.chatwork.com");
  assert.equal(url.searchParams.get("state"), "state");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("scope"), "users.profile.me:read rooms.info:read rooms.messages:write offline_access");
});

test("OAuth callback creates a 303 response with the cookie cleared", () => {
  const response = completedOAuthRedirect("https://example.com", "state=; Max-Age=0; HttpOnly");
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "https://example.com/?chatwork=connected");
  assert.equal(response.headers.get("set-cookie"), "state=; Max-Age=0; HttpOnly");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("stored OAuth tokens require the correct AES key", async () => {
  const key = Buffer.alloc(32, 7).toString("base64url");
  const wrong = Buffer.alloc(32, 8).toString("base64url");
  const cipher = await seal("refresh-secret", key);
  assert.notEqual(cipher.includes("refresh-secret"), true);
  assert.equal(await unseal(cipher, key), "refresh-secret");
  await assert.rejects(unseal(cipher, wrong));
});

test("smoke post sends form body to the selected room and reads message ID", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (input, init) => {
      assert.equal(input, "https://api.chatwork.com/v2/rooms/123/messages");
      assert.equal(init?.method, "POST");
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer token");
      assert.equal(new URLSearchParams(String(init?.body)).get("body"), "test marker");
      return Response.json({ message_id: "456" });
    };
    assert.equal(await postTestMessage("token", "123", "test marker"), "456");
  } finally {
    globalThis.fetch = original;
  }
});

test('production authorization requests file upload permission without changing smoke scopes',()=>{
 const url=new URL(authorizeUrl('client','https://example.com/callback','state','challenge',{files:true}));
 assert.equal(url.searchParams.get('scope'),'users.profile.me:read rooms.info:read rooms.messages:write rooms.files:write offline_access');
});

test('file delivery requires an explicitly granted file scope',async()=>{
 const {hasChatworkFileScope}=await import('../lib/chatwork.ts');
 assert.equal(hasChatworkFileScope(undefined),false);
 assert.equal(hasChatworkFileScope('users.profile.me:read rooms.messages:write'),false);
 assert.equal(hasChatworkFileScope('rooms.messages:write rooms.files:write offline_access'),true);
});

test('OAuth scope is saved and explicit scope changes on refresh are honored',async()=>{
 const {exchangeCode,refreshToken}=await import('../lib/chatwork.ts');const original=globalThis.fetch;
 try{
  globalThis.fetch=async()=>Response.json({access_token:'a',refresh_token:'r',expires_in:1800,scope:'rooms.files:write'});
  assert.equal((await exchangeCode('c','s','https://site/callback','code','verifier')).scope,'rooms.files:write');
  globalThis.fetch=async()=>Response.json({access_token:'b',refresh_token:'r2',expires_in:1800});
  assert.equal((await refreshToken('c','s','r','rooms.files:write')).scope,'rooms.files:write');
  globalThis.fetch=async()=>Response.json({access_token:'b',refresh_token:'r2',expires_in:1800,scope:'rooms.messages:write'});
  assert.equal((await refreshToken('c','s','r','rooms.files:write')).scope,'rooms.messages:write');
 }finally{globalThis.fetch=original}
});
