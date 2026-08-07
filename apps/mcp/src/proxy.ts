import { Tracker } from "@bydefault/vercel";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import type { NextFetchEvent, NextRequest } from "next/server";
import { NextResponse } from "next/server";

const token = getEnvVariable("BYDEFAULT_INGEST_TOKEN", "");
const tracker = token == null || token === ""
  ? null
  : new Tracker({
    token,
    exclude: [
      "/api",
      "/health",
      (request) => (request.headers.get("accept") ?? "").toLowerCase().includes("text/event-stream"),
    ],
  });

export function proxy(request: NextRequest, event: NextFetchEvent) {
  if (tracker != null) {
    tracker.track(request, event).catch(() => undefined);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/mcp", "/llms.txt", "/llms-full.txt"],
};
