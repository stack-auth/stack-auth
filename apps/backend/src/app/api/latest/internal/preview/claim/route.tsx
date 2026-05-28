import { claimPreviewPoolLease, fillPreviewPool } from "@/lib/preview-pool";
import { getApiUrlForRequest } from "@/lib/request-api-url";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { runAsynchronouslyAndWaitUntil } from "@/utils/background-tasks";
import { yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Claim a preview dashboard lease",
    description: "Claims a pre-seeded isolated dashboard preview project and returns a short-lived dashboard session. Only available in preview mode.",
    tags: ["Internal"],
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({}).nullable().optional(),
    body: yupObject({}).optional().default({}),
    method: yupString().oneOf(["POST"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      project_id: yupString().defined(),
      user_id: yupString().defined(),
      access_token: yupString().defined(),
      refresh_token: yupString().defined(),
    }).defined(),
  }),
  async handler(_req, fullReq) {
    const lease = await claimPreviewPoolLease({ apiUrl: getApiUrlForRequest(fullReq) });
    runAsynchronouslyAndWaitUntil(fillPreviewPool({ maxCreate: 1 }));

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        project_id: lease.projectId,
        user_id: lease.userId,
        access_token: lease.accessToken,
        refresh_token: lease.refreshToken,
      },
    };
  },
});

