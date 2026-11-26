import assert from "node:assert/strict";
import { test } from "node:test";
import { createHandler } from "../handler.mjs";

const id = "00000000-0000-4000-8000-000000000001";
const config = { mode: "dispatcher", siteOrigin: "https://site.example", sharedSecret: "a-local-test-secret-very-long", workerRevision: "worker-1", siteRevision: "site-1" };
function request(path, data, auth) { return new Request(`http://localhost${path}`, { method: "POST", headers: auth ? { authorization: auth } : undefined, body: JSON.stringify(data) }); }

test("dispatcher enqueues only an authenticated fixed job id", async () => {
  const calls = [];
  const handle = createHandler(config, { enqueueTask: async value => { calls.push(value); return "fixed-task"; } });
  assert.equal((await handle(request("/enqueue", { jobId: id }))).status, 403);
  assert.equal((await handle(request("/enqueue", { jobId: "other" }, `Bearer ${config.sharedSecret}`))).status, 400);
  const response = await handle(request("/enqueue", { jobId: id }, `Bearer ${config.sharedSecret}`));
  assert.deepEqual(await response.json(), { taskName: "fixed-task" });
  assert.deepEqual(calls, [id]);
});

test("worker records the one Chatwork message id returned by the fixed destination", async () => {
  const calls = [];
  const handle = createHandler({ ...config, mode: "worker" }, { fetchImpl: async (url, init) => {
    const path = new URL(url).pathname;
    calls.push(path);
    if (path.endsWith("/claim")) return Response.json({ leaseId: "lease-1", roomId: "123", body: "確認文", leaseUntil: Date.now() + 300000 });
    if (path.endsWith("/token")) return Response.json({ accessToken: "access" });
    if (path === "/v2/rooms/123/messages") {
      assert.equal(init.headers.authorization, "Bearer access");
      return Response.json({ message_id: "message-1" });
    }
    if (path.endsWith("/result")) {
      assert.deepEqual(JSON.parse(init.body), { jobId: id, leaseId: "lease-1", status: "Sent", messageId: "message-1", errorCode: null });
      return Response.json({ saved: true });
    }
    throw new Error("Unexpected request");
  } });
  assert.equal((await handle(request("/deliver", { jobId: id }))).status, 200);
  assert.deepEqual(calls, ["/api/chatwork/production/internal/claim", "/api/chatwork/production/internal/token", "/v2/rooms/123/messages", "/api/chatwork/production/internal/result"]);
});

test("lost Chatwork response is Unknown and never triggers a second POST", async () => {
  let posts = 0, saved;
  const handle = createHandler({ ...config, mode: "worker" }, { fetchImpl: async (url, init) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/claim")) return Response.json({ leaseId: "lease-1", roomId: "123", body: "確認文", leaseUntil: Date.now() + 300000 });
    if (path.endsWith("/token")) return Response.json({ accessToken: "access" });
    if (path === "/v2/rooms/123/messages") { posts++; throw new Error("response lost"); }
    if (path.endsWith("/result")) { saved = JSON.parse(init.body); return Response.json({ saved: true }); }
    throw new Error("Unexpected request");
  } });
  assert.equal((await handle(request("/deliver", { jobId: id }))).status, 200);
  assert.equal(posts, 1);
  assert.equal(saved.status, "Unknown");
});

test("monitor enqueues pending intent before reporting a healthy heartbeat", async () => {
  const calls = [];
  const handle = createHandler({ ...config, mode: "worker" }, { reconcileTask: async jobId => { calls.push(`task:${jobId}`); return "task"; }, fetchImpl: async (url, init) => {
    const path = new URL(url).pathname;
    calls.push(path);
    if (path.endsWith("/monitor")) return Response.json({ pendingJobs: [{ id, taskName: null }] });
    if (path.endsWith("/dispatch-record")) return Response.json({ saved: true });
    if (path.endsWith("/heartbeat")) { assert.equal(JSON.parse(init.body).monitorSucceeded, true); return Response.json({ receivedAt: "now" }); }
    throw new Error("Unexpected request");
  } });
  assert.equal((await handle(request("/monitor", {}))).status, 200);
  assert.deepEqual(calls, ["/api/chatwork/production/internal/monitor", `task:${id}`, "/api/chatwork/production/internal/dispatch-record", "/api/chatwork/production/internal/heartbeat"]);
});

test("claim conflict acknowledges only a known duplicate; temporary failures are retried", async () => {
  for (const [status, expected] of [[409, 204], [503, 503]]) {
    const handle = createHandler({ ...config, mode: "worker" }, { fetchImpl: async () => Response.json({ error: "claim unavailable" }, { status }) });
    assert.equal((await handle(request("/deliver", { jobId: id }))).status, expected);
  }
});

test("monitor reconciles missing tasks and persists a new task name", async () => {
  const saved = [];
  const handle = createHandler({ ...config, mode: "worker" }, {
    reconcileTask: async (jobId, taskName) => { assert.equal(jobId, id); assert.equal(taskName, "old-task"); return "new-task"; },
    fetchImpl: async (url, init) => {
      const path = new URL(url).pathname;
      if (path.endsWith("/monitor")) return Response.json({ pendingJobs: [{ id, taskName: "old-task" }] });
      if (path.endsWith("/dispatch-record")) { saved.push(JSON.parse(init.body)); return Response.json({ saved: true }); }
      if (path.endsWith("/heartbeat")) return Response.json({});
      throw new Error("unexpected");
    },
  });
  assert.equal((await handle(request("/monitor", {}))).status, 200);
  assert.deepEqual(saved, [{ jobId: id, taskName: "new-task" }]);
});

test("reconciliation preserves existing tasks and replaces missing tasks with fresh names", async () => {
  const { reconcileCloudTask } = await import("../handler.mjs");
  const cfg = { queuePath: "projects/p/locations/l/queues/q", privateWorkerUrl: "https://worker.example", taskInvokerServiceAccount: "worker@example.com" };
  const old = `${cfg.queuePath}/tasks/kiiya-${id.replaceAll("-", "")}`;
  for (const exists of [true, false]) {
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      calls.push([String(url), init.method]);
      if (String(url).includes("metadata.google")) return Response.json({ access_token: "local" });
      if (init.method === "POST") return Response.json({});
      return new Response(null, { status: exists ? 200 : 404 });
    };
    const name = await reconcileCloudTask(cfg, id, old, fetchImpl);
    assert.equal(name === old, exists);
    assert.equal(calls.filter(([, method]) => method === "POST").length, exists ? 0 : 1);
  }
});


test("Site access credential is sent only to the Site, not Chatwork", async () => {
  const handle = createHandler({ ...config, mode: "worker", siteAccessToken: "site-token" }, { fetchImpl: async (url, init) => {
    const host = new URL(url).host, path = new URL(url).pathname;
    if (host === "site.example") assert.equal(init.headers["OAI-Sites-Authorization"], "Bearer site-token");
    if (path.endsWith("/claim")) return Response.json({ leaseId: "lease", roomId: "123", body: "test", leaseUntil: Date.now() + 300000 });
    if (path.endsWith("/token")) return Response.json({ accessToken: "cw-token" });
    if (host === "api.chatwork.com") { assert.equal(init.headers["OAI-Sites-Authorization"], undefined); return Response.json({ message_id: "1" }); }
    if (path.endsWith("/result")) return Response.json({ saved: true });
    throw new Error("unexpected request");
  } });
  assert.equal((await handle(request("/deliver", { jobId: id }))).status, 200);
});

test("missing recorded task checks deterministic initial task before creating another", async () => {
  const { reconcileCloudTask } = await import("../handler.mjs");
  const cfg = { queuePath: "projects/p/locations/l/queues/q", privateWorkerUrl: "https://worker.example", taskInvokerServiceAccount: "worker@example.com" };
  const calls = [];
  const result = await reconcileCloudTask(cfg, id, null, async (url, init = {}) => {
    calls.push([String(url), init.method]);
    if (String(url).includes("metadata.google")) return Response.json({ access_token: "local" });
    if (init.method === "POST") throw new Error("must not create");
    return Response.json({ name: "existing" });
  });
  assert.equal(result, `${cfg.queuePath}/tasks/kiiya-${id.replaceAll("-", "")}`);
  assert.equal(calls.filter(([,method]) => method === "POST").length, 0);
});

test("task name conflict cannot be accepted without verifying that task exists", async () => {
  const { cloudTask } = await import("../handler.mjs");
  const cfg = { queuePath: "projects/p/locations/l/queues/q", privateWorkerUrl: "https://worker.example", taskInvokerServiceAccount: "worker@example.com" };
  await assert.rejects(() => cloudTask(cfg, id, async (url, init = {}) => {
    if (String(url).includes("metadata.google")) return Response.json({ access_token: "local" });
    return new Response(null, { status: init.method === "POST" ? 409 : 404 });
  }));
});

test("worker obtains audience-bound identity and attaches it only to Site requests", async () => {
  const seen = [];
  const handle = createHandler({ ...config, mode: "worker", siteIdentityAudience: "https://site.example/internal", approvalGeneration: 2 }, { fetchImpl: async (url, init = {}) => {
    const parsed = new URL(url);
    if (parsed.hostname === "metadata.google.internal") {
      assert.equal(parsed.searchParams.get("audience"), "https://site.example/internal");
      assert.equal(init.headers["Metadata-Flavor"], "Google");
      return new Response("signed-identity");
    }
    if (parsed.hostname === "site.example") {
      assert.equal(init.headers["x-kiiya-worker-identity"], "signed-identity");
      seen.push(parsed.pathname);
      if (parsed.pathname.endsWith("/claim")) return Response.json({ leaseId: "lease", roomId: "123", body: "test", leaseUntil: Date.now() + 300000 });
      if (parsed.pathname.endsWith("/token")) return Response.json({ accessToken: "cw" });
      return Response.json({ saved: true });
    }
    assert.equal(init.headers["x-kiiya-worker-identity"], undefined);
    return Response.json({ message_id: "1" });
  } });
  assert.equal((await handle(request("/deliver", { jobId: id }))).status, 200);
  assert.equal(seen.length, 3);
});

test("missing task lookup failure never creates replacement", async () => {
  const { reconcileCloudTask } = await import("../handler.mjs");
  const cfg = { queuePath: "projects/p/locations/l/queues/q", privateWorkerUrl: "https://worker.example", taskInvokerServiceAccount: "worker@example.com" };
  let creates = 0;
  await assert.rejects(() => reconcileCloudTask(cfg, id, null, async (url, init = {}) => {
    if (String(url).includes("metadata.google")) return Response.json({ access_token: "local" });
    if (init.method === "POST") creates++;
    return new Response(null, { status: 503 });
  }));
  assert.equal(creates, 0);
});


test("expired lease after token retrieval does not start a Chatwork POST", async () => {
  let posts=0, saved;
  const handle=createHandler({ ...config, mode:'worker' }, { fetchImpl: async (url, init) => {
    const path=new URL(url).pathname;
    if (path.endsWith('/claim')) return Response.json({leaseId:'lease',roomId:'123',body:'test',leaseUntil:Date.now()-1});
    if (path.endsWith('/token')) return Response.json({accessToken:'cw'});
    if (path.endsWith('/result')) { saved=JSON.parse(init.body); return Response.json({saved:true}); }
    posts++; throw new Error('unexpected POST');
  } });
  assert.equal((await handle(request('/deliver',{jobId:id}))).status,200);
  assert.equal(posts,0);
  assert.equal(saved.status,'Unknown');
});

test('report worker sends body and attachment once in order and records distinct IDs',async()=>{
 const sequence=[], results=[],tokenArtifacts=[];let next=0;
 const handle=createHandler({...config,mode:'worker'},{fetchImpl:async(url,init)=>{
  const p=new URL(url).pathname;sequence.push(p);
  if(p==='/api/chatwork/production/internal/claim')return Response.json({kind:'ReportDelivery',leaseId:'lease',leaseUntil:Date.now()+60000,roomId:'123'});
  if(p.endsWith('/report/preflight'))return Response.json({ready:true});
  if(p.endsWith('/report/next'))return Response.json(next++===0?{artifactId:'a',kind:'body'}:next===2?{artifactId:'b',kind:'markdown'}:{done:true});
  if(p.endsWith('/report/claim'))return Response.json({claimed:true});
  if(p.endsWith('/report/payload'))return Response.json(JSON.parse(init.body).artifactId==='a'?{body:'テスト本文'}:{base64:Buffer.from('file').toString('base64'),fileName:'report.md',mime:'text/markdown'});
  if(p.endsWith('/token')){tokenArtifacts.push(JSON.parse(init.body).artifactId);return Response.json({accessToken:'token'});}
  if(p==='/v2/rooms/123/messages')return Response.json({message_id:'message-1'});
  if(p==='/v2/rooms/123/files'){assert.ok(init.body instanceof FormData);return Response.json({file_id:'file-1'});}
  if(p.endsWith('/report/result')){results.push(JSON.parse(init.body));return Response.json({saved:true});}
  if(p.endsWith('/report/complete'))return Response.json({saved:true});
  throw Error('unexpected');
 }});
 assert.equal((await handle(request('/deliver',{jobId:id}))).status,200);
 assert.deepEqual(results.map(x=>[x.artifactId,x.status,x.messageId]),[['a','Sent','message-1'],['b','Sent','file-1']]);
 assert.deepEqual(tokenArtifacts,['a','b']);
 assert.equal(sequence.filter(x=>x==='/v2/rooms/123/messages').length,1);
 assert.equal(sequence.filter(x=>x==='/v2/rooms/123/files').length,1);
});

test('report preflight failure or lost response never sends or retries another artifact',async()=>{
 for(const failure of ['preflight','lost']){let posts=0,next=0,saved;
 const handle=createHandler({...config,mode:'worker'},{fetchImpl:async(url,init)=>{
 const p=new URL(url).pathname;
 if(p==='/api/chatwork/production/internal/claim')return Response.json({kind:'ReportDelivery',leaseId:'lease',leaseUntil:Date.now()+60000,roomId:'123'});
 if(p.endsWith('/report/preflight'))return failure==='preflight'?Response.json({error:'oversize'},{status:409}):Response.json({ready:true});
 if(p.endsWith('/report/next')){next++;return Response.json({artifactId:'a',kind:'body'});}
 if(p.endsWith('/report/claim'))return Response.json({claimed:true});
 if(p.endsWith('/report/payload'))return Response.json({body:'test'});
 if(p.endsWith('/token'))return Response.json({accessToken:'token'});
 if(p==='/v2/rooms/123/messages'){posts++;throw Error('response lost');}
 if(p.endsWith('/report/result')){saved=JSON.parse(init.body);return Response.json({saved:true});}
 throw Error('unexpected');
 }});
 await handle(request('/deliver',{jobId:id}));
 assert.equal(posts,failure==='lost'?1:0);assert.equal(next,failure==='lost'?1:0);
 if(failure==='lost')assert.equal(saved.status,'Unknown');
 }
});

test('revocation after preparation cannot turn a late post into an automatic retry',async()=>{
 let posts=0,prepared=false,revoked=false,saved=false;
 const handler=createHandler({...config,mode:'worker'},{fetchImpl:async(url,init)=>{
  const p=new URL(url).pathname;
  if(p==='/api/chatwork/production/internal/claim')return Response.json({kind:'ReportDelivery',leaseId:'lease',leaseUntil:Date.now()+60000,roomId:'123'});
  if(p.endsWith('/report/preflight'))return Response.json({ready:true});
  if(p.endsWith('/report/next'))return Response.json({artifactId:'a',kind:'body'});
  if(p.endsWith('/report/claim')){prepared=true;return Response.json({claimed:true})}
  if(p.endsWith('/report/payload'))return Response.json({body:'test'});
  if(p.endsWith('/token')){revoked=true;return Response.json({accessToken:'old-token'})}
  if(p==='/v2/rooms/123/messages'){assert.equal(prepared&&revoked,true);posts++;return Response.json({message_id:'late'})}
  if(p.endsWith('/report/result')){saved=true;return Response.json({error:'revoked'},{status:409})}
  throw Error('unexpected');
 }});
 assert.equal((await handler(request('/deliver',{jobId:id}))).status,503);
 assert.equal(posts,1);assert.equal(saved,true);
});
