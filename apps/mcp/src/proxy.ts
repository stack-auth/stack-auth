import { Tracker } from "@bydefault/vercel";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import type { NextFetchEvent, NextRequest } from "next/server";
import { NextResponse } from "next/server";

let tracker: Tracker | null | undefined;

function getTracker(): Tracker | null {
  if (tracker !== undefined) {
    return tracker;
  }

  const token = getEnvVariable("BYDEFAULT_INGEST_TOKEN", "");
  tracker = token === ""
    ? null
    : new Tracker({
      token,
      exclude: [
        "/api",
        "/health",
        (request) => (request.headers.get("accept") ?? "").toLowerCase().includes("text/event-stream"),
      ],
    });
  return tracker;
}

export function proxy(request: NextRequest, event: NextFetchEvent) {
  const currentTracker = getTracker();
  if (currentTracker != null) {
    currentTracker.track(request, event).catch(() => undefined);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/mcp", "/llms.txt", "/llms-full.txt"],
};
