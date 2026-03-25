import { NextResponse } from "next/server";
import { stackServerApp } from "src/stack";

export async function POST(request: Request) {
  const body = await request.json();

  if (body.action === "trigger-server-error") {
    try {
      throw new Error("Demo server error");
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      // Track the error as a server event — the replay link is automatically
      // extracted from the x-stack-replay header injected by the client SDK.
      await stackServerApp.trackEvent("server.error", {
        source: "server",
        error_name: error.name,
        error_message: error.message,
        stack: error.stack,
      }, request);
      return NextResponse.json({ ok: false, error: "Demo server error tracked" }, { status: 500 });
    }
  }

  // Track a server-side event, passing the request for user attribution
  await stackServerApp.trackEvent("api.analytics-demo", {
    action: body.action ?? "unknown",
    source: "demo-api-route",
  }, request);

  return NextResponse.json({ ok: true, tracked: true });
}

export async function GET(request: Request) {
  await stackServerApp.trackEvent("api.analytics-demo.visited", {
    source: "demo-api-route",
  }, request);

  return NextResponse.json({
    message: "Analytics demo API route",
    features: [
      "Server-side trackEvent with request attribution",
      "Non-blocking (fire-and-forget)",
      "Auto user/team ID from auth headers",
    ],
  });
}
