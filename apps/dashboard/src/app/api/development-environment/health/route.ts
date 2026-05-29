import { getPublicEnvVar } from "@/lib/env";
import { NextRequest, NextResponse } from "next/server";
import { createUrlIfValid, isLocalhost } from "@hexclave/shared/dist/utils/urls";

export const runtime = "nodejs";

const LOCAL_EMULATOR_HEALTH_TIMEOUT_MS = 2_000;

type HealthResponse = {
  ok: boolean,
  restart_command: string,
};

function requestHostIsLoopback(req: NextRequest): boolean {
  const host = req.headers.get("host");
  if (host == null) return false;
  return isLocalhost(`http://${host}`);
}

function urlOrigin(value: string | undefined): string | null {
  if (value == null || value.length === 0) return null;
  return createUrlIfValid(value)?.origin ?? null;
}

function expectedDashboardOrigins(): Set<string> {
  return new Set([
    urlOrigin(getPublicEnvVar("NEXT_PUBLIC_STACK_DASHBOARD_URL")),
    urlOrigin(getPublicEnvVar("NEXT_PUBLIC_BROWSER_STACK_DASHBOARD_URL")),
    urlOrigin(getPublicEnvVar("NEXT_PUBLIC_SERVER_STACK_DASHBOARD_URL")),
    "http://127.0.0.1:26700",
  ].filter((origin): origin is string => typeof origin === "string"));
}

function originIsAllowed(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (origin == null) return true;
  const parsedOrigin = urlOrigin(origin);
  return parsedOrigin != null && expectedDashboardOrigins().has(parsedOrigin);
}

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
  if (!requestHostIsLoopback(req) || !originIsAllowed(req)) {
    return NextResponse.json({ error: "Development environment health checks only accept loopback requests." }, { status: 403 });
  }

  const isRemoteDevelopmentEnvironment = getPublicEnvVar("NEXT_PUBLIC_STACK_IS_REMOTE_DEVELOPMENT_ENVIRONMENT") === "true";
  if (isRemoteDevelopmentEnvironment) {
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
