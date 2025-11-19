import { runEmailQueueStep } from "@/lib/email-queue-step";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupBoolean, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { wait } from "@stackframe/stack-shared/dist/utils/promises";

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "Process email queue step",
    description: "Internal endpoint invoked by Vercel Cron to advance the email sending pipeline.",
    tags: ["Emails"],
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({}).nullable().optional(),
    method: yupString().oneOf(["GET"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      ok: yupBoolean().defined(),
    }).defined(),
  }),
  handler: async (_req, fullReq) => {
    const startTime = performance.now();

    while (performance.now() - startTime < 2 * 60 * 1000) {
      await runEmailQueueStep();
      await wait(1000);
    }

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        ok: true,
      },
    };
  },
});
