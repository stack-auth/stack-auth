import { usersCrudHandlers } from '@/app/api/latest/users/crud';
import { getPrismaClientForTenancy, globalPrismaClient } from '@/prisma-client';
import { withExternalDbSyncUpdate } from '@/lib/external-db-sync';
import { KnownErrors } from '@stackframe/stack-shared';
import { yupBoolean, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { AccessTokenPayload } from '@stackframe/stack-shared/dist/sessions';
import { generateSecureRandomString } from '@stackframe/stack-shared/dist/utils/crypto';
import { getEnvVariable } from '@stackframe/stack-shared/dist/utils/env';
import { StackAssertionError, throwErr } from '@stackframe/stack-shared/dist/utils/errors';
import { getPrivateJwks, getPublicJwkSet, signJWT, verifyJWT } from '@stackframe/stack-shared/dist/utils/jwt';
import { Result } from '@stackframe/stack-shared/dist/utils/results';
import { traceSpan } from '@stackframe/stack-shared/dist/utils/telemetry';
import * as jose from 'jose';
import { JOSEError, JWTExpired } from 'jose/errors';
import { SystemEventTypes, getEndUserIpInfoForEvent, logEvent } from './events';
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
  restrictedReason: yupObject({
    type: yupString().oneOf(["anonymous", "email_not_verified"] as const).defined(),
  }).nullable().defined(),
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
});

type UserType = 'normal' | 'restricted' | 'anonymous';

const getIssuer = (projectId: string, userType: UserType) => {
  const suffix = userType === 'anonymous' ? '-anonymous-users' : userType === 'restricted' ? '-restricted-users' : '';
  const url = new URL(`/api/v1/projects${suffix}/${projectId}`, getEnvVariable("NEXT_PUBLIC_STACK_API_URL"));
  return url.toString();
};
const getAudience = (projectId: string, userType: UserType) => {
  // TODO: make the audience a URL, and encode the user type in a better way
  return userType === 'anonymous' ? `${projectId}:anon` : userType === 'restricted' ? `${projectId}:restricted` : projectId;
};

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
      throw new StackAssertionError("If allowAnonymous is true, allowRestricted must also be true");
    }

    let payload: jose.JWTPayload;
    let decoded: jose.JWTPayload | undefined;
    let aud;

    try {
      decoded = jose.decodeJwt(accessToken);
      aud = decoded.aud?.toString() ?? "";

      // Determine allowed issuers based on what types of tokens we accept
      const projectId = aud.split(":")[0];
      const allowedIssuers = [
        getIssuer(projectId, 'normal'),
        ...(allowRestricted ? [getIssuer(projectId, 'restricted')] : []),
        ...(allowAnonymous ? [getIssuer(projectId, 'anonymous')] : []),
      ];

      payload = await verifyJWT({
        allowedIssuers,
        jwt: accessToken,
      });
    } catch (error) {
      if (error instanceof JWTExpired) {
        return Result.error(new KnownErrors.AccessTokenExpired(decoded?.exp ? new Date(decoded.exp * 1000) : undefined));
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
    const restrictedReason = (payload.restricted_reason as { type: "anonymous" | "email_not_verified" } | null | undefined)
      ?? (isAnonymous ? { type: "anonymous" as const } : null);

    // Anonymous users must be restricted
    if (isAnonymous && !isRestricted) {
      throw new StackAssertionError("Unparsable access token. User is anonymous but not restricted.", { accessToken, payload });
    }

    // Enforce consistency between isRestricted and restrictedReason
    if (isRestricted && !restrictedReason) {
      throw new StackAssertionError("Unparsable access token. User is restricted but restrictedReason is missing.", { accessToken, payload });
    }
    if (!isRestricted && restrictedReason) {
      throw new StackAssertionError("Unparsable access token. User is not restricted but restrictedReason is present.", { accessToken, payload });
    }

    // Validate audience matches the user type
    if (aud.endsWith(":anon") && !isAnonymous) {
      throw new StackAssertionError("Unparsable access token. Audience is an anonymous audience, but user is not anonymous.", { accessToken, payload });
    } else if (!aud.endsWith(":anon") && isAnonymous) {
      throw new StackAssertionError("Unparsable access token. Audience is not an anonymous audience, but user is anonymous.", { accessToken, payload });
    }
    if (aud.endsWith(":restricted") && !isRestricted) {
      throw new StackAssertionError("Unparsable access token. User is not restricted, but audience is a restricted audience.", { accessToken, payload });
    } else if (!aud.endsWith(":restricted") && isRestricted && !isAnonymous) {
      throw new StackAssertionError("Unparsable access token. Audience is not a restricted audience, but user is restricted.", { accessToken, payload });
    }

    const branchId = payload.branch_id ?? payload.branchId;
    if (branchId !== "main") {
      // TODO instead, we should check here that the aud is `projectId#branch` instead
      throw new StackAssertionError("Branch ID !== main not currently supported.");
    }

    const result = await accessTokenSchema.validate({
      projectId: aud.split(":")[0],
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
export async function generateAccessTokenFromRefreshTokenIfValid(options: RefreshTokenOptions) {
  const user = await validateRefreshTokenAndGetUser(options);
  if (!user || !options.refreshTokenObj) {
    return null;
  }

  // Update last active at on user and session
  const now = new Date();
  const prisma = await getPrismaClientForTenancy(options.tenancy);

  // Get end user IP info for session tracking and event logging
  const ipInfo = await getEndUserIpInfoForEvent();

  await Promise.all([
    prisma.projectUser.update({
      where: {
        tenancyId_projectUserId: {
          tenancyId: options.tenancy.id,
          projectUserId: options.refreshTokenObj.projectUserId,
        },
      },
      data: withExternalDbSyncUpdate({
        lastActiveAt: now,
      }),
    }),
    globalPrismaClient.projectUserRefreshToken.update({
      where: {
        tenancyId_id: {
          tenancyId: options.tenancy.id,
          id: options.refreshTokenObj.id,
        },
      },
      data: {
        lastActiveAt: now,
        lastActiveAtIpInfo: ipInfo ?? undefined,
      },
    }),
  ]);

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
    is_anonymous: user.is_anonymous,
    is_restricted: user.is_restricted,
    restricted_reason: user.restricted_reason,
  };

  const userType = getUserType(user.is_anonymous, user.is_restricted);
  return await signJWT({
    issuer: getIssuer(options.tenancy.project.id, userType),
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

export async function createAuthTokens(options: CreateRefreshTokenOptions) {
  const refreshTokenObj = await createRefreshTokenObj(options);

  const accessToken = await generateAccessTokenFromRefreshTokenIfValid({
    tenancy: options.tenancy,
    refreshTokenObj: refreshTokenObj,
  }) ?? throwErr("Newly generated refresh token is not valid; this should never happen!", { refreshTokenObj });

  return { refreshToken: refreshTokenObj.refreshToken, accessToken };
}
