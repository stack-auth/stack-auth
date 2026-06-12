import { buildProxyLogRow, scheduleProxyLog } from "@/lib/ai/loggers/ai-proxy-logger";
import { ALLOWED_MODEL_IDS } from "@/lib/ai/models";
import { extractOpenRouterUsage, scanSseForUsage, type UsageFields } from "@/lib/ai/openrouter-usage";
import { preprocessProxyBody } from "@/private";
import { runAsynchronouslyAndWaitUntil } from "@/utils/background-tasks";
import { captureError, StatusError } from "@hexclave/shared/dist/utils/errors";

export const OPENROUTER_DEFAULT_MODEL = "anthropic/claude-sonnet-4.6";

export type SanitizedBody = {
  parsed: { model: string } & Record<string, unknown>,
  bytes: Uint8Array,
};

export function sanitizeBody(raw: ArrayBuffer): SanitizedBody {
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

  if (!parsed.model || !ALLOWED_MODEL_IDS.has(parsed.model)) {
    parsed.model = OPENROUTER_DEFAULT_MODEL;
  }

  if (parsed.metadata?.user_id && parsed.metadata.user_id.length > 128) {
    parsed.metadata.user_id = parsed.metadata.user_id.slice(0, 128);
  }

  const processed = preprocessProxyBody({ parsedBody: parsed }) as { model: string } & Record<string, unknown>;
  return { parsed: processed, bytes: new TextEncoder().encode(JSON.stringify(processed)) };
}

export async function observeAndLog(args: {
  response: Response,
  sanitizedBody: SanitizedBody,
  callerApiKey: string,
  correlationId: string,
  startedAt: number,
  responseHeaders: Record<string, string>,
}): Promise<Response> {
  const { response, sanitizedBody, callerApiKey, correlationId, startedAt, responseHeaders } = args;
  const isStreaming = sanitizedBody.parsed.stream === true;

  if (isStreaming && response.body) {
    const [clientStream, observerStream] = response.body.tee();
    runAsynchronouslyAndWaitUntil((async () => {
      try {
        let usage: UsageFields = {};
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 120_000);
        try {
          usage = (await scanSseForUsage(observerStream, controller.signal)) ?? {};
        } catch (err) {
          captureError("ai-proxy-scan-sse", err);
        } finally {
          clearTimeout(timeoutId);
        }
        scheduleProxyLog(buildProxyLogRow({
          correlationId,
          parsed: sanitizedBody.parsed,
          apiKey: callerApiKey,
          durationMs: BigInt(Math.round(performance.now() - startedAt)),
          responseStatus: response.status,
          usage,
        }));
      } catch (err) {
        captureError("ai-proxy-observer", err);
      }
    })());
    return new Response(clientStream, { status: response.status, headers: responseHeaders });
  }

  const bodyBytes = await response.arrayBuffer();
  try {
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(new TextDecoder().decode(bodyBytes));
    } catch {
      parsedBody = undefined;
    }
    scheduleProxyLog(buildProxyLogRow({
      correlationId,
      parsed: sanitizedBody.parsed,
      apiKey: callerApiKey,
      durationMs: BigInt(Math.round(performance.now() - startedAt)),
      responseStatus: response.status,
      usage: extractOpenRouterUsage(parsedBody),
    }));
  } catch (err) {
    captureError("ai-proxy-log-build", err);
  }
  return new Response(bodyBytes, { status: response.status, headers: responseHeaders });
}
