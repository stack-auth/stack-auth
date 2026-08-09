type NodeRequestInit = RequestInit & {
  duplex?: "half",
};

export function createBackendRequest(request: Request, headers: Headers, originalUrl: string): Request {
  const init: NodeRequestInit = {
    method: request.method,
    headers,
    // The backend request is a protocol-preserving fork of the inbound request.
    // Keep client disconnects observable without reintroducing route-duration signals.
    signal: request.signal,
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    init.duplex = "half";
  }

  return new Request(originalUrl, init);
}

import.meta.vitest?.test("the backend request preserves client cancellation", ({ expect }) => {
  const controller = new AbortController();
  const request = new Request("http://localhost/original", { signal: controller.signal });
  const backendRequest = createBackendRequest(request, new Headers(), "http://localhost/backend");

  expect(backendRequest.signal.aborted).toBe(false);
  controller.abort();
  expect(backendRequest.signal.aborted).toBe(true);
});
