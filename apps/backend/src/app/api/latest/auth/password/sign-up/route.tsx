import { validateRedirectUrl } from "@/lib/redirect-urls";
import { createAuthTokens } from "@/lib/tokens";
import { createOrUpgradeAnonymousUser } from "@/lib/users";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { runAsynchronouslyAndWaitUntil } from "@/utils/vercel";
import { KnownErrors } from "@stackframe/stack-shared";
import { getPasswordError } from "@stackframe/stack-shared/dist/helpers/password";
import { adaptSchema, clientOrHigherAuthTypeSchema, emailVerificationCallbackUrlSchema, passwordSchema, signInEmailSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { contactChannelVerificationCodeHandler } from "../../../contact-channels/verify/verification-code-handler";
import { createMfaRequiredError } from "../../mfa/sign-in/verification-code-handler";

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Sign up with email and password",
    description: "Create a new account with email and password",
    tags: ["Password"],
  },
  request: yupObject({
    auth: yupObject({
      type: clientOrHigherAuthTypeSchema,
      tenancy: adaptSchema,
      user: adaptSchema.optional()
    }).defined(),
    body: yupObject({
      email: signInEmailSchema.defined(),
      password: passwordSchema.defined(),
      verification_callback_url: emailVerificationCallbackUrlSchema.defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      access_token: yupString().defined(),
      refresh_token: yupString().defined(),
      user_id: yupString().defined(),
    }).defined(),
  }),
  async handler({ auth: { tenancy, user: currentUser }, body: { email, password, verification_callback_url: verificationCallbackUrl } }, fullReq) {
    if (!tenancy.config.auth.password.allowSignIn) {
      throw new KnownErrors.PasswordAuthenticationNotEnabled();
    }

    if (!validateRedirectUrl(verificationCallbackUrl, tenancy)) {
      throw new KnownErrors.RedirectUrlNotWhitelisted();
    }

    if (!tenancy.config.auth.allowSignUp) {
      throw new KnownErrors.SignUpNotEnabled();
    }

    const passwordError = getPasswordError(password);
    if (passwordError) {
      throw passwordError;
    }

    const createdUser = await createOrUpgradeAnonymousUser(
      tenancy,
      currentUser ?? null,
      {
        primary_email: email,
        primary_email_verified: false,
        primary_email_auth_enabled: true,
        password,
      },
      [KnownErrors.UserWithEmailAlreadyExists]
    );

    runAsynchronouslyAndWaitUntil((async () => {
      await contactChannelVerificationCodeHandler.sendCode({
        tenancy,
        data: {
          user_id: createdUser.id,
        },
        method: {
          email,
        },
        callbackUrl: verificationCallbackUrl,
      }, {
        user: createdUser,
      });
    })());

    if (createdUser.requires_totp_mfa) {
      throw await createMfaRequiredError({
        project: tenancy.project,
        branchId: tenancy.branchId,
        isNewUser: true,
        userId: createdUser.id,
      });
    }

    const { refreshToken, accessToken } = await createAuthTokens({
      tenancy,
      projectUserId: createdUser.id,
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        access_token: accessToken,
        refresh_token: refreshToken,
        user_id: createdUser.id,
      },
    };
  },
});
