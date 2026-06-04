const cachedRegexes = new Map<string, RegExp>();

export function createCachedRegex(pattern: string) {
  const cached = cachedRegexes.get(pattern);
  if (cached) return cached;

  const regex = new RegExp(pattern);
  cachedRegexes.set(pattern, regex);
  return regex;
}
