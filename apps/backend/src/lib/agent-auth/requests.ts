import { getSoleTenancyFromProjectBranch } from "@/lib/tenancies";
import { AGENT_AUTH_APP_ID } from "./constants";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import type { SmartRequest } from "@/route-handlers/smart-request";

export function getHeader(req: SmartRequest, name: string): string | null {
  const lowerName = name.toLowerCase();
  return req.headers[lowerName]?.[0] ?? null;
}

export function getBearerToken(req: SmartRequest): string | null {
  const authorization = getHeader(req, "authorization");
  if (!authorization) return null;
  const [scheme, ...rest] = authorization.trim().split(/\s+/);
  const token = rest.join(" ");
  if (scheme.toLowerCase() !== "bearer" || token.length === 0) return null;
  return token;
}

export function getAgentAuthAudience(reqUrl: string, path: string): string {
  return new URL(path, new URL(reqUrl).origin).toString();
}

export async function getAgentAuthTenancy(projectId: string) {
  const tenancy = await getSoleTenancyFromProjectBranch(projectId, "main", true);
  if (!tenancy) {
    throw new StatusError(StatusError.NotFound, "Agent auth project not found");
  }
  if (!tenancy.config.apps.installed[AGENT_AUTH_APP_ID]?.enabled) {
    throw new StatusError(StatusError.NotFound, "Not found");
  }
  return tenancy;
}
