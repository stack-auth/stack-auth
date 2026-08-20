import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

export type NodeHttpTransportInit = {
  method?: RequestInit["method"],
  headers?: RequestInit["headers"],
  body?: RequestInit["body"] | ArrayBuffer,
  signal?: RequestInit["signal"],
};

// Global fetch uses Undici's 300-second headers timeout, but a workflow
// invocation can legitimately occupy the full 630-second engine backstop.
// Aborting the caller while the backend keeps working lets the next cron tick
// pile another sandbox invocation on top, so these callers need an explicit
// long-lived transport with an independent absolute deadline.
export async function nodeHttpTransport(
  input: string | URL,
  init: NodeHttpTransportInit | undefined,
  timeoutMs: number,
): Promise<Response> {
  const requestUrl = new URL(input);
  const requestHeaders = new Headers(init?.headers);
  const headers: Record<string, string> = {};
  for (const [name, value] of requestHeaders) {
    headers[name] = value;
  }
  const requestSignal = init?.signal ?? undefined;
  const body = init?.body ?? null;
  let requestBody: Buffer;
  if (!(body instanceof ReadableStream)) {
    if (requestSignal?.aborted) {
      throw requestSignal.reason ?? new DOMException("The operation was aborted.", "AbortError");
    }
    requestBody = Buffer.from(await new Response(body).arrayBuffer());
  } else {
    const reader = body.getReader();
    const chunks: Buffer[] = [];
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    let rejectAbort: (reason?: unknown) => void = () => {};
    const abortPromise = new Promise<never>((_resolve, reject) => {
      rejectAbort = reject;
    });
    const abort = () => {
      rejectAbort(requestSignal?.reason ?? new DOMException("The operation was aborted.", "AbortError"));
    };
    const deadlinePromise = new Promise<never>((_resolve, reject) => {
      deadlineTimer = setTimeout(() => {
        reject(new Error(`HTTP request body exceeded its ${timeoutMs}ms absolute deadline.`));
      }, timeoutMs);
    });
    try {
      if (requestSignal?.aborted) {
        abort();
      } else {
        requestSignal?.addEventListener("abort", abort, { once: true });
      }
      while (true) {
        const result = await Promise.race([reader.read(), abortPromise, deadlinePromise]);
        if (result.done) break;
        chunks.push(Buffer.from(result.value));
      }
      requestBody = Buffer.concat(chunks);
    } finally {
      if (deadlineTimer != null) clearTimeout(deadlineTimer);
      requestSignal?.removeEventListener("abort", abort);
      await reader.cancel();
    }
  }
  const requestFunction = requestUrl.protocol === "https:" ? httpsRequest : httpRequest;

  return await new Promise<Response>((resolve, reject) => {
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
      method: init?.method ?? "GET",
      headers,
      signal: requestSignal,
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
    requestHandle.setTimeout(timeoutMs, () => {
      requestHandle.destroy(new Error(`HTTP request exceeded ${timeoutMs}ms.`));
    });
    deadlineTimer = setTimeout(() => {
      requestHandle.destroy(new Error(`HTTP request exceeded its ${timeoutMs}ms absolute deadline.`));
    }, timeoutMs);
    requestHandle.end(requestBody);
  });
}
