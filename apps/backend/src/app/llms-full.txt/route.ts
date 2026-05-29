import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { llmsFullTxt, llmsTextHeaders } from "@hexclave/shared/dist/ai/llms/llms";
import { yupNumber, yupObject, yupString, yupTuple } from "@hexclave/shared/dist/schema-fields";

export const GET = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    method: yupString().oneOf(["GET", "HEAD"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["text"]).defined(),
    body: yupString().defined(),
    headers: yupObject({
      "Cache-Control": yupTuple([yupString().defined()]).defined(),
      "Access-Control-Allow-Origin": yupTuple([yupString().defined()]).defined(),
      "Access-Control-Allow-Methods": yupTuple([yupString().defined()]).defined(),
      "Access-Control-Allow-Headers": yupTuple([yupString().defined()]).defined(),
      "Content-Type": yupTuple([yupString().defined()]).defined(),
    }).defined(),
  }),
  handler: async () => {
    return {
      statusCode: 200,
      bodyType: "text",
      body: llmsFullTxt,
      headers: {
        "Cache-Control": [llmsTextHeaders["Cache-Control"]] as const,
        "Access-Control-Allow-Origin": [llmsTextHeaders["Access-Control-Allow-Origin"]] as const,
        "Access-Control-Allow-Methods": [llmsTextHeaders["Access-Control-Allow-Methods"]] as const,
        "Access-Control-Allow-Headers": [llmsTextHeaders["Access-Control-Allow-Headers"]] as const,
        "Content-Type": [llmsTextHeaders["Content-Type"]] as const,
      },
    };
  },
});

export const HEAD = GET;
