import type { SamlConnectionConfig } from "@/saml/saml";

/**
 * Email-domain-based connection discovery for /auth/saml/discover and the
 * client SDK's signInWithSso({ email }) flow.
 *
 * Iterates the project's configured SAML connections and returns the first
 * whose `domain` exactly matches the email's domain (case-insensitive).
 *
 * The schema enforces uniqueness on (tenancyId, samlConnectionId, domain) so
 * "exactly one match per domain per project" is a DB-level invariant; this
 * function picks deterministically when scanning.
 */
export function discoverConnectionByEmail(
  connections: Record<string, SamlConnectionConfig>,
  email: string,
): SamlConnectionConfig | null {
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const domain = email.slice(at + 1).toLowerCase();
  if (!domain) return null;

  for (const conn of Object.values(connections)) {
    if (conn.domain && conn.domain.toLowerCase() === domain) {
      return conn;
    }
  }
  return null;
}
