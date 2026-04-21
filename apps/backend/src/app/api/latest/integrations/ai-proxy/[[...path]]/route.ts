import { observeAndLog, sanitizeBody } from "@/lib/ai/ai-proxy-handlers";
import { handleApiRequest } from "@/route-handlers/smart-route-handler";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { captureError } from "@stackframe/stack-shared/dist/utils/errors";
import { NextRequest } from "next/server";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api";
const PRODUCTION_PROXY_BASE_URL = "https://api.stack-auth.com/api/latest/integrations/ai-proxy";

async function proxyToOpenRouter(req: NextRequest, options: { params: Promise<{ path?: string[] }> }) {
  const apiKey = getEnvVariable("STACK_OPENROUTER_API_KEY");
  const params = await options.params;
  const subpath = params.path?.join("/") ?? "";

  const contentType = req.headers.get("Content-Type");
  const sanitized = req.method !== "GET" && req.method !== "HEAD"
    ? sanitizeBody(await req.arrayBuffer())
    : undefined;
  const body = sanitized ? Buffer.from(sanitized.bytes) : undefined;
  const callerApiKey = req.headers.get("x-api-key");
  const shouldLog = sanitized != null && callerApiKey != null && callerApiKey.startsWith("stack-auth-");
  const correlationId = crypto.randomUUID();
  const startedAt = performance.now();

  const targetUrl = apiKey === "FORWARD_TO_PRODUCTION"
    ? `${PRODUCTION_PROXY_BASE_URL}/${subpath}${req.nextUrl.search}`
    : `${OPENROUTER_BASE_URL}/${subpath}${req.nextUrl.search}`;
  const forwardHeaders: Record<string, string> = apiKey === "FORWARD_TO_PRODUCTION"
    ? {}
    : {
      "Authorization": `Bearer ${apiKey}`,
      "anthropic-version": "2023-06-01",
    };
  if (contentType) forwardHeaders["Content-Type"] = contentType;

  const response = await fetch(targetUrl, { method: req.method, headers: forwardHeaders, body });

  const responseHeaders = {
    "Content-Type": response.headers.get("Content-Type") ?? "application/json",
    "Cache-Control": "no-cache",
  };

  const passthrough = () => new Response(response.body, { status: response.status, headers: responseHeaders });

  if (!shouldLog) return passthrough();
  try {
    return await observeAndLog({
      response,
      sanitizedBody: sanitized!,
      callerApiKey,
      correlationId,
      startedAt,
      responseHeaders,
    });
  } catch (e) {
    captureError("ai-proxy-log-pipeline", e);
    return passthrough();
  }
}

export const GET = handleApiRequest(proxyToOpenRouter);
export const POST = handleApiRequest(proxyToOpenRouter);
