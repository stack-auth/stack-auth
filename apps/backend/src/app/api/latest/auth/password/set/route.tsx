import { getPrismaClientForTenancy, retryTransaction } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { getPasswordError } from "@stackframe/stack-shared/dist/helpers/password";
import { adaptSchema, clientOrHigherAuthTypeSchema, passwordSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StackAssertionError, StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { hashPassword } from "@stackframe/stack-shared/dist/utils/hashes";

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Set password",
    description: "Set a new password for the current user",
    tags: ["Password"],
  },
  request: yupObject({
    auth: yupObject({
      type: clientOrHigherAuthTypeSchema,
      tenancy: adaptSchema,
      user: adaptSchema.defined(),
    }).defined(),
    body: yupObject({
      password: passwordSchema.defined(),
    }).defined(),
    headers: yupObject({}).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["success"]).defined(),
  }),
  async handler({ auth: { tenancy, user }, body: { password } }) {
    if (!tenancy.config.credential_enabled) {
      throw new KnownErrors.PasswordAuthenticationNotEnabled();
    }

    const passwordError = getPasswordError(password);
    if (passwordError) {
      throw passwordError;
    }

    const prisma = getPrismaClientForTenancy(tenancy);
    await retryTransaction(prisma, async (tx) => {
      const authMethods = await tx.passwordAuthMethod.findMany({
        where: {
          tenancyId: tenancy.id,
          projectUserId: user.id,
        },
      });

      if (authMethods.length > 1) {
        throw new StackAssertionError("User has multiple password auth methods.", {
          tenancyId: tenancy.id,
          projectUserId: user.id,
        });
      } else if (authMethods.length === 1) {
        throw new StatusError(StatusError.BadRequest, "User already has a password set.");
      }

      await tx.authMethod.create({
        data: {
          tenancyId: tenancy.id,
          projectUserId: user.id,
          passwordAuthMethod: {
            create: {
              passwordHash: await hashPassword(password),
              projectUserId: user.id,
            }
          }
        }
      });
    });

    return {
      statusCode: 200,
      bodyType: "success",
    };
  },
});
