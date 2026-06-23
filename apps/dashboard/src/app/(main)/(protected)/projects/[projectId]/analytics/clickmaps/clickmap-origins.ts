import { stringCompare } from "@hexclave/shared/dist/utils/strings";

export type ClickmapOrigin = {
  id: string,
  origin: string,
};

export type ClickmapWildcardDomain = {
  id: string,
  baseUrl: string,
};

export function normalizeClickmapOrigin(baseUrl: string): string | null {
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

function isWildcardDomain(baseUrl: string): boolean {
  return baseUrl.includes("*");
}

export function getClickmapOriginOptions(trustedDomains: Record<string, { baseUrl?: string | null }>): {
  origins: ClickmapOrigin[],
  wildcardDomains: ClickmapWildcardDomain[],
} {
  const byOrigin = new Map<string, ClickmapOrigin>();
  const wildcardDomains: ClickmapWildcardDomain[] = [];

  for (const id in trustedDomains) {
    const domain = trustedDomains[id];
    if (domain.baseUrl == null) {
      continue;
    }

    if (isWildcardDomain(domain.baseUrl)) {
      wildcardDomains.push({ id, baseUrl: domain.baseUrl });
      continue;
    }

    const origin = normalizeClickmapOrigin(domain.baseUrl);
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
