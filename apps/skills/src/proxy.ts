import { Tracker } from "@bydefault/vercel";
import type { NextFetchEvent, NextRequest } from "next/server";
import { NextResponse } from "next/server";

const token = process.env.BYDEFAULT_INGEST_TOKEN;
const tracker = token == null || token === "" ? null : new Tracker({ token });

export function proxy(request: NextRequest, event: NextFetchEvent) {
  if (tracker != null) {
    tracker.track(request, event).catch(() => undefined);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/deployments", "/workflows", "/full", "/llms.txt", "/llms-full.txt"],
};
