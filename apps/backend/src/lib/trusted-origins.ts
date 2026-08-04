import type { Tenancy } from "@/lib/tenancies";
import { validateRedirectUrl } from "@/lib/redirect-urls";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

export function normalizeTrustedOrigin(origin: string): string {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new StatusError(StatusError.BadRequest, "Invalid origin");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new StatusError(StatusError.BadRequest, "Origin must be an HTTP(S) origin");
  }

  return url.origin;
}

export function validateTrustedOrigin(tenancy: Tenancy, origin: string): string {
  const normalizedOrigin = normalizeTrustedOrigin(origin);
  if (!validateRedirectUrl(`${normalizedOrigin}/`, tenancy)) {
    throw new StatusError(StatusError.Forbidden, "Origin is not a trusted domain for this project");
  }
  return normalizedOrigin;
}
