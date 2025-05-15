import { usersCrudHandlers } from "@/app/api/latest/users/crud";
import { prismaClient } from "@/prisma-client";
import { CrudHandlerInvocationError } from "@/route-handlers/crud-handler";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { adaptSchema, clientOrHigherAuthTypeSchema, contactChannelIdSchema, emailVerificationCallbackUrlSchema, userIdOrMeSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { contactChannelVerificationCodeHandler } from "../../../verify/verification-code-handler";

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Send contact channel verification code",
    description: "Send a code to the user's contact channel for verifying the contact channel.",
    tags: ["Contact Channels"],
  },
  request: yupObject({
    params: yupObject({
      user_id: userIdOrMeSchema.defined().meta({ openapiField: { description: "The user to send the verification code to.", exampleValue: 'me' } }),
      contact_channel_id: contactChannelIdSchema.defined().meta({ openapiField: { description: "The contact channel to send the verification code to.", exampleValue: 'b3d396b8-c574-4c80-97b3-50031675ceb2' } }),
    }).defined(),
    auth: yupObject({
      type: clientOrHigherAuthTypeSchema,
      tenancy: adaptSchema.defined(),
      user: adaptSchema.optional(),
    }).defined(),
    body: yupObject({
      callback_url: emailVerificationCallbackUrlSchema.defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["success"]).defined(),
  }),
  async handler({ auth, body: { callback_url: callbackUrl }, params }) {
    let user;
    if (auth.type === "client") {
      const currentUserId = auth.user?.id || throwErr(new KnownErrors.CannotGetOwnUserWithoutUser());
      if (currentUserId !== params.user_id) {
        throw new StatusError(StatusError.BadRequest, "Can only send verification code for your own user");
      }
      user = auth.user || throwErr("User not found");
    } else {
      try {
        user = await usersCrudHandlers.adminRead({
          tenancy: auth.tenancy,
          user_id: params.user_id
        });
      } catch (e) {
        if (e instanceof CrudHandlerInvocationError && KnownErrors.UserNotFound.isInstance(e.cause)) {
          throw new KnownErrors.UserIdDoesNotExist(params.user_id);
        }
        throw e;
      }
    }

    const contactChannel = await prismaClient.contactChannel.findUnique({
      where: {
        tenancyId_projectUserId_id: {
          tenancyId: auth.tenancy.id,
          projectUserId: user.id,
          id: params.contact_channel_id,
        },
        type: "EMAIL",
      },
    });

    if (!contactChannel) {
      throw new StatusError(StatusError.NotFound, "Contact channel not found");
    }

    if (contactChannel.isVerified) {
      throw new KnownErrors.EmailAlreadyVerified();
    }

    await contactChannelVerificationCodeHandler.sendCode({
      tenancy: auth.tenancy,
      data: {
        user_id: user.id,
      },
      method: {
        email: contactChannel.value,
      },
      callbackUrl,
    }, {
      user,
    });

    return {
      statusCode: 200,
      bodyType: "success",
    };
  },
});
