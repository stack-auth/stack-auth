import { prismaClient } from "@/prisma-client";
import { createVerificationCodeHandler } from "@/route-handlers/verification-code-handler";
import { VerificationCodeType } from "@prisma/client";
import { yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { generateSecureRandomString } from "@stackframe/stack-shared/dist/utils/crypto";

export const setupCodeVerificationCodeHandler = createVerificationCodeHandler({
  metadata: {
    post: {
      hidden: true,
    },
  },
  type: VerificationCodeType.SETUP,
  data: yupObject({}).defined(),
  method: yupObject({}).defined(),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      publishableClientKey: yupString().defined(),
      secretServerKey: yupString().defined(),
    }).defined(),
  }),
  async handler(tenancy, data) {
    const set = await prismaClient.apiKeySet.create({
      data: {
        projectId: tenancy.project.id,
        description: "Key generated for init script",
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365 * 100), // 100 years
        publishableClientKey: `pck_${generateSecureRandomString()}`,
        secretServerKey: `ssk_${generateSecureRandomString()}`,
      }
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        publishableClientKey: set.publishableClientKey,
        secretServerKey: set.secretServerKey,
      },
    };
  },
});
