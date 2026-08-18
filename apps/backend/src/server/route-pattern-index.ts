export type RoutePatternMatch<T> = {
  params: Record<string, string | string[]>,
  value: T,
};

type RoutePatternSegment =
  | { type: "static", value: string }
  | { name: string, type: "dynamic" }
  | { name: string, type: "catch-all" }
  | { name: string, type: "optional-catch-all" };

type DynamicRoutePattern<T> = {
  pattern: string,
  segments: readonly RoutePatternSegment[],
  value: T,
};

/**
 * Indexes static routes separately from dynamic patterns. The backend's overwhelmingly
 * common case is a literal API path; keeping it in a Map avoids walking every generated
 * route and recursively reparsing the URL for each candidate on every request.
 */
export class RoutePatternIndex<T> {
  private readonly dynamicPatterns: readonly DynamicRoutePattern<T>[];
  private readonly staticPatterns = new Map<string, T[]>();

  constructor(values: readonly T[], getPattern: (value: T) => string) {
    const dynamicPatterns: DynamicRoutePattern<T>[] = [];
    for (const value of values) {
      const pattern = getPattern(value);
      const segments = compileRoutePattern(pattern);
      if (segments == null) {
        const normalizedPattern = normalizePathname(pattern);
        const existing = this.staticPatterns.get(normalizedPattern);
        if (existing == null) {
          this.staticPatterns.set(normalizedPattern, [value]);
        } else {
          existing.push(value);
        }
      } else {
        dynamicPatterns.push({ pattern, segments, value });
      }
    }
    this.dynamicPatterns = dynamicPatterns.sort((a, b) => compareRoutePatterns(a.pattern, b.pattern));
  }

  getStaticMatches(pathname: string): readonly T[] | undefined {
    return this.staticPatterns.get(normalizePathname(pathname));
  }

  getDynamicMatches(pathname: string): RoutePatternMatch<T>[] {
    const pathSegments = splitPathname(pathname);
    const matches: RoutePatternMatch<T>[] = [];
    for (const pattern of this.dynamicPatterns) {
      const params = matchRouteSegments(pathSegments, pattern.segments);
      if (params != null) {
        matches.push({ params, value: pattern.value });
      }
    }
    return matches;
  }

  hasMatch(pathname: string): boolean {
    if (this.getStaticMatches(pathname) != null) {
      return true;
    }
    const pathSegments = splitPathname(pathname);
    return this.dynamicPatterns.some((pattern) => matchRouteSegments(pathSegments, pattern.segments) != null);
  }
}

function compileRoutePattern(pattern: string): readonly RoutePatternSegment[] | undefined {
  const segments = splitPathname(pattern);
  if (!segments.some((segment) => segment.startsWith("[") && segment.endsWith("]"))) {
    return undefined;
  }

  return segments.map((segment, index) => {
    const isLastSegment = index === segments.length - 1;
    if (segment.startsWith("[[...") && segment.endsWith("]]")) {
      if (!isLastSegment) {
        throw new Error(`Optional catch-all route segment must be last: ${JSON.stringify(pattern)}`);
      }
      return { name: getRouteParamName(segment, 5, 2, pattern), type: "optional-catch-all" };
    }
    if (segment.startsWith("[...") && segment.endsWith("]")) {
      if (!isLastSegment) {
        throw new Error(`Catch-all route segment must be last: ${JSON.stringify(pattern)}`);
      }
      return { name: getRouteParamName(segment, 4, 1, pattern), type: "catch-all" };
    }
    if (segment.startsWith("[") && segment.endsWith("]")) {
      return { name: getRouteParamName(segment, 1, 1, pattern), type: "dynamic" };
    }
    return { type: "static", value: segment };
  });
}

function getRouteParamName(segment: string, prefixLength: number, suffixLength: number, pattern: string): string {
  const name = segment.slice(prefixLength, -suffixLength);
  if (name === "") {
    throw new Error(`Route parameter name must not be empty: ${JSON.stringify(pattern)}`);
  }
  return name;
}

function matchRouteSegments(
  pathSegments: readonly string[],
  patternSegments: readonly RoutePatternSegment[],
): Record<string, string | string[]> | undefined {
  const params: Record<string, string | string[]> = {};
  let pathIndex = 0;

  for (const segment of patternSegments) {
    if (segment.type === "optional-catch-all") {
      setRouteParam(params, segment.name, pathSegments.slice(pathIndex));
      return params;
    }
    if (segment.type === "catch-all") {
      if (pathIndex >= pathSegments.length) {
        return undefined;
      }
      setRouteParam(params, segment.name, pathSegments.slice(pathIndex));
      return params;
    }

    if (pathIndex >= pathSegments.length) {
      return undefined;
    }
    const pathSegment = pathSegments[pathIndex];
    if (segment.type === "static") {
      if (segment.value !== pathSegment) {
        return undefined;
      }
    } else {
      setRouteParam(params, segment.name, pathSegment);
    }
    pathIndex++;
  }

  return pathIndex === pathSegments.length ? params : undefined;
}

function setRouteParam(params: Record<string, string | string[]>, name: string, value: string | string[]): void {
  Object.defineProperty(params, name, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function normalizePathname(pathname: string): string {
  if (!pathname.startsWith("/")) {
    throw new Error(`Route pathname must start with a slash: ${JSON.stringify(pathname)}`);
  }
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

function splitPathname(pathname: string): string[] {
  const normalized = normalizePathname(pathname);
  return normalized === "/" ? [] : normalized.slice(1).split("/");
}

function compareRoutePatterns(a: string, b: string): number {
  const aSpecificity = getSpecificity(a);
  const bSpecificity = getSpecificity(b);
  const maxLength = Math.max(aSpecificity.length, bSpecificity.length);
  for (let i = 0; i < maxLength; i++) {
    const difference = (bSpecificity[i] ?? 0) - (aSpecificity[i] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

function getSpecificity(normalizedPath: string): number[] {
  return splitPathname(normalizedPath).map((segment) => {
    if (segment.startsWith("[[...") && segment.endsWith("]]")) {
      return 0;
    }
    if (segment.startsWith("[...") && segment.endsWith("]")) {
      return 1;
    }
    if (segment.startsWith("[") && segment.endsWith("]")) {
      return 2;
    }
    return 3;
  });
}
