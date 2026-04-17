import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupNumber, yupObject, yupRecord, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { getLatestPageVersions } from "@stackframe/stack-shared/dist/interface/handler-urls";

export const GET = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    method: yupString().oneOf(["GET"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      versions: yupRecord(yupString().defined(), yupObject({
        version: yupNumber().defined(),
        changelogs: yupRecord(yupString().defined(), yupString().defined()).defined(),
      }).defined()).defined(),
    }).defined(),
  }),
  handler: async () => {
    return {
      statusCode: 200,
      bodyType: "json" as const,
      body: {
        versions: getLatestPageVersions(),
      },
    };
  },
});
