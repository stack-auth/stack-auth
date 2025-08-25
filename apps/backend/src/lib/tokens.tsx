import { usersCrudHandlers } from '@/app/api/latest/users/crud';
import { globalPrismaClient } from '@/prisma-client';
import { Prisma } from '@prisma/client';
import { KnownErrors } from '@stackframe/stack-shared';
import { yupBoolean, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { generateSecureRandomString } from '@stackframe/stack-shared/dist/utils/crypto';
import { getEnvVariable } from '@stackframe/stack-shared/dist/utils/env';
import { throwErr } from '@stackframe/stack-shared/dist/utils/errors';
import { getPrivateJwks, getPublicJwkSet, signJWT, verifyJWT } from '@stackframe/stack-shared/dist/utils/jwt';
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
  isAnonymous: yupBoolean().defined(),
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

const getIssuer = (projectId: string, isAnonymous: boolean) => {
  const url = new URL(`/api/v1/projects${isAnonymous ? "-anonymous-users" : ""}/${projectId}`, getEnvVariable("NEXT_PUBLIC_STACK_API_URL"));
  return url.toString();
};
const getAudience = (projectId: string, isAnonymous: boolean) => {
  // TODO: make the audience a URL, and encode the anonymity in a better way
  return isAnonymous ? `${projectId}:anon` : projectId;
};

export async function getPublicProjectJwkSet(projectId: string, allowAnonymous: boolean) {
  const privateJwks = [
    ...await getPrivateJwks({ audience: getAudience(projectId, false) }),
    ...allowAnonymous ? await getPrivateJwks({ audience: getAudience(projectId, true) }) : [],
  ];
  return await getPublicJwkSet(privateJwks);
}

export async function decodeAccessToken(accessToken: string, { allowAnonymous }: { allowAnonymous: boolean }) {
  return await traceSpan("decoding access token", async (span) => {
    let payload: jose.JWTPayload;
    let decoded: jose.JWTPayload | undefined;
    let aud;

    try {
      decoded = jose.decodeJwt(accessToken);
      aud = decoded.aud?.toString() ?? "";

      payload = await verifyJWT({
        allowedIssuers: [
          getIssuer(aud.split(":")[0], false),
          ...(allowAnonymous ? [getIssuer(aud.split(":")[0], true)] : []),
        ],
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

    const isAnonymous = payload.role === 'anon';
    if (aud.endsWith(":anon") && !isAnonymous) {
      console.warn("Unparsable access token. Role is set to anon, but audience is not an anonymous audience.", { accessToken, payload });
      return Result.error(new KnownErrors.UnparsableAccessToken());
    } else if (!aud.endsWith(":anon") && isAnonymous) {
      console.warn("Unparsable access token. Audience is not an anonymous audience, but role is set to anon.", { accessToken, payload });
      return Result.error(new KnownErrors.UnparsableAccessToken());
    }

    const result = await accessTokenSchema.validate({
      projectId: aud.split(":")[0],
      userId: payload.sub,
      branchId: payload.branchId,
      refreshTokenId: payload.refreshTokenId,
      exp: payload.exp,
      isAnonymous: payload.role === 'anon',
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

  const user = await usersCrudHandlers.adminRead({
    tenancy: options.tenancy,
    user_id: options.userId,
  });

  return await signJWT({
    issuer: getIssuer(options.tenancy.project.id, user.is_anonymous),
    audience: getAudience(options.tenancy.project.id, user.is_anonymous),
    payload: {
      sub: options.userId,
      branchId: options.tenancy.branchId,
      refreshTokenId: options.refreshTokenId,
      role: user.is_anonymous ? 'anon' : 'authenticated',
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
