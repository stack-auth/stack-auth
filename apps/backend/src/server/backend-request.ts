type NodeRequestInit = RequestInit & {
  duplex?: "half",
};

export function createBackendRequest(
  request: Request,
  headers: Headers,
  originalUrl: string,
  signal: AbortSignal = request.signal,
): Request {
  const init: NodeRequestInit = {
    method: request.method,
    headers,
    signal,
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    init.duplex = "half";
  }

  return new Request(originalUrl, init);
}
