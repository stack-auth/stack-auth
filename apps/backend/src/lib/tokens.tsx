import { usersCrudHandlers } from '@/app/api/latest/users/crud';
import { getPrismaClientForTenancy, globalPrismaClient } from '@/prisma-client';
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
import { getEndUserInfo } from './end-users';
import { SystemEventTypes, logEvent } from './events';
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

    const isAnonymous = payload.is_anonymous as boolean;
    const isRestricted = payload.is_restricted as boolean;

    // Validate audience matches the user type
    if (aud.endsWith(":anon") && !isAnonymous) {
      console.warn("Unparsable access token. Role is set to anon, but audience is not an anonymous audience.", { accessToken, payload });
      return Result.error(new KnownErrors.UnparsableAccessToken());
    } else if (!aud.endsWith(":anon") && isAnonymous) {
      console.warn("Unparsable access token. Audience is not an anonymous audience, but role is set to anon.", { accessToken, payload });
      return Result.error(new KnownErrors.UnparsableAccessToken());
    }
    if (aud.endsWith(":restricted") && !isRestricted) {
      console.warn("Unparsable access token. User is restricted, but audience is not a restricted audience.", { accessToken, payload });
      return Result.error(new KnownErrors.UnparsableAccessToken());
    } else if (!aud.endsWith(":restricted") && isRestricted && !isAnonymous) {
      console.warn("Unparsable access token. Audience is not a restricted audience, but user is restricted.", { accessToken, payload });
      return Result.error(new KnownErrors.UnparsableAccessToken());
    }

    const branchId = payload.branch_id ?? payload.branchId;
    if (branchId !== "main") {
      // TODO instead, we should check here that the aud is `projectId#branch` instead
      throw new StackAssertionError("Branch ID !== main not currently supported.");
    }

    const restrictedReason = payload.restricted_reason as { type: "anonymous" | "email_not_verified" } | null | undefined ?? null;

    const result = await accessTokenSchema.validate({
      projectId: aud.split(":")[0],
      userId: payload.sub,
      branchId: branchId,
      refreshTokenId: payload.refresh_token_id ?? payload.refreshTokenId,
      exp: payload.exp,
      isAnonymous: payload.is_anonymous ?? /* legacy, now we always set role to authenticated, TODO next-release remove */ payload.role === 'anon',
      isRestricted,
      restrictedReason,
    });

    return Result.ok(result);
  });
}

export async function isRefreshTokenValid(options: {
  tenancy: Tenancy,
  refreshTokenObj: null | {
    projectUserId: string,
    id: string,
    expiresAt: Date | null,
  },
}) {
  return !!await generateAccessTokenFromRefreshTokenIfValid(options);
}

export async function generateAccessTokenFromRefreshTokenIfValid(options: {
  tenancy: Tenancy,
  refreshTokenObj: null | {
    projectUserId: string,
    id: string,
    expiresAt: Date | null,
  },
}) {
  if (!options.refreshTokenObj) {
    return null;
  }

  if (options.refreshTokenObj.expiresAt && options.refreshTokenObj.expiresAt < new Date()) {
    return null;
  }

  let user;
  try {
    user = await usersCrudHandlers.adminRead({
      tenancy: options.tenancy,
      user_id: options.refreshTokenObj.projectUserId,
      allowedErrorTypes: [KnownErrors.UserNotFound],
    });
  } catch (error) {
    if (error instanceof KnownErrors.UserNotFound) {
      // The user was deleted — their refresh token still exists because we don't cascade deletes across source-of-truth/global tables.
      // => refresh token is invalid
      return null;
    }
    throw error;
  }

  // Update last active at on user and session
  const now = new Date();
  const prisma = await getPrismaClientForTenancy(options.tenancy);

  // Get end user IP info for session tracking
  const endUserInfo = await getEndUserInfo();
  const ipInfo = endUserInfo ? (endUserInfo.maybeSpoofed ? endUserInfo.spoofedInfo : endUserInfo.exactInfo) : undefined;

  await Promise.all([
    prisma.projectUser.update({
      where: {
        tenancyId_projectUserId: {
          tenancyId: options.tenancy.id,
          projectUserId: options.refreshTokenObj.projectUserId,
        },
      },
      data: {
        lastActiveAt: now,
      },
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
        lastActiveAtIpInfo: ipInfo,
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
