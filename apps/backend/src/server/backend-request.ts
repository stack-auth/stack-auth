type NodeRequestInit = RequestInit & {
  duplex?: "half",
};

export function createBackendRequest(request: Request, headers: Headers, originalUrl: string): Request {
  const init: NodeRequestInit = {
    method: request.method,
    headers,
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    init.duplex = "half";
  }

  return new Request(originalUrl, init);
}
