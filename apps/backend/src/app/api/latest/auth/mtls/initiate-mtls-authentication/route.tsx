import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@hexclave/shared";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { generateMtlsChallenge } from "@hexclave/shared/dist/utils/mtls";
import { mtlsSignInVerificationCodeHandler } from "../sign-in/verification-code-handler";

const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Initialize mTLS authentication",
    description: "Create a challenge that the client signs with the certificate's private key to sign in.",
    tags: ["mTLS"],
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: clientOrHigherAuthTypeSchema,
      tenancy: adaptSchema,
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      challenge: yupString().defined(),
      code: yupString().defined(),
    }).defined(),
  }),
  async handler({ auth: { tenancy } }) {
    if (!tenancy.config.auth.mtls.allowSignIn) {
      throw new KnownErrors.MtlsAuthenticationNotEnabled();
    }

    const challenge = generateMtlsChallenge();
    const { code } = await mtlsSignInVerificationCodeHandler.createCode({
      tenancy,
      method: {},
      expiresInMs: SIGN_IN_TIMEOUT_MS,
      data: { challenge },
      callbackUrl: undefined,
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: { challenge, code },
    };
  },
});
