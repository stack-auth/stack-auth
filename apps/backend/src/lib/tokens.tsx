import { globalPrismaClient } from '@/prisma-client';
import { Prisma } from '@prisma/client';
import { KnownErrors } from '@stackframe/stack-shared';
import { yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { generateSecureRandomString } from '@stackframe/stack-shared/dist/utils/crypto';
import { getEnvVariable } from '@stackframe/stack-shared/dist/utils/env';
import { throwErr } from '@stackframe/stack-shared/dist/utils/errors';
import { signJWT, verifyJWT } from '@stackframe/stack-shared/dist/utils/jwt';
import { Result } from '@stackframe/stack-shared/dist/utils/results';
import { traceSpan } from '@stackframe/stack-shared/dist/utils/telemetry';
import * as jose from 'jose';
import { JOSEError, JWTExpired } from 'jose/errors';
import { SystemEventTypes, logEvent } from './events';
import { Tenancy } from './tenancies';

export const authorizationHeaderSchema = yupString().matches(/^StackSession [^ ]+$/);

const accessTokenSchema = yupObject({
  projectId: yupString().defined(),
  userId: yupString().defined(),
  branchId: yupString().defined(),
  // we make it optional to keep backwards compatibility with old tokens for a while
  // TODO next-release
  refreshTokenId: yupString().optional(),
  exp: yupNumber().defined(),
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

const getIssuer = (projectId: string) => {
  const url = new URL(`/api/v1/projects/${projectId}`, getEnvVariable("NEXT_PUBLIC_STACK_API_URL"));
  return url.toString();
};

const legacyIssuer = "access-token.jwt-signature.stack-auth.com";

export async function decodeAccessToken(accessToken: string) {
  return await traceSpan("decoding access token", async (span) => {
    let payload: jose.JWTPayload;
    let decoded: jose.JWTPayload | undefined;

    try {
      decoded = jose.decodeJwt(accessToken);

      let expectedIssuer: string;
      // TODO: next-release: This is for backwards compatibility with old tokens
      if (decoded.iss === legacyIssuer) {
        expectedIssuer = legacyIssuer;
      } else {
        expectedIssuer = getIssuer(decoded.aud?.toString() ?? "");
      }

      payload = await verifyJWT({
        issuer: expectedIssuer,
        jwt: accessToken,
      });
    } catch (error) {
      if (error instanceof JWTExpired) {
        return Result.error(new KnownErrors.AccessTokenExpired(decoded?.exp ? new Date(decoded.exp * 1000) : undefined));
      } else if (error instanceof JOSEError) {
        return Result.error(new KnownErrors.UnparsableAccessToken());
      }
      throw error;
    }

    const result = await accessTokenSchema.validate({
      projectId: payload.aud || payload.projectId,
      userId: payload.sub,
      branchId: payload.branchId,
      refreshTokenId: payload.refreshTokenId,
      exp: payload.exp,
    });

    return Result.ok(result);
  });
}

export async function generateAccessToken(options: {
  tenancy: Tenancy,
  userId: string,
  refreshTokenId: string,
}) {
  await logEvent(
    [SystemEventTypes.SessionActivity],
    {
      projectId: options.tenancy.project.id,
      branchId: options.tenancy.branchId,
      userId: options.userId,
      sessionId: options.refreshTokenId,
    }
  );

  return await signJWT({
    issuer: getIssuer(options.tenancy.project.id),
    audience: options.tenancy.project.id,
    payload: {
      sub: options.userId,
      branchId: options.tenancy.branchId,
      refreshTokenId: options.refreshTokenId,
      role: 'authenticated',
    },
    expirationTime: getEnvVariable("STACK_ACCESS_TOKEN_EXPIRATION_TIME", "10min"),
  });
}

export async function createAuthTokens(options: {
  tenancy: Tenancy,
  projectUserId: string,
  expiresAt?: Date,
  isImpersonation?: boolean,
}) {
  options.expiresAt ??= new Date(Date.now() + 1000 * 60 * 60 * 24 * 365);
  options.isImpersonation ??= false;

  const refreshToken = generateSecureRandomString();

  try {
    const refreshTokenObj = await globalPrismaClient.projectUserRefreshToken.create({
      data: {
        tenancyId: options.tenancy.id,
        projectUserId: options.projectUserId,
        refreshToken: refreshToken,
        expiresAt: options.expiresAt,
        isImpersonation: options.isImpersonation,
      },
    });

    const accessToken = await generateAccessToken({
      tenancy: options.tenancy,
      userId: options.projectUserId,
      refreshTokenId: refreshTokenObj.id,
    });


    return { refreshToken, accessToken };

  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      throwErr(new Error(
        `Auth token creation failed for tenancyId ${options.tenancy.id} and projectUserId ${options.projectUserId}: ${error.message}`,
        { cause: error }
      ));
    }
    throw error;
  }
}
