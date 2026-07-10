import { getPublicEnvVar } from "@/lib/env";
import { assertRemoteDevelopmentEnvironmentBrowserRequest, assertRemoteDevelopmentEnvironmentRequest } from "@/lib/remote-development-environment/security";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type HealthResponse = {
  ok: boolean,
  restart_command: string,
};

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function devRestartCommand(configFilePath: string | undefined): string {
  if (configFilePath == null) {
    return "hexclave dev --config-file <path-to-hexclave.config.ts> -- <your app command>";
  }
  return `hexclave dev --config-file ${shellQuote(configFilePath)} -- <your app command>`;
}

function healthResponse(body: HealthResponse, status: number): NextResponse<HealthResponse> {
  return NextResponse.json(body, { status });
}

export async function GET(req: NextRequest) {
  const isRemoteDevelopmentEnvironment = getPublicEnvVar("NEXT_PUBLIC_STACK_IS_REMOTE_DEVELOPMENT_ENVIRONMENT") === "true";
  if (isRemoteDevelopmentEnvironment) {
    const securityResponse = req.headers.has("authorization")
      ? assertRemoteDevelopmentEnvironmentRequest(req)
      : assertRemoteDevelopmentEnvironmentBrowserRequest(req);
    if (securityResponse != null) return securityResponse;

    const { getRemoteDevelopmentEnvironmentHealth } = await import("@/lib/remote-development-environment/manager");
    const health = getRemoteDevelopmentEnvironmentHealth();
    return healthResponse({
      ok: health.healthy,
      restart_command: devRestartCommand(health.configFilePath),
    }, health.healthy ? 200 : 503);
  }
  return NextResponse.json({ error: "Development environment health checks are disabled." }, { status: 404 });
}
