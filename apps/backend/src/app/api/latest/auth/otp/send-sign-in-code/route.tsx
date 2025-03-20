import { getAuthContactChannel } from "@/lib/contact-channel";
import { prismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { adaptSchema, clientOrHigherAuthTypeSchema, emailOtpSignInCallbackUrlSchema, signInEmailSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import semver from "semver";
import { usersCrudHandlers } from "../../../users/crud";
import { signInVerificationCodeHandler } from "../sign-in/verification-code-handler";

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
      nonce: yupString().defined(),
    }).defined(),
  }),
  async handler({ auth: { tenancy }, body: { email, callback_url: callbackUrl }, clientVersion }, fullReq) {
    if (!tenancy.config.magic_link_enabled) {
      throw new StatusError(StatusError.Forbidden, "Magic link is not enabled for this project");
    }

    const contactChannel = await getAuthContactChannel(
      prismaClient,
      {
        tenancyId: tenancy.id,
        type: "EMAIL",
        value: email,
      }
    );

    let user;
    let isNewUser;

    if (contactChannel) {
      const otpAuthMethod = contactChannel.projectUser.authMethods.find((m) => m.otpAuthMethod)?.otpAuthMethod;

      if (contactChannel.isVerified) {
        if (!otpAuthMethod) {
          // automatically merge the otp auth method with the existing account

          // TODO: use an existing crud handler
          const rawProject = await prismaClient.project.findUnique({
            where: {
              id: tenancy.project.id,
            },
            include: {
              config: {
                include: {
                  authMethodConfigs: {
                    include: {
                      otpConfig: true,
                    }
                  }
                }
              }
            }
          });

          const otpAuthMethodConfig = rawProject?.config.authMethodConfigs.find((m) => m.otpConfig) ?? throwErr("OTP auth method config not found.");
          await prismaClient.authMethod.create({
            data: {
              projectUserId: contactChannel.projectUser.projectUserId,
              tenancyId: tenancy.id,
              projectConfigId: tenancy.config.id,
              authMethodConfigId: otpAuthMethodConfig.id,
            },
          });
        }

        user = await usersCrudHandlers.adminRead({
          tenancy,
          user_id: contactChannel.projectUser.projectUserId,
        });
      } else {
        throw new KnownErrors.UserWithEmailAlreadyExists(contactChannel.value);
      }
      isNewUser = false;
    } else {
      if (!tenancy.config.sign_up_enabled) {
        throw new KnownErrors.SignUpNotEnabled();
      }
      isNewUser = true;
    }

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
        data: {
          user_id: user?.id,
          is_new_user: isNewUser,
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
