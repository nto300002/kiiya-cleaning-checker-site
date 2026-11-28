import handler from "vinext/server/fetch-handler";
import { runWithConnectorBinding } from "../lib/connector-context";
import type { ConnectorBinding } from "../lib/connector-contract.mjs";

function stripLegacySitesAuthHeaders(request: Request): Request {
  let hasLegacyHeader = false;
  request.headers.forEach((_value, key) => {
    if (key.toLowerCase().startsWith("oai-authenticated-user-")) hasLegacyHeader = true;
  });
  if (!hasLegacyHeader) return request;
  const sanitizedHeaders = new Headers(request.headers);
  for (const key of Array.from(sanitizedHeaders.keys())) {
    if (key.toLowerCase().startsWith("oai-authenticated-user-")) sanitizedHeaders.delete(key);
  }
  return new Request(request, { headers: sanitizedHeaders });
}

const worker = {
  fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext<{ CONNECTORS?: ConnectorBinding }>) {
    const sanitizedRequest = stripLegacySitesAuthHeaders(request);
    let binding = ctx.props?.CONNECTORS;
    if (import.meta.env.DEV && !binding && env.CONNECTORS) {
      const preview = env.CONNECTORS;
      const expiresAt = Date.now() + 60_000;
      binding = {
        async getContext() {
          if (Date.now() >= expiresAt) return { status: "request_context_expired" };
          return preview.getContext?.() ?? { status: "binding_unavailable" };
        },
        async invoke(connectorId, actionName, args) {
          if (Date.now() >= expiresAt) {
            return { status: "request_context_expired", message: "This request has expired. Please try again." };
          }
          return preview.invoke(connectorId, actionName, args);
        },
      };
    }
    return runWithConnectorBinding(binding, () => handler.fetch(sanitizedRequest, env, ctx));
  },
};

export default worker;
