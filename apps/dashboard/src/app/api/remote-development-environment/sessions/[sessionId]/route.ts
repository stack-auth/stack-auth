import { NextRequest, NextResponse } from "next/server";
import { closeRemoteDevelopmentEnvironmentSession } from "@/lib/remote-development-environment/manager";
import { assertRemoteDevelopmentEnvironmentRequest } from "@/lib/remote-development-environment/security";

export const runtime = "nodejs";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const securityResponse = assertRemoteDevelopmentEnvironmentRequest(req);
  if (securityResponse != null) return securityResponse;

  const { sessionId } = await params;
  closeRemoteDevelopmentEnvironmentSession(sessionId);
  return NextResponse.json({ ok: true });
}
