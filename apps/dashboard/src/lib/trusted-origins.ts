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
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return null;
  }
  if (url.hostname.includes("*")) {
    return null;
  }

  return url.origin;
}

export function getTrustedOriginOptions(
  trustedDomains: Record<string, { baseUrl?: string | null }>,
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

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(domain.baseUrl);
    } catch {
      continue;
    }

    if (parsedUrl.hostname.includes("*")) {
      wildcardDomains.push({ id, baseUrl: domain.baseUrl });
      continue;
    }

    const origin = normalizeTrustedOrigin(domain.baseUrl);
    if (origin == null) {
      continue;
    }
    byOrigin.set(origin, { id, origin });
  }

  return {
    origins: Array.from(byOrigin.values()).sort((a, b) => stringCompare(a.origin, b.origin)),
    wildcardDomains: wildcardDomains.sort((a, b) => stringCompare(a.baseUrl, b.baseUrl)),
  };
}
