import { KnownErrors } from "@stackframe/stack-shared";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { signJWT, verifyJWT } from "@stackframe/stack-shared/dist/utils/jwt";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { JOSEError, JWTExpired } from "jose/errors";

export const SERVER_ACCESS_TOKEN_SCOPE = "server" as const;

const DEFAULT_TTL_SECONDS = 900;
const MIN_TTL_SECONDS = 30;
const MAX_TTL_SECONDS = 3600;

function getIssuer(projectId: string): string {
  const url = new URL(`/api/v1/projects/${encodeURIComponent(projectId)}/oidc-federation`, getEnvVariable("NEXT_PUBLIC_STACK_API_URL"));
  return url.toString();
}

function getAudience(projectId: string): string {
  return `${projectId}:server`;
}

export function clampServerAccessTokenTtlSeconds(requested: number | undefined): number {
  const value = requested ?? DEFAULT_TTL_SECONDS;
  if (!Number.isFinite(value)) return DEFAULT_TTL_SECONDS;
  return Math.min(MAX_TTL_SECONDS, Math.max(MIN_TTL_SECONDS, Math.floor(value)));
}

export type ServerAccessTokenFederation = {
  policyId: string,
  issuer: string,
  subject: string,
  audience: string,
};

export type MintServerAccessTokenOptions = {
  projectId: string,
  branchId: string,
  federation: ServerAccessTokenFederation,
  /** Seconds. Clamped to [30, 3600]. */
  ttlSeconds: number,
};

export async function mintServerAccessToken(options: MintServerAccessTokenOptions): Promise<{ accessToken: string, expiresAtMs: number, ttlSeconds: number }> {
  const ttl = clampServerAccessTokenTtlSeconds(options.ttlSeconds);
  const accessToken = await signJWT({
    issuer: getIssuer(options.projectId),
    audience: getAudience(options.projectId),
    expirationTime: `${ttl}s`,
    payload: {
      sub: `${options.federation.issuer}|${options.federation.subject}`,
      project_id: options.projectId,
      branch_id: options.branchId,
      scope: SERVER_ACCESS_TOKEN_SCOPE,
      fed: {
        policy_id: options.federation.policyId,
        issuer: options.federation.issuer,
        sub: options.federation.subject,
        audience: options.federation.audience,
      },
    },
  });
  return { accessToken, expiresAtMs: Date.now() + ttl * 1000, ttlSeconds: ttl };
}

export type VerifiedServerAccessToken = {
  projectId: string,
  branchId: string,
  federation: ServerAccessTokenFederation,
};

export async function verifyServerAccessToken(token: string, options: { projectId: string }): Promise<Result<VerifiedServerAccessToken, InstanceType<typeof KnownErrors.UnparsableAccessToken> | InstanceType<typeof KnownErrors.AccessTokenExpired>>> {
  try {
    const payload = await verifyJWT({
      allowedIssuers: [getIssuer(options.projectId)],
      jwt: token,
    });

    if (payload.aud !== getAudience(options.projectId)) {
      return Result.error(new KnownErrors.UnparsableAccessToken());
    }
    if (payload.scope !== SERVER_ACCESS_TOKEN_SCOPE) {
      return Result.error(new KnownErrors.UnparsableAccessToken());
    }
    if (payload.project_id !== options.projectId) {
      return Result.error(new KnownErrors.UnparsableAccessToken());
    }
    const branchId = payload.branch_id;
    const fed = payload.fed;
    if (typeof branchId !== "string"
        || typeof fed !== "object" || fed === null
        || !("policy_id" in fed) || !("issuer" in fed) || !("sub" in fed) || !("audience" in fed)) {
      throw new StackAssertionError("Malformed server access token payload", { payload });
    }
    const { policy_id: policyId, issuer, sub: subject, audience } = fed;
    if (typeof policyId !== "string" || typeof issuer !== "string" || typeof subject !== "string" || typeof audience !== "string") {
      throw new StackAssertionError("Malformed server access token `fed` claim", { payload });
    }
    return Result.ok({
      projectId: options.projectId,
      branchId,
      federation: { policyId, issuer, subject, audience },
    });
  } catch (error) {
    if (error instanceof JWTExpired) {
      return Result.error(new KnownErrors.AccessTokenExpired(
        error.payload.exp ? new Date(error.payload.exp * 1000) : undefined,
        options.projectId,
        undefined,
        undefined,
      ));
    }
    if (error instanceof JOSEError) {
      return Result.error(new KnownErrors.UnparsableAccessToken());
    }
    throw error;
  }
}
