/**
 * Normalize a path by replacing dynamic segments (UUIDs, numeric IDs,
 * hashes, base64 tokens, etc.) with placeholder tokens. This groups
 * similar pages (e.g. /users/abc123 and /users/def456 → /users/:id).
 */

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_REGEX = /^\d+$/;
const HEX_ID_REGEX = /^[0-9a-f]{8,}$/i;
const BASE64_TOKEN_REGEX = /^[A-Za-z0-9_-]{16,}[=]{0,2}$/;
// Require a digit in the suffix so static segments like `sign_in` stay literal.
const PREFIXED_ID_REGEX = /^[a-z]{1,10}_[a-z0-9]*\d[a-z0-9]*$/i;

function isLikelyDynamicSegment(segment: string): boolean {
  if (segment.length === 0) return false;

  if (UUID_REGEX.test(segment)) return true;
  if (NUMERIC_REGEX.test(segment)) return true;
  if (HEX_ID_REGEX.test(segment)) return true;
  if (PREFIXED_ID_REGEX.test(segment)) return true;

  // Length 20, not the regex's 16: shorter base64-shaped words (`api`, `auth`)
  // would otherwise collapse into `:id`.
  if (segment.length >= 20 && BASE64_TOKEN_REGEX.test(segment)) return true;

  return false;
}

export function normalizeUrlPath(path: string): string {
  const queryStart = path.indexOf("?");
  const hashStart = path.indexOf("#");
  const end = Math.min(
    queryStart < 0 ? path.length : queryStart,
    hashStart < 0 ? path.length : hashStart,
  );
  const cleanPath = path.slice(0, end);

  const segments = cleanPath.split("/");
  const normalized = segments.map((seg) =>
    isLikelyDynamicSegment(seg) ? ":id" : seg
  );

  // Collapse consecutive :id segments (e.g. /a/:id/:id → /a/:id)
  const collapsed: string[] = [];
  for (const seg of normalized) {
    if (seg === ":id" && collapsed[collapsed.length - 1] === ":id") continue;
    collapsed.push(seg);
  }

  return collapsed.join("/") || "/";
}
