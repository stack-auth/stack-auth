import { usersCrudHandlers } from '@/app/api/latest/users/crud';
import { withExternalDbSyncUpdate } from '@/lib/external-db-sync';
import { getPrismaClientForTenancy, globalPrismaClient } from '@/prisma-client';
import { KnownErrors } from '@hexclave/shared';
import type { RestrictedReason } from "@hexclave/shared/dist/schema-fields";
import { restrictedReasonSchema, yupBoolean, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { AccessTokenPayload } from '@hexclave/shared/dist/sessions';
import { generateSecureRandomString } from '@hexclave/shared/dist/utils/crypto';
import { getEnvVariable } from '@hexclave/shared/dist/utils/env';
import { captureError, HexclaveAssertionError, throwErr } from '@hexclave/shared/dist/utils/errors';
import { getPrivateJwks, getPublicJwkSet, signJWT, verifyJWT } from '@hexclave/shared/dist/utils/jwt';
import { Result } from '@hexclave/shared/dist/utils/results';
import { traceSpan } from '@hexclave/shared/dist/utils/telemetry';
import { turnstileResultValues } from '@hexclave/shared/dist/utils/turnstile';
import * as jose from 'jose';
import { JOSEError, JWTExpired } from 'jose/errors';
import { getEndUserIpInfoForEvent, logEvent, SystemEventTypes } from './events';
import { getBillingTeamId } from './plan-entitlements';
import { CLOUD_HOST_PAIRS } from './request-api-url';
import { Tenancy } from './tenancies';

export const authorizationHeaderSchema = yupString().matches(/^StackSession [^ ]+$/);

const accessTokenSchema = yupObject({
  projectId: yupString().defined(),
  userId: yupString().defined(),
  branchId: yupString().defined(),
  refreshTokenId: yupString().optional(),
  exp: yupNumber().defined(),
  isAnonymous: yupBoolean().defined(),
  isRestricted: yupBoolean().defined(),
  restrictedReason: restrictedReasonSchema.nullable().defined(),
}).defined();

export const oauthCookieSchema = yupObject({
  tenancyId: yupString().defined(),
  publishableClientKey: yupString().defined(),
  innerCodeVerifier: yupString().defined(),
  redirectUri: yupString().defined(),
  scope: yupString().defined(),
  state: yupString().defined(),
  grantType: yupString().defined(),
  codeChallenge: yupString().defined(),
  codeChallengeMethod: yupString().defined(),
  responseType: yupString().defined(),
  type: yupString().oneOf(['authenticate', 'link']).defined(),
  projectUserId: yupString().optional(),
  providerScope: yupString().optional(),
  errorRedirectUrl: yupString().optional(),
  afterCallbackRedirectUrl: yupString().optional(),
  // TODO next-release: make these .defined() once all deployments write these fields into the cookie
  turnstileResult: yupString().oneOf(turnstileResultValues).optional(),
  turnstileVisibleChallengeResult: yupString().oneOf(turnstileResultValues).optional(),
  responseMode: yupString().oneOf(['json', 'redirect']).optional(),
  // The host-derived API URL of the request that started /authorize. The
  // browser-redirect CSRF cookie is host-scoped to that host, but the OAuth
  // `redirect_uri` (and thus the callback host) is now config-derived and can be
  // a sibling brand. The callback uses this to detect a legitimate cross-host
  // landing and skip the cookie check (server-side state + outer PKCE still
  // apply). Optional for in-flight flows started before this field existed.
  authorizeApiUrl: yupString().optional(),
});

type UserType = 'normal' | 'restricted' | 'anonymous';

// `apiUrl` is the host-derived API URL for the request that triggered token
// signing — see `getApiUrlForRequest` in `request-api-url.ts`. The resulting
// `iss` claim matches the host the customer's SDK targeted, so a customer on
// `api.stack-auth.com` keeps seeing `iss: https://api.stack-auth.com/...`
// tokens forever (until they explicitly migrate their SDK to a host that
// resolves to `api.hexclave.com`).
const getIssuer = (projectId: string, userType: UserType, apiUrl: string) => {
  const suffix = userType === 'anonymous' ? '-anonymous-users' : userType === 'restricted' ? '-restricted-users' : '';
  const url = new URL(`/api/v1/projects${suffix}/${projectId}`, apiUrl);
  return url.toString();
};
// Hexclave rebrand: api.stack-auth.com ↔ api.hexclave.com. During the domain transition a
// backend served from one host must keep validating tokens issued under the other, so the
// validator accepts the issuer under both hosts. Signing picks the issuer host per request
// from `getApiUrlForRequest`, so a token's `iss` follows the SDK's configured host. See
// RENAME-TO-HEXCLAVE.md (Tier 0, JWT) and the `CLOUD_HOST_PAIRS` source-of-truth in
// `request-api-url.ts` for the canonical list of paired hosts. Use a Map (not a plain
// object) for the dynamic host lookup — avoids any chance of a prototype-key collision
// when the input host comes from an attacker-controlled JWT.
const issuerHostAliases = new Map<string, string>(
  CLOUD_HOST_PAIRS.flatMap(([stackAuthHost, hexclaveHost]) => [
    [stackAuthHost, hexclaveHost],
    [hexclaveHost, stackAuthHost],
  ]),
);
// Validation accepts both the primary issuer (derived from the deployment's
// `NEXT_PUBLIC_STACK_API_URL` so existing single-host self-hosters keep working)
// and its alias host, so a token minted under one cloud brand validates against
// either backend host.
//
// LOAD-BEARING OMISSION: the project's OIDC provider issuer (`.../projects/{id}/oidc`) is
// deliberately NOT in this list. Tokens minted by a project acting as an OAuth provider are for
// that project's own resource servers, not for the Hexclave API, and this omission is one of the
// two independent mechanisms that keeps them out (the other being that a resource audience derives
// a different signing key — see `getResourceAudience`). Do not "helpfully" unify the two issuer
// helpers.
const getAllowedIssuers = (projectId: string, userType: UserType): string[] => {
  const issuer = getIssuer(projectId, userType, getEnvVariable("NEXT_PUBLIC_STACK_API_URL"));
  const aliasHost = issuerHostAliases.get(new URL(issuer).host);
  if (!aliasHost) return [issuer];
  const aliasedUrl = new URL(issuer);
  aliasedUrl.host = aliasHost;
  return [issuer, aliasedUrl.toString()];
};
// The `aud` claim is not just an identifier — it selects the signing key. `getPrivateJwks({ audience })`
// derives a distinct keypair per audience string (see `packages/shared/src/utils/jwt.tsx`), so two
// tokens with different audiences are signed by different keys and are structurally unable to
// validate against each other. That is what makes resource-scoped tokens (see `parseAudience`'s
// `resource` variant) safe: an MCP token cannot be replayed as a session token even if some future
// caller forgets to check the issuer.
//
// Because of that, the audience string format is a wire format we can never change without rotating
// every signing key. Parsing therefore lives in exactly one place — `parseAudience` — and every
// producer goes through `getAudience`/`getResourceAudience`.

const ANONYMOUS_AUDIENCE_SUFFIX = 'anon';
const RESTRICTED_AUDIENCE_SUFFIX = 'restricted';
const RESOURCE_AUDIENCE_MARKER = 'resource';

// Project IDs are UUIDs or the literal `internal` (see `projectIdSchema`), and resource IDs are
// user-specified IDs (see `USER_SPECIFIED_ID_PATTERN`). Neither can contain a colon, which is what
// makes the audience format unambiguously parseable. We re-assert it here rather than trusting the
// callers, because `parseAudience` also runs on attacker-controlled JWTs.
const AUDIENCE_SEGMENT_PATTERN = /^[a-zA-Z0-9_-]+$/;

export type ParsedAudience =
  /** A token representing a signed-in user of the project — what the main API accepts. */
  | { type: 'user', projectId: string, userType: UserType }
  /**
   * A token minted by the project's OAuth/OIDC provider for a specific registered resource server
   * (e.g. a customer's MCP server). Deliberately *not* accepted by the main API: it has a different
   * issuer and a different signing key.
   */
  | { type: 'resource', projectId: string, resourceId: string };

const getAudience = (projectId: string, userType: UserType) => {
  // TODO: make the audience a URL, and encode the user type in a better way
  return userType === 'anonymous' ? `${projectId}:${ANONYMOUS_AUDIENCE_SUFFIX}` : userType === 'restricted' ? `${projectId}:${RESTRICTED_AUDIENCE_SUFFIX}` : projectId;
};

/**
 * The audience for a token scoped to a single resource server registered on the project's OAuth
 * provider. Distinct from every user audience, so it derives its own signing keypair.
 */
export const getResourceAudience = (projectId: string, resourceId: string) => {
  if (!AUDIENCE_SEGMENT_PATTERN.test(projectId)) {
    throw new HexclaveAssertionError("Project ID is not a valid audience segment; it must not contain a colon.", { projectId });
  }
  if (!AUDIENCE_SEGMENT_PATTERN.test(resourceId)) {
    throw new HexclaveAssertionError("Resource ID is not a valid audience segment; it must not contain a colon.", { resourceId });
  }
  return `${projectId}:${RESOURCE_AUDIENCE_MARKER}:${resourceId}`;
};

/**
 * Parses an `aud` claim, or returns `null` if it is not a shape we mint.
 *
 * Use this on untrusted input (a JWT presented by a caller). Use `parseAudience` where the audience
 * is ours by construction and an unknown shape is a bug.
 */
export function tryParseAudience(aud: string): ParsedAudience | null {
  const segments = aud.split(":");
  if (!segments.every(segment => AUDIENCE_SEGMENT_PATTERN.test(segment))) return null;

  switch (segments.length) {
    case 1: {
      return { type: 'user', projectId: segments[0], userType: 'normal' };
    }
    case 2: {
      switch (segments[1]) {
        case ANONYMOUS_AUDIENCE_SUFFIX: {
          return { type: 'user', projectId: segments[0], userType: 'anonymous' };
        }
        case RESTRICTED_AUDIENCE_SUFFIX: {
          return { type: 'user', projectId: segments[0], userType: 'restricted' };
        }
        default: {
          return null;
        }
      }
    }
    case 3: {
      if (segments[1] !== RESOURCE_AUDIENCE_MARKER) return null;
      return { type: 'resource', projectId: segments[0], resourceId: segments[2] };
    }
    default: {
      return null;
    }
  }
}

/**
 * Parses an `aud` claim, throwing if it is not a shape we mint.
 *
 * Only for audiences we produced ourselves. For a JWT that came in over the wire, use
 * `tryParseAudience` and turn `null` into a 4xx — an unparsable token is a caller error, not ours.
 */
export function parseAudience(aud: string): ParsedAudience {
  return tryParseAudience(aud) ?? throwErr("Audience is not in any format Hexclave mints. Either it was not minted by us, or the audience format changed without updating `tryParseAudience`.", { aud });
}

import.meta.vitest?.describe("audience parsing", (test) => {
  const projectId = "e0b52f4d-dece-408c-af49-d23061bb0f8d";

  test("round-trips every user audience", ({ expect }) => {
    for (const userType of ['normal', 'restricted', 'anonymous'] as const) {
      expect(parseAudience(getAudience(projectId, userType))).toEqual({ type: 'user', projectId, userType });
    }
  });

  test("round-trips a resource audience", ({ expect }) => {
    expect(parseAudience(getResourceAudience(projectId, "my_mcp-server"))).toEqual({
      type: 'resource',
      projectId,
      resourceId: "my_mcp-server",
    });
  });

  test("parses the `internal` project", ({ expect }) => {
    expect(parseAudience("internal")).toEqual({ type: 'user', projectId: "internal", userType: 'normal' });
  });

  test("user and resource audiences never collide", ({ expect }) => {
    const userAudiences = (['normal', 'restricted', 'anonymous'] as const).map(t => getAudience(projectId, t));
    const resourceAudience = getResourceAudience(projectId, "anon");
    expect(userAudiences).not.toContain(resourceAudience);
  });

  test("rejects unknown shapes rather than guessing", ({ expect }) => {
    const rejected = [
      "",
      ":",
      `${projectId}:`,
      `:${projectId}`,
      `${projectId}:unknown-suffix`,
      // `resource` must be in the marker position, not the suffix position
      `${projectId}:resource`,
      // colons cannot be smuggled into a segment
      `${projectId}:resource:a:b`,
      `${projectId}:anon:extra`,
      // not a marker we mint
      `${projectId}:audience:foo`,
      "a b",
      "https://example.com",
    ];
    for (const aud of rejected) {
      expect(tryParseAudience(aud), `expected ${JSON.stringify(aud)} to be rejected`).toBeNull();
      expect(() => parseAudience(aud)).toThrow();
    }
  });

  test("refuses to mint a resource audience with a colon in it", ({ expect }) => {
    expect(() => getResourceAudience(projectId, "a:b")).toThrow();
    expect(() => getResourceAudience("a:b", "resource")).toThrow();
  });
});

const getUserType = (isAnonymous: boolean, isRestricted: boolean): UserType => {
  if (isAnonymous) return 'anonymous';
  if (isRestricted) return 'restricted';
  return 'normal';
};

export async function getPublicProjectJwkSet(projectId: string, options: { allowRestricted: boolean, allowAnonymous: boolean }) {
  const privateJwks = [
    ...await getPrivateJwks({ audience: getAudience(projectId, 'normal') }),
    ...options.allowRestricted ? await getPrivateJwks({ audience: getAudience(projectId, 'restricted') }) : [],
    ...options.allowAnonymous ? await getPrivateJwks({ audience: getAudience(projectId, 'anonymous') }) : [],
  ];
  return await getPublicJwkSet(privateJwks);
}

export async function decodeAccessToken(accessToken: string, { allowAnonymous, allowRestricted }: { allowAnonymous: boolean, allowRestricted: boolean }) {
  return await traceSpan("decoding access token", async (span) => {

    if (allowAnonymous && !allowRestricted) {
      throw new HexclaveAssertionError("If allowAnonymous is true, allowRestricted must also be true");
    }

    let payload: jose.JWTPayload;
    let decoded: jose.JWTPayload | undefined;
    let parsedAud: ParsedAudience;

    try {
      decoded = jose.decodeJwt(accessToken);
      const aud = decoded.aud?.toString() ?? "";

      // The audience is attacker-controlled at this point (the signature hasn't been checked yet),
      // so an unrecognized shape is a caller error, not an assertion failure.
      const maybeParsedAud = tryParseAudience(aud);
      if (!maybeParsedAud) {
        console.warn("Access token has an audience Hexclave never mints. This might be a user error, but if it happens frequently, it's a sign of a misconfiguration.", { accessToken, aud });
        return Result.error(new KnownErrors.UnparsableAccessToken());
      }
      // A resource-scoped token belongs to a customer's own resource server (e.g. their MCP server)
      // and must never authenticate a request to the main API. `getAllowedIssuers` below would
      // already reject it — the OIDC issuer path is deliberately absent from that list — but
      // rejecting here means the refusal doesn't silently depend on that omission surviving a
      // future refactor. See `parseAudience` for the second, independent layer (distinct signing key).
      if (maybeParsedAud.type !== 'user') {
        console.warn("Resource-scoped access token presented to the main API. These are only valid at the resource server they were minted for.", { accessToken, aud });
        return Result.error(new KnownErrors.UnparsableAccessToken());
      }
      parsedAud = maybeParsedAud;

      // Determine allowed issuers based on what types of tokens we accept
      const projectId = parsedAud.projectId;
      const allowedIssuers = [
        ...getAllowedIssuers(projectId, 'normal'),
        ...(allowRestricted ? getAllowedIssuers(projectId, 'restricted') : []),
        ...(allowAnonymous ? getAllowedIssuers(projectId, 'anonymous') : []),
      ];

      payload = await verifyJWT({
        allowedIssuers,
        jwt: accessToken,
      });
    } catch (error) {
      if (error instanceof JWTExpired) {
        // Best-effort only: an expired token's audience is still untrusted, and it may be a shape we
        // don't recognize. The project ID here is diagnostic (it goes into the error for the SDK to
        // report), never an authorization input.
        const expiredProjectId = tryParseAudience(decoded?.aud?.toString() ?? "")?.projectId;
        const error = new KnownErrors.AccessTokenExpired(
          decoded?.exp ? new Date(decoded.exp * 1000) : undefined,
          expiredProjectId,
          decoded?.sub ?? undefined,
          (decoded?.refresh_token_id ?? decoded?.refreshTokenId) as string | undefined,
        );
        console.log(`[Token decode] Access token expired for project ${expiredProjectId}, user ${decoded?.sub}. This is most likely not an issue, but if it happens frequently, it may be a sign of a misconfiguration.`, error);
        return Result.error(error);
      } else if (error instanceof JOSEError) {
        console.warn("Unparsable access token. This might be a user error, but if it happens frequently, it's a sign of a misconfiguration.", { accessToken, error });
        return Result.error(new KnownErrors.UnparsableAccessToken());
      }
      throw error;
    }

    // TODO next-release: Delete the legacy behavior from here
    const isAnonymous = payload.is_anonymous as boolean;
    // Legacy tokens default to non-restricted; also, anonymous users are always restricted
    const isRestricted = (payload.is_restricted as boolean | undefined) ?? isAnonymous;
    // For legacy anonymous tokens, infer restrictedReason as { type: "anonymous" }
    const restrictedReason = (payload.restricted_reason as RestrictedReason | null | undefined)
      ?? (isAnonymous ? { type: "anonymous" as const } : null);

    // Anonymous users must be restricted
    if (isAnonymous && !isRestricted) {
      throw new HexclaveAssertionError("Unparsable access token. User is anonymous but not restricted.", { accessToken, payload });
    }

    // Enforce consistency between isRestricted and restrictedReason
    if (isRestricted && !restrictedReason) {
      throw new HexclaveAssertionError("Unparsable access token. User is restricted but restrictedReason is missing.", { accessToken, payload });
    }
    if (!isRestricted && restrictedReason) {
      throw new HexclaveAssertionError("Unparsable access token. User is not restricted but restrictedReason is present.", { accessToken, payload });
    }

    // Validate audience matches the user type. The audience selects the signing key, so a mismatch
    // here means we signed a token with the wrong key — a bug on our side, not a caller error.
    const audUserType = parsedAud.userType;
    if ((audUserType === 'anonymous') !== isAnonymous) {
      throw new HexclaveAssertionError("Unparsable access token. The audience's user type disagrees with the token's is_anonymous claim.", { accessToken, payload, audUserType, isAnonymous });
    }
    // Anonymous audiences are implicitly restricted (an anonymous user is always restricted), so
    // they satisfy the restricted check without carrying the `:restricted` suffix.
    if ((audUserType === 'restricted' || audUserType === 'anonymous') !== isRestricted) {
      throw new HexclaveAssertionError("Unparsable access token. The audience's user type disagrees with the token's is_restricted claim.", { accessToken, payload, audUserType, isRestricted });
    }

    const branchId = payload.branch_id ?? payload.branchId;
    if (branchId !== "main") {
      // TODO instead, we should check here that the aud is `projectId#branch` instead
      throw new HexclaveAssertionError("Branch ID !== main not currently supported.");
    }

    const result = await accessTokenSchema.validate({
      projectId: parsedAud.projectId,
      userId: payload.sub,
      branchId: branchId,
      refreshTokenId: payload.refresh_token_id ?? payload.refreshTokenId,
      exp: payload.exp,
      isAnonymous,
      isRestricted,
      restrictedReason,
    });

    return Result.ok(result);
  });
}

type RefreshTokenOptions = {
  tenancy: Tenancy,
  refreshTokenObj: null | {
    projectUserId: string,
    id: string,
    expiresAt: Date | null,
  },
};

type GenerateAccessTokenOptions = RefreshTokenOptions & {
  // Host-derived API URL — gets baked into the new access token's `iss` claim
  // so the issuer host matches the SDK's configured host. Callers from a route
  // handler should pass `getApiUrlForRequest(fullReq)`; callers from a non-
  // request context (background jobs, etc.) should fall back to the
  // deployment's `NEXT_PUBLIC_STACK_API_URL`.
  apiUrl: string,
};

/**
 * Validates a refresh token and returns the user if valid.
 * This function has NO side effects - it doesn't log events or update timestamps.
 * Use this when you just need to check validity without triggering analytics.
 *
 * @returns The user object if the token is valid, null otherwise.
 */
async function validateRefreshTokenAndGetUser(options: RefreshTokenOptions) {
  if (!options.refreshTokenObj) {
    return null;
  }

  if (options.refreshTokenObj.expiresAt && options.refreshTokenObj.expiresAt < new Date()) {
    return null;
  }

  try {
    const user = await usersCrudHandlers.adminRead({
      tenancy: options.tenancy,
      user_id: options.refreshTokenObj.projectUserId,
      allowedErrorTypes: [KnownErrors.UserNotFound],
    });
    return user;
  } catch (error) {
    if (error instanceof KnownErrors.UserNotFound) {
      // The user was deleted — their refresh token still exists because we don't cascade deletes across source-of-truth/global tables.
      // => refresh token is invalid
      return null;
    }
    throw error;
  }
}

/**
 * Checks if a refresh token is valid.
 */
export async function isRefreshTokenValid(options: RefreshTokenOptions) {
  return !!(await validateRefreshTokenAndGetUser(options));
}

/**
 * Generates an access token from a refresh token if the token is valid.
 *
 * This function has side effects:
 * - Updates last active timestamps on the user and session
 * - Logs session activity and token refresh events for analytics
 *
 * @returns The access token string if valid, null otherwise.
 */
export async function generateAccessTokenFromRefreshTokenIfValid(options: GenerateAccessTokenOptions) {
  const user = await validateRefreshTokenAndGetUser(options);
  if (!user || !options.refreshTokenObj) {
    return null;
  }

  // Update last active at on user and session
  const now = new Date();
  const prisma = await getPrismaClientForTenancy(options.tenancy);

  // Get end user IP info for session tracking and event logging
  const ipInfo = await getEndUserIpInfoForEvent();

  // updateMany (instead of update) so a concurrent sign-out / session revocation
  // that deletes the row between the caller's read and this write does not
  // surface as a P2025 500. Update the refresh-token row first so a revoked
  // session stops before touching projectUser.lastActiveAt.
  const refreshTokenUpdate = await globalPrismaClient.projectUserRefreshToken.updateMany({
    where: {
      tenancyId: options.tenancy.id,
      id: options.refreshTokenObj.id,
    },
    data: withExternalDbSyncUpdate({
      lastActiveAt: now,
      lastActiveAtIpInfo: ipInfo ?? undefined,
    }),
  });
  if (refreshTokenUpdate.count === 0) return null;

  const projectUserUpdate = await prisma.projectUser.updateMany({
    where: {
      tenancyId: options.tenancy.id,
      projectUserId: options.refreshTokenObj.projectUserId,
    },
    data: withExternalDbSyncUpdate({
      lastActiveAt: now,
    }),
  });
  if (projectUserUpdate.count === 0) return null;

  // Token refresh runs on every access-token roll, so skip the per-event
  // billing-team DB lookup by threading it through from the tenancy we
  // already have.
  const billingTeamId = getBillingTeamId(options.tenancy.project);

  // Log session activity event (used for metrics, geo info, etc.)
  await logEvent(
    [SystemEventTypes.SessionActivity],
    {
      projectId: options.tenancy.project.id,
      branchId: options.tenancy.branchId,
      userId: options.refreshTokenObj.projectUserId,
      sessionId: options.refreshTokenObj.id,
      isAnonymous: user.is_anonymous,
      teamId: undefined,
    },
    {
      billingTeamId,
    }
  );

  // Log token refresh event for ClickHouse analytics
  await logEvent(
    [SystemEventTypes.TokenRefresh],
    {
      projectId: options.tenancy.project.id,
      branchId: options.tenancy.branchId,
      userId: options.refreshTokenObj.projectUserId,
      refreshTokenId: options.refreshTokenObj.id,
      isAnonymous: user.is_anonymous,
      teamId: undefined,
      ipInfo,
    },
    {
      refreshTokenId: options.refreshTokenObj.id,
      billingTeamId,
    }
  );

  const payload: Omit<AccessTokenPayload, "iss" | "aud" | "iat"> = {
    sub: options.refreshTokenObj.projectUserId,
    project_id: options.tenancy.project.id,
    branch_id: options.tenancy.branchId,
    refresh_token_id: options.refreshTokenObj.id,
    role: 'authenticated',
    name: user.display_name,
    email: user.primary_email,
    email_verified: user.primary_email_verified,
    selected_team_id: user.selected_team_id,
    signed_up_at: Math.floor(user.signed_up_at_millis / 1000),
    is_anonymous: user.is_anonymous,
    is_restricted: user.is_restricted,
    restricted_reason: user.restricted_reason,
    requires_totp_mfa: user.requires_totp_mfa,
  };

  // Validate the payload matches the accessTokenSchema before signing, to catch inconsistencies early
  try {
    await accessTokenSchema.validate({
      projectId: options.tenancy.project.id,
      userId: options.refreshTokenObj.projectUserId,
      branchId: options.tenancy.branchId,
      refreshTokenId: options.refreshTokenObj.id,
      exp: 0, // placeholder, actual exp is set by signJWT
      isAnonymous: user.is_anonymous,
      isRestricted: user.is_restricted,
      restrictedReason: user.restricted_reason,
    });
  } catch (error) {
    captureError("generated-access-token-payload-does-not-fit-the-access-token-schema", new HexclaveAssertionError("Generated access token payload does not fit the accessTokenSchema. This is a bug — the token data is inconsistent.", { cause: error, payload }));
  }

  const userType = getUserType(user.is_anonymous, user.is_restricted);
  return await signJWT({
    issuer: getIssuer(options.tenancy.project.id, userType, options.apiUrl),
    audience: getAudience(options.tenancy.project.id, userType),
    expirationTime: getEnvVariable("STACK_ACCESS_TOKEN_EXPIRATION_TIME", "10min"),
    payload,
  });
}

type CreateRefreshTokenOptions = {
  tenancy: Tenancy,
  projectUserId: string,
  expiresAt?: Date,
  isImpersonation?: boolean,
}

type CreateAuthTokensOptions = CreateRefreshTokenOptions & {
  // See `apiUrl` on GenerateAccessTokenOptions — flows through to the signed
  // access token's `iss` claim.
  apiUrl: string,
};

export async function createRefreshTokenObj(options: CreateRefreshTokenOptions) {
  options.expiresAt ??= new Date(Date.now() + 1000 * 60 * 60 * 24 * 365);
  options.isImpersonation ??= false;

  const refreshToken = generateSecureRandomString();

  const refreshTokenObj = await globalPrismaClient.projectUserRefreshToken.create({
    data: {
      tenancyId: options.tenancy.id,
      projectUserId: options.projectUserId,
      refreshToken: refreshToken,
      expiresAt: options.expiresAt,
      isImpersonation: options.isImpersonation,
    },
  });

  return refreshTokenObj;
}

export async function createAuthTokens(options: CreateAuthTokensOptions) {
  const refreshTokenObj = await createRefreshTokenObj(options);

  const accessToken = await generateAccessTokenFromRefreshTokenIfValid({
    tenancy: options.tenancy,
    refreshTokenObj: refreshTokenObj,
    apiUrl: options.apiUrl,
  }) ?? throwErr("Newly generated refresh token is not valid; this should never happen!", { refreshTokenObj });

  return { refreshToken: refreshTokenObj.refreshToken, accessToken };
}
