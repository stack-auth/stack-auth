import "server-only";

import { StatusError } from "@hexclave/shared/dist/utils/errors";
import * as jose from "jose";
import { envOrDevDefault } from "../env";

// Authenticates the Stack Auth backend to this app's /api/backend/* ingest
// routes with a short-lived JWT assertion — no shared secret. The backend
// signs it with the Stack Auth project keys it inherently holds (derived from
// STACK_SERVER_SECRET); we verify against the project's public JWKS endpoint.
// A stolen ordinary user access token cannot be replayed here: `sub` must be
// the reserved `__internal_tool_backend__` (real users always get UUID
// subjects) and the `token_use` claim must match.

export const BACKEND_ASSERTION_SUBJECT = "__internal_tool_backend__";
export const BACKEND_ASSERTION_TOKEN_USE = "internal-tool-backend";

function apiUrl(): string {
  const prefix = process.env.NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX ?? "81";
  return envOrDevDefault(
    process.env.NEXT_PUBLIC_HEXCLAVE_API_URL,
    `http://localhost:${prefix}02`,
    "NEXT_PUBLIC_HEXCLAVE_API_URL",
  ).replace(/\/+$/, "");
}

function projectId(): string {
  return envOrDevDefault(process.env.NEXT_PUBLIC_HEXCLAVE_PROJECT_ID, "internal", "NEXT_PUBLIC_HEXCLAVE_PROJECT_ID");
}

let cachedJwks: ReturnType<typeof jose.createRemoteJWKSet> | null = null;
function remoteJwks() {
  cachedJwks ??= jose.createRemoteJWKSet(new URL(`${apiUrl()}/api/v1/projects/${projectId()}/.well-known/jwks.json`));
  return cachedJwks;
}

export async function requireBackendAssertion(req: Request): Promise<void> {
  const authorization = req.headers.get("authorization");
  if (authorization == null || !authorization.startsWith("Bearer ")) {
    throw new StatusError(StatusError.Unauthorized, "Missing backend assertion.");
  }
  const assertion = authorization.slice("Bearer ".length);

  let payload: jose.JWTPayload;
  try {
    ({ payload } = await jose.jwtVerify(assertion, remoteJwks(), {
      issuer: `${apiUrl()}/api/v1/projects/${projectId()}`,
      audience: projectId(),
    }));
  } catch {
    throw new StatusError(StatusError.Unauthorized, "Invalid backend assertion.");
  }

  if (payload.sub !== BACKEND_ASSERTION_SUBJECT || payload.token_use !== BACKEND_ASSERTION_TOKEN_USE) {
    throw new StatusError(StatusError.Unauthorized, "Invalid backend assertion.");
  }
}
