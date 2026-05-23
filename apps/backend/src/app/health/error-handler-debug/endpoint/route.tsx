import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";

export const dynamic = "force-dynamic";

export const GET = createSmartRouteHandler({
  request: yupObject({}),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["success"]).defined(),
  }),
  handler: async (req) => {
    throw new HexclaveAssertionError(`Server debug error thrown successfully!`);
  },
});
