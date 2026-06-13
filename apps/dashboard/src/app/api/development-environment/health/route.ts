import { getPublicEnvVar } from "@/lib/env";
import { assertRemoteDevelopmentEnvironmentBrowserRequest, assertRemoteDevelopmentEnvironmentRequest } from "@/lib/remote-development-environment/security";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const LOCAL_EMULATOR_HEALTH_TIMEOUT_MS = 2_000;

type HealthResponse = {
  ok: boolean,
  restart_command: string,
};

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function devRestartCommand(configFilePath: string | undefined): string {
  if (configFilePath == null) {
    return "stack dev --config-file <path-to-stack.config.ts> -- <your app command>";
  }
  return `stack dev --config-file ${shellQuote(configFilePath)} -- <your app command>`;
}

function healthResponse(body: HealthResponse, status: number): NextResponse<HealthResponse> {
  return NextResponse.json(body, { status });
}

async function localEmulatorIsHealthy(): Promise<boolean> {
  const apiBaseUrl = getPublicEnvVar("NEXT_PUBLIC_STACK_API_URL");
  if (apiBaseUrl == null) return false;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LOCAL_EMULATOR_HEALTH_TIMEOUT_MS);
  try {
    const response = await fetch(`${apiBaseUrl}/api/v1/projects/current`, {
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "X-Stack-Access-Type": "client",
        "X-Stack-Project-Id": "internal",
        "X-Stack-Publishable-Client-Key": getPublicEnvVar("NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY") ?? "",
      },
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
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

  const isLocalEmulator = getPublicEnvVar("NEXT_PUBLIC_STACK_IS_LOCAL_EMULATOR") === "true";
  if (isLocalEmulator) {
    const healthy = await localEmulatorIsHealthy();
    return healthResponse({
      ok: healthy,
      restart_command: devRestartCommand(undefined),
    }, healthy ? 200 : 503);
  }

  return NextResponse.json({ error: "Development environment health checks are disabled." }, { status: 404 });
}
