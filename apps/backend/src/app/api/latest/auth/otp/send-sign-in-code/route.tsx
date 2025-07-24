import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, clientOrHigherAuthTypeSchema, emailOtpSignInCallbackUrlSchema, signInEmailSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import semver from "semver";
import { ensureUserForEmailAllowsOtp, signInVerificationCodeHandler } from "../sign-in/verification-code-handler";

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Send sign-in code",
    description: "Send a code to the user's email address for sign-in.",
    tags: ["OTP"],
  },
  request: yupObject({
    auth: yupObject({
      type: clientOrHigherAuthTypeSchema,
      tenancy: adaptSchema,
    }).defined(),
    body: yupObject({
      email: signInEmailSchema.defined(),
      callback_url: emailOtpSignInCallbackUrlSchema.defined(),
    }).defined(),
    clientVersion: yupObject({
      version: yupString().optional(),
      sdk: yupString().optional(),
    }).optional(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      nonce: yupString().defined().meta({ openapiField: { description: "A token that must be stored temporarily and provided when verifying the 6-digit code", exampleValue: "u3h6gn4w24pqc8ya679inrhjwh1rybth6a7thurqhnpf2" } }),
    }).defined(),
  }),
  async handler({ auth: { tenancy }, body: { email, callback_url: callbackUrl }, clientVersion }, fullReq) {
    if (!tenancy.config.auth.otp.allowSignIn) {
      throw new StatusError(StatusError.Forbidden, "OTP sign-in is not enabled for this project");
    }

    const user = await ensureUserForEmailAllowsOtp(tenancy, email);

    let type: "legacy" | "standard";
    if (clientVersion?.sdk === "@stackframe/stack" && semver.valid(clientVersion.version) && semver.lte(clientVersion.version, "2.5.37")) {
      type = "legacy";
    } else {
      type = "standard";
    }

    const { nonce } = await signInVerificationCodeHandler.sendCode(
      {
        tenancy,
        callbackUrl,
        method: { email, type },
        data: {},
      },
      { email }
    );

    return {
      statusCode: 200,
      bodyType: "json",
      body: { nonce },
    };
  },
});
