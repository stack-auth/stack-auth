import { getAuthContactChannel } from "@/lib/contact-channel";
import { createAuthTokens } from "@/lib/tokens";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { adaptSchema, clientOrHigherAuthTypeSchema, emailSchema, passwordSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { comparePassword } from "@stackframe/stack-shared/dist/utils/hashes";
import { createMfaRequiredError } from "../../mfa/sign-in/verification-code-handler";

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Sign in with email and password",
    description: "Sign in to an account with email and password",
    tags: ["Password"],
  },
  request: yupObject({
    auth: yupObject({
      type: clientOrHigherAuthTypeSchema,
      tenancy: adaptSchema,
    }).defined(),
    body: yupObject({
      email: emailSchema.defined(),
      password: passwordSchema.defined(),
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
  async handler({ auth: { tenancy }, body: { email, password } }, fullReq) {
    if (!tenancy.config.credential_enabled) {
      throw new KnownErrors.PasswordAuthenticationNotEnabled();
    }

    const prisma = getPrismaClientForTenancy(tenancy);
    const contactChannel = await getAuthContactChannel(
      prisma,
      {
        tenancyId: tenancy.id,
        type: "EMAIL",
        value: email,
      }
    );

    const passwordAuthMethod = contactChannel?.projectUser.authMethods.find((m) => m.passwordAuthMethod)?.passwordAuthMethod;

    // we compare the password even if the authMethod doesn't exist to prevent timing attacks
    if (!await comparePassword(password, passwordAuthMethod?.passwordHash || "")) {
      throw new KnownErrors.EmailPasswordMismatch();
    }

    if (!contactChannel || !passwordAuthMethod) {
      throw new StackAssertionError("This should never happen (the comparePassword call should've already caused this to fail)");
    }

    if (contactChannel.projectUser.requiresTotpMfa) {
      throw await createMfaRequiredError({
        project: tenancy.project,
        branchId: tenancy.branchId,
        isNewUser: false,
        userId: contactChannel.projectUser.projectUserId,
      });
    }

    const { refreshToken, accessToken } = await createAuthTokens({
      tenancy,
      projectUserId: contactChannel.projectUser.projectUserId,
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        access_token: accessToken,
        refresh_token: refreshToken,
        user_id: contactChannel.projectUser.projectUserId,
      }
    };
  },
});
