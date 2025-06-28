import { createVerificationCodeHandler } from "@/route-handlers/verification-code-handler";
import { VerificationCodeType } from "@prisma/client";
import { yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";

export const unsubscribeLinkVerificationCodeHandler = createVerificationCodeHandler({
  type: VerificationCodeType.ONE_TIME_PASSWORD,
  data: yupObject({
    user_id: yupString().defined(),
    notification_category_id: yupString().defined(),
  }),
  // @ts-expect-error handler functions are not used for this verificationCodeHandler
  async handler() {
    return null;
  },
});
