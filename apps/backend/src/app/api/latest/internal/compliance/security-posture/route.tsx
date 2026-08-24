import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, adminAuthTypeSchema, yupArray, yupBoolean, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

export const GET = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      controls: yupArray(yupObject({
        key: yupString().defined(),
        label: yupString().defined(),
        enabled: yupBoolean().defined(),
        value: yupString().optional(),
        recommendation: yupString().optional(),
      }).defined()).defined(),
    }).defined(),
  }),
  handler: async (req) => {
    const config = req.auth.tenancy.config;
    const rules = Object.values(config.auth.signUpRules);
    const enabledRules = rules.filter((rule) => rule.enabled === true);
    const rejectingRules = enabledRules.filter((rule) => rule.action.type === "reject");
    const restrictingRules = enabledRules.filter((rule) => rule.action.type === "restrict");
    const providers = Object.entries(config.auth.oauth.providers)
      .filter(([, provider]) => provider.type !== undefined && provider.allowSignIn === true)
      .map(([id]) => id);
    const controls = [
      {
        key: "email_verification_required",
        label: "Email verification required",
        enabled: config.onboarding.requireEmailVerification === true,
        recommendation: config.onboarding.requireEmailVerification === true ? undefined : "Require email verification for stronger account ownership evidence.",
      },
      {
        key: "otp_enabled",
        label: "OTP sign-in enabled",
        enabled: config.auth.otp.allowSignIn === true,
      },
      {
        key: "password_enabled",
        label: "Password sign-in enabled",
        enabled: config.auth.password.allowSignIn === true,
      },
      {
        key: "passkey_enabled",
        label: "Passkey sign-in enabled",
        enabled: config.auth.passkey.allowSignIn === true,
      },
      {
        key: "sign_up_rules_configured",
        label: "Sign-up rules configured",
        enabled: enabledRules.length > 0,
        value: String(enabledRules.length),
      },
      {
        key: "sign_up_rules_reject",
        label: "Sign-up rules reject access",
        enabled: rejectingRules.length > 0,
        value: String(rejectingRules.length),
      },
      {
        key: "sign_up_rules_restrict",
        label: "Sign-up rules restrict users",
        enabled: restrictingRules.length > 0,
        value: String(restrictingRules.length),
      },
      {
        key: "oauth_providers",
        label: "OAuth providers configured",
        enabled: providers.length > 0,
        value: providers.join(", "),
      },
    ];
    return {
      statusCode: 200 as const,
      bodyType: "json" as const,
      body: { controls },
    };
  },
});
