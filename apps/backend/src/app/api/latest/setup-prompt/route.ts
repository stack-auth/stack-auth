import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { getSdkSetupPrompt } from "@stackframe/stack-shared/dist/ai/prompts";
import { yupNumber, yupObject, yupString, yupTuple } from "@stackframe/stack-shared/dist/schema-fields";

export const GET = createSmartRouteHandler({
  metadata: {
    hidden: true,
    summary: "SDK setup prompt",
    description: "Returns the AI setup prompt used by Stack docs.",
    tags: [],
  },
  request: yupObject({
    method: yupString().oneOf(["GET"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["text"]).defined(),
    body: yupString().defined(),
    headers: yupObject({
      "Cache-Control": yupTuple([yupString().defined()]).defined(),
    }).defined(),
  }),
  handler: async () => {
    return {
      statusCode: 200,
      bodyType: "text",
      body: getSdkSetupPrompt("ai-prompt", { tanstackQuery: false }),
      headers: {
        "Cache-Control": ["public, max-age=60"] as const,
      },
    };
  },
});
