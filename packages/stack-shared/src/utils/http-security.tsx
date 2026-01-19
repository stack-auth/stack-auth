/**
 * Determines if insecure HTTP requests should be allowed for a given endpoint.
 * - Localhost HTTP is always allowed (for local development)
 * - Non-localhost HTTP requires explicit opt-in via dangerouslyAllowInsecureHttp
 * - HTTPS never needs this flag
 */
export function shouldAllowInsecureRequest(endpoint: string, dangerouslyAllowInsecureHttp?: boolean): boolean {
  const isLocalhostHttp = /^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(endpoint);
  return isLocalhostHttp || (!!dangerouslyAllowInsecureHttp && endpoint.startsWith('http://'));
}
