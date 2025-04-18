import { retryTransaction } from "@/prisma-client";
import { createVerificationCodeHandler } from "@/route-handlers/verification-code-handler";
import { VerificationCodeType } from "@prisma/client";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { decodeClientDataJSON } from "@simplewebauthn/server/helpers";
import { KnownErrors } from "@stackframe/stack-shared";
import { yupMixed, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { RegistrationResponseJSON } from "@stackframe/stack-shared/dist/utils/passkey";

export const registerVerificationCodeHandler = createVerificationCodeHandler({
  metadata: {
    post: {
      summary: "Set a new passkey",
      description: "Sign in with a passkey",
      tags: ["Passkey"],
      hidden: true,
    }
  },
  type: VerificationCodeType.PASSKEY_REGISTRATION_CHALLENGE,
  requestBody: yupObject({
    credential: yupMixed<RegistrationResponseJSON>().defined(),
    code: yupString().defined(),
  }),
  data: yupObject({
    challenge: yupString().defined(),
    userHandle: yupString().defined(),
  }),
  method: yupObject({
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      user_handle: yupString().defined(),
    }),
  }),
  async send() {
    throw new StackAssertionError("send() called on a Passkey registration verification code handler");
  },
  async handler(tenancy, _, { challenge }, { credential }, user) {
    if (!tenancy.config.passkey_enabled) {
      throw new KnownErrors.PasskeyAuthenticationNotEnabled();
    }

    if (!user) {
      throw new StackAssertionError("User not found", {
        tenancyId: tenancy.id,
      });
    }

    // HACK: we validate origin and rpid outside of simpleauth, this should be replaced once we have a primary authentication domain

    let expectedRPID = "";
    let expectedOrigin = "";
    const clientDataJSON = decodeClientDataJSON(credential.response.clientDataJSON);
    const { origin } = clientDataJSON;
    const localhostAllowed = tenancy.config.allow_localhost;
    const parsedOrigin = new URL(origin);
    const isLocalhost = parsedOrigin.hostname === "localhost";

    if (!localhostAllowed && isLocalhost) {
      throw new KnownErrors.PasskeyAuthenticationFailed("Passkey registration failed because localhost is not allowed");
    }

    if (localhostAllowed && isLocalhost) {
      expectedRPID = parsedOrigin.hostname;
      expectedOrigin = origin;
    }

    if (!isLocalhost) {
      if (!tenancy.config.domains.map(e => e.domain).includes(parsedOrigin.origin)) {
        throw new KnownErrors.PasskeyAuthenticationFailed("Passkey registration failed because the origin is not allowed");
      } else {
        expectedRPID = parsedOrigin.hostname;
        expectedOrigin = origin;
      }
    }


    let verification;
    verification = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge: challenge,
      expectedOrigin,
      expectedRPID,
      expectedType: "webauthn.create",
      // we don't need user verification for most websites, in the future this might be an option. See https://simplewebauthn.dev/docs/advanced/passkeys#verifyregistrationresponse
      requireUserVerification: false,
    });


    if (!verification.verified || !verification.registrationInfo) {
      throw new KnownErrors.PasskeyRegistrationFailed("Passkey registration failed because the verification response is invalid");
    }

    const registrationInfo = verification.registrationInfo;

    await retryTransaction(async (tx) => {
      const authMethods = await tx.passkeyAuthMethod.findMany({
        where: {
          tenancyId: tenancy.id,
          projectUserId: user.id,
        },
      });

      if (authMethods.length > 1) {
        // We do not support multiple passkeys per user yet
        throw new StackAssertionError("User has multiple passkey auth methods.", {
          tenancyId: tenancy.id,
          projectUserId: user.id,
        });
      }

      if (authMethods.length === 0) {
        // Create new passkey auth method
        await tx.authMethod.create({
          data: {
            tenancyId: tenancy.id,
            projectUserId: user.id,
            passkeyAuthMethod: {
              create: {
                publicKey: Buffer.from(registrationInfo.credential.publicKey).toString('base64url'),
                projectUserId: user.id,
                userHandle: registrationInfo.credential.id,
                credentialId: registrationInfo.credential.id,
                transports: registrationInfo.credential.transports,
                credentialDeviceType: registrationInfo.credentialDeviceType,
                counter: registrationInfo.credential.counter,
              }
            }
          }
        });
      } else {
        // Update existing passkey auth method
        await tx.passkeyAuthMethod.update({
          where: {
            tenancyId_projectUserId: {
              tenancyId: tenancy.id,
              projectUserId: user.id,
            }
          },
          data: {
            publicKey: Buffer.from(registrationInfo.credential.publicKey).toString('base64url'),
            userHandle: registrationInfo.credential.id,
            credentialId: registrationInfo.credential.id,
            transports: registrationInfo.credential.transports,
            credentialDeviceType: registrationInfo.credentialDeviceType,
            counter: registrationInfo.credential.counter,
          }
        });
      }
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        user_handle: registrationInfo.credential.id,
      },
    };
  },
});
