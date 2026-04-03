import { handleApiRequest } from "@/route-handlers/smart-route-handler";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { NextRequest } from "next/server";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api";
const OPENROUTER_MODEL = "anthropic/claude-sonnet-4.6";

function sanitizeBody(raw: ArrayBuffer): Uint8Array {
  const text = new TextDecoder().decode(raw);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new StatusError(400, "Request body must be valid JSON");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new StatusError(400, "Request body must be a JSON object");
  }

  parsed.model = OPENROUTER_MODEL;

  // OpenRouter limits metadata.user_id to 128 characters
  if (parsed.metadata?.user_id && parsed.metadata.user_id.length > 128) {
    parsed.metadata.user_id = parsed.metadata.user_id.slice(0, 128);
  }

  return new TextEncoder().encode(JSON.stringify(parsed));
}

async function proxyToOpenRouter(req: NextRequest, options: { params: Promise<{ path?: string[] }> }) {
  const apiKey = getEnvVariable("STACK_OPENROUTER_API_KEY");
  const params = await options.params;
  const subpath = params.path?.join("/") ?? "";
  const targetUrl = `${OPENROUTER_BASE_URL}/${subpath}${req.nextUrl.search}`;

  const headers: Record<string, string> = {
    "Authorization": `Bearer ${apiKey}`,
    "anthropic-version": "2023-06-01",
  };

  const contentType = req.headers.get("Content-Type");
  if (contentType) {
    headers["Content-Type"] = contentType;
  }

  const body = req.method !== "GET" && req.method !== "HEAD"
    ? Buffer.from(sanitizeBody(await req.arrayBuffer()))
    : undefined;

  const response = await fetch(targetUrl, {
    method: req.method,
    headers,
    body,
  });

  return new Response(response.body, {
    status: response.status,
    headers: {
      "Content-Type": response.headers.get("Content-Type") ?? "application/json",
      "Cache-Control": "no-cache",
    },
  });
}

export const GET = handleApiRequest(proxyToOpenRouter);
export const POST = handleApiRequest(proxyToOpenRouter);
