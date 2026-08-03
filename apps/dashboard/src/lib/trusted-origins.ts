import { stringCompare } from "@hexclave/shared/dist/utils/strings";

export type TrustedOrigin = {
  id: string,
  origin: string,
};

export type TrustedWildcardDomain = {
  id: string,
  baseUrl: string,
};

export function normalizeTrustedOrigin(baseUrl: string): string | null {
  if (baseUrl.includes("*")) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return null;
  }

  return url.origin;
}

export function getTrustedOriginOptions(
  trustedDomains: Record<string, { baseUrl?: string | null }>,
  allowLocalhost = false,
): {
  origins: TrustedOrigin[],
  wildcardDomains: TrustedWildcardDomain[],
} {
  const byOrigin = new Map<string, TrustedOrigin>();
  const wildcardDomains: TrustedWildcardDomain[] = [];

  for (const id in trustedDomains) {
    const domain = trustedDomains[id];
    if (domain.baseUrl == null) {
      continue;
    }

    if (domain.baseUrl.includes("*")) {
      wildcardDomains.push({ id, baseUrl: domain.baseUrl });
      continue;
    }

    const origin = normalizeTrustedOrigin(domain.baseUrl);
    if (origin == null) {
      continue;
    }
    byOrigin.set(origin, { id, origin });
  }

  const origins = Array.from(byOrigin.values());
  if (allowLocalhost) {
    origins.push({ id: "localhost", origin: "http://localhost" });
  }
  return {
    origins: origins.sort((a, b) => stringCompare(a.origin, b.origin)),
    wildcardDomains: wildcardDomains.sort((a, b) => stringCompare(a.baseUrl, b.baseUrl)),
  };
}
