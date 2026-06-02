import type { Tenancy } from "@/lib/tenancies";
import { validateRedirectUrl } from "@/lib/redirect-urls";
import { yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import { signJWT, verifyJWT } from "@hexclave/shared/dist/utils/jwt";
import { yupValidate } from "@hexclave/shared/dist/schema-fields";
import { JOSEError } from "jose/errors";
import { ValidationError } from "yup";

const CLICKMAP_TOKEN_ISSUER = "hexclave:analytics:clickmap";
const CLICKMAP_TOKEN_AUDIENCE = "hexclave:analytics:clickmap-overlay";
const CLICKMAP_TOKEN_KIND = "analytics_clickmap_overlay";
const CLICKMAP_TOKEN_SCOPE = "clickmap:read";
export const CLICKMAP_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

const AnalyticsClickmapTokenPayloadSchema = yupObject({
  kind: yupString().oneOf([CLICKMAP_TOKEN_KIND]).defined(),
  scope: yupString().oneOf([CLICKMAP_TOKEN_SCOPE]).defined(),
  project_id: yupString().defined(),
  branch_id: yupString().defined(),
  origin: yupString().defined(),
}).defined();

export type AnalyticsClickmapTokenPayload = {
  kind: typeof CLICKMAP_TOKEN_KIND,
  scope: typeof CLICKMAP_TOKEN_SCOPE,
  project_id: string,
  branch_id: string,
  origin: string,
};

export function normalizeAnalyticsClickmapOrigin(origin: string): string {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new StatusError(StatusError.BadRequest, "Invalid clickmap origin");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new StatusError(StatusError.BadRequest, "Clickmap origin must be an HTTP(S) origin");
  }

  return url.origin;
}

export function validateAnalyticsClickmapOrigin(tenancy: Tenancy, origin: string): string {
  const normalizedOrigin = normalizeAnalyticsClickmapOrigin(origin);
  if (!validateRedirectUrl(`${normalizedOrigin}/`, tenancy)) {
    throw new StatusError(StatusError.Forbidden, "Clickmap origin is not a trusted domain for this project");
  }
  return normalizedOrigin;
}

export async function createAnalyticsClickmapToken(options: {
  tenancy: Tenancy,
  origin: string,
}): Promise<{ token: string, origin: string, expiresAtMillis: number }> {
  const origin = validateAnalyticsClickmapOrigin(options.tenancy, options.origin);
  const expiresAtMillis = Date.now() + CLICKMAP_TOKEN_TTL_MS;
  const token = await signJWT({
    issuer: CLICKMAP_TOKEN_ISSUER,
    audience: CLICKMAP_TOKEN_AUDIENCE,
    expirationTime: `${CLICKMAP_TOKEN_TTL_MS / 1000}s`,
    payload: {
      kind: CLICKMAP_TOKEN_KIND,
      scope: CLICKMAP_TOKEN_SCOPE,
      project_id: options.tenancy.project.id,
      branch_id: options.tenancy.branchId,
      origin,
    } satisfies AnalyticsClickmapTokenPayload,
  });
  return { token, origin, expiresAtMillis };
}

export async function verifyAnalyticsClickmapToken(options: {
  token: string,
  origin: string,
}): Promise<AnalyticsClickmapTokenPayload> {
  const origin = normalizeAnalyticsClickmapOrigin(options.origin);
  let payload: AnalyticsClickmapTokenPayload;
  try {
    const verified = await verifyJWT({ allowedIssuers: [CLICKMAP_TOKEN_ISSUER], jwt: options.token });
    // verifyJWT only constrains the issuer, so also require the audience to match
    // — otherwise a validly-signed token minted for a different audience could pass.
    if (verified.aud !== CLICKMAP_TOKEN_AUDIENCE) {
      throw new StatusError(StatusError.Unauthorized, "Invalid or expired clickmap token");
    }
    payload = await yupValidate(AnalyticsClickmapTokenPayloadSchema, verified, { abortEarly: false });
  } catch (error) {
    // Only expected JWT/validation failures are auth errors; rethrow anything
    // unexpected (e.g. backend faults) so they aren't misreported as bad credentials.
    if (error instanceof StatusError) throw error;
    if (error instanceof JOSEError || error instanceof ValidationError) {
      throw new StatusError(StatusError.Unauthorized, "Invalid or expired clickmap token");
    }
    throw error;
  }

  if (payload.origin !== origin) {
    throw new StatusError(StatusError.Forbidden, "Clickmap token origin does not match this page");
  }
  return payload;
}
