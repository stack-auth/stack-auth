import { getAuthContactChannelWithEmailNormalization } from "@/lib/contact-channel";
import { getApiUrlForRequest } from "@/lib/request-api-url";
import { createAuthTokens } from "@/lib/tokens";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@hexclave/shared";
import { adaptSchema, clientOrHigherAuthTypeSchema, emailSchema, passwordSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { HexclaveAssertionError, throwErr } from "@hexclave/shared/dist/utils/errors";
import { comparePassword } from "@hexclave/shared/dist/utils/hashes";
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
      email: emailSchema.defined().nonEmpty(),
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
    if (!tenancy.config.auth.password.allowSignIn) {
      throw new KnownErrors.PasswordAuthenticationNotEnabled();
    }

    const prisma = await getPrismaClientForTenancy(tenancy);
    const contactChannel = await getAuthContactChannelWithEmailNormalization(
      prisma,
      {
        tenancyId: tenancy.id,
        type: "EMAIL",
        value: email,
      }
    );

    const passwordAuthMethod = contactChannel?.contact.projectUser?.authMethods.find((m) => m.passwordAuthMethod)?.passwordAuthMethod;

    // we compare the password even if the authMethod doesn't exist to prevent timing attacks
    if (!await comparePassword(password, passwordAuthMethod?.passwordHash || "")) {
      throw new KnownErrors.EmailPasswordMismatch();
    }

    if (!contactChannel || !passwordAuthMethod) {
      throw new HexclaveAssertionError("This should never happen (the comparePassword call should've already caused this to fail)");
    }

    const projectUser = contactChannel.contact.projectUser
      ?? throwErr("Auth contact channel is missing its ProjectUser", { contactChannelId: contactChannel.id });

    if (projectUser.requiresTotpMfa) {
      throw await createMfaRequiredError({
        project: tenancy.project,
        branchId: tenancy.branchId,
        isNewUser: false,
        userId: projectUser.projectUserId,
      });
    }

    const { refreshToken, accessToken } = await createAuthTokens({
      tenancy,
      projectUserId: projectUser.projectUserId,
      apiUrl: getApiUrlForRequest(fullReq),
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        access_token: accessToken,
        refresh_token: refreshToken,
        user_id: projectUser.projectUserId,
      }
    };
  },
});
