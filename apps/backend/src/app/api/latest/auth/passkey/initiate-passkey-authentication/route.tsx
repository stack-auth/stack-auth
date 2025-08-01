import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { isoUint8Array } from "@simplewebauthn/server/helpers";
import { KnownErrors } from "@stackframe/stack-shared";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupMixed, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { PublicKeyCredentialRequestOptionsJSON } from "@stackframe/stack-shared/dist/utils/passkey";
import { passkeySignInVerificationCodeHandler } from "../sign-in/verification-code-handler";

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Initialize passkey authentication",
    description: "Create a challenge for passkey authentication",
    tags: ["Passkey"],
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: clientOrHigherAuthTypeSchema,
      tenancy: adaptSchema,
    }).defined()
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      options_json: yupMixed().defined(),
      code: yupString().defined(),
    }).defined(),
  }),
  async handler({ auth: { tenancy } }) {

    if (!tenancy.config.auth.passkey.allowSignIn) {
      throw new KnownErrors.PasskeyAuthenticationNotEnabled();
    }

    const SIGN_IN_TIMEOUT_MS = 60000;

    const authenticationOptions: PublicKeyCredentialRequestOptionsJSON = await generateAuthenticationOptions({
      rpID: "THIS_VALUE_WILL_BE_REPLACED.example.com", // HACK: will be overridden in the frontend to be the actual domain, this is a temporary solution until we have a primary authentication domain
      userVerification: "preferred",
      challenge: getEnvVariable("STACK_ENABLE_HARDCODED_PASSKEY_CHALLENGE_FOR_TESTING", "") ? isoUint8Array.fromUTF8String("MOCK") : undefined,
      allowCredentials: [],
      timeout: SIGN_IN_TIMEOUT_MS,
    });


    const { code } = await passkeySignInVerificationCodeHandler.createCode({
      tenancy,
      method: {},
      expiresInMs: SIGN_IN_TIMEOUT_MS + 5000,
      data: {
        challenge: authenticationOptions.challenge
      },
      callbackUrl: undefined
    });


    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        options_json: authenticationOptions,
        code,
      },
    };
  },
});
