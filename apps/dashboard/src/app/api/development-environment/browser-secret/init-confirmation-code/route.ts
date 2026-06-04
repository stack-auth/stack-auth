import { initRemoteDevelopmentEnvironmentBrowserSecretConfirmationCode } from "@/lib/remote-development-environment/browser-secret";
import { NextRequest } from "next/server";

export const runtime = "nodejs";

export function POST(req: NextRequest) {
  return initRemoteDevelopmentEnvironmentBrowserSecretConfirmationCode(req);
}
