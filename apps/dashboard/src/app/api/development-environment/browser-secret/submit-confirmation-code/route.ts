import {
  assertRemoteDevelopmentEnvironmentBrowserSecretSetupRequest,
  submitRemoteDevelopmentEnvironmentBrowserSecretConfirmationCode,
} from "@/lib/remote-development-environment/browser-secret";
import { readRemoteDevelopmentEnvironmentJsonBody } from "@/lib/remote-development-environment/route-json";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function confirmationCodeFromBody(value: unknown): string | null {
  if (
    value == null ||
    typeof value !== "object" ||
    !("code" in value) ||
    typeof value.code !== "string"
  ) {
    return null;
  }
  return value.code;
}

export async function POST(req: NextRequest) {
  const securityResponse = assertRemoteDevelopmentEnvironmentBrowserSecretSetupRequest(req);
  if (securityResponse != null) return securityResponse;

  const parsedBody = await readRemoteDevelopmentEnvironmentJsonBody(req);
  if (parsedBody instanceof NextResponse) return parsedBody;
  const code = confirmationCodeFromBody(parsedBody);
  if (code == null) {
    return NextResponse.json({ error: "code is required." }, { status: 400 });
  }

  return submitRemoteDevelopmentEnvironmentBrowserSecretConfirmationCode(req, code);
}
