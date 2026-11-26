import { randomUUID } from "node:crypto";

function json(value, status = 200) { return Response.json(value, { status, headers: { "cache-control": "no-store" } }); }
function equal(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
function safeJobId(value) { return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }

export async function cloudTask(config, jobId, fetchImpl = fetch, suffix = "") {
  if (!safeJobId(jobId)) throw new Error("Invalid job id");
  const { queuePath, privateWorkerUrl, taskInvokerServiceAccount } = config;
  if (!/^projects\/[^/]+\/locations\/[^/]+\/queues\/[^/]+$/.test(queuePath) || !privateWorkerUrl.startsWith("https://") || !taskInvokerServiceAccount.includes("@")) throw new Error("Task configuration is incomplete");
  if (suffix && !/^[0-9a-f]{32}$/i.test(suffix)) throw new Error("Invalid task suffix");
  const taskName = `${queuePath}/tasks/kiiya-${jobId.replaceAll("-", "")}${suffix ? `-${suffix}` : ""}`;
  const metadata = await fetchImpl("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", { headers: { "Metadata-Flavor": "Google" }, signal: AbortSignal.timeout(5000) });
  if (!metadata.ok) throw new Error("Cloud Run credential unavailable");
  const { access_token: accessToken } = await metadata.json();
  const task = { task: { name: taskName, httpRequest: {
    httpMethod: "POST", url: new URL("/deliver", privateWorkerUrl).toString(),
    headers: { "Content-Type": "application/json" },
    body: Buffer.from(JSON.stringify({ jobId })).toString("base64"),
    oidcToken: { serviceAccountEmail: taskInvokerServiceAccount, audience: privateWorkerUrl },
  } } };
  const response = await fetchImpl(`https://cloudtasks.googleapis.com/v2/${queuePath}/tasks`, {
    method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify(task), signal: AbortSignal.timeout(10000),
  });
  if (response.status === 409) {
    const existing = await fetchImpl(`https://cloudtasks.googleapis.com/v2/${taskName}`, { headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10000) });
    if (existing.ok) return taskName;
    throw new Error(`Cloud Tasks conflict lookup failed (${existing.status})`);
  }
  if (!response.ok) throw new Error(`Cloud Tasks create failed (${response.status})`);
  const created = await response.json();
  return created.name || taskName;
}

// A deleted task can retain its name in Cloud Tasks deduplication. Verify the
// recorded task and use a fresh name only when it no longer exists.
export async function reconcileCloudTask(config, jobId, taskName, fetchImpl = fetch) {
  if (!safeJobId(jobId)) throw new Error("Invalid job id");
  {
    const expectedPrefix = `${config.queuePath}/tasks/kiiya-${jobId.replaceAll("-", "")}`;
    taskName ||= expectedPrefix;
    if (taskName !== expectedPrefix && !new RegExp(`^${expectedPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-[0-9a-f]{32}$`, "i").test(taskName)) throw new Error("Unexpected task name");
    const metadata = await fetchImpl("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", { headers: { "Metadata-Flavor": "Google" }, signal: AbortSignal.timeout(5000) });
    if (!metadata.ok) throw new Error("Cloud Run credential unavailable");
    const { access_token: accessToken } = await metadata.json();
    const task = await fetchImpl(`https://cloudtasks.googleapis.com/v2/${taskName}`, { headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10000) });
    if (task.ok) return taskName;
    if (task.status !== 404) throw new Error(`Cloud Tasks lookup failed (${task.status})`);
  }
  return cloudTask(config, jobId, fetchImpl, randomUUID().replaceAll("-", ""));
}

export function createHandler(config, dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl || fetch;
  const enqueueTask = dependencies.enqueueTask || ((jobId) => cloudTask(config, jobId, fetchImpl));
  const reconcileTask = dependencies.reconcileTask || ((jobId, taskName) => reconcileCloudTask(config, jobId, taskName, fetchImpl));
  const siteUrl = new URL("/api/chatwork/production/internal/", config.siteOrigin || "https://invalid.example");
  async function site(path, value) {
    let identityHeaders = {};
    if (config.siteIdentityAudience) {
      const url = new URL("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity");
      url.searchParams.set("audience", config.siteIdentityAudience);
      const metadata = await fetchImpl(url, { headers: { "Metadata-Flavor": "Google" }, signal: AbortSignal.timeout(5000) });
      if (!metadata.ok) throw new Error("Worker identity unavailable");
      identityHeaders = { "x-kiiya-worker-identity": await metadata.text() };
    }
    const response = await fetchImpl(new URL(path, siteUrl), { method: "POST", headers: { authorization: `Bearer ${config.sharedSecret}`, "content-type": "application/json", ...identityHeaders, ...(config.siteAccessToken ? { "OAI-Sites-Authorization": `Bearer ${config.siteAccessToken}` } : {}) },
      body: JSON.stringify(value), signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Site ${path} failed (${response.status})`);
    return response.json();
  }
  async function deliver(jobId) {
    let job;
    try { job = await site("claim", { jobId }); }
    catch (error) {
      if (String(error).includes("(409)")) return new Response(null, { status: 204 });
      throw error;
    }
    if (job.kind === "ReportDelivery") return deliverReport(jobId, job);
    let outcome = { status: "Unknown", messageId: null, errorCode: "POST_RESULT_UNKNOWN" };
    try {
      const { accessToken } = await site("token", { jobId, leaseId: job.leaseId });
      // The expiry check limits ordinary delays; it cannot replace revoking a token
      // already obtained by a paused or compromised worker.
      if (!Number.isSafeInteger(job.leaseUntil) || Date.now() >= job.leaseUntil) throw new Error("Posting lease expired");
      const post = await fetchImpl(`https://api.chatwork.com/v2/rooms/${job.roomId}/messages`, {
        method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ body: job.body }), signal: AbortSignal.timeout(240000),
      });
      if ([401, 403, 429].includes(post.status)) outcome = { status: "Failed", messageId: null, errorCode: `CHATWORK_${post.status}` };
      else if (post.ok) {
        const result = await post.json();
        if (result.message_id) outcome = { status: "Sent", messageId: String(result.message_id), errorCode: null };
      }
    } catch { /* A transport failure after POST may have reached Chatwork. Never retry automatically. */ }
    await site("result", { jobId, leaseId: job.leaseId, ...outcome });
    return json({ status: outcome.status });
  }
  async function deliverReport(jobId, job) {
    if (!/^\d{1,20}$/.test(String(job.roomId)) || !Number.isSafeInteger(job.leaseUntil)) throw new Error("Invalid report lease");
    const context = { jobId, leaseId: job.leaseId };
    const preflight = await site("report/preflight", context);
    if (preflight.ready !== true) throw new Error("Report preflight unavailable");
    for (let count = 0; count < 24; count++) {
      const next = await site("report/next", context);
      if (next.done === true) { await site("report/complete", context); return json({status:"Sent"}); }
      if (typeof next.artifactId !== "string" || !["body","markdown","image","pdf"].includes(next.kind)) throw new Error("Invalid artifact");
      const item = {...context,artifactId:next.artifactId};
      const claim = await site("report/claim", item);
      if (claim.claimed !== true) throw new Error("Artifact claim rejected");
      let outcome = {status:"Unknown",messageId:null,errorCode:"POST_RESULT_UNKNOWN"};
      try {
        const payload = await site("report/payload", item);
        const {accessToken} = await site("token", item);
        if (Date.now() >= job.leaseUntil) throw new Error("Posting lease expired");
        let requestBody, headers={authorization:`Bearer ${accessToken}`}, endpoint;
        if (next.kind === "body") {
          if(typeof payload.body!=="string" || !payload.body || payload.body.length>65535) throw new Error("Invalid body");
          endpoint="messages";headers["content-type"]="application/x-www-form-urlencoded";requestBody=new URLSearchParams({body:payload.body});
        } else {
          if(typeof payload.base64!=="string" || typeof payload.fileName!=="string" || typeof payload.mime!=="string" || payload.base64.length>6666672) throw new Error("Invalid attachment");
          const bytes=Buffer.from(payload.base64,"base64");
          if(!bytes.length || bytes.length>5000000) throw new Error("Invalid attachment size");
          endpoint="files";requestBody=new FormData();requestBody.append("file",new Blob([bytes],{type:payload.mime}),payload.fileName);
        }
        const post=await fetchImpl(`https://api.chatwork.com/v2/rooms/${job.roomId}/${endpoint}`,{method:"POST",headers,body:requestBody,signal:AbortSignal.timeout(240000)});
        if([400,401,403,429].includes(post.status)) outcome={status:"Failed",messageId:null,errorCode:`CHATWORK_${post.status}`};
        else if(post.ok){const response=await post.json();const id=endpoint==="messages"?response.message_id:response.file_id;if(id)outcome={status:"Sent",messageId:String(id),errorCode:null};}
      } catch { /* Once claimed, an interrupted POST is always uncertain. */ }
      await site("report/result",{...item,...outcome});
      if(outcome.status!=="Sent") return json({status:outcome.status});
    }
    throw new Error("Too many report artifacts");
  }
  return async function handle(request) {
    try {
      const path = new URL(request.url).pathname;
      if (path === "/health" && request.method === "GET") return json({ ok: true });
      if (request.method !== "POST") return json({ error: "Not found" }, 404);
      const input = await request.json();
      if (config.mode === "dispatcher" && path === "/enqueue") {
        if (!equal(request.headers.get("authorization") || "", `Bearer ${config.sharedSecret}`)) return json({ error: "Forbidden" }, 403);
        if (!safeJobId(input?.jobId)) return json({ error: "Invalid job id" }, 400);
        return json({ taskName: await enqueueTask(input.jobId) });
      }
      if (config.mode === "worker" && path === "/deliver") {
        if (!safeJobId(input?.jobId)) return json({ error: "Invalid job id" }, 400);
        return await deliver(input.jobId);
      }
      if (config.mode === "worker" && path === "/monitor") {
        const { pendingJobs } = await site("monitor", {});
        for (const job of pendingJobs) {
          const taskName = await reconcileTask(job.id, job.taskName);
          await site("dispatch-record", { jobId: job.id, taskName });
        }
        await site("heartbeat", { workerRevision: config.workerRevision, siteRevision: config.siteRevision,
          approvalGeneration: config.approvalGeneration, monitorRunId: randomUUID(), monitorSucceeded: true });
        return json({ pending: pendingJobs.length });
      }
      return json({ error: "Not found" }, 404);
    } catch (error) {
      console.error("delivery_worker_failure", error instanceof Error ? error.message : "unknown");
      return json({ error: "Worker operation failed" }, 503);
    }
  };
}
