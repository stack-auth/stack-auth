export type ClickmapOrigin = {
  id: string,
  origin: string,
};

export type ClickmapWildcardDomain = {
  id: string,
  baseUrl: string,
};

export function normalizeClickmapOrigin(baseUrl: string): string | null {
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

function compareStrings(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
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
    origins: Array.from(byOrigin.values()).sort((a, b) => compareStrings(a.origin, b.origin)),
    wildcardDomains: wildcardDomains.sort((a, b) => compareStrings(a.baseUrl, b.baseUrl)),
  };
}
