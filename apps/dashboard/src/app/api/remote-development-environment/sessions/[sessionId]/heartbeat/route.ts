import { NextRequest, NextResponse } from "next/server";
import { getPendingRemoteDevelopmentEnvironmentBrowserSecretConfirmationCode, heartbeatRemoteDevelopmentEnvironmentSession } from "@/lib/remote-development-environment/manager";
import { assertRemoteDevelopmentEnvironmentRequest } from "@/lib/remote-development-environment/security";

export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const securityResponse = assertRemoteDevelopmentEnvironmentRequest(req);
  if (securityResponse != null) return securityResponse;

  const { sessionId } = await params;
  const heartbeat = heartbeatRemoteDevelopmentEnvironmentSession(sessionId);
  if (heartbeat == null) {
    return NextResponse.json({ error: "Unknown remote development environment session." }, { status: 404 });
  }
  const confirmationCode = getPendingRemoteDevelopmentEnvironmentBrowserSecretConfirmationCode();
  return NextResponse.json({
    ok: true,
    browser_secret_confirmation_code: confirmationCode?.code,
    browser_secret_confirmation_code_expires_at_millis: confirmationCode?.expiresAtMillis,
    config_sync_events: heartbeat.configSyncEvents.map((event) => event.status === "success"
      ? {
        config_file_path: event.configFilePath,
        status: "success",
        created_at_millis: event.createdAtMillis,
      }
      : {
        config_file_path: event.configFilePath,
        status: "error",
        error_message: event.errorMessage,
        created_at_millis: event.createdAtMillis,
      }),
  });
}
