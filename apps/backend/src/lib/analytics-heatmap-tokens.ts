import type { Tenancy } from "@/lib/tenancies";
import { validateRedirectUrl } from "@/lib/redirect-urls";
import { yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { signJWT, verifyJWT } from "@stackframe/stack-shared/dist/utils/jwt";
import { yupValidate } from "@stackframe/stack-shared/dist/schema-fields";

const HEATMAP_TOKEN_ISSUER = "hexclave:analytics:heatmap";
const HEATMAP_TOKEN_AUDIENCE = "hexclave:analytics:heatmap-overlay";
const HEATMAP_TOKEN_KIND = "analytics_heatmap_overlay";
const HEATMAP_TOKEN_SCOPE = "heatmap:read";
export const HEATMAP_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

const AnalyticsHeatmapTokenPayloadSchema = yupObject({
  kind: yupString().oneOf([HEATMAP_TOKEN_KIND]).defined(),
  scope: yupString().oneOf([HEATMAP_TOKEN_SCOPE]).defined(),
  project_id: yupString().defined(),
  branch_id: yupString().defined(),
  origin: yupString().defined(),
}).defined();

export type AnalyticsHeatmapTokenPayload = {
  kind: typeof HEATMAP_TOKEN_KIND,
  scope: typeof HEATMAP_TOKEN_SCOPE,
  project_id: string,
  branch_id: string,
  origin: string,
};

export function normalizeAnalyticsHeatmapOrigin(origin: string): string {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new StatusError(StatusError.BadRequest, "Invalid heatmap origin");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new StatusError(StatusError.BadRequest, "Heatmap origin must be an HTTP(S) origin");
  }

  return url.origin;
}

export function validateAnalyticsHeatmapOrigin(tenancy: Tenancy, origin: string): string {
  const normalizedOrigin = normalizeAnalyticsHeatmapOrigin(origin);
  if (!validateRedirectUrl(`${normalizedOrigin}/`, tenancy)) {
    throw new StatusError(StatusError.Forbidden, "Heatmap origin is not a trusted domain for this project");
  }
  return normalizedOrigin;
}

export async function createAnalyticsHeatmapToken(options: {
  tenancy: Tenancy,
  origin: string,
}): Promise<{ token: string, origin: string, expiresAtMillis: number }> {
  const origin = validateAnalyticsHeatmapOrigin(options.tenancy, options.origin);
  const expiresAtMillis = Date.now() + HEATMAP_TOKEN_TTL_MS;
  const token = await signJWT({
    issuer: HEATMAP_TOKEN_ISSUER,
    audience: HEATMAP_TOKEN_AUDIENCE,
    expirationTime: `${HEATMAP_TOKEN_TTL_MS / 1000}s`,
    payload: {
      kind: HEATMAP_TOKEN_KIND,
      scope: HEATMAP_TOKEN_SCOPE,
      project_id: options.tenancy.project.id,
      branch_id: options.tenancy.branchId,
      origin,
    } satisfies AnalyticsHeatmapTokenPayload,
  });
  return { token, origin, expiresAtMillis };
}

export async function verifyAnalyticsHeatmapToken(options: {
  token: string,
  origin: string,
}): Promise<AnalyticsHeatmapTokenPayload> {
  const origin = normalizeAnalyticsHeatmapOrigin(options.origin);
  let payload: AnalyticsHeatmapTokenPayload;
  try {
    payload = await yupValidate(
      AnalyticsHeatmapTokenPayloadSchema,
      await verifyJWT({ allowedIssuers: [HEATMAP_TOKEN_ISSUER], jwt: options.token }),
      { abortEarly: false },
    );
  } catch {
    throw new StatusError(StatusError.Unauthorized, "Invalid or expired heatmap token");
  }

  if (payload.origin !== origin) {
    throw new StatusError(StatusError.Forbidden, "Heatmap token origin does not match this page");
  }
  return payload;
}
