import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { WORKFLOW_INVOCATION_BACKSTOP_TIMEOUT_MS } from "../src/lib/workflows/engine";

const CRON_TRANSPORT_TIMEOUT_MARGIN_MS = 30_000;

// Engine steps can legitimately occupy the full backstop; Undici's 300s
// headers timeout would abort the cron caller while the backend keeps working,
// allowing the next tick to pile another sandbox invocation on top.
export function getCronTransportTimeoutMs(): number {
  return WORKFLOW_INVOCATION_BACKSTOP_TIMEOUT_MS + CRON_TRANSPORT_TIMEOUT_MARGIN_MS;
}

export function cronFetch(
  input: string | URL,
  init: { headers?: HeadersInit, signal?: AbortSignal } | undefined,
  transportTimeoutMs = getCronTransportTimeoutMs(),
): Promise<Response> {
  const requestUrl = new URL(input);
  const requestHeaders = new Headers(init?.headers);
  const headers: Record<string, string> = {};
  for (const [name, value] of requestHeaders) {
    headers[name] = value;
  }
  const requestFunction = requestUrl.protocol === "https:" ? httpsRequest : httpRequest;

  return new Promise<Response>((resolve, reject) => {
    let settled = false;
    let deadlineTimer: ReturnType<typeof setTimeout>;
    const clearDeadlineTimer = () => {
      clearTimeout(deadlineTimer);
    };
    const rejectOnce = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearDeadlineTimer();
      reject(error);
    };
    const requestHandle = requestFunction(requestUrl, {
      method: "GET",
      headers,
      signal: init?.signal,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer | string) => {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      });
      response.once("error", rejectOnce);
      response.once("end", () => {
        if (settled) return;
        settled = true;
        clearDeadlineTimer();
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          if (value == null) continue;
          responseHeaders.set(name, Array.isArray(value) ? value.join(", ") : value);
        }
        resolve(new Response(Buffer.concat(chunks), {
          status: response.statusCode ?? 0,
          statusText: response.statusMessage,
          headers: responseHeaders,
        }));
      });
    });
    requestHandle.once("error", rejectOnce);
    requestHandle.setTimeout(transportTimeoutMs, () => {
      requestHandle.destroy(new Error(`Cron request exceeded ${transportTimeoutMs}ms.`));
    });
    deadlineTimer = setTimeout(() => {
      requestHandle.destroy(new Error(`Cron request exceeded its ${transportTimeoutMs}ms absolute deadline.`));
    }, transportTimeoutMs);
    requestHandle.end();
  });
}
