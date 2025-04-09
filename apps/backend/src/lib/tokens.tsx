import { prismaClient } from '@/prisma-client';
import { traceSpan } from '@/utils/telemetry';
import { Prisma } from '@prisma/client';
import { KnownErrors } from '@stackframe/stack-shared';
import { yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { generateSecureRandomString } from '@stackframe/stack-shared/dist/utils/crypto';
import { getEnvVariable } from '@stackframe/stack-shared/dist/utils/env';
import { throwErr } from '@stackframe/stack-shared/dist/utils/errors';
import { legacyVerifyGlobalJWT, signJWT, verifyJWT } from '@stackframe/stack-shared/dist/utils/jwt';
import { Result } from '@stackframe/stack-shared/dist/utils/results';
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

const jwtIssuer = "https://access-token.jwt-signature.stack-auth.com";

export async function decodeAccessToken(accessToken: string) {
  return await traceSpan("decoding access token", async (span) => {
    let payload: jose.JWTPayload;
    let decoded: jose.JWTPayload | undefined;
    try {
      decoded = jose.decodeJwt(accessToken);

      if (!decoded.aud) {
        payload = await legacyVerifyGlobalJWT(jwtIssuer, accessToken);
      } else {
        payload = await verifyJWT({
          issuer: jwtIssuer,
          jwt: accessToken,
        });
      }
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
      branchId: payload.branchId ?? "main",  // TODO remove the main fallback once old tokens have expired
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
    issuer: jwtIssuer,
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
    const refreshTokenObj = await prismaClient.projectUserRefreshToken.create({
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
        `prisma.projectUserRefreshToken.create() failed for tenancyId ${options.tenancy.id} and projectUserId ${options.projectUserId}: ${error.message}`,
        { cause: error }
      ));
    }
    throw error;
  }


}
