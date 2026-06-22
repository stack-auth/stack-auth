import { NextURL } from "@/lib/next-compat/server";
import type { NextRequest } from "next/server";

type NodeRequestInit = RequestInit & {
  duplex?: "half",
};

export function createNextRequestShim(request: Request, headers: Headers, originalUrl: string): NextRequest {
  const init: NodeRequestInit = {
    method: request.method,
    headers,
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    init.duplex = "half";
  }

  return new BackendNextRequest(originalUrl, init);
}

class BackendNextRequest extends Request {
  get nextUrl() {
    return new NextURL(this.url);
  }
}
