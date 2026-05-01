import type { SamlConnectionConfig } from "@/saml/saml";

/**
 * Email-domain-based connection discovery for /auth/saml/discover and the
 * client SDK's signInWithSso({ email }) flow.
 *
 * Iterates the project's configured SAML connections and returns the first
 * whose `domain` exactly matches the email's domain (case-insensitive).
 *
 * Connections live as JSON under tenancy.config — there is no DB-level
 * unique index on `domain`. The admin POST /saml-connections handler
 * rejects duplicate-domain inserts so this scan is effectively
 * deterministic per project; if a misconfiguration ever bypasses that
 * guard, "first match wins" in Object.values() iteration order.
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
