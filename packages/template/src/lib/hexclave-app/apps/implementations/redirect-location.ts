/**
 * Query and hash parameters commonly change between redirect hops, so loop prevention and
 * after-auth self-target checks intentionally compare only the origin and pathname.
 */
export function getComparableRedirectLocation(url: URL): string {
  return `${url.origin}${url.pathname}`;
}
