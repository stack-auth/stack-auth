import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

export type NodeHttpTransportInit = {
  method?: RequestInit["method"],
  headers?: RequestInit["headers"],
  body?: RequestInit["body"] | ArrayBuffer,
  signal?: RequestInit["signal"],
};

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
  const body = await new Response(init?.body ?? null).arrayBuffer();
  const requestBody = Buffer.from(body);
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
      signal: init?.signal ?? undefined,
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
