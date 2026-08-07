import { Tracker } from "@bydefault/vercel";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import type { NextFetchEvent, NextRequest } from "next/server";
import { NextResponse } from "next/server";

let tracker: Tracker | null | undefined;

function getTracker(): Tracker | null {
  if (tracker !== undefined) {
    return tracker;
  }

  const token = getEnvVariable("HEXCLAVE_BYDEFAULT_INGEST_TOKEN", "");
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
  if (currentTracker != null && request.method === "GET") {
    runAsynchronously(currentTracker.track(request, event), { noErrorLogging: true });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/mcp", "/llms.txt", "/llms-full.txt"],
};
