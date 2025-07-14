import { createAuthTokens } from "@/lib/tokens";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createVerificationCodeHandler } from "@/route-handlers/verification-code-handler";
import { VerificationCodeType } from "@prisma/client";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { decodeClientDataJSON } from "@simplewebauthn/server/helpers";
import { KnownErrors } from "@stackframe/stack-shared";
import { signInResponseSchema, yupMixed, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { AuthenticationResponseJSON } from "@stackframe/stack-shared/dist/utils/passkey";
import { createMfaRequiredError } from "../../mfa/sign-in/verification-code-handler";

export const passkeySignInVerificationCodeHandler = createVerificationCodeHandler({
  metadata: {
    post: {
      summary: "Sign in with a passkey",
      description: "Sign in with a passkey",
      tags: ["Passkey"],
      hidden: true,
    }
  },
  type: VerificationCodeType.PASSKEY_AUTHENTICATION_CHALLENGE,
  requestBody: yupObject({
    authentication_response: yupMixed<AuthenticationResponseJSON>().defined(),
    code: yupString().defined(),
  }),
  data: yupObject({
    challenge: yupString().defined()
  }),
  method: yupObject({}),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: signInResponseSchema.defined(),
  }),
  async send() {
    throw new StackAssertionError("send() called on a Passkey sign in verification code handler");
  },
  async handler(tenancy, _, { challenge }, { authentication_response }) {

    if (!tenancy.config.passkey_enabled) {
      throw new KnownErrors.PasskeyAuthenticationNotEnabled();
    }


    const credentialId = authentication_response.id;

    const prisma = getPrismaClientForTenancy(tenancy);
    // Get passkey from DB with userHandle
    const passkey = await prisma.passkeyAuthMethod.findFirst({
      where: {
        credentialId,
        tenancyId: tenancy.id,
      },
      include: {
        projectUser: true,
      },
    });


    if (!passkey) {
      throw new KnownErrors.PasskeyAuthenticationFailed("Passkey not found");
    }

    // HACK: we validate origin and rpid outside of simpleauth, this should be replaced once we have a primary authentication domain
    let expectedRPID = "";
    let expectedOrigin = "";
    const clientDataJSON = decodeClientDataJSON(authentication_response.response.clientDataJSON);
    const { origin } = clientDataJSON;
    const localhostAllowed = tenancy.config.allow_localhost;
    const parsedOrigin = new URL(origin);
    const isLocalhost = parsedOrigin.hostname === "localhost";

    if (!localhostAllowed && isLocalhost) {
      throw new KnownErrors.PasskeyAuthenticationFailed("Passkey authentication failed because localhost is not allowed");
    }

    if (localhostAllowed && isLocalhost) {
      expectedRPID = parsedOrigin.hostname;
      expectedOrigin = origin;
    }

    if (!isLocalhost) {
      if (!tenancy.config.domains.map(e => e.domain).includes(parsedOrigin.origin)) {
        throw new KnownErrors.PasskeyAuthenticationFailed("Passkey authentication failed because the origin is not allowed");
      } else {
        expectedRPID = parsedOrigin.hostname;
        expectedOrigin = origin;
      }
    }

    let authVerify;
    authVerify = await verifyAuthenticationResponse({
      response: authentication_response,
      expectedChallenge: challenge,
      expectedOrigin,
      expectedRPID,
      credential: {
        id: passkey.userHandle,
        publicKey: new Uint8Array(Buffer.from(passkey.publicKey, 'base64')),
        counter: passkey.counter,
      },
      requireUserVerification: false,
    });


    if (!authVerify.verified) {
      throw new KnownErrors.PasskeyAuthenticationFailed("The signature of the authentication response could not be verified with the stored public key tied to this credential ID");
    }
    const authenticationInfo = authVerify.authenticationInfo;

    // Update counter
    await prisma.passkeyAuthMethod.update({
      where: {
        tenancyId_projectUserId: {
          tenancyId: tenancy.id,
          projectUserId: passkey.projectUserId,
        }
      },
      data: {
        counter: authenticationInfo.newCounter,
      },
    });

    const user = passkey.projectUser;

    if (user.requiresTotpMfa) {
      throw await createMfaRequiredError({
        project: tenancy.project,
        branchId: tenancy.branchId,
        isNewUser: false,
        userId: user.projectUserId,
      });
    }

    const { refreshToken, accessToken } = await createAuthTokens({
      tenancy,
      projectUserId: user.projectUserId,
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        refresh_token: refreshToken,
        access_token: accessToken,
        is_new_user: false,
        user_id: user.projectUserId,
      },
    };
  },
});
