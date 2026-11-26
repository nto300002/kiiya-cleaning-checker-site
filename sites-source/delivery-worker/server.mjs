import { createServer } from "node:http";
import { createHandler } from "./handler.mjs";

const config = {
  mode: process.env.DELIVERY_MODE,
  siteOrigin: process.env.SITE_ORIGIN,
  siteAccessToken: process.env.SITE_ACCESS_TOKEN,
  siteIdentityAudience: process.env.SITE_IDENTITY_AUDIENCE,
  approvalGeneration: Number(process.env.APPROVAL_GENERATION),
  sharedSecret: process.env.DELIVERY_WORKER_SHARED_SECRET,
  queuePath: process.env.CLOUD_TASKS_QUEUE_PATH,
  privateWorkerUrl: process.env.PRIVATE_WORKER_URL,
  taskInvokerServiceAccount: process.env.TASK_INVOKER_SERVICE_ACCOUNT,
  workerRevision: process.env.WORKER_REVISION,
  siteRevision: process.env.SITE_REVISION,
};
if (!["dispatcher", "worker"].includes(config.mode) || !config.sharedSecret || config.sharedSecret.length < 24 || !config.siteOrigin?.startsWith("https://")) throw new Error("Delivery configuration is incomplete");
if (config.mode === "worker" && (!config.siteIdentityAudience || !Number.isSafeInteger(config.approvalGeneration) || config.approvalGeneration < 1)) throw new Error("Worker identity configuration is incomplete");
const handle = createHandler(config);
createServer(async (incoming, outgoing) => {
  const chunks = [];
  for await (const chunk of incoming) chunks.push(chunk);
  const request = new Request(`http://localhost${incoming.url}`, { method: incoming.method, headers: incoming.headers,
    body: incoming.method === "GET" ? undefined : Buffer.concat(chunks) });
  const response = await handle(request);
  outgoing.writeHead(response.status, Object.fromEntries(response.headers));
  outgoing.end(Buffer.from(await response.arrayBuffer()));
}).listen(Number(process.env.PORT || 8080), "0.0.0.0");
