import { getRequestContextAndBotChallengeAssessment, botChallengeFlowRequestSchemaFields } from "@/lib/turnstile";
import { serializeStoredSignUpRequestContext } from "@/lib/sign-up-context";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, clientOrHigherAuthTypeSchema, emailOtpSignInCallbackUrlSchema, signInEmailSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
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
      ...botChallengeFlowRequestSchemaFields,
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
  async handler({ auth: { tenancy }, body: { email, callback_url: callbackUrl, ...botChallenge }, clientVersion }) {
    if (!tenancy.config.auth.otp.allowSignIn) {
      throw new StatusError(StatusError.Forbidden, "OTP sign-in is not enabled for this project");
    }

    await ensureUserForEmailAllowsOtp(tenancy, email);

    const { requestContext, turnstileAssessment } = await getRequestContextAndBotChallengeAssessment(botChallenge, "send_magic_link_email", tenancy);

    const { nonce } = await signInVerificationCodeHandler.sendCode(
      {
        tenancy,
        callbackUrl,
        method: { email },
        data: {
          turnstile_result: turnstileAssessment.status,
          turnstile_visible_challenge_result: turnstileAssessment.visibleChallengeResult,
          ...serializeStoredSignUpRequestContext(requestContext),
        },
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
